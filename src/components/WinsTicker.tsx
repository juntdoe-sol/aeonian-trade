/**
 * WinsTicker — compact, horizontally-scrolling "live wins" strip for the Arena
 * page. Surfaces other traders' recent profitable position closes from the
 * public `phoenixWins` collection (written best-effort by the backend on every
 * profitable close).
 *
 * Identity resolution (X avatar/@username, wallet fallback) and the trader
 * profile popup reuse the SAME mechanism as PnlLeaderboard, so rendering stays
 * consistent across the app. Dismissible for the session (local state).
 */

import { useMemo, useState } from 'react';
import { TrendingUp, X, EyeOff } from 'lucide-react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyPhoenixWins, type PhoenixWinsResponse } from '@/lib/collections/phoenixWins';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import { truncateAddress } from '@/utils/format-address';
import { useHiddenPnlWallets } from '@/utils/use-hide-pnl';
import { UserProfilePopup } from './UserProfilePopup';

// ─── Types & helpers ────────────────────────────────────────────────────────

interface XProfile {
  username: string;
  avatar?: string;
}

const POS = '#4ADE80';
const ACCENT = '#b794f6';
const MAX_WINS = 24;

function formatProfit(cents: number): string {
  const usd = cents / 100;
  const formatted = usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `+$${formatted}`;
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function WinChip({
  win,
  xProfile,
  hidden,
  onClick,
}: {
  win: PhoenixWinsResponse;
  xProfile?: XProfile;
  hidden?: boolean;
  onClick: () => void;
}) {
  const initial = (xProfile?.username ?? win.trader ?? '?').charAt(0).toUpperCase();
  const displayName = xProfile?.username ? `@${xProfile.username}` : truncateAddress(win.trader);

  return (
    <button
      type='button'
      onClick={onClick}
      className='flex-shrink-0 flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full transition-all hover:brightness-110 active:scale-[0.98]'
      style={{
        background: 'rgba(74,222,128,0.07)',
        border: '1px solid rgba(74,222,128,0.18)',
      }}
    >
      {/* Avatar */}
      {xProfile?.avatar ? (
        <img
          src={xProfile.avatar}
          alt={xProfile.username}
          className='w-6 h-6 rounded-full object-cover flex-shrink-0'
          style={{ border: '1px solid rgba(255,255,255,0.12)' }}
        />
      ) : (
        <div
          className='w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0'
          style={{ background: 'rgba(183,148,246,0.16)', color: ACCENT, border: '1px solid rgba(183,148,246,0.22)' }}
        >
          {initial}
        </div>
      )}

      {/* Identity + market */}
      <span className='text-xs font-semibold whitespace-nowrap' style={{ color: xProfile ? '#fff' : '#A8A8B8' }}>
        {displayName}
      </span>
      <span className='text-[11px] font-bold whitespace-nowrap' style={{ color: '#7A7A8A' }}>
        {win.symbol}
      </span>

      {/* Profit — masked when the trader hid their PnL */}
      {hidden ? (
        <span className='inline-flex items-center gap-1 text-xs font-black whitespace-nowrap' style={{ color: '#7A7A8A' }}>
          <EyeOff size={12} style={{ color: '#7A7A8A' }} />
          Hidden
        </span>
      ) : (
        <span className='text-xs font-black tabular-nums whitespace-nowrap' style={{ color: POS }}>
          {formatProfit(win.pnlUsdCents)}
        </span>
      )}
    </button>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function WinsTicker() {
  const [dismissed, setDismissed] = useState(false);
  const [profileAddress, setProfileAddress] = useState<string | null>(null);

  // Recent wins, newest first.
  const { data: rawWins } = useRealtimeData<PhoenixWinsResponse[]>(
    subscribeManyPhoenixWins,
    !dismissed,
    'order by createdAt desc limit 30',
  );

  // X identity — same resolution pattern as PnlLeaderboard.
  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    !dismissed,
  );

  // Wallets that opted to hide their PnL — mask the profit amount on their chips.
  const hiddenWallets = useHiddenPnlWallets(!dismissed);

  const xProfileMap = useMemo(() => {
    const map = new Map<string, XProfile>();
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet) {
        try {
          const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
          if (parsed?.username) {
            map.set(String(link.wallet), { username: parsed.username, avatar: parsed.avatar ?? undefined });
          }
        } catch {
          // malformed profile JSON — skip
        }
      }
    }
    return map;
  }, [allSocialLinks]);

  // Sort newest first defensively and cap, in case the query ordering is ignored.
  const wins = useMemo(() => {
    if (!rawWins) return [];
    return [...rawWins]
      .filter((w) => w.pnlUsdCents > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_WINS);
  }, [rawWins]);

  // Nothing to show → render nothing (no empty placeholder).
  if (dismissed || wins.length === 0) return null;

  return (
    <div
      className='glass-card rounded-xl overflow-hidden animate-fade-in'
      style={{ border: '1px solid rgba(74,222,128,0.16)' }}
    >
      <div className='flex items-center gap-2 px-3 pt-2.5 pb-1.5'>
        <TrendingUp size={14} style={{ color: POS }} />
        <span className='text-[11px] font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
          Live Wins
        </span>
        <button
          type='button'
          onClick={() => setDismissed(true)}
          aria-label='Dismiss wins ticker'
          className='ml-auto flex items-center justify-center w-6 h-6 rounded-lg transition-all hover:bg-white/[0.06] active:bg-white/[0.1]'
          style={{ color: '#7A7A8A' }}
        >
          <X size={14} />
        </button>
      </div>

      <div
        className='flex items-center gap-2 px-3 pb-3 overflow-x-auto'
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {wins.map((win) => (
          <WinChip
            key={win.id}
            win={win}
            xProfile={xProfileMap.get(win.trader)}
            hidden={hiddenWallets.has(win.trader)}
            onClick={() => setProfileAddress(win.trader)}
          />
        ))}
      </div>

      {/* Trader profile popup — same pattern as the Arena leaderboard rows */}
      <UserProfilePopup
        traderAddress={profileAddress}
        open={!!profileAddress}
        onClose={() => setProfileAddress(null)}
      />
    </div>
  );
}
