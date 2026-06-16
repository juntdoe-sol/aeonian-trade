/**
 * Notification fan-out: when a trader opens or closes a trade, create one
 * `notifications` doc per follower of that trader.
 *
 * Called from the /api/phoenix/record-trade route AFTER the phoenixTradeRecord
 * write succeeds. The backend signs as PROJECT_VAULT_ADDRESS, which is the only
 * wallet allowed to create notifications.
 *
 * COVERAGE: record-trade fires for every Flight-routed Phoenix order — cross AND
 * isolated, opens AND closes (the frontend close handlers also POST record-trade).
 * So fan-out here covers all observable trade events. The one gap is the same as
 * the points gap: if a social/Privy wallet's auth token can't be refreshed, the
 * frontend skips the record-trade POST entirely, so no notification is produced.
 *
 * SECURITY: the `trader` address is validated against SOLANA_ADDRESS_RE at the
 * route before this is called, so interpolating it into the where-clause is safe
 * (base58 charset only — no query-injection surface).
 */

import { getManyFollows } from '../collections/follows.js';
import { getSocialLinks } from '../collections/socialLinks.js';
import { setMany, Address, Time } from '../db-client.js';
import { buildNotifications } from '../collections/notifications.js';

interface FanOutParams {
  trader: string;
  type: 'open' | 'close';
  symbol: string;
  side: 'long' | 'short';
  /** Signed realized PnL in cents — only meaningful for closes. */
  pnlUsdCents?: number;
  /**
   * Realized PnL as a percentage of the position's margin (cost basis) — only
   * meaningful for closes. e.g. 75 = +75% return on margin. Used together with
   * pnlUsdCents to flag a "big win".
   */
  pnlPct?: number;
}

/**
 * A close is a "big win" when the trader realized a meaningful profit:
 *   - realized PnL >= +$500 (>= 50000 cents), OR
 *   - realized PnL >= +50% of the position's margin (cost basis).
 * Either condition qualifies. Only positive-PnL closes can be big wins — opens
 * and losses never are.
 */
const BIG_WIN_CENTS = 50000; // $500
const BIG_WIN_PCT = 50; // +50% of margin
function isBigWin(params: FanOutParams): boolean {
  if (params.type !== 'close') return false;
  const cents = params.pnlUsdCents;
  if (typeof cents !== 'number' || cents <= 0) return false;
  if (cents >= BIG_WIN_CENTS) return true;
  if (typeof params.pnlPct === 'number' && params.pnlPct >= BIG_WIN_PCT) return true;
  return false;
}

