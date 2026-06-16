/**
 * PnlLeaderboard — Battles page section showing top traders by realized PnL
 * per rolling period (Daily / Weekly / Monthly / All Time).
 *
 * Data source: `pnlLeaderboard` collection, precomputed every 15 min by the
 * pnl-leaderboard Heartbeat task.
 * Twitter identity: same xProfileMap pattern as AdminDashboard / share modals.
 */

import { useEffect, useMemo, useState } from 'react';
import { Crown, EyeOff, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyPnlLeaderboard, type PnlLeaderboardResponse } from '@/lib/collections/pnlLeaderboard';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import {
  subscribeManyMonthlyRewardDeposit,
  type MonthlyRewardDepositResponse,
} from '@/lib/collections/monthlyRewardDeposit';
import { api } from '@/lib/api-client';
import { truncateAddress } from '@/utils/format-address';
import { TokenLogo } from '@/components/TokenLogo';
import { MonthlyPrizePotCard } from './MonthlyPrizePotCard';
import {
  currentMonthKeyUTC,
  potAccountIdForMonth,
  symbolForMint,
  formatTokenAmount,
  rankShareBaseUnits,
  fromBaseUnits,
} from '@/utils/monthly-reward-tokens';
import { SOL, USDC } from '@/lib/constants';
import { UserProfilePopup } from './UserProfilePopup';

