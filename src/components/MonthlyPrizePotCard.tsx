/**
 * MonthlyPrizePotCard — Victory Treasury (user-facing display)
 *
 * Ambient floating display showing the REAL current prize pot amount,
 * sourced from the actual on-chain PDA balance via
 * runGetPotTokenBalanceQueryForMonthlyRewardWithdrawal — the same authoritative
 * source used by the admin WithdrawFromPotSection "In pot" display.
 *
 * Deposit records are still subscribed to discover which mints exist in the pot
 * (for featured-mint selection and empty-pot guard), but the displayed amounts
 * come entirely from the on-chain query, not off-chain arithmetic.
 *
 * Hidden when the pot is empty (all on-chain balances zero / not yet loaded).
 *
 * Animation: simple mount-triggered count-up from 0 to the real on-chain balance
 * over ~2.5s with an ease-out curve. Fires once per page open. No localStorage,
 * no UTC snapshots. Final displayed value always equals the real balance.
 * Respects prefers-reduced-motion: shows the real value instantly.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribeMonthlyRewardTarget,
  type MonthlyRewardTargetResponse,
} from '@/lib/collections/monthlyRewardTarget';
import {
  subscribeManyMonthlyRewardDeposit,
  type MonthlyRewardDepositResponse,
} from '@/lib/collections/monthlyRewardDeposit';
import {
  runGetPotTokenBalanceQueryForMonthlyRewardWithdrawal,
} from '@/lib/collections/monthlyRewardWithdrawal';
import { TokenLogo } from '@/components/TokenLogo';
import { FlipBoardCounter } from '@/components/FlipBoardCounter';
import {
  currentMonthKeyUTC,
  potAccountIdForMonth,
  monthLabel,
  symbolForMint,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { useMediaQuery } from '@/hooks/use-media-query';

// ── Entrance reveal hook ─────────────────────────────────────────────────────
/**
 * Returns true once the element has mounted and a single RAF has fired,
 * triggering CSS transition from the "hidden" initial state to "visible".
 * Respects prefers-reduced-motion: returns true immediately so no transition fires.
 */
function useEntranceReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (prefersReduced) {
      setReady(true);
      return;
    }
    // Two-frame delay so the browser paints the initial hidden state first
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, []);
  return ready;
}

// ── Month days-remaining helper ──────────────────────────────────────────────
function getDaysRemaining(): number {
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const startOfNextMonth = Date.UTC(utcYear, utcMonth + 1, 1);
  const msRemaining = startOfNextMonth - Date.now();
  return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
}

// ── Count-up hook ────────────────────────────────────────────────────────────
/**
 * Simple mount-triggered count-up from 0 to the real on-chain balance.
 *
 * Animates once per page open over ~2.5s with an ease-out curve.
 * When subscriptionsReady becomes true for the first time, kicks off a RAF
 * loop that counts from 0 → realValue. Subsequent realValue updates snap
 * directly to the new value (no re-animation) so the display stays accurate.
 *
 * prefers-reduced-motion: always show realValue instantly.
 * Final displayed value always equals realValue exactly.
 */
