/**
 * Notification: when the monthly-reward-finalize Heartbeat task finalizes a
 * month's prize pot, create one `notifications` doc (type 'monthly_reward') for
 * EACH of the 3 winners, telling them they placed (rank 1/2/3) and can claim.
 *
 * Called from the monthly-reward-finalize Heartbeat AFTER the winners + allotment
 * docs are written. The backend signs as PROJECT_VAULT_ADDRESS, which is the only
 * wallet allowed to create notifications.
 *
 * The notifications collection has a fixed field shape (recipient, actor,
 * actorName, type, symbol, side, pnlUsdCents, createdAt, read, bigWin) — there is
 * no title/body/link field. The frontend NotificationBell renders copy based on
 * `type`. We reuse the existing fields:
 *   - type     = 'monthly_reward'
 *   - recipient = the winner (self-notification)
 *   - actor     = the winner (self-notification; actor === recipient)
 *   - symbol    = the monthKey ("YYYY_MM") — the bell formats it to "June 2026"
 *   - side      = the rank as a string ('1' | '2' | '3')
 *
 * Idempotency: this is only called from the already-idempotent finalize path
 * (which runs at most once per month), so winners are notified exactly once. The
 * notificationId is also deterministic (keyed by monthKey + winner) as a second
 * guard against a duplicate write.
 *
 * Best-effort: a failed notification must never abort or un-finalize the month —
 * finalization + allotments are the source of truth. Never throws.
 */

import { getSocialLinks } from '../collections/socialLinks.js';
import { setNotifications } from '../collections/notifications.js';
import { Address, Time } from '../db-client.js';

/** Resolve a wallet's linked X/Twitter @username, if any. Best-effort. */
async function resolveActorName(wallet: string): Promise<string | undefined> {
  try {
    // socialLinks key format: social:{wallet}:{provider}
    const link = await getSocialLinks(`social:${wallet}:twitter`);
    if (!link?.profile) return undefined;
    const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
    const username = parsed?.username;
    return typeof username === 'string' && username.length > 0 ? username : undefined;
  } catch {
    return undefined;
  }
}

interface MonthlyWinner {
  /** Winner wallet address. */
  trader: string;
  /** 1 | 2 | 3 */
  rank: number;
}

/**
 * Notify each monthly prize-pot winner that they placed and can claim. Notifies
 * the winner themselves (self-notification: actor === recipient). Never throws.
 *
 * @param monthKey "YYYY_MM" key of the finalized month.
 * @param winners  the 3 ranked winners (rank 1, 2, 3).
 * @returns the number of notifications successfully created.
 */
export async function notifyMonthlyWinners(
  monthKey: string,
  winners: MonthlyWinner[],
): Promise<number> {
  let created = 0;
  for (const w of winners) {
    if (typeof w.trader !== 'string' || w.trader.length < 32) continue;
    if (w.rank < 1 || w.rank > 3) continue;

    try {
      const actorName = await resolveActorName(w.trader);
      // Deterministic id — keyed by month + winner so a retried finalize (should
      // never happen given idempotency, but belt-and-suspenders) can't double-send.
      const notificationId = `monthly-${monthKey}-${w.trader.slice(0, 8)}-r${w.rank}`;

      const ok = await setNotifications(notificationId, {
        recipient: Address.publicKey(w.trader),
        actor: Address.publicKey(w.trader), // self-notification
        ...(actorName ? { actorName } : {}),
        type: 'monthly_reward',
        symbol: monthKey, // bell formats "YYYY_MM" → "June 2026"
        side: String(w.rank), // '1' | '2' | '3'
        createdAt: Time.Now,
        read: false,
      });

      if (ok) {
        created++;
      } else {
        console.warn(
          `[notify-monthly-winners] setNotifications returned false for ${monthKey} winner=${w.trader.slice(0, 8)}… rank=${w.rank}`,
        );
      }
    } catch (err) {
      // Best-effort: log and continue — one failed notification must not abort
      // the rest, and the month is already finalized regardless.
      console.error(
        `[notify-monthly-winners] failed for ${monthKey} winner=${w.trader.slice(0, 8)}… rank=${w.rank}:`,
        err,
      );
    }
  }
  return created;
}
