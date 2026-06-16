/**
 * BigWinPopup — real-time celebration overlay for the Arena page.
 *
 * Subscribes to the public `phoenixWins` collection and, whenever a NEW big win
 * (pnlUsdCents > BIG_WIN_THRESHOLD_CENTS) lands WHILE a user is on the page,
 * pops a celebratory frosted-glass card for everyone currently viewing.
 *
 * Detection avoids a popup storm on load by capturing a baseline timestamp on
 * first data arrival and only celebrating wins strictly newer than it. Already
 * celebrated win IDs are tracked in a ref so the same win never pops twice.
 * Multiple near-simultaneous wins are QUEUED and shown one at a time.
 *
 * Identity resolution (X avatar/@username, wallet fallback) and the trader
 * profile popup reuse the SAME mechanism as WinsTicker / PnlLeaderboard.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PartyPopper, Trophy, X, EyeOff } from 'lucide-react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyPhoenixWins, type PhoenixWinsResponse } from '@/lib/collections/phoenixWins';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import { truncateAddress } from '@/utils/format-address';
import { useHiddenPnlWallets } from '@/utils/use-hide-pnl';
import { UserProfilePopup } from './UserProfilePopup';

// ─── Tunables ────────────────────────────────────────────────────────────────

/** A "big win" is any phoenixWins record with pnlUsdCents strictly above this. $100 = 10000c. */
const BIG_WIN_THRESHOLD_CENTS = 10000;
/** How long each celebration card stays before auto-dismissing. */
const AUTO_DISMISS_MS = 5000;

const POS = '#4ADE80';
const ACCENT = '#b794f6';

// ─── Types & helpers ──────────────────────────────────────────────────────────

interface XProfile {
  username: string;
  avatar?: string;
}