/** Resolve a trader's linked X/Twitter @username, if any. Best-effort. */
async function resolveActorName(trader: string): Promise<string | undefined> {
  try {
    // socialLinks key format: social:{wallet}:{provider}
    const link = await getSocialLinks(`social:${trader}:twitter`);
    if (!link?.profile) return undefined;
    const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
    const username = parsed?.username;
    return typeof username === 'string' && username.length > 0 ? username : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fan out a notification to every follower of `trader`. Never throws — a failed
 * fan-out must not break the user-facing trade flow that already succeeded.
 *
 * @returns the number of notifications created (0 if no followers / on error).
 */
export async function notifyFollowers(params: FanOutParams): Promise<number> {
  try {
    // 1. Who follows this trader?
    const followers = await getManyFollows(`followed = '${params.trader}'`);
    if (!followers || followers.length === 0) return 0;

    // 2. Resolve the trader's X handle once (cached display name on each notif).
    const actorName = await resolveActorName(params.trader);

    // 3. Build one notification per follower.
    const bigWin = isBigWin(params);
    const nowSec = Math.floor(Date.now() / 1000);
    const ops = followers
      .map((f) => f.follower)
      .filter((recipient): recipient is string => typeof recipient === 'string' && recipient.length >= 32)
      // A trader could theoretically follow themselves via a stale doc — never notify self.
      .filter((recipient) => recipient !== params.trader)
      .map((recipient) => {
        // Deterministic id so the same trade event can't double-notify the same
        // follower (idempotent if record-trade is retried).
        const notificationId = `${params.trader.slice(0, 8)}-${recipient.slice(0, 8)}-${params.type}-${params.symbol}-${nowSec}`;
        return buildNotifications(notificationId, {
          recipient: Address.publicKey(recipient),
          actor: Address.publicKey(params.trader),
          ...(actorName ? { actorName } : {}),
          type: params.type,
          symbol: params.symbol,
          side: params.side,
          ...(params.type === 'close' && typeof params.pnlUsdCents === 'number'
            ? { pnlUsdCents: Math.round(params.pnlUsdCents) }
            : {}),
          ...(bigWin ? { bigWin: true } : {}),
          createdAt: Time.Now,
          read: false,
        });
      });

    if (ops.length === 0) return 0;

    const ok = await setMany(ops);
    if (!ok) {
      console.warn(`[notify-followers] setMany returned false for trader=${params.trader.slice(0, 8)}… (${ops.length} notifs)`);
      return 0;
    }
    return ops.length;
  } catch (err) {
    console.error('[notify-followers] fan-out failed:', err);
    return 0;
  }
}

interface LiquidationFanOutParams {
  /** The liquidated trader's wallet. */
  trader: string;
  /** Market symbol of the liquidated position (e.g. "SOL"). */
  symbol: string;
  /** Direction of the liquidated position. */
  side: 'long' | 'short';
}

/**
 * Fan out a 'liquidated' notification when a trader is liquidated. Notifies:
 *   - every follower of the liquidated trader (recipient = follower), AND
 *   - the liquidated trader themselves (recipient = actor = trader) as a
 *     self-notification.
 *
 * Reuses the same follower-lookup, actorName resolution, and notification-write
 * paths as notifyFollowers. pnlUsdCents/bigWin are intentionally absent — a
 * liquidation is a wipeout, never framed as a PnL/win event. Never throws.
 *
 * @returns the number of notifications created (0 on error / no recipients).
 */
export async function notifyLiquidation(params: LiquidationFanOutParams): Promise<number> {
  try {
    // 1. Who follows this trader? (self-notification is added regardless of followers)
    const followers = await getManyFollows(`followed = '${params.trader}'`);

    // 2. Resolve the trader's cached display name once (same path as trade fan-out).
    const actorName = await resolveActorName(params.trader);

    // 3. Recipient set: all valid followers (excluding the trader's own follow doc)
    //    PLUS the trader themselves (self-notification). De-dupe so the trader
    //    can't get two copies if a stale self-follow doc exists.
    const recipients = new Set<string>();
    for (const f of followers ?? []) {
      const r = f.follower;
      if (typeof r === 'string' && r.length >= 32 && r !== params.trader) {
        recipients.add(r);
      }
    }
    // Self-notification — the liquidated trader is always notified.
    recipients.add(params.trader);

    const nowSec = Math.floor(Date.now() / 1000);
    const ops = Array.from(recipients).map((recipient) => {
      // Deterministic id so a retried detection can't double-notify the same recipient.
      const notificationId = `${params.trader.slice(0, 8)}-${recipient.slice(0, 8)}-liquidated-${params.symbol}-${params.side}-${nowSec}`;
      return buildNotifications(notificationId, {
        recipient: Address.publicKey(recipient),
        actor: Address.publicKey(params.trader),
        ...(actorName ? { actorName } : {}),
        type: 'liquidated',
        symbol: params.symbol,
        side: params.side,
        // pnlUsdCents/bigWin intentionally absent for liquidations.
        createdAt: Time.Now,
        read: false,
      });
    });

    if (ops.length === 0) return 0;

    const ok = await setMany(ops);
    if (!ok) {
      console.warn(`[notify-followers] liquidation setMany returned false for trader=${params.trader.slice(0, 8)}… (${ops.length} notifs)`);
      return 0;
    }
    return ops.length;
  } catch (err) {
    console.error('[notify-followers] liquidation fan-out failed:', err);
    return 0;
  }
}
