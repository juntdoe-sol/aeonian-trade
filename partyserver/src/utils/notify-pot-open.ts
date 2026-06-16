/**
 * Notification fan-out: when the admin makes the FIRST deposit into a new
 * month's prize pot, announce to active traders that the pot is now live — to
 * drive trading competition for the month.
 *
 * Called from the POST /api/monthly-pot/announce route AFTER the route confirms
 * this is the pot's first deposit. The backend signs as PROJECT_VAULT_ADDRESS,
 * which is the only wallet allowed to create notifications.
 *
 * Recipient set ("active traders"): the union of wallets that appear in the
 * pnlLeaderboard (any period — these are traders with recent realized PnL) and
 * the phoenixTradeRecord collection (traders with a recorded on-chain trade).
 * The admin/vault address is excluded. Deduped.
 *
 * Notification shape reuses the fixed `notifications` schema (no title/body/link
 * field — the NotificationBell renders copy off `type`). We use a new
 * `monthly_pot_open` type and, like the winner notifications, set the recipient
 * as their own actor (self-notification, broadcast-style) and stash the monthKey
 * in `symbol` ("YYYY_MM" → the bell formats it to "June 2026").
 *
 * Best-effort: a single failed write logs and continues; never throws out of the
 * loop. Returns the number of notifications successfully created.
 */

import { buildNotifications } from '../collections/notifications.js';
import { getAllPnlLeaderboard } from '../collections/pnlLeaderboard.js';
import { getAllPhoenixTradeRecord } from '../collections/phoenixTradeRecord.js';
import { setMany, Address, Time } from '../db-client.js';
import { PROJECT_VAULT_ADDRESS, ADMIN_ADDRESS } from '../constants.js';

const NOTIF_TYPE = 'monthly_pot_open';
const VALID_ADDRESS_MIN_LEN = 32;
// Safety cap so a single announce can't fan out an unbounded number of writes.
const MAX_RECIPIENTS = 2000;

/** Build the deduped set of "active trader" wallet addresses. Best-effort. */
async function collectActiveTraders(): Promise<Set<string>> {
  const recipients = new Set<string>();

  const add = (addr: unknown) => {
    if (typeof addr !== 'string' || addr.length < VALID_ADDRESS_MIN_LEN) return;
    if (addr === PROJECT_VAULT_ADDRESS || addr === ADMIN_ADDRESS) return;
    recipients.add(addr);
  };

  // 1. pnlLeaderboard — traders with recent realized PnL (any period).
  try {
    const rows = await getAllPnlLeaderboard();
    for (const r of rows ?? []) add(r.trader);
  } catch (err) {
    console.error('[notify-pot-open] failed reading pnlLeaderboard:', err);
  }

  // 2. phoenixTradeRecord — traders with a recorded on-chain trade.
  try {
    const records = await getAllPhoenixTradeRecord();
    for (const t of records ?? []) add(t.trader);
  } catch (err) {
    console.error('[notify-pot-open] failed reading phoenixTradeRecord:', err);
  }

  return recipients;
}

/**
 * Announce a newly-opened monthly prize pot to all active traders. Each trader
 * gets one self-notification (actor === recipient). Never throws.
 *
 * @param monthKey "YYYY_MM" key of the month whose pot just opened.
 * @returns the number of notifications successfully created.
 */
export async function notifyPotOpen(monthKey: string): Promise<number> {
  const recipients = await collectActiveTraders();
  if (recipients.size === 0) {
    console.log(`[notify-pot-open] No active traders to notify for ${monthKey}.`);
    return 0;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const targets = Array.from(recipients).slice(0, MAX_RECIPIENTS);

  // Build one self-notification per active trader. Deterministic id keyed by
  // month + recipient so a retried announce can't double-notify the same trader.
  const ops = targets.map((recipient) =>
    buildNotifications(`potopen-${monthKey}-${recipient.slice(0, 12)}`, {
      recipient: Address.publicKey(recipient),
      actor: Address.publicKey(recipient), // self-notification (broadcast-style)
      type: NOTIF_TYPE,
      symbol: monthKey, // bell formats "YYYY_MM" → "June 2026"
      createdAt: Time.Now,
      read: false,
    }),
  );

  // Best-effort batched write. setMany is all-or-nothing for the batch, so on a
  // batch failure fall back to per-recipient writes so one bad doc can't drop
  // the whole announcement.
  let created = 0;
  try {
    const ok = await setMany(ops);
    if (ok) {
      created = ops.length;
    } else {
      console.warn(
        `[notify-pot-open] setMany returned false for ${monthKey} (${ops.length} notifs) — retrying per-recipient.`,
      );
    }
  } catch (err) {
    console.error(`[notify-pot-open] setMany threw for ${monthKey} — retrying per-recipient:`, err);
  }

  if (created === 0) {
    for (const op of ops) {
      try {
        const ok = await setMany([op]);
        if (ok) created++;
      } catch (err) {
        // Best-effort: log and continue — one failed write must not abort the rest.
        console.error(`[notify-pot-open] per-recipient write failed for ${monthKey}:`, err);
      }
    }
  }

  console.log(`[notify-pot-open] ${monthKey} pot-open announced to ${created}/${ops.length} active traders.`);
  return created;
}
