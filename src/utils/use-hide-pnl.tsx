/**
 * use-hide-pnl — shared helpers for respecting a trader's "Hide PnL" privacy
 * preference everywhere ANOTHER user can see their PnL.
 *
 * Source of truth: the public `leaderboardPrivacy` collection (one doc per
 * wallet, keyed by address, `hidePnl: boolean`). It is the SAME preference the
 * Heartbeat task mirrors into `pnlLeaderboard.pnlHidden`, but reading it
 * directly works even for traders who aren't currently on the leaderboard.
 *
 * Default when no preference doc exists → NOT hidden (PnL shown).
 *
 * IMPORTANT: a trader's OWN view of their own PnL is never hidden. Callers must
 * combine these results with an "is this my own profile" check and only mask
 * when viewing SOMEONE ELSE.
 */

import { useMemo } from 'react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeLeaderboardPrivacy,
  subscribeManyLeaderboardPrivacy,
  type LeaderboardPrivacyResponse,
} from '@/lib/collections/leaderboardPrivacy';

/**
 * Read a SINGLE trader's hide-PnL preference (for the trader profile popup,
 * which views one arbitrary trader at a time). Returns false until the doc
 * resolves, and false when the trader has no preference set.
 */
export function useTraderHidePnl(traderAddress: string | null, enabled: boolean = true): boolean {
  const { data } = useRealtimeData<LeaderboardPrivacyResponse | null>(
    subscribeLeaderboardPrivacy,
    enabled && !!traderAddress,
    traderAddress ?? '',
  );
  return data?.hidePnl === true;
}

/**
 * Subscribe to the whole `leaderboardPrivacy` collection and return a Set of
 * wallet addresses that opted to hide PnL. For surfaces that render MANY
 * traders at once (wins ticker, big-win popup, notification feed).
 */
export function useHiddenPnlWallets(enabled: boolean = true): Set<string> {
  const { data } = useRealtimeData<LeaderboardPrivacyResponse[]>(
    subscribeManyLeaderboardPrivacy,
    enabled,
  );
  return useMemo(() => {
    const set = new Set<string>();
    for (const pref of data ?? []) {
      if (pref.hidePnl === true && pref.id) set.add(pref.id);
    }
    return set;
  }, [data]);
}
