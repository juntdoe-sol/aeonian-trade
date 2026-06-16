/**
 * UserProfilePopup — end-user trader profile shown when a PnL-leaderboard row is
 * tapped. Mobile-first bottom sheet matching AEONIAN's frosted-glass aesthetic.
 *
 * Shows: X avatar/@username (or truncated wallet fallback), copy-address button,
 * a "Connect X" prompt on your OWN profile if X isn't linked, live PnL tiles
 * (unrealized + realized 24h/7d/30d via shared FIFO), a follower count + Follow/
 * Unfollow toggle, and a scrollable closed-trade activity list (each with PnL).
 *
 * Data sources are all reused from the rest of the app:
 *   - X identity: socialLinks (same parse pattern as PnlLeaderboard / share cards)
 *   - live PnL + fills: fetchTraderProfile() → public Phoenix endpoints + FIFO
 *   - follows: follows collection (user-signed create/delete)
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth, getIdToken } from '@pooflabs/web';
import {
  Copy, Check, TrendingUp, TrendingDown, UserPlus, UserCheck, Loader2, Users, Copy as CopyIcon, EyeOff, Eye, Trophy,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useOAuth } from '@/hooks/useOAuth';
import {
  subscribeManyFollows, setFollows, deleteFollows, type FollowsResponse,
} from '@/lib/collections/follows';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import {
  subscribeManyMonthlyRewardWinners, type MonthlyRewardWinnersResponse,
} from '@/lib/collections/monthlyRewardWinners';
import { monthLabel } from '@/utils/monthly-reward-tokens';
import { createAuthenticatedApiClient } from '@/lib/api-client';
import { Time, Address } from '@/lib/db-client';
import { truncateAddress } from '@/utils/format-address';
import { fetchTraderProfile, type TraderProfileData, type OpenPosition } from '@/utils/trader-profile';
import { useTraderHidePnl } from '@/utils/use-hide-pnl';
import { errorToast, successToast } from '@/utils/toast-helpers';
import { formatPrice } from '@/components/trading/types';
import type { ClosedTrade } from '@/utils/trade-computations';

// ─── Helpers ────────────────────────────────────────────────────────────────

const POS = '#4ADE80';
const NEG = '#FF5252';
const ACCENT = '#b794f6';

function fmtSignedUsd(v: number): string {
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v >= 0 ? '+' : '−'}$${abs}`;
}

function pnlColor(v: number): string {
  return v >= 0 ? POS : NEG;
}

function fmtTimeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

interface XProfile {
  username: string;
  avatar?: string;
}

// ─── Masked PnL value (privacy) ─────────────────────────────────────────────
// Shown to OTHER viewers when a trader enabled "Hide PnL". Keeps identity,
// rank and position visible — only the dollar value is withheld.

function MaskedPnl({ size = 'sm' }: { size?: 'sm' | 'xs' }) {
  return (
    <span
      className='inline-flex items-center gap-1 font-black tabular-nums'
      style={{ color: '#5A5A5A', fontSize: size === 'xs' ? 13 : 14 }}
    >
      <EyeOff size={size === 'xs' ? 12 : 13} style={{ color: '#5A5A5A' }} />
      Hidden
    </span>
  );
}

// ─── PnL tile ─────────────────────────────────────────────────────────────────

function PnlTile({ label, value, hidden }: { label: string; value: number | null; hidden?: boolean }) {
  // Hide the tile entirely when the data source is genuinely unavailable (null).
  if (value === null) return null;
  return (
    <div
      className='rounded-xl px-3 py-2.5 flex flex-col gap-0.5'
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span className='text-[10px] uppercase tracking-wider' style={{ color: '#7A7A8A' }}>{label}</span>
      {hidden ? (
        <MaskedPnl />
      ) : (
        <span className='text-sm font-black tabular-nums' style={{ color: pnlColor(value) }}>
          {fmtSignedUsd(value)}
        </span>
      )}
    </div>
  );
}

// ─── Activity row ───────────────────────────────────────────────────────────

function ActivityRow({ trade, hidden }: { trade: ClosedTrade; hidden?: boolean }) {
  const symbol = trade.symbol.replace(/-PERP$/i, '');
  const sideColor = trade.side === 'Long' ? POS : NEG;
  return (
    <div
      className='flex items-center gap-3 px-3 py-2.5 rounded-lg'
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className='flex flex-col min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-bold'>{symbol}</span>
          <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded' style={{ color: sideColor, background: `${sideColor}1A` }}>
            {trade.side}
          </span>
        </div>
        <span className='text-[11px]' style={{ color: '#6A6A7A' }}>
          {trade.size.toFixed(4)} · {fmtTimeAgo(trade.timestamp)} ago
        </span>
      </div>
      {hidden ? (
        <span className='flex-shrink-0'><MaskedPnl /></span>
      ) : (
        <span className='text-sm font-black tabular-nums flex-shrink-0' style={{ color: pnlColor(trade.realizedPnl) }}>
          {fmtSignedUsd(trade.realizedPnl)}
        </span>
      )}
    </div>
  );
}

// ─── Open-position row ────────────────────────────────────────────────────────

function OpenPositionRow({ pos, hidden }: { pos: OpenPosition; hidden?: boolean }) {
  const symbol = pos.symbol.replace(/-PERP$/i, '');
  const sideLabel = pos.side === 'long' ? 'Long' : 'Short';
  const sideColor = pos.side === 'long' ? POS : NEG;
  return (
    <div
      className='flex items-center gap-3 px-3 py-2.5 rounded-lg'
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className='flex flex-col min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-bold'>{symbol}</span>
          <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded' style={{ color: sideColor, background: `${sideColor}1A` }}>
            {sideLabel}
          </span>
          {pos.leverage != null && (
            <span className='text-[10px] font-bold px-1.5 py-0.5 rounded' style={{ color: ACCENT, background: `${ACCENT}1A` }}>
              {pos.leverage.toFixed(1)}x
            </span>
          )}
        </div>
        <span className='text-[11px]' style={{ color: '#6A6A7A' }}>
          {pos.size.toFixed(4)} @ {formatPrice(pos.entryPrice)}
        </span>
      </div>
      {hidden ? (
        <span className='flex-shrink-0'><MaskedPnl /></span>
      ) : (
        <span className='text-sm font-black tabular-nums flex-shrink-0' style={{ color: pnlColor(pos.unrealizedPnl) }}>
          {fmtSignedUsd(pos.unrealizedPnl)}
        </span>
      )}
    </div>
  );
}

// ─── Main popup ───────────────────────────────────────────────────────────────

export function UserProfilePopup({
  traderAddress,
  open,
  onClose,
  previewAsOther = false,
}: {
  traderAddress: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * Preview mode: render the trader's OWN profile exactly as other users would
   * see it when PnL is hidden. Forces masking on unconditionally and suppresses
   * own-profile-only affordances (Connect-X prompt) while keeping the Follow
   * action non-interactive. Used by the privacy settings "Preview" button.
   */
  previewAsOther?: boolean;
}) {
  const { user } = useAuth();
  const { connect } = useOAuth();
  const realIsOwnProfile = !!user?.address && !!traderAddress && user.address === traderAddress;
  // In preview mode we deliberately render the "viewed-by-others" layout even
  // though this is technically the user's own profile, so treat it as NOT own.
  const isOwnProfile = realIsOwnProfile && !previewAsOther;

  // Respect the viewed trader's "Hide PnL" preference — but NEVER for their own
  // view of themselves (a trader can always see their own numbers). In preview
  // mode, force masking on so the trader sees exactly what others would see.
  const traderHidesPnl = useTraderHidePnl(traderAddress, open && !isOwnProfile && !previewAsOther);
  const maskPnl = previewAsOther || (traderHidesPnl && !isOwnProfile);

  const [profile, setProfile] = useState<TraderProfileData | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  // ── X identity (same resolution pattern as the leaderboard) ─────────────────
  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    open,
  );
  const xProfile: XProfile | undefined = useMemo(() => {
    if (!traderAddress) return undefined;
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet === traderAddress) {
        try {
          const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
          if (parsed?.username) return { username: parsed.username, avatar: parsed.avatar ?? undefined };
        } catch { /* skip malformed */ }
      }
    }
    return undefined;
  }, [allSocialLinks, traderAddress]);

  // ── Follower count (live query on follows) ──────────────────────────────────
  const { data: followerDocs } = useRealtimeData<FollowsResponse[]>(
    subscribeManyFollows,
    open && !!traderAddress,
    traderAddress ? `followed = '${traderAddress}'` : '',
  );
  const followerCount = followerDocs?.length ?? 0;

  // ── Monthly reward wins (this trader placed top-3 in a finalized month) ─────
  const { data: allWinners } = useRealtimeData<MonthlyRewardWinnersResponse[]>(
    subscribeManyMonthlyRewardWinners,
    open && !!traderAddress,
  );
  const monthlyWins = useMemo(() => {
    if (!traderAddress) return [];
    const wins: Array<{ monthKey: string; rank: number }> = [];
    for (const w of allWinners ?? []) {
      let rank = 0;
      if (w.winner1 === traderAddress) rank = 1;
      else if (w.winner2 === traderAddress) rank = 2;
      else if (w.winner3 === traderAddress) rank = 3;
      if (rank > 0) wins.push({ monthKey: w.monthKey, rank });
    }
    // newest month first
    wins.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));
    return wins;
  }, [allWinners, traderAddress]);

  // ── Am I following this trader? (keyed doc existence) ───────────────────────
  const followId = user?.address && traderAddress ? `${user.address}:${traderAddress}` : '';
  const isFollowing = useMemo(
    () => !!user?.address && (followerDocs ?? []).some((d) => d.follower === user.address),
    [followerDocs, user?.address],
  );

  // ── Fetch live trading data when opened ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (open && traderAddress) {
      setProfile(null);
      setLoadingProfile(true);
      fetchTraderProfile(traderAddress)
        .then((data) => { if (!cancelled) setProfile(data); })
        .catch(() => { if (!cancelled) setProfile(null); })
        .finally(() => { if (!cancelled) setLoadingProfile(false); });
    }
    return () => { cancelled = true; };
  }, [open, traderAddress]);

  const handleCopy = async () => {
    if (!traderAddress) return;
    try {
      await navigator.clipboard.writeText(traderAddress);
      setCopied(true);
      successToast('Address copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      errorToast('Could not copy address');
    }
  };

  const handleFollowToggle = async () => {
    if (!user?.address) {
      errorToast('Log in to follow traders');
      return;
    }
    if (!traderAddress || isOwnProfile || !followId) return;
    setFollowBusy(true);
    try {
      if (isFollowing) {
        const ok = await deleteFollows(followId);
        if (ok) successToast('Unfollowed');
        else errorToast('Could not unfollow');
      } else {
        const ok = await setFollows(followId, {
          follower: Address.publicKey(user.address),
          followed: Address.publicKey(traderAddress),
          createdAt: Time.Now,
        });
        if (ok) {
          successToast('Following');
          // Best-effort: notify the trader they gained a follower. NEVER block or
          // revert the follow on a notification failure. Social/Privy wallets may
          // have a null token — skip silently in that case (no error toast).
          try {
            const token = await getIdToken();
            if (token) {
              const authApi = createAuthenticatedApiClient(token, user.address);
              await authApi.post('/api/phoenix/record-follow', { followed: traderAddress });
            }
          } catch (notifyErr) {
            console.warn('[follow] record-follow notification failed (non-fatal):', notifyErr);
          }
        } else {
          errorToast('Could not follow');
        }
      }
    } catch {
      errorToast('Something went wrong');
    } finally {
      setFollowBusy(false);
    }
  };

  const displayName = xProfile?.username ? `@${xProfile.username}` : truncateAddress(traderAddress ?? '');
  const initial = (xProfile?.username ?? traderAddress ?? '?').charAt(0).toUpperCase();
  const closedTrades = profile?.closedTrades ?? [];
  const openPositions = profile?.openPositions ?? [];

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side='bottom'
        className='glass-card border-t p-0 max-h-[88dvh] overflow-hidden flex flex-col'
        style={{
          background: 'hsl(270 45% 9% / 0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
      >
        {/* Grab handle */}
        <div className='flex justify-center pt-3 pb-1'>
          <div className='w-10 h-1 rounded-full' style={{ background: 'rgba(255,255,255,0.18)' }} />
        </div>

        <div className='overflow-y-auto px-5 pb-8 pt-2'>
          {/* ── Header: avatar + identity ───────────────────────────────────── */}
          <div className='flex items-center gap-3.5'>
            {xProfile?.avatar ? (
              <img
                src={xProfile.avatar}
                alt={xProfile.username}
                className='w-14 h-14 rounded-full object-cover flex-shrink-0'
                style={{ border: '2px solid rgba(183,148,246,0.35)' }}
              />
            ) : (
              <div
                className='w-14 h-14 rounded-full flex items-center justify-center text-xl font-black flex-shrink-0'
                style={{ background: 'rgba(183,148,246,0.14)', color: ACCENT, border: '2px solid rgba(183,148,246,0.25)' }}
              >
                {initial}
              </div>
            )}

            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <div className='text-lg font-black truncate' style={{ color: '#fff' }}>{displayName}</div>
                {previewAsOther && (
                  <span
                    className='flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full'
                    style={{ color: ACCENT, background: 'rgba(183,148,246,0.16)', border: '1px solid rgba(183,148,246,0.32)' }}
                  >
                    <Eye size={11} />
                    Preview
                  </span>
                )}
              </div>
              {/* Wallet + copy */}
              <button
                onClick={handleCopy}
                className='flex items-center gap-1.5 mt-0.5 text-xs transition-colors'
                style={{ color: '#7A7A8A' }}
              >
                <span className='font-mono'>{truncateAddress(traderAddress ?? '', 6, 6)}</span>
                {copied
                  ? <Check size={12} style={{ color: POS }} />
                  : <Copy size={12} />}
              </button>
            </div>
          </div>

          {/* ── Follower count + Follow button ──────────────────────────────── */}
          <div className='flex items-center gap-3 mt-4'>
            <div className='flex items-center gap-1.5'>
              <Users size={15} style={{ color: ACCENT }} />
              <span className='text-sm font-bold' style={{ color: '#fff' }}>{followerCount}</span>
              <span className='text-xs' style={{ color: '#7A7A8A' }}>
                {followerCount === 1 ? 'follower' : 'followers'}
              </span>
            </div>

            {!isOwnProfile && !previewAsOther && (
              <button
                onClick={handleFollowToggle}
                disabled={followBusy}
                className='ml-auto flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl transition-all disabled:opacity-60'
                style={
                  isFollowing
                    ? { background: 'rgba(255,255,255,0.06)', color: '#C8C8D4', border: '1px solid rgba(255,255,255,0.1)' }
                    : { background: ACCENT, color: '#1a0b2e', border: '1px solid transparent' }
                }
              >
                {followBusy
                  ? <Loader2 size={14} className='animate-spin' />
                  : isFollowing
                    ? <UserCheck size={14} />
                    : <UserPlus size={14} />}
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}

            {/* Preview mode: show Follow as a read-only, non-interactive cue. */}
            {previewAsOther && (
              <div
                role='button'
                aria-disabled='true'
                tabIndex={-1}
                className='ml-auto select-none flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl cursor-not-allowed'
                style={{ background: ACCENT, color: '#1a0b2e', opacity: 0.75 }}
              >
                <UserPlus size={14} />
                Follow
              </div>
            )}
          </div>

          {/* ── Monthly Reward Winner ───────────────────────────────────────── */}
          {monthlyWins.length > 0 && (
            <div
              className='mt-4 rounded-2xl p-4'
              style={{
                background: 'linear-gradient(135deg, rgba(255,215,0,0.10), rgba(255,215,0,0.03))',
                border: '1px solid rgba(255,215,0,0.25)',
              }}
            >
              <div className='flex items-center gap-2 mb-2.5'>
                <Trophy size={15} style={{ color: '#FFD700' }} />
                <span className='text-sm font-black' style={{ color: '#E8C547' }}>
                  Monthly Reward Winner
                </span>
              </div>
              <div className='flex flex-wrap gap-2'>
                {monthlyWins.map((w) => (
                  <span
                    key={w.monthKey}
                    className='inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full'
                    style={{ background: 'rgba(255,215,0,0.12)', color: '#E8C547', border: '1px solid rgba(255,215,0,0.3)' }}
                  >
                    <Trophy size={11} style={{ color: '#FFD700' }} />
                    {monthLabel(w.monthKey)}
                    <span style={{ opacity: 0.6 }}>· #{w.rank}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Copy Trade (coming soon, non-functional) ────────────────────── */}
          {!isOwnProfile && (
            <div
              className='mt-3 rounded-2xl p-4'
              style={{
                background: 'linear-gradient(135deg, rgba(183,148,246,0.10), rgba(183,148,246,0.03))',
                border: '1px solid rgba(183,148,246,0.18)',
              }}
            >
              <div className='flex items-center justify-between gap-2'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm font-black' style={{ color: '#fff' }}>Copy Trade</span>
                </div>
                <span
                  className='text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full'
                  style={{ color: ACCENT, background: 'rgba(183,148,246,0.16)', border: '1px solid rgba(183,148,246,0.3)' }}
                >
                  Coming Soon
                </span>
              </div>

              <p className='text-xs leading-relaxed mt-2' style={{ color: '#A8A8B8' }}>
                AI-powered copy trading. Coming soon.
              </p>

              {/* Non-functional preview button — no click handler, not focusable */}
              <div
                role='button'
                aria-disabled='true'
                tabIndex={-1}
                className='select-none w-full flex items-center justify-center gap-2 mt-3 text-sm font-bold px-4 py-2.5 rounded-xl cursor-not-allowed'
                style={{
                  background: 'rgba(183,148,246,0.10)',
                  color: ACCENT,
                  border: '1px dashed rgba(183,148,246,0.4)',
                }}
              >
                <CopyIcon size={14} />
                Copy this trader
              </div>
            </div>
          )}

          {/* ── Connect-X prompt (own profile, X not linked) ────────────────── */}
          {isOwnProfile && !xProfile && (
            <button
              onClick={() => connect('twitter')}
              className='w-full flex items-center justify-center gap-2 mt-4 text-sm font-bold px-4 py-2.5 rounded-xl transition-all'
              style={{ background: 'rgba(183,148,246,0.12)', color: ACCENT, border: '1px solid rgba(183,148,246,0.3)' }}
            >
              <svg viewBox='0 0 24 24' fill='currentColor' width={14} height={14}>
                <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z' />
              </svg>
              Connect X to show your handle
            </button>
          )}

          {/* ── PnL tiles ───────────────────────────────────────────────────── */}
          <div className='mt-5'>
            <div className='text-xs font-bold uppercase tracking-wider mb-2.5' style={{ color: '#7A7A8A' }}>
              Performance
            </div>
            {loadingProfile ? (
              <div className='grid grid-cols-2 gap-2'>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className='h-[58px] rounded-xl animate-pulse' style={{ background: 'rgba(255,255,255,0.04)' }} />
                ))}
              </div>
            ) : profile?.notFound ? (
              <div className='rounded-xl px-3 py-4 text-center text-sm' style={{ background: 'rgba(255,255,255,0.03)', color: '#7A7A8A' }}>
                No trading activity yet
              </div>
            ) : (
              <div className='grid grid-cols-2 gap-2'>
                <PnlTile label='Unrealized' value={profile?.unrealizedPnl ?? null} hidden={maskPnl} />
                <PnlTile label='Realized 24h' value={profile?.realized24h ?? 0} hidden={maskPnl} />
                <PnlTile label='Realized 7d' value={profile?.realized7d ?? 0} hidden={maskPnl} />
                <PnlTile label='Realized 30d' value={profile?.realized30d ?? 0} hidden={maskPnl} />
              </div>
            )}
            {maskPnl && !loadingProfile && !profile?.notFound && (
              <div className='flex items-center gap-1.5 mt-2 text-[11px]' style={{ color: '#6A6A7A' }}>
                <EyeOff size={12} style={{ color: '#6A6A7A' }} />
                {previewAsOther ? 'Your PnL would be hidden from others' : 'This trader has hidden their PnL'}
              </div>
            )}
          </div>

          {/* ── Open positions ──────────────────────────────────────────────── */}
          <div className='mt-5'>
            <div className='text-xs font-bold uppercase tracking-wider mb-2.5' style={{ color: '#7A7A8A' }}>
              Open Positions
            </div>
            {loadingProfile ? (
              <div className='space-y-2'>
                {[0, 1].map((i) => (
                  <div key={i} className='h-[52px] rounded-lg animate-pulse' style={{ background: 'rgba(255,255,255,0.03)' }} />
                ))}
              </div>
            ) : openPositions.length === 0 ? (
              <div className='rounded-xl px-3 py-4 text-center text-sm' style={{ background: 'rgba(255,255,255,0.03)', color: '#7A7A8A' }}>
                No open positions
              </div>
            ) : (
              <div className='space-y-1.5'>
                {openPositions.map((p, i) => (
                  <OpenPositionRow key={`${p.symbol}-${p.side}-${i}`} pos={p} hidden={maskPnl} />
                ))}
              </div>
            )}
          </div>

          {/* ── Trade activity ──────────────────────────────────────────────── */}
          <div className='mt-5'>
            <div className='text-xs font-bold uppercase tracking-wider mb-2.5' style={{ color: '#7A7A8A' }}>
              Recent Trades
            </div>
            {loadingProfile ? (
              <div className='space-y-2'>
                {[0, 1, 2].map((i) => (
                  <div key={i} className='h-[52px] rounded-lg animate-pulse' style={{ background: 'rgba(255,255,255,0.03)' }} />
                ))}
              </div>
            ) : closedTrades.length === 0 ? (
              <div className='rounded-xl px-3 py-4 text-center text-sm' style={{ background: 'rgba(255,255,255,0.03)', color: '#7A7A8A' }}>
                No closed trades yet
              </div>
            ) : (
              <div className='space-y-1.5 max-h-[290px] overflow-y-auto pr-1'>
                {closedTrades.slice(0, 50).map((t, i) => (
                  <ActivityRow key={`${t.symbol}-${t.timestamp}-${i}`} trade={t} hidden={maskPnl} />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
