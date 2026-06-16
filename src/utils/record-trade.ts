/**
 * Records a Phoenix order placed via the Flight SDK to the backend so that
 * trading points are awarded and a queryable `phoenixTradeRecord` row is written
 * (the PnL leaderboard reads from those records).
 *
 * WHY THIS EXISTS:
 * Cross-margin orders that used to go through the `phoenixOrder` collection had
 * their points + trade-record side-effects produced by that collection's offchain
 * create hook. Once cross-margin orders are routed through Flight (for builder-fee
 * collection) they bypass the collection entirely, so we must re-create those
 * side-effects by POSTing to /api/phoenix/record-trade after a successful Flight tx.
 *
 * AUTH TOKEN GOTCHA (Privy / social wallets):
 * `getIdToken()` can return null for social-login (Privy embedded) wallets even
 * after the user is fully logged in, because Privy establishes its session
 * asynchronously. A bare `if (token)` guard would silently skip the call for those
 * users — exactly the bug that previously zeroed out social-wallet trading points.
 * So we refresh the Poof session via `login()` and retry once before giving up.
 */
import { getIdToken } from '@pooflabs/web';
import { createAuthenticatedApiClient } from '@/lib/api-client';

export interface RecordTradePayload {
  /** Confirmed on-chain tx signature from the Flight order. */
  txSignature: string;
  /** Trader wallet address (must match the authenticated wallet). */
  trader: string;
  /** Phoenix market pubkey (base58). */
  market: string;
  /** Symbol e.g. "SOL-PERP". */
  symbol: string;
  side: 'long' | 'short';
  /** Size in base lots (integer) — NOT human-readable base units. */
  sizeBaseLots: number;
  leverage: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** 0 for cross margin. */
  subaccountIndex: number;
  /** Notional size in USD (integer). */
  sizeUsd: number;
  /**
   * True when this order closes/reduces an existing position (vs opening a new
   * one). Drives the follower notification copy ("closed" vs "opened").
   */
  isClose?: boolean;
  /**
   * Signed realized PnL in cents for a close (e.g. -1250 = −$12.50). Only sent
   * for closes; surfaced to followers in their notification.
   */
  pnlUsdCents?: number;
  /**
   * Realized PnL as a percentage of the position's margin (cost basis), e.g.
   * 75 = +75% return on margin. Only sent for closes. Used by the backend to
   * flag "big win" notifications (>= +50% qualifies). Computed at the close
   * call site as (pnl * leverage) / notional * 100, since margin = notional /
   * leverage. Omitted when leverage/notional aren't available.
   */
  pnlPct?: number;
}

/**
 * POST the trade record. Returns true if the record was written (points awarded),
 * false otherwise. NEVER throws — recording is a best-effort side-effect that must
 * not break the user-facing "order placed" flow that already succeeded on-chain.
 *
 * @param payload   The trade details (sizeBaseLots must be integer base lots).
 * @param login     The `login` function from useAuth(), used to refresh a null token.
 */
export async function recordFlightTrade(
  payload: RecordTradePayload,
  login: () => Promise<unknown>,
): Promise<boolean> {
  try {
    let token = await getIdToken();

    // Social/Privy wallets may not have a token ready yet — refresh and retry once.
    if (!token) {
      try {
        await login();
      } catch (loginErr) {
        console.warn('[record-trade] login() refresh failed:', loginErr);
      }
      token = await getIdToken();
    }

    if (!token) {
      console.warn(
        '[record-trade] No auth token after refresh — trade NOT recorded (points/leaderboard skipped).',
        { trader: payload.trader, txSignature: payload.txSignature },
      );
      return false;
    }

    const authApi = createAuthenticatedApiClient(token, payload.trader);

    // Only send optional numeric fields when they are real positive values —
    // the backend Zod schema rejects null and requires .positive() for these.
    const body: Record<string, unknown> = {
      txSignature: payload.txSignature,
      trader: payload.trader,
      market: payload.market,
      symbol: payload.symbol,
      side: payload.side,
      sizeBaseLots: Math.floor(payload.sizeBaseLots),
      leverage: Math.max(1, Math.floor(payload.leverage)),
      orderType: payload.orderType,
      subaccountIndex: payload.subaccountIndex,
      sizeUsd: Math.max(0, Math.floor(payload.sizeUsd)),
    };
    if (payload.limitPrice != null && payload.limitPrice > 0) body.limitPrice = payload.limitPrice;
    if (payload.stopLoss != null && payload.stopLoss > 0) body.stopLoss = payload.stopLoss;
    if (payload.takeProfit != null && payload.takeProfit > 0) body.takeProfit = payload.takeProfit;
    if (payload.isClose) body.isClose = true;
    if (payload.isClose && payload.pnlUsdCents != null && Number.isFinite(payload.pnlUsdCents)) {
      body.pnlUsdCents = Math.round(payload.pnlUsdCents);
    }
    if (payload.isClose && payload.pnlPct != null && Number.isFinite(payload.pnlPct)) {
      body.pnlPct = payload.pnlPct;
    }

    await authApi.post('/api/phoenix/record-trade', body);
    return true;
  } catch (err) {
    // The on-chain order already succeeded; a failed record is non-fatal.
    console.error('[record-trade] Failed to record Flight trade:', err);
    return false;
  }
}
