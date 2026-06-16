/**
 * NotificationBell — in-app notification bell for the app chrome (AppHeader).
 *
 * Renders ONLY for logged-in users. Shows an unread badge (count of unread
 * notifications addressed to the connected wallet). Tapping opens a bottom sheet
 * listing recent notifications newest-first; opening the sheet marks all unread
 * notifications read via a PARTIAL update ({ read: true } only — never re-sends
 * recipient/actor/createdAt, which silently fails on update in this app).
 *
 * Notifications are backend-fanned-out (one per follower) when a followed trader
 * opens or closes a trade — see partyserver notify-followers fan-out.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@pooflabs/web';
import { Bell, TrendingUp, TrendingDown, Trophy, UserPlus, Zap, EyeOff, Megaphone } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyNotifications, updateNotifications, type NotificationsResponse,
} from '@/lib/collections/notifications';
import { truncateAddress } from '@/utils/format-address';
import { useHiddenPnlWallets } from '@/utils/use-hide-pnl';
import { monthLabel } from '@/utils/monthly-reward-tokens';

const POS = '#4ADE80';
const NEG = '#FF5252';
const ACCENT = '#b794f6';
// Big-win highlight — warm gold, distinct from the long/short green/red and the
// purple accent so it reads instantly as "this one's special".
const GOLD = '#FFC83D';

function fmtTimeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtSignedUsd(cents: number): string {
  const usd = cents / 100;
  const abs = Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${usd >= 0 ? '+' : '−'}$${abs}`;
}

function NotificationItem({
  n,
  maskPnl,
  onClaim,
}: {
  n: NotificationsResponse;
  maskPnl?: boolean;
  onClaim?: () => void;
}) {
  const actorLabel = n.actorName ? `@${n.actorName}` : truncateAddress(n.actor);

  // ── Follow notification — no symbol/side/pnl, distinct icon + copy. ──────────
  if (n.type === 'follow') {
    return (
      <div
        className='flex items-start gap-3 px-3 py-3 rounded-xl'
        style={{
          background: n.read ? 'rgba(255,255,255,0.03)' : 'rgba(183,148,246,0.08)',
          border: n.read ? '1px solid transparent' : '1px solid rgba(183,148,246,0.18)',
        }}
      >
        <div
          className='w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5'
          style={{ background: `${ACCENT}1A` }}
        >
          <UserPlus size={15} style={{ color: ACCENT }} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-sm leading-snug' style={{ color: '#E8E8F0' }}>
            <span className='font-bold' style={{ color: '#fff' }}>{actorLabel}</span>
            {' '}started following you
          </div>
          <div className='text-[11px] mt-0.5' style={{ color: '#6A6A7A' }}>{fmtTimeAgo(n.createdAt)}</div>
        </div>
      </div>
    );
  }

  // ── Monthly prize-pot win — self-notification, gold marker, links to claim. ──
  // symbol holds the monthKey ("YYYY_MM"), side holds the rank string ('1'..'3').
  if (n.type === 'monthly_reward') {
    const rank = Number(n.side) || 0;
    const rankLabel = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `#${rank}`;
    const month = monthLabel(n.symbol ?? '');
    return (
      <button
        type='button'
        onClick={onClaim}
        className='w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl transition-all hover:brightness-110'
        style={{
          background: n.read
            ? 'rgba(255,200,61,0.06)'
            : 'linear-gradient(135deg, rgba(255,200,61,0.16), rgba(255,200,61,0.06))',
          border: n.read ? '1px solid rgba(255,200,61,0.16)' : `1px solid ${GOLD}66`,
          boxShadow: n.read ? 'none' : `0 0 16px ${GOLD}33, inset 0 0 0 1px ${GOLD}1A`,
        }}
      >
        <div
          className='w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5'
          style={{ background: `${GOLD}26` }}
        >
          <Trophy size={15} style={{ color: GOLD }} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-sm leading-snug' style={{ color: '#E8E8F0' }}>
            <span className='font-bold' style={{ color: '#fff' }}>You won a monthly prize</span>
          </div>
          <div className='text-[13px] leading-snug mt-0.5' style={{ color: '#C8C8D4' }}>
            You placed{' '}
            <span className='font-bold' style={{ color: GOLD }}>{rankLabel}</span>
            {' '}in the {month} prize pot. Tap to claim your reward.
          </div>
          <div className='text-[11px] mt-0.5' style={{ color: '#6A6A7A' }}>{fmtTimeAgo(n.createdAt)}</div>
        </div>
      </button>
    );
  }

  // ── Monthly prize-pot OPENED — broadcast to active traders, self-notification. ──
  // symbol holds the monthKey ("YYYY_MM"). Taps route to the Arena leaderboard.
  if (n.type === 'monthly_pot_open') {
    const month = monthLabel(n.symbol ?? '');
    return (
      <button
        type='button'
        onClick={onClaim}
        className='w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl transition-all hover:brightness-110'
        style={{
          background: n.read
            ? 'rgba(255,200,61,0.06)'
            : 'linear-gradient(135deg, rgba(255,200,61,0.16), rgba(255,200,61,0.06))',
          border: n.read ? '1px solid rgba(255,200,61,0.16)' : `1px solid ${GOLD}66`,
          boxShadow: n.read ? 'none' : `0 0 16px ${GOLD}33, inset 0 0 0 1px ${GOLD}1A`,
        }}
      >
        <div
          className='w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5'
          style={{ background: `${GOLD}26` }}
        >
          <Megaphone size={15} style={{ color: GOLD }} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-sm leading-snug' style={{ color: '#E8E8F0' }}>
            <span className='font-bold' style={{ color: '#fff' }}>Monthly prize pot is live</span>
          </div>
          <div className='text-[13px] leading-snug mt-0.5' style={{ color: '#C8C8D4' }}>
            The {month} prize pot is open. Start trading to climb the leaderboard and win.
          </div>
          <div className='text-[11px] mt-0.5' style={{ color: '#6A6A7A' }}>{fmtTimeAgo(n.createdAt)}</div>
        </div>
      </button>
    );
  }

  // ── Liquidation notification — wipeout, red marker, no PnL framing. ──────────
  if (n.type === 'liquidated') {
    const liqSymbol = (n.symbol ?? '').replace(/-PERP$/i, '');
    const isSelf = n.actor === n.recipient;
    return (
      <div
        className='flex items-start gap-3 px-3 py-3 rounded-xl'
        style={{
          background: n.read
            ? 'rgba(255,82,82,0.06)'
            : 'linear-gradient(135deg, rgba(255,82,82,0.16), rgba(255,82,82,0.05))',
          border: n.read ? '1px solid rgba(255,82,82,0.16)' : '1px solid rgba(255,82,82,0.4)',
          boxShadow: n.read ? 'none' : '0 0 14px rgba(255,82,82,0.18)',
        }}
      >
        <div
          className='w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5'
          style={{ background: `${NEG}1F` }}
        >
          <Zap size={15} style={{ color: NEG }} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='text-sm leading-snug' style={{ color: '#E8E8F0' }}>
            {isSelf ? (
              <>
                <span className='font-bold' style={{ color: '#fff' }}>You</span>
                {' '}were liquidated on{' '}
              </>
            ) : (
              <>
                <span className='font-bold' style={{ color: '#fff' }}>{actorLabel}</span>
                {' '}was liquidated on{' '}
              </>
            )}
            <span className='font-semibold'>{liqSymbol}</span>
            {n.side && (
              <>
                {' '}
                <span className='font-semibold' style={{ color: NEG }}>{n.side}</span>
              </>
            )}
          </div>
          <div className='text-[11px] mt-0.5' style={{ color: '#6A6A7A' }}>{fmtTimeAgo(n.createdAt)}</div>
        </div>
      </div>
    );
  }

  // ── Trade notification (open/close) — symbol/side present per policy. ────────
  // symbol/side are optional on the type but always present for trade notifs;
  // guard defensively so a malformed doc can't crash the render.
  const symbol = (n.symbol ?? '').replace(/-PERP$/i, '');
  const sideColor = n.side === 'long' ? POS : NEG;
  const verb = n.type === 'close' ? 'closed' : 'opened';
  const hasPnl = n.type === 'close' && typeof n.pnlUsdCents === 'number';
  // bigWin is only ever set on profitable closes by the backend, but guard on
  // PnL sign too so a flag can never mislabel a loss. When the actor hid their
  // PnL, suppress the Big Win styling/label entirely (the badge itself leaks
  // that they booked a large gain) and mask the value below.
  const bigWin = n.bigWin === true && (n.pnlUsdCents ?? 0) > 0 && !maskPnl;

  return (
    <div
      className='flex items-start gap-3 px-3 py-3 rounded-xl'
      style={
        bigWin
          ? {
              // Accent-tinted gold wash + glow + brighter border. Frosted-glass
              // aesthetic: translucent fill so the sheet blur shows through.
              background: 'linear-gradient(135deg, rgba(255,200,61,0.16), rgba(255,200,61,0.06))',
              border: `1px solid ${GOLD}66`,
              boxShadow: `0 0 16px ${GOLD}33, inset 0 0 0 1px ${GOLD}1A`,
            }
          : {
              background: n.read ? 'rgba(255,255,255,0.03)' : 'rgba(183,148,246,0.08)',
              border: n.read ? '1px solid transparent' : '1px solid rgba(183,148,246,0.18)',
            }
      }
    >
      <div
        className='w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5'
        style={{ background: bigWin ? `${GOLD}26` : `${sideColor}1A` }}
      >
        {bigWin
          ? <Trophy size={15} style={{ color: GOLD }} />
          : n.side === 'long'
            ? <TrendingUp size={15} style={{ color: sideColor }} />
            : <TrendingDown size={15} style={{ color: sideColor }} />}
      </div>
      <div className='min-w-0 flex-1'>
        {bigWin && (
          <div className='mb-1 flex items-center gap-1.5'>
            <span
              className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide'
              style={{
                background: `${GOLD}26`,
                color: GOLD,
                border: `1px solid ${GOLD}59`,
              }}
            >
              <Trophy size={10} style={{ color: GOLD }} />
              Big Win
            </span>
          </div>
        )}
        <div className='text-sm leading-snug' style={{ color: '#E8E8F0' }}>
          <span className='font-bold' style={{ color: '#fff' }}>{actorLabel}</span>
          {' '}{verb} a{' '}
          <span className='font-semibold' style={{ color: sideColor }}>{n.side}</span>
          {' '}<span className='font-semibold'>{symbol}</span>
          {hasPnl && (
            <>
              {' · '}
              {maskPnl ? (
                <span className='inline-flex items-center gap-1 font-bold' style={{ color: '#7A7A8A' }}>
                  <EyeOff size={12} style={{ color: '#7A7A8A' }} />
                  Hidden
                </span>
              ) : (
                <span
                  className='font-bold tabular-nums'
                  style={{ color: bigWin ? GOLD : (n.pnlUsdCents ?? 0) >= 0 ? POS : NEG }}
                >
                  {fmtSignedUsd(n.pnlUsdCents ?? 0)}
                </span>
              )}
            </>
          )}
        </div>
        <div className='text-[11px] mt-0.5' style={{ color: '#6A6A7A' }}>{fmtTimeAgo(n.createdAt)}</div>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: notifications } = useRealtimeData<NotificationsResponse[]>(
    subscribeManyNotifications,
    !!user?.address,
    user?.address ? `recipient = '${user.address}'` : '',
  );

  // Wallets that opted to hide their PnL. Mask the PnL value on notifications
  // whose ACTOR (the trader the PnL belongs to) hid it — but never on a
  // self-notification (actor === recipient), since that's your own number.
  const hiddenWallets = useHiddenPnlWallets(!!user?.address);

  const sorted = useMemo(
    () => [...(notifications ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50),
    [notifications],
  );
  const unreadCount = useMemo(
    () => (notifications ?? []).filter((n) => !n.read).length,
    [notifications],
  );

  // Only render the bell for logged-in users.
  if (!user?.address) return null;

  const markAllRead = async () => {
    const unread = (notifications ?? []).filter((n) => !n.read);
    // Partial update: send ONLY { read: true } — never re-send recipient/actor/createdAt.
    await Promise.allSettled(unread.map((n) => updateNotifications(n.id, { read: true })));
  };

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next && unreadCount > 0) void markAllRead();
  };

  return (
    <>
      <button
        onClick={() => handleOpen(true)}
        aria-label='Notifications'
        title='Notifications'
        className='relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors'
        style={{ color: '#8A8A8A' }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            className='absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center text-[9px] font-black'
            style={{ background: NEG, color: '#fff', lineHeight: 1 }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetContent
          side='bottom'
          className='glass-card border-t p-0 max-h-[80dvh] overflow-hidden flex flex-col'
          style={{
            background: 'hsl(270 45% 9% / 0.92)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
          }}
        >
          <div className='flex justify-center pt-3 pb-1'>
            <div className='w-10 h-1 rounded-full' style={{ background: 'rgba(255,255,255,0.18)' }} />
          </div>

          <div className='px-5 pt-2 pb-3 flex items-center gap-2'>
            <Bell size={16} style={{ color: ACCENT }} />
            <h2 className='text-base font-black' style={{ color: '#fff' }}>Notifications</h2>
          </div>

          <div className='overflow-y-auto px-4 pb-8 space-y-2'>
            {sorted.length === 0 ? (
              <div className='py-12 text-center'>
                <Bell size={28} className='mx-auto mb-3' style={{ color: '#2A2A2A' }} />
                <p className='text-sm' style={{ color: '#6A6A7A' }}>No notifications yet</p>
                <p className='text-xs mt-1' style={{ color: '#4A4A5A' }}>
                  Follow traders to get notified when they open or close trades
                </p>
              </div>
            ) : (
              sorted.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  maskPnl={n.actor !== n.recipient && hiddenWallets.has(n.actor)}
                  onClaim={
                    n.type === 'monthly_reward' || n.type === 'monthly_pot_open'
                      ? () => {
                          setOpen(false);
                          // The Arena leaderboard view hosts the monthly pot UI
                          // (claim for winners; live pot for the open announcement).
                          navigate('/battles');
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
