/**
 * PnlLeaderboard — Battles page section showing top traders by realized PnL
 * per rolling period (Daily / Weekly / Monthly / All Time).
 *
 * Data source: `pnlLeaderboard` collection, precomputed every 15 min by the
 * pnl-leaderboard Heartbeat task.
 * Twitter identity: same xProfileMap pattern as AdminDashboard / share modals.
 *
 * Monthly top-3 prize split: derived from the REAL on-chain net pot balance
 * (SUM deposits − SUM withdrawals per mint), identical to MonthlyPrizePotCard.
 * Split: 1st=50%, 2nd=35%, 3rd=15% of actual current pot total.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crown, EyeOff, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { WarriorAvatar } from './arena/WarriorAvatar';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useDefaultAvatars } from '@/hooks/use-default-avatars';
import { pickDefaultAvatar } from '@/utils/default-avatar';
import { subscribeManyPnlLeaderboard, type PnlLeaderboardResponse } from '@/lib/collections/pnlLeaderboard';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import {
  subscribeManyMonthlyRewardDeposit,
  type MonthlyRewardDepositResponse,
} from '@/lib/collections/monthlyRewardDeposit';
import {
  subscribeManyMonthlyRewardWithdrawal,
  type MonthlyRewardWithdrawalResponse,
} from '@/lib/collections/monthlyRewardWithdrawal';
import { api } from '@/lib/api-client';
import { truncateAddress } from '@/utils/format-address';
import { TokenLogo } from '@/components/TokenLogo';
import {
  currentMonthKeyUTC,
  potAccountIdForMonth,
  symbolForMint,
  formatTokenAmount,
  rankShareBaseUnits,
  fromBaseUnits,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { SOL, USDC } from '@/lib/constants';
import { UserProfilePopup } from './UserProfilePopup';

/** Format a base-unit amount using resolved decimals and symbol. Mirrors MonthlyPrizePotCard.formatAmount. */
function formatResolvedAmount(baseUnits: number, decimals: number, symbol: string): string {
  const human = decimals > 0 ? baseUnits / Math.pow(10, decimals) : baseUnits;
  const maxFrac = Math.min(decimals, 6);
  const str = human.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return `${str} $${symbol}`;
}

