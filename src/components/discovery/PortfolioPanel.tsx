/**
 * PortfolioPanel — left column of DiscoveryPage.
 * Compact portfolio summary + tabbed feed: Positions / Activities / Follows.
 */

import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@pooflabs/web';
import { api } from '@/lib/api-client';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyNotifications, updateNotifications, type NotificationsResponse } from '@/lib/collections/notifications';
import { subscribeManyFollows, type FollowsResponse } from '@/lib/collections/follows';
import { getPnlLeaderboard, type PnlLeaderboardResponse } from '@/lib/collections/pnlLeaderboard';
import { toNumber, type RisePosition, type TokenAmount } from '@/utils/phoenix-mappers';
import { truncateAddress } from '@/utils/format-address';
import { TrendingUp, TrendingDown, UserCheck, Bell, Layers, LogIn, Zap, UserPlus, Trophy } from 'lucide-react';

const BG = '#1a1a1f';
const BORDER = '#2a2a35';
const ACCENT = '#ab9ff2';
const MUTED = '#6b6b7a';
const POS = '#4ADE80';
const NEG = '#FF5252';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TraderDataMinimal {
  collateralBalance?: TokenAmount;
  unrealizedPnl?: TokenAmount;
  crossInitialMargin?: TokenAmount;
  positions?: RisePosition[];
  health?: number;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${fmtUsd(v)}`;
}

function fmtTimeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function bareSymbol(s: string): string {
  return s.replace(/-PERP$/i, '');
}

// ─── Portfolio Summary ────────────────────────────────────────────────────────

function PortfolioSummary({ walletAddress }: { walletAddress: string }) {
  const [trader, setTrader] = useState<TraderDataMinimal | null>(null);
  const [loading, setLoading] = useState(true);
  const [allTimePnl, setAllTimePnl] = useState<PnlLeaderboardResponse | null | 'loading'>('loading');

  const fetchTrader = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const data = await api.get<TraderDataMinimal>(`/api/phoenix/trader/${walletAddress}`);
      setTrader(data);
    } catch {
      setTrader(null);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  const fetchAllTimePnl = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const entry = await getPnlLeaderboard(`all:${walletAddress}`);
      setAllTimePnl(entry);
    } catch {
      setAllTimePnl(null);
    }
  }, [walletAddress]);

  useEffect(() => { fetchTrader(); }, [fetchTrader]);
  useEffect(() => { fetchAllTimePnl(); }, [fetchAllTimePnl]);

  const collateral = toNumber(trader?.collateralBalance);
  const unrealizedPnl = toNumber(trader?.unrealizedPnl);
  const initialMargin = trader?.crossInitialMargin
    ? toNumber(trader.crossInitialMargin)
    : (Array.isArray(trader?.positions) ? trader!.positions! : []).reduce(
        (s, p) => s + toNumber(p.initialMargin), 0,
      );
  const totalPortfolio = collateral + unrealizedPnl;
  const hasData = !!trader;

  if (loading && !trader) {
    return (
      <div className='px-4 py-4' style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className='text-xs' style={{ color: MUTED }}>Loading portfolio...</div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className='px-4 py-4' style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className='text-xs' style={{ color: MUTED }}>No portfolio data available</div>
      </div>
    );
  }

  const hasPositions = Array.isArray(trader?.positions) && (trader?.positions?.length ?? 0) > 0;

  // All-time realized PnL
  // When no leaderboard record exists yet (new user, 404 → null), treat as $0.00 realized PnL.
  // Only the 'loading' sentinel hides the tile; a resolved null means "no trades" = $0.
  const allTimePnlResolved = allTimePnl !== 'loading';
  const allTimePnlHidden = allTimePnlResolved && allTimePnl !== null && !!(allTimePnl as PnlLeaderboardResponse).pnlHidden;
  const allTimePnlValue = allTimePnlResolved && !allTimePnlHidden
    ? (allTimePnl !== null ? (allTimePnl as PnlLeaderboardResponse).realizedPnlUsdCents / 100 : 0)
    : null;
  const allTimePnlColor = allTimePnlValue != null ? (allTimePnlValue >= 0 ? POS : NEG) : MUTED;

  return (
    <div className='px-4 py-4' style={{ borderBottom: `1px solid ${BORDER}` }}>
      {/* Portfolio Value — primary large figure */}
      <div className='mb-3'>
        <div className='text-[10px] uppercase tracking-wider font-medium mb-0.5' style={{ color: MUTED }}>
          Portfolio Value
        </div>
        <div className='text-2xl font-bold tabular-nums' style={{ color: '#e8e8f0' }}>
          {fmtUsd(totalPortfolio)}
        </div>
      </div>

      {/* All-Time Realized PnL + optional In Use row */}
      <div className='flex items-stretch gap-2'>
        {allTimePnlValue !== null && (
          <div
            className='flex-1 rounded-lg px-3 py-2.5'
            style={{ background: '#111116', border: `1px solid ${BORDER}40` }}
          >
            <div className='text-[10px] uppercase tracking-wider font-medium mb-0.5' style={{ color: MUTED }}>
              All-Time Realized
            </div>
            <div className='text-2xl font-bold tabular-nums' style={{ color: allTimePnlColor }}>
              {fmtSignedUsd(allTimePnlValue)}
            </div>
          </div>
        )}

        {/* Only show in-use tile if we have positions/margin info */}
        {initialMargin > 0 && hasPositions && (
          <div
            className='rounded-lg px-3 py-2.5'
            style={{ background: '#111116', border: `1px solid ${BORDER}40` }}
          >
            <div className='text-[10px] uppercase tracking-wider font-medium mb-0.5' style={{ color: MUTED }}>In Use</div>
            <div className='text-sm font-semibold tabular-nums' style={{ color: '#e8e8f0' }}>
              {fmtUsd(initialMargin)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Positions Tab ────────────────────────────────────────────────────────────

function PositionsTab({ walletAddress }: { walletAddress: string }) {
  const navigate = useNavigate();
  const [trader, setTrader] = useState<TraderDataMinimal | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const data = await api.get<TraderDataMinimal>(`/api/phoenix/trader/${walletAddress}`);
      setTrader(data);
    } catch {
      setTrader(null);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => { fetch(); }, [fetch]);

  const positions: RisePosition[] = useMemo(
    () => (Array.isArray(trader?.positions) ? trader!.positions! : []),
    [trader],
  );

  if (loading && !trader) {
    return (
      <div className='flex items-center justify-center py-8'>
        <div className='text-xs' style={{ color: MUTED }}>Loading positions...</div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-10 gap-2'>
        <Layers size={24} style={{ color: MUTED }} />
        <div className='text-xs' style={{ color: MUTED }}>No open positions</div>
      </div>
    );
  }

  return (
    <div className='space-y-1.5 p-2'>
      {positions.map((pos, i) => {
        const bare = bareSymbol(pos.symbol ?? '');
        const pnl = toNumber(pos.unrealizedPnl);
        const size = toNumber(pos.positionSize);
        const entry = toNumber(pos.entryPrice);
        const isLong = size >= 0;
        const pnlColor = pnl >= 0 ? POS : NEG;

        return (
          <button
            key={i}
            onClick={() => navigate(`/trade/${pos.symbol ?? 'SOL-PERP'}`)}
            className='w-full flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.04]'
            style={{ background: '#111116', border: `1px solid ${BORDER}40` }}
          >
            <div className='flex items-center gap-2 min-w-0'>
              <div
                className='w-1.5 h-1.5 rounded-full flex-shrink-0'
                style={{ background: isLong ? POS : NEG }}
              />
              <div className='text-left min-w-0'>
                <div className='text-xs font-semibold' style={{ color: '#e8e8f0' }}>
                  {bare}
                </div>
                <div className='text-[10px]' style={{ color: MUTED }}>
                  {isLong ? 'Long' : 'Short'} @ {entry > 0 ? `$${entry.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </div>
              </div>
            </div>
            <div className='text-right tabular-nums'>
              <div className='text-xs font-bold' style={{ color: pnlColor }}>
                {fmtSignedUsd(pnl)}
              </div>
              <div className='text-[10px]' style={{ color: MUTED }}>
                {Math.abs(size).toFixed(4)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Activities Tab ───────────────────────────────────────────────────────────

function ActivitiesTab({ walletAddress }: { walletAddress: string }) {
  const { data: notifications } = useRealtimeData<NotificationsResponse[]>(
    subscribeManyNotifications,
    !!walletAddress,
    walletAddress ? `recipient = '${walletAddress}'` : '',
  );

  const sorted = useMemo(
    () => [...(notifications ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30),
    [notifications],
  );

  // Mark all unread as read when component mounts
  useEffect(() => {
    const unread = (notifications ?? []).filter((n) => !n.read);
    if (unread.length > 0) {
      Promise.allSettled(unread.map((n) => updateNotifications(n.id, { read: true })));
    }
  }, [notifications]);

  if (sorted.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-10 gap-2'>
        <Bell size={24} style={{ color: MUTED }} />
        <div className='text-xs' style={{ color: MUTED }}>No recent activity</div>
      </div>
    );
  }

  return (
    <div className='space-y-1 p-2'>
      {sorted.map((n) => {
        const isClose = n.type === 'close';
        const isOpen = n.type === 'open';
        const isFollow = n.type === 'follow';
        const isLiquidated = n.type === 'liquidated';
        const isMonthlyReward = n.type === 'monthly_reward';
        const actorLabel = n.actorName ? `@${n.actorName}` : truncateAddress(n.actor, 4, 4);
        const bare = n.symbol ? bareSymbol(n.symbol) : '';

        let icon = <Zap size={13} style={{ color: ACCENT }} />;
        let text = '';
        let valueColor = MUTED;
        let valueText = '';

        if (isFollow) {
          icon = <UserPlus size={13} style={{ color: ACCENT }} />;
          text = `${actorLabel} started following you`;
        } else if (isMonthlyReward) {
          icon = <Trophy size={13} style={{ color: '#FFC83D' }} />;
          const rank = Number(n.side) || 0;
          text = `Monthly reward — ${rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'} place`;
        } else if (isLiquidated) {
          icon = <TrendingDown size={13} style={{ color: NEG }} />;
          text = `${actorLabel} was liquidated on ${bare}`;
        } else if (isOpen) {
          const side = n.side?.toLowerCase() === 'bid' || n.side?.toLowerCase() === 'long' ? 'Long' : 'Short';
          const sideColor = side === 'Long' ? POS : NEG;
          text = `${actorLabel} opened ${bare} ${side}`;
          icon = side === 'Long' ? <TrendingUp size={13} style={{ color: sideColor }} /> : <TrendingDown size={13} style={{ color: sideColor }} />;
        } else if (isClose) {
          const side = n.side?.toLowerCase() === 'bid' || n.side?.toLowerCase() === 'long' ? 'Long' : 'Short';
          const pnl = n.pnlUsdCents != null ? n.pnlUsdCents / 100 : null;
          text = `${actorLabel} closed ${bare} ${side}`;
          if (pnl != null) {
            valueText = fmtSignedUsd(pnl);
            valueColor = pnl >= 0 ? POS : NEG;
          }
          icon = pnl != null && pnl >= 0 ? <TrendingUp size={13} style={{ color: POS }} /> : <TrendingDown size={13} style={{ color: NEG }} />;
        }

        return (
          <div
            key={n.id}
            className='flex items-start gap-2.5 rounded-lg px-3 py-2.5'
            style={{
              background: n.read ? '#111116' : `${ACCENT}10`,
              border: `1px solid ${n.read ? BORDER + '40' : ACCENT + '28'}`,
            }}
          >
            <div
              className='w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5'
              style={{ background: '#1e1e28' }}
            >
              {icon}
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-xs leading-snug' style={{ color: '#c8c8d8' }}>
                {text}
              </div>
              <div className='text-[10px] mt-0.5' style={{ color: MUTED }}>
                {fmtTimeAgo(n.createdAt)}
              </div>
            </div>
            {valueText && (
              <div className='text-xs font-bold tabular-nums flex-shrink-0' style={{ color: valueColor }}>
                {valueText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Follows Tab ──────────────────────────────────────────────────────────────

function FollowsTab({ walletAddress }: { walletAddress: string }) {
  const { data: followDocs } = useRealtimeData<FollowsResponse[]>(
    subscribeManyFollows,
    !!walletAddress,
    walletAddress ? `follower = '${walletAddress}'` : '',
  );

  const follows = followDocs ?? [];

  if (follows.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-10 gap-2'>
        <UserCheck size={24} style={{ color: MUTED }} />
        <div className='text-xs' style={{ color: MUTED }}>Not following anyone yet</div>
        <div className='text-[10px] text-center px-4' style={{ color: MUTED }}>
          Follow traders from the Arena leaderboard to see their activity
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-1 p-2'>
      {follows.map((f) => (
        <div
          key={f.id}
          className='flex items-center gap-3 rounded-lg px-3 py-2.5'
          style={{ background: '#111116', border: `1px solid ${BORDER}40` }}
        >
          <div
            className='w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold'
            style={{ background: `${ACCENT}20`, color: ACCENT }}
          >
            {f.followed.slice(0, 2).toUpperCase()}
          </div>
          <div className='flex-1 min-w-0'>
            <div className='text-xs font-medium truncate' style={{ color: '#e8e8f0' }}>
              {truncateAddress(f.followed, 5, 5)}
            </div>
            <div className='text-[10px]' style={{ color: MUTED }}>
              Following since {new Date(f.createdAt * 1000).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main PortfolioPanel ──────────────────────────────────────────────────────

type TabId = 'positions' | 'activities' | 'follows';

const TABS: { id: TabId; label: string; icon: ElementType }[] = [
  { id: 'positions', label: 'Positions', icon: Layers },
  { id: 'activities', label: 'Activity', icon: Bell },
  { id: 'follows', label: 'Follows', icon: UserCheck },
];

export function PortfolioPanel() {
  const { user, login, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('positions');

  if (loading) {
    return (
      <div
        className='flex flex-col rounded-xl overflow-hidden h-full'
        style={{ background: BG, border: `1px solid ${BORDER}` }}
      >
        <div className='px-4 py-4'>
          <div className='text-xs' style={{ color: MUTED }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className='flex flex-col rounded-xl overflow-hidden h-full'
        style={{ background: BG, border: `1px solid ${BORDER}` }}
      >
        <div
          className='flex items-center justify-between px-4 py-3 border-b flex-shrink-0'
          style={{ borderColor: BORDER }}
        >
          <span className='text-sm font-semibold' style={{ color: '#e8e8f0' }}>
            Portfolio
          </span>
        </div>
        <div className='flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12'>
          <LogIn size={28} style={{ color: MUTED }} />
          <div className='text-center'>
            <div className='text-sm font-semibold mb-1' style={{ color: '#e8e8f0' }}>
              Log In to view your portfolio
            </div>
            <div className='text-xs' style={{ color: MUTED }}>
              Connect your wallet to see positions, activity, and who you follow
            </div>
          </div>
          <button
            onClick={() => login()}
            className='px-5 py-2 rounded-full text-sm font-semibold transition-all hover:opacity-90'
            style={{ background: ACCENT, color: '#0d0d0d' }}
          >
            Log In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className='flex flex-col rounded-xl overflow-hidden h-full'
      style={{ background: BG, border: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div
        className='flex items-center justify-between px-4 py-3 border-b flex-shrink-0'
        style={{ borderColor: BORDER }}
      >
        <span className='text-sm font-semibold' style={{ color: '#e8e8f0' }}>
          Portfolio
        </span>
        <span className='text-[10px] font-mono' style={{ color: MUTED }}>
          {truncateAddress(user.address, 4, 4)}
        </span>
      </div>

      {/* Portfolio summary */}
      <PortfolioSummary walletAddress={user.address} />

      {/* Tabs */}
      <div
        className='flex gap-0 border-b flex-shrink-0'
        style={{ borderColor: BORDER }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className='flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors'
              style={{
                color: active ? ACCENT : MUTED,
                borderBottom: active ? `2px solid ${ACCENT}` : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className='flex-1 overflow-y-auto' style={{ minHeight: 0 }}>
        {activeTab === 'positions' && <PositionsTab walletAddress={user.address} />}
        {activeTab === 'activities' && <ActivitiesTab walletAddress={user.address} />}
        {activeTab === 'follows' && <FollowsTab walletAddress={user.address} />}
      </div>
    </div>
  );
}
