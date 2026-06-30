/**
 * MonthlyHallOfFame — collapsible "Hall of Fame" section listing every finalized
 * monthly prize pot (newest month first). For each month it shows the 3 winners
 * (rank 1/2/3) with their X identity (same xProfileMap resolution as the live
 * leaderboard) and the per-token amount each rank won, computed with the same
 * integer rank-split the backend finalizer uses (50% / 35% / 15%).
 *
 * Lives BELOW the live PnL leaderboard on the Arena page — it is a historical
 * archive, never a duplicate of the live leaderboard surface. Winner rows open
 * the existing UserProfilePopup.
 *
 * Data: `monthlyRewardWinners` (public, one doc per finalized month). Empty state
 * is shown when no month has been finalized yet.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Trophy } from 'lucide-react';
import { useDefaultAvatars } from '@/hooks/use-default-avatars';
import { pickDefaultAvatar } from '@/utils/default-avatar';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyMonthlyRewardWinners,
  type MonthlyRewardWinnersResponse,
} from '@/lib/collections/monthlyRewardWinners';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import { truncateAddress } from '@/utils/format-address';
import {
  monthLabel,
  symbolForMint,
  rankShareBaseUnits,
  RANK_SHARE_PCT,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { TokenLogo } from '@/components/TokenLogo';
import { UserProfilePopup } from './UserProfilePopup';

/** Format a base-unit amount using resolved metadata. */
function formatWithMeta(
  baseUnits: number,
  mint: string,
  tokenMeta: Map<string, { symbol: string; decimals: number }>,
): string {
  const meta = tokenMeta.get(mint);
  const decimals = meta?.decimals ?? 0;
  const symbol = meta?.symbol ?? symbolForMint(mint);
  const human = decimals > 0 ? baseUnits / Math.pow(10, decimals) : baseUnits;
  const maxFrac = Math.min(decimals, 6);
  const str = human.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return `${str} $${symbol}`;
}

interface XProfile {
  username: string;
  avatar?: string;
}

interface PotSlot {
  mint: string;
  total: number; // base units, full pot for the slot
}

interface RankRow {
  rank: number;
  winner: string;
  /** Per-token amount this rank won (base units). */
  shares: Array<{ mint: string; amount: number }>;
}

// Rank medal colors, mirroring the live leaderboard's RankBadge palette.
const RANK_META: Record<number, { bg: string; border: string; color: string; label: string }> = {
  1: { bg: 'rgba(255,215,0,0.18)', border: 'rgba(255,215,0,0.4)', color: '#FFD700', label: '1st' },
  2: { bg: 'rgba(180,190,200,0.15)', border: 'rgba(180,190,200,0.3)', color: '#B4B8C5', label: '2nd' },
  3: { bg: 'rgba(205,127,50,0.15)', border: 'rgba(205,127,50,0.3)', color: '#CD7F32', label: '3rd' },
};

/** Extract the populated (total > 0) token slots from a winners doc. */
function potSlots(w: MonthlyRewardWinnersResponse): PotSlot[] {
  const slots: Array<[string | undefined, number | undefined]> = [
    [w.mint1, w.total1],
    [w.mint2, w.total2],
    [w.mint3, w.total3],
    [w.mint4, w.total4],
    [w.mint5, w.total5],
  ];
  const out: PotSlot[] = [];
  for (const [mint, total] of slots) {
    const n = Number(total) || 0;
    if (mint && n > 0) out.push({ mint, total: n });
  }
  return out;
}

function RankBadge({ rank }: { rank: number }) {
  const m = RANK_META[rank];
  if (rank === 1) {
    return (
      <div
        className='flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center'
        style={{ background: m.bg, border: `1px solid ${m.border}` }}
      >
        <Trophy size={13} style={{ color: m.color }} />
      </div>
    );
  }
  return (
    <div
      className='flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black'
      style={{ background: m?.bg, color: m?.color, border: `1px solid ${m?.border}` }}
    >
      {rank}
    </div>
  );
}