function usePrizePotCountUp(
  realValue: number,
  subscriptionsReady: boolean,
): number {
  const [displayed, setDisplayed] = useState<number>(0);
  const rafRef = useRef<number | null>(null);
  const animStartRef = useRef<number | null>(null);
  const hasAnimatedRef = useRef(false);

  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  useEffect(() => {
    if (!subscriptionsReady) return;

    // If reduced motion or already animated once, snap to real value
    if (prefersReduced || hasAnimatedRef.current) {
      setDisplayed(realValue);
      return;
    }

    // First time ready — animate from 0 to realValue over 2.5s ease-out
    hasAnimatedRef.current = true;
    animStartRef.current = null;
    const target = realValue;
    const DURATION = 2500;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (timestamp: number) => {
      if (animStartRef.current === null) animStartRef.current = timestamp;
      const elapsed = timestamp - animStartRef.current;
      const progress = Math.min(1, elapsed / DURATION);
      // Ease-out cubic: decelerates toward the end
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(eased >= 1 ? target : target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionsReady]);

  // After initial animation fires, keep displayed in sync with live realValue changes
  useEffect(() => {
    if (!subscriptionsReady || !hasAnimatedRef.current) return;
    setDisplayed(realValue);
  }, [realValue, subscriptionsReady]);

  return displayed;
}

// ── Format helpers ───────────────────────────────────────────────────────────
function toHuman(baseUnits: number, decimals: number): number {
  return decimals > 0 ? baseUnits / Math.pow(10, decimals) : baseUnits;
}

/** Minimum number of integer digits shown (padded with leading zeros). */
const MIN_INTEGER_DIGITS = 5;

/**
 * Insert thousands-separator commas into a plain digit string (no existing commas).
 * e.g. "00100" → "00,100", "1234567" → "1,234,567"
 */
function addThousandsSeparators(digits: string): string {
  // Work right-to-left, inserting a comma every 3 digits
  let result = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += ',';
    result += digits[i];
  }
  return result;
}

function formatHuman(human: number, _decimals: number): string {
  // Get the normally-formatted string so locale decimal separator is handled
  const normal = human.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Split into integer and decimal parts (always 2 decimal digits)
  const dotIdx = normal.lastIndexOf('.');
  const intPart = dotIdx >= 0 ? normal.slice(0, dotIdx) : normal;
  const decPart = dotIdx >= 0 ? normal.slice(dotIdx + 1) : '00';

  // Strip existing thousands separators (commas) from the integer part
  const rawDigits = intPart.replace(/,/g, '');

  // Pad integer part to MIN_INTEGER_DIGITS with leading zeros
  const paddedDigits = rawDigits.padStart(MIN_INTEGER_DIGITS, '0');

  // Re-apply thousands separators to the padded digit string
  const formattedInt = addThousandsSeparators(paddedDigits);

  return `${formattedInt}.${decPart}`;
}

// ── Typed subscription hook ──────────────────────────────────────────────────
function useTargetSubscription(monthKey: string): MonthlyRewardTargetResponse | null {
  const [target, setTarget] = useState<MonthlyRewardTargetResponse | null>(null);
  const unsubRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    subscribeMonthlyRewardTarget((data) => {
      if (!cancelled) setTarget(data);
    }, monthKey).then((unsub) => {
      if (cancelled) { void unsub(); }
      else { unsubRef.current = unsub; }
    });
    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, [monthKey]);

  return target;
}

function useDepositsSubscription(potAccountId: string): {
  items: MonthlyRewardDepositResponse[];
  ready: boolean;
} {
  const [items, setItems] = useState<MonthlyRewardDepositResponse[]>([]);
  const [ready, setReady] = useState(false);
  const unsubRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    subscribeManyMonthlyRewardDeposit((data) => {
      if (!cancelled) {
        setItems(data);
        setReady(true);
      }
    }, `where potAccountId = '${potAccountId}'`).then((unsub) => {
      if (cancelled) { void unsub(); }
      else { unsubRef.current = unsub; }
    });
    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, [potAccountId]);

  return { items, ready };
}

/**
 * Fetches the actual on-chain PDA balance for a given mint in the prize pot.
 * Returns the balance in base units (lamports for SOL, micro-units for SPL).
 * Returns null while loading, 0 on error or empty.
 *
 * Uses the same query function as WithdrawFromPotSection so both surfaces
 * always show the same authoritative number.
 */
function usePotOnChainBalance(potAccountId: string, mint: string): number | null {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!potAccountId || !mint) return;
    let cancelled = false;

    const probeId = `${potAccountId}_${mint}_cardprobe`;

    const fetch = async () => {
      try {
        const live = await runGetPotTokenBalanceQueryForMonthlyRewardWithdrawal(probeId, {
          potAccountId,
          mint,
        });
        if (!cancelled) {
          setBalance(Math.max(0, Math.floor(Number(live) || 0)));
        }
      } catch (err) {
        console.warn('[MonthlyPrizePotCard] on-chain balance fetch failed:', err);
        if (!cancelled) {
          setBalance((prev) => (prev === null ? 0 : prev));
        }
      }
    };

    void fetch();

    // Re-poll every 30 seconds to stay reasonably fresh without hammering the chain
    const interval = setInterval(() => { void fetch(); }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [potAccountId, mint]);

  return balance;
}

