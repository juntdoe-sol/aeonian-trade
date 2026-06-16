/**
 * Notification: when a user follows a trader, create one `notifications` doc of
 * type 'follow' addressed to the followed trader (the recipient).
 *
 * Called from the /api/phoenix/record-follow route AFTER the frontend has already
 * created the `follows` doc (user-signed). The backend signs as
 * PROJECT_VAULT_ADDRESS, which is the only wallet allowed to create notifications.
 *
 * Mirrors notify-followers.ts: same display-name resolution (X handle from the
 * socialLinks collection) and the same deterministic `$notificationId` shape.
 *
 * SECURITY: `follower` is validated against SOLANA_ADDRESS_RE at the route before
 * this is called, so it is base58 charset only — no query-injection surface (this
 * helper does keyed writes only anyway, no where-clause interpolation).
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

/**
 * Create a 'follow' notification for `followed` from `follower`. Never throws — a
 * failed notification must not break the follow flow that already succeeded.
 *
 * @returns true if the notification was written, false otherwise (incl. self-follow).
 */
export async function notifyNewFollower(follower: string, followed: string): Promise<boolean> {
  // Never notify someone that they followed themselves.
  if (follower === followed) return false;

  try {
    // Resolve the follower's X handle once (cached display name on the notif).
    const actorName = await resolveActorName(follower);

    // Deterministic id so a re-follow (delete → re-create) can't pile up dupes
    // for the same (follower → followed) pair on the same second.
    const nowSec = Math.floor(Date.now() / 1000);
    const notificationId = `${follower.slice(0, 8)}-${followed.slice(0, 8)}-follow-${nowSec}`;

    const ok = await setNotifications(notificationId, {
      recipient: Address.publicKey(followed),
      actor: Address.publicKey(follower),
      ...(actorName ? { actorName } : {}),
      type: 'follow',
      createdAt: Time.Now,
      read: false,
    });
    if (!ok) {
      console.warn(`[notify-new-follower] setNotifications returned false for followed=${followed.slice(0, 8)}…`);
    }
    return ok;
  } catch (err) {
    console.error('[notify-new-follower] failed:', err);
    return false;
  }
}