interface ProjectedShare {
  mint: string;
  amount: number; // base units
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly' | 'all';

interface XProfile {
  username: string;
  avatar?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  all: 'All Time',
};

function formatPnl(cents: number): string {
  const usd = cents / 100;
  const abs = Math.abs(usd);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${usd >= 0 ? '+' : '−'}$${formatted}`;
}

// ─── Rank medal helper ─────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div
        className='flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black'
        style={{ background: 'rgba(255,215,0,0.18)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.4)' }}
      >
        1
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div
        className='flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black'
        style={{ background: 'rgba(180,190,200,0.15)', color: '#B4B8C5', border: '1px solid rgba(180,190,200,0.3)' }}
      >
        2
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div
        className='flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black'
        style={{ background: 'rgba(205,127,50,0.15)', color: '#CD7F32', border: '1px solid rgba(205,127,50,0.3)' }}
      >
        3
      </div>
    );
  }
  return (
    <div
      className='flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold'
      style={{ background: 'rgba(255,255,255,0.05)', color: '#5A5A5A' }}
    >
      {rank}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function LeaderboardRow({
  rank,
  entry,
  xProfile,
  projectedShares,
  onClick,
}: {
  rank: number;
  entry: PnlLeaderboardResponse;
  xProfile?: XProfile;
  projectedShares?: ProjectedShare[];
  onClick: () => void;
}) {
  const isPositive = entry.realizedPnlUsdCents >= 0;
  const pnlColor = entry.pnlHidden ? '#5A5A5A' : (isPositive ? '#4ADE80' : '#FF5252');

  const initials = xProfile?.username
    ? xProfile.username.charAt(0).toUpperCase()
    : entry.trader.charAt(0).toUpperCase();

  const displayName = xProfile?.username
    ? `@${xProfile.username}`
    : truncateAddress(entry.trader);

  const visibleShares = (projectedShares ?? []).filter((s) => s.amount > 0);

  return (
    <button
      type='button'
      onClick={onClick}
      className='w-full flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all hover:bg-white/[0.04] active:bg-white/[0.06] text-left'
    >
      <RankBadge rank={rank} />

      {/* Avatar */}
      {xProfile?.avatar ? (
        <img
          src={xProfile.avatar}
          alt={xProfile.username}
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

      {/* Identity */}
      <div className='flex-1 min-w-0'>
        <div className='text-sm font-semibold truncate' style={{ color: xProfile ? '#fff' : '#9A9A9A' }}>
          {displayName}
        </div>
        <div className='text-xs' style={{ color: '#5A5A5A' }}>
          {entry.tradeCount} {entry.tradeCount === 1 ? 'trade' : 'trades'}
        </div>
        {/* Projected monthly prize share (top-3 monthly rows only) */}
        {visibleShares.length > 0 && (
          <div className='flex flex-wrap items-center gap-1.5 mt-1'>
            {visibleShares.map((s) => (
              <span
                key={s.mint}
                className='inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums'
                style={{ background: 'rgba(255,215,0,0.12)', color: '#E8C547', border: '1px solid rgba(255,215,0,0.25)' }}
              >
                <TokenLogo symbol={symbolForMint(s.mint)} size={12} />
                {formatTokenAmount(s.amount, s.mint)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* PnL — masked when hidden */}
      {entry.pnlHidden ? (
        <div className='flex items-center gap-1.5 flex-shrink-0'>
          <EyeOff size={13} style={{ color: '#5A5A5A' }} />
          <span className='text-sm font-black tabular-nums' style={{ color: '#5A5A5A' }}>—</span>
        </div>
      ) : (
        <div className='flex items-center gap-1.5 flex-shrink-0'>
          {isPositive
            ? <TrendingUp size={13} style={{ color: pnlColor }} />
            : <TrendingDown size={13} style={{ color: pnlColor }} />
          }
          <span
            className='text-sm font-black tabular-nums'
            style={{ color: pnlColor }}
          >
            {formatPnl(entry.realizedPnlUsdCents)}
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Podium accent configs ─────────────────────────────────────────────────────

const PODIUM_ACCENTS = {
  1: {
    bg: 'rgba(255,215,0,0.07)',
    border: 'rgba(255,215,0,0.30)',
    glow: 'rgba(255,215,0,0.12)',
    rankColor: '#FFD700',
    rankBg: 'rgba(255,215,0,0.15)',
    rankBorder: 'rgba(255,215,0,0.40)',
    icon: <Crown size={14} style={{ color: '#FFD700' }} />,
  },
  2: {
    bg: 'rgba(192,198,212,0.06)',
    border: 'rgba(192,198,212,0.22)',
    glow: 'rgba(192,198,212,0.08)',
    rankColor: '#C0C6D4',
    rankBg: 'rgba(192,198,212,0.12)',
    rankBorder: 'rgba(192,198,212,0.28)',
    icon: <span className='text-xs font-black' style={{ color: '#C0C6D4' }}>2</span>,
  },
  3: {
    bg: 'rgba(205,127,50,0.06)',
    border: 'rgba(205,127,50,0.22)',
    glow: 'rgba(205,127,50,0.08)',
    rankColor: '#CD7F32',
    rankBg: 'rgba(205,127,50,0.12)',
    rankBorder: 'rgba(205,127,50,0.28)',
    icon: <span className='text-xs font-black' style={{ color: '#CD7F32' }}>3</span>,
  },
} as const;

// ─── PodiumCard ────────────────────────────────────────────────────────────────

/**
 * Compute the combined USD value of a set of projected shares.
 * Returns { pricedUsd, unpricedCount } where:
 *   pricedUsd    = sum of all tokens we could price in USD
 *   unpricedCount = number of tokens we could NOT price
 *
 * Pricing rules:
 *   USDC  → $1 per token
 *   SOL   → solPriceUsd per token
 *   other → unpriced (counted but not summed)
 */
function computePrizeUsd(
  shares: ProjectedShare[],
  solPriceUsd: number | null,
): { pricedUsd: number; unpricedCount: number } {
  let pricedUsd = 0;
  let unpricedCount = 0;
  for (const s of shares) {
    if (s.amount <= 0) continue;
    const human = fromBaseUnits(s.amount, s.mint);
    if (s.mint === USDC) {
      pricedUsd += human; // USDC = $1.00
    } else if (s.mint === SOL && solPriceUsd != null && solPriceUsd > 0) {
      pricedUsd += human * solPriceUsd;
    } else {
      unpricedCount += 1;
    }
  }
  return { pricedUsd, unpricedCount };
}

function PodiumCard({
  rank,
  entry,
  xProfile,
  projectedShares,
  isCenter,
  solPriceUsd,
  onClick,
}: {
  rank: 1 | 2 | 3;
  entry: PnlLeaderboardResponse;
  xProfile?: XProfile;
  projectedShares?: ProjectedShare[];
  isCenter: boolean;
  solPriceUsd: number | null;
  onClick: () => void;
}) {
  const accent = PODIUM_ACCENTS[rank];
  const isPositive = entry.realizedPnlUsdCents >= 0;
  const pnlColor = entry.pnlHidden ? '#5A5A5A' : (isPositive ? '#4ADE80' : '#FF5252');

  const initials = xProfile?.username
    ? xProfile.username.charAt(0).toUpperCase()
    : entry.trader.charAt(0).toUpperCase();

  const displayName = xProfile?.username
    ? `@${xProfile.username}`
    : truncateAddress(entry.trader);

  const avatarSize = isCenter ? 'w-12 h-12' : 'w-10 h-10';
  const avatarTextSize = isCenter ? 'text-sm' : 'text-xs';

  const visibleShares = (projectedShares ?? []).filter((s) => s.amount > 0);

  // Compute USD headline for prize shares
  const prizeUsdHeadline = useMemo(() => {
    if (visibleShares.length === 0) return null;
    const { pricedUsd, unpricedCount } = computePrizeUsd(visibleShares, solPriceUsd);
    const allUnpriced = pricedUsd === 0 && unpricedCount > 0;
    if (allUnpriced) return null; // hide entirely — no tokens have a price
    const formatted = pricedUsd.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return { formatted, unpricedCount };
  }, [visibleShares, solPriceUsd]);

  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-2xl transition-all active:scale-95 ${isCenter ? 'px-2 py-3' : 'px-2 py-2.5'}`}
      style={{
        flex: isCenter ? '0 0 40%' : '0 0 28%',
        background: accent.bg,
        border: `1px solid ${accent.border}`,
        boxShadow: `0 0 18px ${accent.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
        alignSelf: isCenter ? 'flex-end' : 'flex-end',
        marginBottom: isCenter ? 0 : '10px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Rank badge */}
      <div
        className='flex items-center justify-center w-6 h-6 rounded-full'
        style={{
          background: accent.rankBg,
          border: `1px solid ${accent.rankBorder}`,
        }}
      >
        {accent.icon}
      </div>

      {/* Avatar */}
      {xProfile?.avatar ? (
        <img
          src={xProfile.avatar}
          alt={xProfile.username}
          className={`${avatarSize} rounded-full object-cover flex-shrink-0`}
          style={{ border: `1.5px solid ${accent.border}` }}
        />
      ) : (
        <div
          className={`${avatarSize} rounded-full flex items-center justify-center ${avatarTextSize} font-bold flex-shrink-0`}
          style={{
            background: 'rgba(183,148,246,0.13)',
            color: '#b794f6',
            border: `1.5px solid ${accent.border}`,
          }}
        >
          {initials}
        </div>
      )}

      {/* Name */}
      <div
        className='w-full text-center text-xs font-semibold truncate leading-tight'
        style={{ color: xProfile ? '#fff' : '#9A9A9A', maxWidth: '100%' }}
      >
        {displayName}
      </div>

      {/* PnL */}
      {entry.pnlHidden ? (
        <div className='flex items-center gap-1'>
          <EyeOff size={11} style={{ color: '#5A5A5A' }} />
          <span className='text-xs font-black tabular-nums' style={{ color: '#5A5A5A' }}>—</span>
        </div>
      ) : (
        <div className='flex items-center gap-0.5'>
          {isPositive
            ? <TrendingUp size={11} style={{ color: pnlColor }} />
            : <TrendingDown size={11} style={{ color: pnlColor }} />
          }
          <span
            className={`${isCenter ? 'text-sm' : 'text-xs'} font-black tabular-nums`}
            style={{ color: pnlColor }}
          >
            {formatPnl(entry.realizedPnlUsdCents)}
          </span>
        </div>
      )}

      {/* Projected prize shares */}
      {visibleShares.length > 0 && (
        <div className='w-full flex flex-col items-center gap-1 mt-1'>
          <span
            className='text-[8px] font-black uppercase tracking-[0.08em]'
            style={{ color: '#C9A227' }}
          >
            Projected Prize
          </span>

          {/* USD headline total — only rendered when at least one token is priced */}
          {prizeUsdHeadline && (
            <div className='flex flex-col items-center gap-0.5'>
              <span
                className={`font-black tabular-nums leading-none ${isCenter ? 'text-base' : 'text-sm'}`}
                style={{
                  color: '#FFD700',
                  textShadow: '0 0 16px rgba(255,215,0,0.55)',
                  letterSpacing: '-0.01em',
                }}
              >
                ${prizeUsdHeadline.formatted}
              </span>
              {prizeUsdHeadline.unpricedCount > 0 && (
                <span
                  className='text-[8px] font-semibold'
                  style={{ color: '#8A7030' }}
                >
                  + {prizeUsdHeadline.unpricedCount} more token{prizeUsdHeadline.unpricedCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          <div className='flex flex-wrap justify-center gap-1'>
            {visibleShares.map((s) => (
              <span
                key={s.mint}
                className={`inline-flex items-center gap-1 rounded-full font-black tabular-nums ${isCenter ? 'px-2.5 py-1 text-xs' : 'px-2 py-1 text-[11px]'}`}
                style={{
                  background: 'linear-gradient(135deg, rgba(255,215,0,0.28), rgba(255,184,0,0.14))',
                  color: '#FFDD66',
                  border: '1px solid rgba(255,215,0,0.5)',
                  boxShadow: '0 0 12px rgba(255,215,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
              >
                <TokenLogo symbol={symbolForMint(s.mint)} size={isCenter ? 16 : 14} />
                {formatTokenAmount(s.amount, s.mint)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trade count */}
      <div className='text-[10px]' style={{ color: '#5A5A5A' }}>
        {entry.tradeCount} {entry.tradeCount === 1 ? 'trade' : 'trades'}
      </div>
    </button>
  );
}

// ─── Podium section ────────────────────────────────────────────────────────────

function PodiumSection({
  top3,
  xProfileMap,
  potComposition,
  hasPot,
  period,
  solPriceUsd,
  onSelectTrader,
}: {
  top3: PnlLeaderboardResponse[];
  xProfileMap: Map<string, XProfile>;
  potComposition: { mint: string; total: number }[];
  hasPot: boolean;
  period: string;
  solPriceUsd: number | null;
  onSelectTrader: (address: string) => void;
}) {
  if (top3.length === 0) return null;

  const rank1 = top3.find((e) => e.rank === 1);
  const rank2 = top3.find((e) => e.rank === 2);
  const rank3 = top3.find((e) => e.rank === 3);

  function getShares(rank: number): ProjectedShare[] | undefined {
    if (!(period === 'monthly' && hasPot && rank >= 1 && rank <= 3)) return undefined;
    return potComposition.map(({ mint, total }) => ({
      mint,
      amount: rankShareBaseUnits(total, rank),
    }));
  }

  // Layout: [rank2] [rank1 — center/tallest] [rank3]
  // If only 1 trader, center it. If 2, show rank1 + rank2 only.
  return (
    <div className='mb-4'>
      <div className='flex items-end justify-center gap-2'>
        {/* Rank 2 — left */}
        {rank2 ? (
          <PodiumCard
            rank={2}
            entry={rank2}
            xProfile={xProfileMap.get(rank2.trader)}
            projectedShares={getShares(2)}
            isCenter={false}
            solPriceUsd={solPriceUsd}
            onClick={() => onSelectTrader(rank2.trader)}
          />
        ) : rank1 ? (
          // Spacer to keep rank1 centered when rank2 is missing
          <div style={{ flex: '0 0 28%' }} />
        ) : null}

        {/* Rank 1 — center */}
        {rank1 && (
          <PodiumCard
            rank={1}
            entry={rank1}
            xProfile={xProfileMap.get(rank1.trader)}
            projectedShares={getShares(1)}
            isCenter={true}
            solPriceUsd={solPriceUsd}
            onClick={() => onSelectTrader(rank1.trader)}
          />
        )}

        {/* Rank 3 — right */}
        {rank3 ? (
          <PodiumCard
            rank={3}
            entry={rank3}
            xProfile={xProfileMap.get(rank3.trader)}
            projectedShares={getShares(3)}
            isCenter={false}
            solPriceUsd={solPriceUsd}
            onClick={() => onSelectTrader(rank3.trader)}
          />
        ) : rank1 ? (
          // Spacer to keep rank1 centered when rank3 is missing
          <div style={{ flex: '0 0 28%' }} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PnlLeaderboard() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);

  // Fetch SOL mark price from markets-overview (same source TradePage uses).
  // One-shot on mount — no polling needed for a prize pot value display.
  useEffect(() => {
    let cancelled = false;
    api.get<unknown>('/api/phoenix/markets-overview')
      .then((raw) => {
        if (cancelled) return;
        const list: Array<{ symbol?: string; markPrice?: number; lastPrice?: number }> = Array.isArray(raw)
          ? (raw as typeof list)
          : ((raw as { markets?: typeof list })?.markets ?? []);
        const solMarket = list.find(
          (m) => m.symbol === 'SOL' || m.symbol === 'SOL-PERP',
        );
        const price = solMarket?.markPrice ?? solMarket?.lastPrice;
        if (typeof price === 'number' && price > 0) {
          setSolPriceUsd(price);
        }
      })
      .catch(() => { /* price stays null — headline will be hidden for SOL */ });
    return () => { cancelled = true; };
  }, []);

  // Subscribe to all pnlLeaderboard entries
  const { data: rawEntries } = useRealtimeData<PnlLeaderboardResponse[]>(
    subscribeManyPnlLeaderboard,
    true,
  );

  // Subscribe to social links for Twitter identity
  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true,
  );

  // Current-month prize pot composition — used for projected-share badges on
  // the top-3 MONTHLY rows.
  const currentMonthKey = useMemo(() => currentMonthKeyUTC(), []);
  const currentPotId = useMemo(() => potAccountIdForMonth(currentMonthKey), [currentMonthKey]);
  const { data: potDeposits } = useRealtimeData<MonthlyRewardDepositResponse[]>(
    subscribeManyMonthlyRewardDeposit,
    true,
    `where potAccountId = '${currentPotId}'`,
  );

  // Pot totals by mint (base units), SOL-first then by mint string — mirrors
  // the backend finalizer's slot ordering so projected shares line up.
  const potComposition = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of potDeposits ?? []) {
      if (!d.mint) continue;
      const amt = Number(d.amount) || 0;
      if (amt <= 0) continue;
      totals.set(d.mint, (totals.get(d.mint) ?? 0) + amt);
    }
    return Array.from(totals.entries())
      .map(([mint, total]) => ({ mint, total }))
      .sort((a, b) => {
        if (a.mint === SOL && b.mint !== SOL) return -1;
        if (b.mint === SOL && a.mint !== SOL) return 1;
        return a.mint < b.mint ? -1 : 1;
      });
  }, [potDeposits]);

  const hasPot = potComposition.length > 0;

  // Build xProfileMap: wallet → { username, avatar }
  const xProfileMap = useMemo(() => {
    const map = new Map<string, XProfile>();
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet) {
        try {
          const parsed = typeof link.profile === 'string'
            ? JSON.parse(link.profile)
            : link.profile;
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

  // Filter to selected period, only traders with trades; sort by precomputed rank ascending
  // (rank is assigned from true PnL ordering before privacy masking, so hidden rows keep correct position)
  const rows = useMemo(() => {
    if (!rawEntries) return [];
    return rawEntries
      .filter((e) => e.period === period && e.tradeCount > 0)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 20);
  }, [rawEntries, period]);

  // Client-side search: filter loaded rows by X @username OR wallet address (case-insensitive, partial)
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((entry) => {
      const handle = xProfileMap.get(entry.trader)?.username?.toLowerCase() ?? '';
      const wallet = entry.trader.toLowerCase();
      return handle.includes(q) || wallet.includes(q);
    });
  }, [rows, search, xProfileMap]);

  // Podium = top 3; rest list starts at rank 4 (only when not searching)
  const top3 = useMemo(() => rows.filter((e) => e.rank <= 3), [rows]);
  const isSearching = search.trim().length > 0;
  // When searching show ALL filtered rows; when not searching, show rank 4+
  const listRows = useMemo(() => {
    if (isSearching) return filteredRows;
    return rows.filter((e) => e.rank > 3);
  }, [isSearching, filteredRows, rows]);

  const periods: Period[] = ['daily', 'weekly', 'monthly', 'all'];

  return (
    <section>
      {/* Section header */}
      <div className='flex items-center gap-2 mb-3'>
        <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
          PnL Leaderboard
        </h2>
      </div>

      {/* Search bar */}
      <div className='relative mb-3'>
        <Search
          size={16}
          className='absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none'
          style={{ color: search ? '#b794f6' : '#5A5A5A' }}
        />
        <input
          type='text'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search by @username or wallet'
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='glass-card w-full rounded-xl text-sm font-medium pl-10 pr-10 py-3 outline-none transition-all placeholder:text-[#5A5A5A]'
          style={{
            color: '#fff',
            borderColor: search ? 'rgba(183,148,246,0.5)' : undefined,
            background: search ? 'rgba(183,148,246,0.08)' : undefined,
          }}
        />
        {search && (
          <button
            type='button'
            onClick={() => setSearch('')}
            aria-label='Clear search'
            className='absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:bg-white/[0.06] active:bg-white/[0.1]'
            style={{ color: '#8A8A8A' }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Current month prize pot (monthly period only) */}
      {period === 'monthly' && <MonthlyPrizePotCard />}

      {/* Period tabs */}
      <div className='glass-card rounded-xl overflow-hidden'>
        <div className='flex' style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className='flex-1 py-2.5 text-xs font-semibold transition-all'
              style={{
                background: period === p ? 'rgba(183,148,246,0.10)' : 'transparent',
                color: period === p ? '#b794f6' : '#5A5A5A',
                borderBottom: period === p ? '2px solid #b794f6' : '2px solid transparent',
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Podium — top 3, only shown when not searching and there are entries */}
        {!isSearching && top3.length > 0 && (
          <div className='px-3 pt-4 pb-1'>
            <PodiumSection
              top3={top3}
              xProfileMap={xProfileMap}
              potComposition={potComposition}
              hasPot={hasPot}
              period={period}
              solPriceUsd={solPriceUsd}
              onSelectTrader={(address) => setProfileAddress(address)}
            />
          </div>
        )}

        {/* Column headers — shown for the rank-4+ list (or search results) */}
        {(listRows.length > 0 || isSearching) && (
          <div
            className='flex items-center gap-3 px-4 py-1.5'
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', borderTop: !isSearching && top3.length > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
          >
            <span className='flex-shrink-0 w-7 text-center text-[10px] font-bold uppercase tracking-wider' style={{ color: '#3A3A3A' }}>
              #
            </span>
            {/* avatar column spacer */}
            <span className='flex-shrink-0 w-8' />
            <span className='flex-1 text-[10px] font-bold uppercase tracking-wider' style={{ color: '#3A3A3A' }}>
              Trader
            </span>
            <span className='flex-shrink-0 text-[10px] font-bold uppercase tracking-wider' style={{ color: '#3A3A3A' }}>
              PnL
            </span>
          </div>
        )}

        {/* Rows — fixed-height scrollable */}
        <div
          className='px-1 py-1'
          style={{
            maxHeight: listRows.length > 0 ? '432px' : undefined,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {rows.length === 0 ? (
            /* No data at all for this period */
            <div className='py-8 text-center'>
              <Search size={24} className='mx-auto mb-2' style={{ color: '#2A2A2A' }} />
              <p className='text-sm' style={{ color: '#4A4A4A' }}>No trades in this period yet</p>
            </div>
          ) : isSearching && filteredRows.length === 0 ? (
            /* Search returned no results */
            <div className='py-8 text-center'>
              <Search size={24} className='mx-auto mb-2' style={{ color: '#2A2A2A' }} />
              <p className='text-sm' style={{ color: '#4A4A4A' }}>No traders found</p>
              <p className='text-xs mt-0.5' style={{ color: '#3A3A3A' }}>
                Try a different @username or wallet
              </p>
            </div>
          ) : listRows.length === 0 && !isSearching ? (
            /* All traders are in the podium — nothing left for the list */
            <div className='py-3 text-center'>
              <p className='text-xs' style={{ color: '#5A5A5A' }}>Tap any card above to view a trader profile</p>
            </div>
          ) : (
            <div>
              {listRows.map((entry) => {
                // Projected prize share only on top-3 MONTHLY rows when a pot exists.
                const projectedShares =
                  period === 'monthly' && hasPot && entry.rank >= 1 && entry.rank <= 3
                    ? potComposition.map(({ mint, total }) => ({
                        mint,
                        amount: rankShareBaseUnits(total, entry.rank),
                      }))
                    : undefined;
                return (
                  <LeaderboardRow
                    key={entry.id}
                    rank={entry.rank}
                    entry={entry}
                    xProfile={xProfileMap.get(entry.trader)}
                    projectedShares={projectedShares}
                    onClick={() => setProfileAddress(entry.trader)}
                  />
                );
              })}
              <p className='text-center text-xs px-3 pt-1.5 pb-1' style={{ color: '#5A5A5A' }}>
                Tap any trader to view their profile
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Trader profile popup — opens when a row is tapped */}
      <UserProfilePopup
        traderAddress={profileAddress}
        open={!!profileAddress}
        onClose={() => setProfileAddress(null)}
      />
    </section>
  );
}