function formatProfit(cents: number): string {
  const usd = cents / 100;
  const formatted = usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `+$${formatted}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function BigWinPopup() {
  // Queue of big wins waiting to be celebrated + the one currently on screen.
  const [queue, setQueue] = useState<PhoenixWinsResponse[]>([]);
  const [current, setCurrent] = useState<PhoenixWinsResponse | null>(null);
  const [profileAddress, setProfileAddress] = useState<string | null>(null);

  // Baseline timestamp captured on first data arrival — only wins newer than
  // this are celebrated, so old history never pops on page load.
  const baselineRef = useRef<number | null>(null);
  // IDs already celebrated (or queued), so the same win never pops twice.
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Recent wins, newest first.
  const { data: rawWins } = useRealtimeData<PhoenixWinsResponse[]>(
    subscribeManyPhoenixWins,
    true,
    'order by createdAt desc limit 30',
  );

  // X identity — same resolution pattern as WinsTicker / PnlLeaderboard.
  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true,
  );

  // Traders who opted to hide their PnL. We do NOT broadcast a "Big Win"
  // celebration for them at all — the threshold-based popup itself would leak
  // that they booked a large gain, so it is suppressed rather than masked.
  const hiddenWallets = useHiddenPnlWallets(true);
  // Keep a ref so the detection effect reads the latest set without needing it
  // as a dependency (avoids re-running detection just because the set updates).
  const hiddenWalletsRef = useRef(hiddenWallets);
  hiddenWalletsRef.current = hiddenWallets;

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

  // Detect NEW big wins as data streams in.
  useEffect(() => {
    if (!rawWins) return;

    // Establish the baseline on first data arrival.
    if (baselineRef.current === null) {
      let newest = 0;
      for (const w of rawWins) {
        if (w.createdAt > newest) newest = w.createdAt;
      }
      baselineRef.current = newest;
      return; // never celebrate anything from the initial snapshot
    }

    const baseline = baselineRef.current;
    const fresh = rawWins
      .filter(
        (w) =>
          w.pnlUsdCents > BIG_WIN_THRESHOLD_CENTS &&
          w.createdAt > baseline &&
          !seenIdsRef.current.has(w.id) &&
          // Never celebrate a win for a trader who hid their PnL.
          !hiddenWalletsRef.current.has(w.trader),
      )
      .sort((a, b) => a.createdAt - b.createdAt); // oldest-first so they queue in order

    if (fresh.length === 0) return;

    for (const w of fresh) seenIdsRef.current.add(w.id);
    setQueue((prev) => [...prev, ...fresh]);
  }, [rawWins]);

  // Pull the next win off the queue whenever nothing is currently showing.
  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((prev) => prev.slice(1));
  }, [current, queue]);

  // Auto-dismiss the current card after a few seconds.
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) {
    // Still render the (closed) profile popup so it can animate out cleanly.
    return (
      <UserProfilePopup
        traderAddress={profileAddress}
        open={!!profileAddress}
        onClose={() => setProfileAddress(null)}
      />
    );
  }

  const xProfile = xProfileMap.get(current.trader);
  const initial = (xProfile?.username ?? current.trader ?? '?').charAt(0).toUpperCase();
  const displayName = xProfile?.username ? `@${xProfile.username}` : truncateAddress(current.trader);

  return (
    <>
      {/* Fixed, centered-top floating celebration card */}
      <div
        className='fixed inset-x-0 z-[100] flex justify-center px-4 pointer-events-none'
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      >
        <div
          key={current.id}
          className='big-win-card pointer-events-auto w-full max-w-sm rounded-2xl overflow-hidden'
          style={{
            background: 'rgba(20,18,28,0.72)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            border: '1px solid rgba(183,148,246,0.35)',
            boxShadow: '0 12px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 40px rgba(74,222,128,0.12)',
          }}
        >
          {/* Accent glow strip */}
          <div
            className='h-1 w-full'
            style={{ background: `linear-gradient(90deg, ${ACCENT}, ${POS})` }}
          />

          <div className='p-4'>
            {/* Headline row */}
            <div className='flex items-center gap-2 mb-3'>
              <div
                className='flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0'
                style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.3)' }}
              >
                <Trophy size={15} style={{ color: POS }} />
              </div>
              <div className='flex items-center gap-1.5'>
                <PartyPopper size={15} style={{ color: ACCENT }} />
                <span
                  className='text-sm font-black uppercase tracking-wide'
                  style={{ color: '#fff' }}
                >
                  Big Win!
                </span>
              </div>
              <button
                type='button'
                onClick={() => setCurrent(null)}
                aria-label='Dismiss celebration'
                className='ml-auto flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:bg-white/[0.08] active:bg-white/[0.12]'
                style={{ color: '#9A9AAA' }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Trader + profit */}
            <button
              type='button'
              onClick={() => setProfileAddress(current.trader)}
              className='w-full flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-white/[0.05] active:scale-[0.99] text-left'
              style={{ border: '1px solid rgba(255,255,255,0.07)' }}
            >
              {/* Avatar */}
              {xProfile?.avatar ? (
                <img
                  src={xProfile.avatar}
                  alt={xProfile.username}
                  className='w-10 h-10 rounded-full object-cover flex-shrink-0'
                  style={{ border: '1px solid rgba(255,255,255,0.14)' }}
                />
              ) : (
                <div
                  className='w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0'
                  style={{ background: 'rgba(183,148,246,0.18)', color: ACCENT, border: '1px solid rgba(183,148,246,0.26)' }}
                >
                  {initial}
                </div>
              )}

              <div className='min-w-0 flex-1'>
                <div className='flex items-baseline gap-2'>
                  <span
                    className='text-sm font-bold truncate'
                    style={{ color: xProfile ? '#fff' : '#C8C8D4' }}
                  >
                    {displayName}
                  </span>
                  <span className='text-[11px] font-bold flex-shrink-0' style={{ color: '#7A7A8A' }}>
                    {current.symbol}
                  </span>
                </div>
                <div className='text-lg font-black tabular-nums leading-tight' style={{ color: POS }}>
                  {formatProfit(current.pnlUsdCents)}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Trader profile popup — same pattern as the ticker rows */}
      <UserProfilePopup
        traderAddress={profileAddress}
        open={!!profileAddress}
        onClose={() => setProfileAddress(null)}
      />

      <style>{`
        @keyframes bigWinIn {
          0%   { opacity: 0; transform: translateY(-16px) scale(0.96); }
          60%  { opacity: 1; transform: translateY(2px) scale(1.01); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .big-win-card {
          animation: bigWinIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </>
  );
}