export interface ProjectedShare {
  mint: string;
  amount: number; // base units
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly' | 'all';

export interface XProfile {
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
  tokenMeta,
  defaultAvatarUrls,
  onClick,
}: {
  rank: number;
  entry: PnlLeaderboardResponse;
  xProfile?: XProfile;
  projectedShares?: ProjectedShare[];
  tokenMeta?: Map<string, { symbol: string; decimals: number }>;
  defaultAvatarUrls: string[];
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
      className='arena-march-in w-full flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all hover:bg-white/[0.04] active:bg-white/[0.06] text-left'
      style={{ animationDelay: `${Math.min(rank - 1, 12) * 50}ms` }}
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
      ) : (() => {
        const defaultAvatar = pickDefaultAvatar(entry.trader, defaultAvatarUrls);
        return defaultAvatar ? (
          <img
            src={defaultAvatar}
            alt='avatar'
            className='flex-shrink-0 w-8 h-8 rounded-full object-cover'
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          />
        ) : (
          <WarriorAvatar rank={rank} size={32} className='flex-shrink-0' />
        );
      })()}

      {/* Identity */}
      <div className='flex-1 min-w-0'>
        <div className='text-sm font-semibold truncate' style={{ color: xProfile ? '#fff' : '#9A9A9A' }}>
          {displayName}
        </div>
        <div className='text-xs' style={{ color: '#5A5A5A' }}>
          {entry.tradeCount} {entry.tradeCount === 1 ? 'trade' : 'trades'}
        </div>
        {/* Prize split from real pot balance (top-3 monthly rows only) */}
        {visibleShares.length > 0 && (
          <div className='flex flex-wrap items-center gap-1.5 mt-1'>
            {visibleShares.map((s) => (
              <span
                key={s.mint}
                className='inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums'
                style={{ background: 'rgba(255,215,0,0.12)', color: '#E8C547', border: '1px solid rgba(255,215,0,0.25)' }}
              >
                <TokenLogo symbol={tokenMeta?.get(s.mint)?.symbol ?? symbolForMint(s.mint)} size={12} />
                {tokenMeta?.get(s.mint)
                  ? formatResolvedAmount(s.amount, tokenMeta.get(s.mint)!.decimals, tokenMeta.get(s.mint)!.symbol)
                  : formatTokenAmount(s.amount, s.mint)}
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
    topBg: 'linear-gradient(160deg, rgba(255,220,80,0.13) 0%, rgba(200,140,20,0.06) 100%)',
    bodyBg: 'linear-gradient(180deg, rgba(100,72,20,0.55) 0%, rgba(60,42,10,0.75) 50%, rgba(30,20,5,0.95) 100%)',
    topBorder: 'rgba(255,215,0,0.50)',
    sideBorder: 'rgba(200,150,42,0.30)',
    glow: '0 0 28px rgba(255,215,0,0.16), 0 8px 32px rgba(0,0,0,0.55)',
    rankColor: '#E8C547',
    rankNumeral: 'I',
    rankNumeralSize: 'text-sm',
    rankNumeralOpacity: 'rgba(224,179,65,0.75)',
    crownGlow: '0 0 10px rgba(255,215,0,0.7)',
  },
  2: {
    topBg: 'linear-gradient(160deg, rgba(210,218,230,0.09) 0%, rgba(160,170,190,0.04) 100%)',
    bodyBg: 'linear-gradient(180deg, rgba(70,78,95,0.5) 0%, rgba(45,50,65,0.7) 50%, rgba(20,22,30,0.95) 100%)',
    topBorder: 'rgba(192,198,212,0.42)',
    sideBorder: 'rgba(160,170,190,0.22)',
    glow: '0 0 20px rgba(192,198,212,0.10), 0 8px 28px rgba(0,0,0,0.5)',
    rankColor: '#C0C6D4',
    rankNumeral: 'II',
    rankNumeralSize: 'text-xs',
    rankNumeralOpacity: 'rgba(192,198,212,0.55)',
    crownGlow: '',
  },
  3: {
    topBg: 'linear-gradient(160deg, rgba(215,140,55,0.09) 0%, rgba(160,95,30,0.04) 100%)',
    bodyBg: 'linear-gradient(180deg, rgba(85,52,18,0.5) 0%, rgba(55,32,8,0.7) 50%, rgba(25,14,3,0.95) 100%)',
    topBorder: 'rgba(205,127,50,0.42)',
    sideBorder: 'rgba(170,100,35,0.22)',
    glow: '0 0 18px rgba(205,127,50,0.10), 0 8px 28px rgba(0,0,0,0.5)',
    rankColor: '#CD7F32',
    rankNumeral: 'III',
    rankNumeralSize: 'text-[10px]',
    rankNumeralOpacity: 'rgba(185,110,45,0.55)',
    crownGlow: '',
  },
} as const;

// ─── computePrizeUsd ───────────────────────────────────────────────────────────

/**
 * Compute the combined USD value of a set of projected shares.
 * Pricing rules: USDC → $1/token, SOL → solPriceUsd/token, other → unpriced.
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
      pricedUsd += human;
    } else if (s.mint === SOL && solPriceUsd != null && solPriceUsd > 0) {
      pricedUsd += human * solPriceUsd;
    } else {
      unpricedCount += 1;
    }
  }
  return { pricedUsd, unpricedCount };
}

// ─── UnifiedPodiumBlock ────────────────────────────────────────────────────────
//
// A single tall pedestal block with the trader's info embedded inside.
// The block is the pedestal — no separate hovering card, no thin bar underneath.
// Rank numeral sits at the bottom of the stone face.
// Animation: rises from the ground (scaleY 0→1, transform-origin bottom).

function UnifiedPodiumBlock({
  rank,
  entry,
  xProfile,
  projectedShares,
  isCenter,
  solPriceUsd,
  tokenMeta,
  riseDelay,
  contentDelay,
  inView,
  defaultAvatarUrls,
  onClick,
  desktopLarge = false,
}: {
  rank: 1 | 2 | 3;
  entry: PnlLeaderboardResponse;
  xProfile?: XProfile;
  projectedShares?: ProjectedShare[];
  isCenter: boolean;
  solPriceUsd: number | null;
  tokenMeta?: Map<string, { symbol: string; decimals: number }>;
  riseDelay: number;
  contentDelay: number;
  inView: boolean;
  defaultAvatarUrls: string[];
  onClick: () => void;
  desktopLarge?: boolean;
}) {
  const accent = PODIUM_ACCENTS[rank];
  const isPositive = entry.realizedPnlUsdCents >= 0;
  const pnlColor = entry.pnlHidden ? '#5A5A5A' : (isPositive ? '#4ADE80' : '#FF5252');

  const displayName = xProfile?.username
    ? `@${xProfile.username}`
    : truncateAddress(entry.trader);

  const visibleShares = (projectedShares ?? []).filter((s) => s.amount > 0);

  const prizeUsdHeadline = useMemo(() => {
    if (visibleShares.length === 0) return null;
    const { pricedUsd, unpricedCount } = computePrizeUsd(visibleShares, solPriceUsd);
    if (pricedUsd === 0 && unpricedCount > 0) return null;
    const formatted = pricedUsd.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return { formatted, unpricedCount };
  }, [visibleShares, solPriceUsd]);

  const avatarSize = desktopLarge
    ? (isCenter ? 80 : 64)
    : (isCenter ? 44 : 36);

  // Stone base heights create the classic stepped podium silhouette.
  // Rank 1 (center) tallest base, rank 2 medium, rank 3 shortest.
  // items-end alignment in the parent container ensures all blocks share
  // a common bottom edge, so the height difference reads as step-up levels.
  const stoneBaseMinHeight = desktopLarge
    ? (rank === 1 ? 144 : rank === 2 ? 96 : 64)
    : (rank === 1 ? 72 : rank === 2 ? 48 : 32);

  return (
    // Outer wrapper: holds the layout column slot.
    // No overflow:hidden here — the crown for rank 1 floats above the pedestal.
    <div
      style={{
        flex: isCenter ? '0 0 37%' : '0 0 30%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Crown floats above the pedestal top edge for rank 1 */}
      {rank === 1 && (
        <div className='flex justify-center mb-1'>
          <div
            className='arena-crown-float'
            style={!inView ? { animationPlayState: 'paused', opacity: 0 } : undefined}
          >
            <Crown
              size={desktopLarge ? 34 : 18}
              style={{
                color: '#E0B341',
                filter: `drop-shadow(${accent.crownGlow})`,
              }}
            />
          </div>
        </div>
      )}
      {/* Spacer so rank 2 & 3 outer column also ends at the same visual bottom */}
      {rank !== 1 && <div className='flex-1' />}

      {/* The unified pedestal block */}
      <button
        type='button'
        onClick={onClick}
        className='arena-unified-podium w-full flex flex-col rounded-t-xl active:brightness-110 transition-[filter] cursor-pointer'
        style={{
          animationDelay: `${riseDelay}ms`,
          // Pause and hide the pedestal until the section scrolls into view
          ...(!inView ? { animationPlayState: 'paused', transform: 'scaleY(0)', opacity: 0.6 } : undefined),
          // Top section: info area with glass-stone gradient
          background: accent.bodyBg,
          border: `1px solid ${accent.sideBorder}`,
          borderTop: `2px solid ${accent.topBorder}`,
          boxShadow: accent.glow,
          // No bottom rounding — pedestals sit flat on the ground
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          // Prevent default button styles
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Info content section — fades in after pedestal has risen */}
        <div
          className={`arena-unified-podium-content flex flex-col items-center flex-1 ${desktopLarge ? 'px-5 pt-7 pb-4 gap-3' : 'px-2 pt-3 pb-2 gap-1.5'}`}
          style={{
            animationDelay: `${contentDelay}ms`,
            // Pause and hide content until the section scrolls into view
            ...(!inView ? { animationPlayState: 'paused', opacity: 0, transform: 'translateY(10px)' } : undefined),
            // Subtle top glow inside the pedestal face
            background: accent.topBg,
          }}
        >
          {/* Avatar */}
          <div className='flex-shrink-0'>
            {xProfile?.avatar ? (
              <img
                src={xProfile.avatar}
                alt={xProfile.username}
                className='rounded-full object-cover'
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  border: `1.5px solid ${accent.topBorder}`,
                  boxShadow: `0 0 12px ${accent.sideBorder}`,
                }}
              />
            ) : (() => {
              const defaultAvatar = pickDefaultAvatar(entry.trader, defaultAvatarUrls);
              return defaultAvatar ? (
                <img
                  src={defaultAvatar}
                  alt='avatar'
                  className='rounded-full object-cover'
                  style={{
                    width: avatarSize,
                    height: avatarSize,
                    border: `1.5px solid ${accent.topBorder}`,
                    boxShadow: `0 0 12px ${accent.sideBorder}`,
                  }}
                />
              ) : (
                <WarriorAvatar rank={rank} size={avatarSize} className='flex-shrink-0' />
              );
            })()}
          </div>

          {/* Display name */}
          <div
            className='w-full text-center font-semibold truncate leading-tight'
            style={{ color: xProfile ? '#E8E8E8' : '#8A8A8A', fontSize: desktopLarge ? '0.95rem' : '0.6875rem' }}
          >
            {displayName}
          </div>

          {/* PnL */}
          {entry.pnlHidden ? (
            <div className='flex items-center gap-1 flex-shrink-0'>
              <EyeOff size={desktopLarge ? 14 : 10} style={{ color: '#5A5A5A' }} />
              <span className='font-black tabular-nums' style={{ color: '#5A5A5A', fontSize: desktopLarge ? '1rem' : '0.75rem' }}>—</span>
            </div>
          ) : (
            <div className='flex items-center gap-0.5 flex-shrink-0'>
              {isPositive
                ? <TrendingUp size={desktopLarge ? 14 : 10} style={{ color: pnlColor }} />
                : <TrendingDown size={desktopLarge ? 14 : 10} style={{ color: pnlColor }} />
              }
              <span
                className='font-black tabular-nums'
                style={{ color: pnlColor, fontSize: desktopLarge ? (isCenter ? '1.35rem' : '1.1rem') : (isCenter ? '0.875rem' : '0.75rem') }}
              >
                {formatPnl(entry.realizedPnlUsdCents)}
              </span>
            </div>
          )}

          {/* Prize split — only on Monthly when pot is funded */}
          {visibleShares.length > 0 && (
            <div className='w-full flex flex-col items-center gap-1'>
              <span
                className='font-black uppercase tracking-[0.08em]'
                style={{ color: '#C9A227', fontSize: desktopLarge ? '0.7rem' : '0.5rem' }}
              >
                Prize Split
              </span>

              {prizeUsdHeadline && (
                <div className='flex flex-col items-center gap-0.5'>
                  <span
                    className='font-black tabular-nums leading-none'
                    style={{
                      color: '#FFD700',
                      textShadow: '0 0 14px rgba(255,215,0,0.55)',
                      letterSpacing: '-0.01em',
                      fontSize: desktopLarge ? (isCenter ? '1.2rem' : '1rem') : (isCenter ? '0.875rem' : '0.75rem'),
                    }}
                  >
                    ${prizeUsdHeadline.formatted}
                  </span>
                  {prizeUsdHeadline.unpricedCount > 0 && (
                    <span className='font-semibold' style={{ color: '#8A7030', fontSize: desktopLarge ? '0.7rem' : '0.5rem' }}>
                      + {prizeUsdHeadline.unpricedCount} more
                    </span>
                  )}
                </div>
              )}

              <div className='flex flex-wrap justify-center gap-0.5'>
                {visibleShares.map((s) => (
                  <span
                    key={s.mint}
                    className='inline-flex items-center gap-1 rounded-full font-black tabular-nums'
                    style={{
                      background: 'linear-gradient(135deg, rgba(255,215,0,0.22), rgba(255,184,0,0.10))',
                      color: '#FFDD66',
                      border: '1px solid rgba(255,215,0,0.40)',
                      padding: desktopLarge ? (isCenter ? '0.3rem 0.6rem' : '0.2rem 0.5rem') : (isCenter ? '0.125rem 0.5rem' : '0.125rem 0.375rem'),
                      fontSize: desktopLarge ? (isCenter ? '0.75rem' : '0.65rem') : (isCenter ? '0.625rem' : '0.5625rem'),
                    }}
                  >
                    <TokenLogo symbol={tokenMeta?.get(s.mint)?.symbol ?? symbolForMint(s.mint)} size={desktopLarge ? (isCenter ? 16 : 13) : (isCenter ? 12 : 10)} />
                    {tokenMeta?.get(s.mint)
                      ? formatResolvedAmount(s.amount, tokenMeta.get(s.mint)!.decimals, tokenMeta.get(s.mint)!.symbol)
                      : formatTokenAmount(s.amount, s.mint)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Trade count */}
          <div style={{ color: '#4A4A4A', fontSize: desktopLarge ? '0.7rem' : '0.5625rem' }}>
            {entry.tradeCount} {entry.tradeCount === 1 ? 'trade' : 'trades'}
          </div>
        </div>

        {/* Stone base section — purely decorative, contains the rank numeral */}
        <div
          className='w-full flex items-center justify-center flex-shrink-0'
          style={{
            minHeight: stoneBaseMinHeight,
            background: 'linear-gradient(180deg, rgba(40,28,8,0.7) 0%, rgba(18,12,3,0.95) 100%)',
            borderTop: `1px solid ${accent.sideBorder}`,
          }}
        >
          <span
            className={`font-black uppercase tracking-[0.12em] select-none ${desktopLarge ? 'text-2xl' : accent.rankNumeralSize}`}
            style={{ color: accent.rankNumeralOpacity }}
          >
            {accent.rankNumeral}
          </span>
        </div>
      </button>
    </div>
  );
}

// ─── Podium section ────────────────────────────────────────────────────────────

export function PodiumSection({
  top3,
  xProfileMap,
  potComposition,
  hasPot,
  period,
  solPriceUsd,
  tokenMeta,
  defaultAvatarUrls,
  onSelectTrader,
  desktopLarge = false,
}: {
  top3: PnlLeaderboardResponse[];
  xProfileMap: Map<string, XProfile>;
  potComposition: { mint: string; total: number }[];
  hasPot: boolean;
  period: string;
  solPriceUsd: number | null;
  tokenMeta: Map<string, { symbol: string; decimals: number }>;
  defaultAvatarUrls: string[];
  onSelectTrader: (address: string) => void;
  desktopLarge?: boolean;
}) {
  // Fire-once in-view detection via IntersectionObserver.
  // The podium entrance animation plays only when the section scrolls into view.
  const [inView, setInView] = useState(false);
  const podiumRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = podiumRef.current;
    if (!el || inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect(); // fire once
        }
      },
      {
        // Trigger slightly before the element is fully in view (10% of viewport buffer from bottom)
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.1,
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top3.length, inView]); // re-run when data first populates (top3.length 0→N)

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

  // Stagger: rank2 rises first (leftmost), rank1 center, rank3 right.
  // Slight stagger makes the podium assemble from left to right.
  // Content fades in after its column's pedestal has substantially risen.
  const delays = {
    rank2Rise: 0,
    rank1Rise: 100,
    rank3Rise: 200,
    rank2Content: 320,
    rank1Content: 420,
    rank3Content: 520,
  };

  // Layout: [rank2] [rank1 — center/tallest] [rank3]
  return (
    <div className={desktopLarge ? 'mb-0' : 'mb-4'} ref={podiumRef}>
      {/* items-end aligns the BOTTOMS of all three columns so they share a common ground */}
      <div className={`flex items-end justify-center ${desktopLarge ? 'gap-3 px-4' : 'gap-1.5 px-1'}`}>
        {/* Rank 2 — left */}
        {rank2 ? (
          <UnifiedPodiumBlock
            rank={2}
            entry={rank2}
            xProfile={xProfileMap.get(rank2.trader)}
            projectedShares={getShares(2)}
            isCenter={false}
            solPriceUsd={solPriceUsd}
            tokenMeta={tokenMeta}
            riseDelay={delays.rank2Rise}
            contentDelay={delays.rank2Content}
            inView={inView}
            defaultAvatarUrls={defaultAvatarUrls}
            onClick={() => onSelectTrader(rank2.trader)}
            desktopLarge={desktopLarge}
          />
        ) : rank1 ? (
          <div style={{ flex: '0 0 30%' }} />
        ) : null}

        {/* Rank 1 — center, tallest */}
        {rank1 && (
          <UnifiedPodiumBlock
            rank={1}
            entry={rank1}
            xProfile={xProfileMap.get(rank1.trader)}
            projectedShares={getShares(1)}
            isCenter={true}
            solPriceUsd={solPriceUsd}
            tokenMeta={tokenMeta}
            riseDelay={delays.rank1Rise}
            contentDelay={delays.rank1Content}
            inView={inView}
            defaultAvatarUrls={defaultAvatarUrls}
            onClick={() => onSelectTrader(rank1.trader)}
            desktopLarge={desktopLarge}
          />
        )}

        {/* Rank 3 — right, shortest */}
        {rank3 ? (
          <UnifiedPodiumBlock
            rank={3}
            entry={rank3}
            xProfile={xProfileMap.get(rank3.trader)}
            projectedShares={getShares(3)}
            isCenter={false}
            solPriceUsd={solPriceUsd}
            tokenMeta={tokenMeta}
            riseDelay={delays.rank3Rise}
            contentDelay={delays.rank3Content}
            inView={inView}
            defaultAvatarUrls={defaultAvatarUrls}
            onClick={() => onSelectTrader(rank3.trader)}
            desktopLarge={desktopLarge}
          />
        ) : rank1 ? (
          <div style={{ flex: '0 0 30%' }} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Real pot subscription hooks ──────────────────────────────────────────────

/** Subscribes to all deposit records for a given potAccountId. */
function useDepositsSubscription(potAccountId: string): MonthlyRewardDepositResponse[] {
  const [items, setItems] = useState<MonthlyRewardDepositResponse[]>([]);
  const unsubRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    subscribeManyMonthlyRewardDeposit((data) => {
      if (!cancelled) setItems(data);
    }, `where potAccountId = '${potAccountId}'`).then((unsub) => {
      if (cancelled) { void unsub(); }
      else { unsubRef.current = unsub; }
    });
    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, [potAccountId]);

  return items;
}

/** Subscribes to all withdrawal records for a given potAccountId. */
function useWithdrawalsSubscription(potAccountId: string): MonthlyRewardWithdrawalResponse[] {
  const [items, setItems] = useState<MonthlyRewardWithdrawalResponse[]>([]);
  const unsubRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    subscribeManyMonthlyRewardWithdrawal((data) => {
      if (!cancelled) setItems(data);
    }, `where potAccountId = '${potAccountId}'`).then((unsub) => {
      if (cancelled) { void unsub(); }
      else { unsubRef.current = unsub; }
    });
    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, [potAccountId]);

  return items;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PnlLeaderboard({ hidePodium = false, desktopLarge = false }: { hidePodium?: boolean; desktopLarge?: boolean }) {
  const [period, setPeriod] = useState<Period>('monthly');
  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);

  // Default avatar pool — called once here and passed down to row/podium components.
  const defaultAvatarUrls = useDefaultAvatars();

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

  // Real pot balance — same source as MonthlyPrizePotCard.
  // net per mint = SUM(deposits.amount) - SUM(withdrawals.amount) for potAccountId.
  const currentMonthKey = useMemo(() => currentMonthKeyUTC(), []);
  const potAccountId = useMemo(() => potAccountIdForMonth(currentMonthKey), [currentMonthKey]);

  const deposits = useDepositsSubscription(potAccountId);
  const withdrawals = useWithdrawalsSubscription(potAccountId);

  // Compute net balance per mint (identical logic to MonthlyPrizePotCard).
  const netByMint = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of deposits) {
      if (!d.mint) continue;
      const amt = Number(d.amount) || 0;
      if (amt <= 0) continue;
      totals.set(d.mint, (totals.get(d.mint) ?? 0) + amt);
    }
    for (const w of withdrawals) {
      if (!w.mint) continue;
      const amt = Number(w.amount) || 0;
      if (amt <= 0) continue;
      totals.set(w.mint, (totals.get(w.mint) ?? 0) - amt);
    }
    // Remove mints that net to zero or negative
    for (const [mint, net] of totals) {
      if (net <= 0) totals.delete(mint);
    }
    return totals;
  }, [deposits, withdrawals]);

  // Build composition from REAL net balances (one entry per mint with a positive balance).
  const potComposition = useMemo(() => {
    const entries: { mint: string; total: number }[] = [];
    for (const [mint, net] of netByMint) {
      entries.push({ mint, total: net });
    }
    return entries;
  }, [netByMint]);

  // Pot is considered present when at least one mint has a positive net balance.
  // Show $0 when empty (zero) rather than hiding — render real zeros.
  const hasPot = potComposition.length > 0;

  // Resolve symbol + decimals for all mints in the real pot.
  const allMints = useMemo(() => potComposition.map((c) => c.mint), [potComposition]);
  const tokenMeta = useTokenMetadata(allMints);

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
  // When searching show ALL filtered rows; when not searching, show rank 4+ (unless podium is hidden, in which case show all ranks)
  const listRows = useMemo(() => {
    if (isSearching) return filteredRows;
    if (hidePodium) return rows;
    return rows.filter((e) => e.rank > 3);
  }, [isSearching, filteredRows, rows, hidePodium]);

  const periods: Period[] = ['daily', 'weekly', 'monthly', 'all'];

  return (
    <section>
      {/* Podium — top 3, shown at the very top before search/tabs, only when not searching and not hidden by parent */}
      {!hidePodium && !isSearching && top3.length > 0 && (
        <div className='px-3 pt-4 pb-3 mb-3'>
          <PodiumSection
            top3={top3}
            xProfileMap={xProfileMap}
            potComposition={potComposition}
            hasPot={hasPot}
            period={period}
            solPriceUsd={solPriceUsd}
            tokenMeta={tokenMeta}
            defaultAvatarUrls={defaultAvatarUrls}
            onSelectTrader={(address) => setProfileAddress(address)}
            desktopLarge={desktopLarge}
          />
        </div>
      )}

      {/* Search bar */}
      <div className='relative mb-3'>
        <Search
          size={16}
          className='absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none'
          style={{ color: search ? '#C8962A' : '#5A5A5A' }}
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
          className='arena-search-input w-full rounded-xl text-sm font-medium pl-10 pr-10 py-3 outline-none transition-all placeholder:text-[#5A5A5A]'
          style={{
            color: '#fff',
            background: search ? 'rgba(200,150,42,0.10)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${search ? 'rgba(200,150,42,0.45)' : 'rgba(200,150,42,0.15)'}`,
            boxShadow: search ? '0 0 0 1px rgba(200,150,42,0.12) inset' : undefined,
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

      {/* Period tabs */}
      <div className='arena-card rounded-xl overflow-hidden'>
        <div className='flex' style={{ borderBottom: '1px solid rgba(200,150,42,0.12)' }}>
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className='flex-1 py-2.5 text-xs font-semibold transition-all'
              style={{
                background: period === p ? 'rgba(200,150,42,0.12)' : 'transparent',
                color: period === p ? '#E0B341' : '#5A5A5A',
                borderBottom: period === p ? '2px solid rgba(200,150,42,0.7)' : '2px solid transparent',
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        <p className='text-center text-xs px-3 pt-2 pb-0.5' style={{ color: '#5A5A5A' }}>
          Tap any trader to view their profile
        </p>

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
              <Search size={24} className='mx-auto mb-2' style={{ color: 'rgba(200,150,42,0.2)' }} />
              <p className='text-sm' style={{ color: '#5A5A5A' }}>No trades in this period yet</p>
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
                    tokenMeta={tokenMeta}
                    defaultAvatarUrls={defaultAvatarUrls}
                    onClick={() => setProfileAddress(entry.trader)}
                  />
                );
              })}
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

// ─── usePodiumMonthlyData ─────────────────────────────────────────────────────
// Exported hook that provides all data needed to render a standalone PodiumSection
// (top-3 monthly entries, xProfile map, pot composition, sol price, token meta).
// Used by the desktop above-fold podium in BattlesPage.

export function usePodiumMonthlyData() {
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);

  const defaultAvatarUrls = useDefaultAvatars();

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>('/api/phoenix/markets-overview')
      .then((raw) => {
        if (cancelled) return;
        const list: Array<{ symbol?: string; markPrice?: number; lastPrice?: number }> = Array.isArray(raw)
          ? (raw as typeof list)
          : ((raw as { markets?: typeof list })?.markets ?? []);
        const solMarket = list.find((m) => m.symbol === 'SOL' || m.symbol === 'SOL-PERP');
        const price = solMarket?.markPrice ?? solMarket?.lastPrice;
        if (typeof price === 'number' && price > 0) setSolPriceUsd(price);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { data: rawEntries } = useRealtimeData<PnlLeaderboardResponse[]>(
    subscribeManyPnlLeaderboard,
    true,
  );

  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true,
  );

  const currentMonthKey = useMemo(() => currentMonthKeyUTC(), []);
  const potAccountId = useMemo(() => potAccountIdForMonth(currentMonthKey), [currentMonthKey]);
  const deposits = useDepositsSubscription(potAccountId);
  const withdrawals = useWithdrawalsSubscription(potAccountId);

  const netByMint = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of deposits) {
      if (!d.mint) continue;
      const amt = Number(d.amount) || 0;
      if (amt <= 0) continue;
      totals.set(d.mint, (totals.get(d.mint) ?? 0) + amt);
    }
    for (const w of withdrawals) {
      if (!w.mint) continue;
      const amt = Number(w.amount) || 0;
      if (amt <= 0) continue;
      totals.set(w.mint, (totals.get(w.mint) ?? 0) - amt);
    }
    for (const [mint, net] of totals) {
      if (net <= 0) totals.delete(mint);
    }
    return totals;
  }, [deposits, withdrawals]);

  const potComposition = useMemo(() => {
    const entries: { mint: string; total: number }[] = [];
    for (const [mint, net] of netByMint) {
      entries.push({ mint, total: net });
    }
    return entries;
  }, [netByMint]);

  const hasPot = potComposition.length > 0;

  const allMints = useMemo(() => potComposition.map((c) => c.mint), [potComposition]);
  const tokenMeta = useTokenMetadata(allMints);

  const xProfileMap = useMemo(() => {
    const map = new Map<string, XProfile>();
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet) {
        try {
          const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
          if (parsed?.username) {
            map.set(String(link.wallet), { username: parsed.username, avatar: parsed.avatar ?? undefined });
          }
        } catch { /* skip */ }
      }
    }
    return map;
  }, [allSocialLinks]);

  const top3 = useMemo(() => {
    if (!rawEntries) return [];
    return rawEntries
      .filter((e) => e.period === 'monthly' && e.tradeCount > 0 && e.rank <= 3)
      .sort((a, b) => a.rank - b.rank);
  }, [rawEntries]);

  return {
    top3,
    xProfileMap,
    potComposition,
    hasPot,
    solPriceUsd,
    tokenMeta,
    defaultAvatarUrls,
  };
}