function WinnerRow({
  row,
  xProfile,
  tokenMeta,
  defaultAvatarUrls,
  onClick,
}: {
  row: RankRow;
  xProfile?: XProfile;
  tokenMeta: Map<string, { symbol: string; decimals: number }>;
  defaultAvatarUrls: string[];
  onClick: () => void;
}) {
  const meta = RANK_META[row.rank];
  const initials = xProfile?.username
    ? xProfile.username.charAt(0).toUpperCase()
    : row.winner.charAt(0).toUpperCase();
  const displayName = xProfile?.username ? `@${xProfile.username}` : truncateAddress(row.winner);
  const visibleShares = row.shares.filter((s) => s.amount > 0);
  const defaultAvatar = pickDefaultAvatar(row.winner, defaultAvatarUrls);

  return (
    <button
      type='button'
      onClick={onClick}
      className='w-full flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all hover:bg-white/[0.04] active:bg-white/[0.06] text-left'
    >
      <RankBadge rank={row.rank} />

      {xProfile?.avatar ? (
        <img
          src={xProfile.avatar}
          alt={xProfile.username}
          className='flex-shrink-0 w-8 h-8 rounded-full object-cover'
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        />
      ) : defaultAvatar ? (
        <img
          src={defaultAvatar}
          alt='avatar'
          className='flex-shrink-0 w-8 h-8 rounded-full object-cover'
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        />
      ) : (
        <div
          className='flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold'
          style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.2)' }}
        >
          {initials}
        </div>
      )}

      <div className='flex-1 min-w-0'>
        <div className='text-sm font-semibold truncate' style={{ color: xProfile ? '#fff' : '#9A9A9A' }}>
          {displayName}
        </div>
        <div className='text-[11px]' style={{ color: meta?.color ?? '#5A5A5A' }}>
          {meta?.label ?? `#${row.rank}`} place · {RANK_SHARE_PCT[row.rank] ?? 0}%
        </div>
      </div>

      {/* Per-token amounts won by this rank */}
      <div className='flex flex-col items-end gap-1 flex-shrink-0'>
        {visibleShares.length === 0 ? (
          <span className='text-xs' style={{ color: '#5A5A5A' }}>—</span>
        ) : (
          visibleShares.map((s) => (
            <span
              key={s.mint}
              className='inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums'
              style={{ background: 'rgba(255,215,0,0.12)', color: '#E8C547', border: '1px solid rgba(255,215,0,0.25)' }}
            >
              <TokenLogo symbol={tokenMeta.get(s.mint)?.symbol ?? symbolForMint(s.mint)} size={12} />
              {formatWithMeta(s.amount, s.mint, tokenMeta)}
            </span>
          ))
        )}
      </div>
    </button>
  );
}

function MonthBlock({
  winners,
  xProfileMap,
  tokenMeta,
  defaultAvatarUrls,
  onSelect,
}: {
  winners: MonthlyRewardWinnersResponse;
  xProfileMap: Map<string, XProfile>;
  tokenMeta: Map<string, { symbol: string; decimals: number }>;
  defaultAvatarUrls: string[];
  onSelect: (addr: string) => void;
}) {
  const slots = potSlots(winners);

  const rows: RankRow[] = useMemo(() => {
    const addrs = [winners.winner1, winners.winner2, winners.winner3];
    return addrs.map((winner, i) => {
      const rank = i + 1;
      return {
        rank,
        winner,
        shares: slots.map((s) => ({
          mint: s.mint,
          // Same integer split the backend finalizer uses.
          amount: rankShareBaseUnits(s.total, rank),
        })),
      };
    });
  }, [winners, slots]);

  return (
    <div className='rounded-xl overflow-hidden' style={{ background: 'rgba(60,45,20,0.14)', border: '1px solid rgba(200,150,42,0.20)', boxShadow: '0 2px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,220,100,0.04)' }}>
      <div
        className='flex items-center gap-2 px-4 py-2.5'
        style={{ borderBottom: '1px solid rgba(200,150,42,0.10)' }}
      >
        <Trophy size={14} style={{ color: '#FFD700' }} />
        <span className='text-sm font-bold' style={{ color: '#E0B341' }}>
          {monthLabel(winners.monthKey)}
        </span>
      </div>
      <div className='px-1 py-1'>
        {rows.map((row) => (
          <WinnerRow
            key={row.rank}
            row={row}
            xProfile={xProfileMap.get(row.winner)}
            tokenMeta={tokenMeta}
            defaultAvatarUrls={defaultAvatarUrls}
            onClick={() => onSelect(row.winner)}
          />
        ))}
      </div>
    </div>
  );
}