// ── Injected keyframes (inserted once, SSR-safe) ─────────────────────────────
const KEYFRAME_ID = 'victory-treasury-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAME_ID)) {
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @media (prefers-reduced-motion: no-preference) {
      @keyframes vt-glow-breathe {
        0%, 100% { opacity: 0.18; filter: blur(32px); }
        50%       { opacity: 0.38; filter: blur(20px); }
      }
      @keyframes vt-label-float {
        0%, 100% { transform: translateY(0px); }
        50%       { transform: translateY(-2px); }
      }
    }
  `;
  document.head.appendChild(style);
}

// ── Main component ───────────────────────────────────────────────────────────
export function MonthlyPrizePotCard({ desktopHero = false }: { desktopHero?: boolean }) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const entranceReady = useEntranceReady();

  const monthKey = useMemo(() => currentMonthKeyUTC(), []);
  const potAccountId = useMemo(() => potAccountIdForMonth(monthKey), [monthKey]);
  const daysRemaining = useMemo(() => getDaysRemaining(), []);

  // Live target doc — for featured mint preference only
  const monthlyTarget = useTargetSubscription(monthKey);

  // Deposit records — used ONLY to discover which mints exist in the pot.
  // Displayed amounts come from the authoritative on-chain PDA balance query below.
  const { items: deposits, ready: depositsReady } = useDepositsSubscription(potAccountId);

  // Distinct mints that have ever been deposited into this pot
  const depositedMints = useMemo(() => {
    const seen = new Set<string>();
    for (const d of deposits) {
      if (d.mint) seen.add(d.mint);
    }
    return Array.from(seen);
  }, [deposits]);

  // Featured mint: use targetMint if in depositedMints, else first deposited mint
  const featuredMint = useMemo(() => {
    const targetMint = monthlyTarget?.targetMint;
    if (targetMint && depositedMints.includes(targetMint)) {
      return targetMint;
    }
    return depositedMints[0] ?? '';
  }, [depositedMints, monthlyTarget?.targetMint]);

  // Authoritative on-chain PDA balance for the featured mint.
  // This is the SAME query used by WithdrawFromPotSection "In pot" display.
  const featuredOnChainBalance = usePotOnChainBalance(
    potAccountId,
    featuredMint,
  );

  // Resolve token metadata for featured mint
  const mintList = useMemo(() => (featuredMint ? [featuredMint] : []), [featuredMint]);
  const tokenMeta = useTokenMetadata(mintList);

  const featuredMeta = featuredMint ? tokenMeta.get(featuredMint) : undefined;
  const featuredSymbol = featuredMeta?.symbol ?? symbolForMint(featuredMint ?? '');
  const featuredDecimals = featuredMeta?.decimals ?? 6;

  // Real on-chain amount in base units for the featured mint (null = still loading)
  const featuredNetBaseUnits = featuredOnChainBalance ?? 0;
  const featuredNetHuman = toHuman(featuredNetBaseUnits, featuredDecimals);

  // subscriptionsReady: deposits subscription has fired AND on-chain balance has loaded
  const subscriptionsReady = depositsReady && featuredOnChainBalance !== null;

  // Mount-triggered count-up: animates from 0 to the real on-chain balance
  // over ~2.5s ease-out on first load. Final value always equals the real balance.
  const animatedValue = usePrizePotCountUp(featuredNetHuman, subscriptionsReady);

  // Hide entirely when pot is empty — no deposits recorded OR on-chain balance is zero
  if (depositedMints.length === 0 || !featuredMint) return null;
  // Also hide if we've loaded the on-chain balance and it's zero (withdrawn or empty)
  if (featuredOnChainBalance !== null && featuredOnChainBalance <= 0) return null;

  const formattedAmount = formatHuman(animatedValue, featuredDecimals);

  const splits = [
    { label: '1st', pct: '50%' },
    { label: '2nd', pct: '35%' },
    { label: '3rd', pct: '15%' },
  ];

  if (isDesktop) {
    const heroScale = desktopHero;
    return (
      <div
        style={{
          opacity: entranceReady ? 1 : 0,
          transform: entranceReady ? 'translateY(0px) scale(1)' : 'translateY(10px) scale(0.98)',
          transition: 'opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Ambient gold glow — breathes slowly behind the whole card */}
        <div
          aria-hidden='true'
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at 50% 60%, rgba(200,150,42,0.35) 0%, transparent 70%)',
            animation: 'vt-glow-breathe 4.5s ease-in-out infinite',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        {/* DESKTOP: floating display, no card background */}
        <div
          className={`relative flex flex-col items-center text-center select-none ${heroScale ? 'py-6' : 'py-4'}`}
          style={{ zIndex: 1 }}
        >
          {/* Top label — floats gently */}
          <div
            className={`flex items-center justify-center gap-3 ${heroScale ? 'mb-4' : 'mb-3'}`}
            style={{ animation: 'vt-label-float 5s ease-in-out infinite' }}
          >
            <span
              className='font-black uppercase tracking-[0.25em]'
              style={{ color: '#C8962A', fontSize: heroScale ? '0.95rem' : '0.875rem' }}
            >
              {monthLabel(monthKey)} Victory Treasury
            </span>
            <span
              className='font-bold px-2.5 py-1 rounded-full'
              style={{
                background: 'rgba(200,150,42,0.12)',
                color: 'rgba(200,150,42,0.85)',
                border: '1px solid rgba(200,150,42,0.28)',
                fontSize: heroScale ? '0.8rem' : '0.75rem',
              }}
            >
              {daysRemaining === 0 ? 'Last day' : `${daysRemaining}d left`}
            </span>
          </div>

          {/* Prize amount — desktop hero: larger flip-board counter */}
          <div className={`flex flex-col items-center justify-center gap-3 ${heroScale ? 'mb-5' : 'mb-4'}`}>
            <FlipBoardCounter
              value={formattedAmount}
              size='xl'
              accentColor='#C8962A'
              fitWidth
            />
            <div className='flex items-center gap-2'>
              <TokenLogo symbol={featuredSymbol} size={heroScale ? 36 : 28} />
              <span
                className='font-bold'
                style={{ color: 'rgba(240,200,80,0.55)', fontSize: heroScale ? '1.6rem' : '1.25rem' }}
              >
                {featuredSymbol}
              </span>
            </div>
          </div>

          {/* Split badges */}
          <div className='flex items-center justify-center gap-3'>
            <span
              style={{ color: 'rgba(200,150,42,0.45)', fontSize: heroScale ? '0.9rem' : '0.875rem' }}
            >
              Top 3 split:
            </span>
            {splits.map(({ label, pct }, i) => (
              <span
                key={label}
                className='font-bold rounded-lg'
                style={{
                  background: 'rgba(200,150,42,0.10)',
                  color: 'rgba(240,200,80,0.7)',
                  border: '1px solid rgba(200,150,42,0.2)',
                  padding: heroScale ? '0.5rem 1.1rem' : '0.375rem 0.875rem',
                  fontSize: heroScale ? '0.9rem' : '0.875rem',
                  opacity: entranceReady ? 1 : 0,
                  transform: entranceReady ? 'translateY(0px)' : 'translateY(6px)',
                  transition: `opacity 0.45s ease ${0.18 + i * 0.07}s, transform 0.45s ease ${0.18 + i * 0.07}s`,
                }}
              >
                {label} {pct}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        opacity: entranceReady ? 1 : 0,
        transform: entranceReady ? 'translateY(0px) scale(1)' : 'translateY(8px) scale(0.985)',
        transition: 'opacity 0.5s cubic-bezier(0.22,1,0.36,1), transform 0.5s cubic-bezier(0.22,1,0.36,1)',
        position: 'relative',
        width: '100%',
      }}
    >
      {/* Ambient gold glow — mobile, softer */}
      <div
        aria-hidden='true'
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at 50% 55%, rgba(200,150,42,0.22) 0%, transparent 70%)',
          animation: 'vt-glow-breathe 4.5s ease-in-out infinite',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* MOBILE: bare layout, no card background */}
      <div className='relative w-full text-center px-4 py-3 select-none' style={{ zIndex: 1 }}>
        {/* Top label row — smaller, tighter */}
        <div
          className='flex items-center justify-center gap-1.5 mb-2'
          style={{ animation: 'vt-label-float 5s ease-in-out infinite' }}
        >
          <span className='text-[10px] font-black uppercase tracking-[0.18em]' style={{ color: '#C8962A' }}>
            {monthLabel(monthKey)} Victory Treasury
          </span>
          <span
            className='text-[9px] font-bold px-1.5 py-0.5 rounded-full'
            style={{ background: 'rgba(200,150,42,0.15)', color: 'rgba(200,150,42,0.8)', border: '1px solid rgba(200,150,42,0.25)' }}
          >
            {daysRemaining === 0 ? 'Last day' : `${daysRemaining}d left`}
          </span>
        </div>

        {/* Prize amount — flip-board is the hero */}
        <div className='flex flex-col items-center justify-center gap-1.5 my-2'>
          <FlipBoardCounter
            value={formattedAmount}
            size='md'
            accentColor='#C8962A'
          />
          <div className='flex items-center gap-1.5 mt-0.5'>
            <TokenLogo symbol={featuredSymbol} size={14} />
            <span className='text-xs font-bold' style={{ color: 'rgba(240,200,80,0.6)' }}>
              {featuredSymbol}
            </span>
          </div>
        </div>

        {/* Split badges row — smaller, stagger in */}
        <div className='flex items-center justify-center gap-1.5 mt-2'>
          <span className='text-[9px]' style={{ color: 'rgba(200,150,42,0.5)' }}>Top 3 split:</span>
          {splits.map(({ label, pct }, i) => (
            <span
              key={label}
              className='text-[9px] font-bold px-1.5 py-0.5 rounded'
              style={{
                background: 'rgba(200,150,42,0.10)',
                color: 'rgba(240,200,80,0.7)',
                border: '1px solid rgba(200,150,42,0.18)',
                opacity: entranceReady ? 1 : 0,
                transform: entranceReady ? 'translateY(0px)' : 'translateY(5px)',
                transition: `opacity 0.4s ease ${0.16 + i * 0.06}s, transform 0.4s ease ${0.16 + i * 0.06}s`,
              }}
            >
              {label} {pct}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