export function MonthlyHallOfFame() {
  const [collapsed, setCollapsed] = useState(false);
  const [profileAddress, setProfileAddress] = useState<string | null>(null);

  // Default avatar pool — called once here and passed down to row components.
  const defaultAvatarUrls = useDefaultAvatars();

  const { data: allWinners } = useRealtimeData<MonthlyRewardWinnersResponse[]>(
    subscribeManyMonthlyRewardWinners,
    true,
  );

  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true,
  );

  // Newest month first ("YYYY_MM" sorts lexically).
  const months = useMemo(
    () =>
      [...(allWinners ?? [])].sort((a, b) =>
        a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0,
      ),
    [allWinners],
  );

  // Collect all unique mints from all finalized months so we can resolve
  // decimals + symbol for any arbitrary SPL token via the lookup API.
  const allMints = useMemo(() => {
    const mints = new Set<string>();
    for (const w of allWinners ?? []) {
      for (const mint of [w.mint1, w.mint2, w.mint3, w.mint4, w.mint5]) {
        if (mint) mints.add(mint);
      }
    }
    return Array.from(mints);
  }, [allWinners]);
  const tokenMeta = useTokenMetadata(allMints);

  // wallet → { username, avatar } — same resolution as the live leaderboard.
  const xProfileMap = useMemo(() => {
    const map = new Map<string, XProfile>();
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet) {
        try {
          const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
          if (parsed?.username) {
            map.set(String(link.wallet), {
              username: parsed.username,
              avatar: parsed.avatar ?? undefined,
            });
          }
        } catch {
          // malformed profile JSON — skip
        }
      }
    }
    return map;
  }, [allSocialLinks]);

  return (
    <section className='mt-6'>
      {/* Collapsible header — stone/gold treatment to match Arena aesthetic. */}
      <div className='arena-card rounded-xl overflow-hidden'>
        <button
          type='button'
          className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]'
          onClick={() => setCollapsed((v) => !v)}
        >
          <div className='flex items-center gap-2'>
            <Trophy size={14} style={{ color: '#E8C547' }} />
            <span className='text-sm font-bold' style={{ color: '#E8C547' }}>Hall of Fame</span>
            {months.length > 0 && (
              <span
                className='text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums'
                style={{ background: 'rgba(255,215,0,0.12)', color: '#E8C547', border: '1px solid rgba(255,215,0,0.2)' }}
              >
                {months.length}
              </span>
            )}
          </div>
          <ChevronDown
            size={15}
            style={{
              color: '#E8C547',
              transition: 'transform 0.2s',
              transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            }}
          />
        </button>

        {!collapsed && (
          <div className='px-3 pb-3' style={{ borderTop: '1px solid rgba(200,150,42,0.12)' }}>
            {months.length === 0 ? (
              <div className='rounded-xl p-8 text-center mt-2' style={{ border: '1px dashed rgba(200,150,42,0.18)' }}>
                <Trophy size={26} className='mx-auto mb-2' style={{ color: 'rgba(200,150,42,0.18)' }} />
                <p className='text-sm' style={{ color: '#5A5A5A' }}>No months finalized yet</p>
                <p className='text-xs mt-1' style={{ color: '#4A4A4A' }}>
                  Past monthly prize-pot winners will appear here once a month wraps up.
                </p>
              </div>
            ) : (
              <div className='space-y-3 animate-fade-in mt-2'>
                {months.map((w) => (
                  <MonthBlock
                    key={w.id}
                    winners={w}
                    xProfileMap={xProfileMap}
                    tokenMeta={tokenMeta}
                    defaultAvatarUrls={defaultAvatarUrls}
                    onSelect={setProfileAddress}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <UserProfilePopup
        traderAddress={profileAddress}
        open={!!profileAddress}
        onClose={() => setProfileAddress(null)}
      />
    </section>
  );
}
