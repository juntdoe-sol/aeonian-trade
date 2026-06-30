/**
 * RocketLaunchOverlay — full-screen rocket-launch animation on position open.
 *
 * Renders via createPortal into a dedicated #overlay-root div appended directly
 * to document.documentElement (<html>), NOT document.body.
 *
 * Why: base.css sets `body { position: fixed; inset: 0 }` for the mobile
 * scroll-lock. On iOS Safari a `position: fixed` element becomes the containing
 * block for its own `position: fixed` descendants, so portalling into body makes
 * the overlay invisible (it paints inside the fixed body stacking context, which
 * iOS Safari composites separately). Portalling into <html> escapes that
 * containing block entirely — same fix as the CelebrationOverlay.
 *
 * pointer-events: none throughout — never blocks interaction.
 * Auto-dismisses after TOTAL_MS. All animation is CSS transform-based (GPU).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRocketLaunchStore, RocketLaunchPayload } from '@/utils/launch-rocket';

// ── Overlay root ──────────────────────────────────────────────────────────────
// Portalling into <html> (document.documentElement) instead of document.body
// so that `position:fixed` children escape the fixed-body containing block that
// iOS Safari creates. This is a lazy singleton — created once, never removed.
function getOverlayRoot(): HTMLElement {
  let el = document.getElementById('overlay-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-root';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9997';
    document.documentElement.appendChild(el);
  }
  return el;
}

// ── Timing ────────────────────────────────────────────────────────────────────
const TOTAL_MS = 2600;
const FADE_IN_MS = 180;
const FADE_OUT_START_MS = TOTAL_MS - 500;
const FADE_OUT_MS = 500;

// ── AEONIAN brand palette ─────────────────────────────────────────────────────
// White #FFFFFF / Orchid #B09AD9 / Amethyst #6B2FA8 / Royal #401368 / Void #120427 / Mist #EFE9F5

// ── Rocket SVG ────────────────────────────────────────────────────────────────
// A hand-crafted SVG rocket with Aeonian brand colors. No emoji.
function RocketSVG() {
  return (
    <svg
      width="64"
      height="96"
      viewBox="0 0 64 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Body */}
      <path
        d="M32 2 C20 2 12 22 12 44 L52 44 C52 22 44 2 32 2Z"
        fill="url(#rocketBodyGrad)"
      />
      {/* Cockpit window */}
      <circle cx="32" cy="26" r="7" fill="url(#windowGrad)" opacity="0.9" />
      <circle cx="32" cy="26" r="5" fill="#B09AD9" opacity="0.45" />
      {/* Left fin */}
      <path d="M12 44 L4 62 L18 56 L12 44Z" fill="#B09AD9" />
      {/* Right fin */}
      <path d="M52 44 L60 62 L46 56 L52 44Z" fill="#B09AD9" />
      {/* Nozzle */}
      <rect x="26" y="56" width="12" height="8" rx="2" fill="#401368" />

      {/* Defs */}
      <defs>
        <linearGradient id="rocketBodyGrad" x1="32" y1="2" x2="32" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EFE9F5" />
          <stop offset="50%" stopColor="#B09AD9" />
          <stop offset="100%" stopColor="#6B2FA8" />
        </linearGradient>
        <radialGradient id="windowGrad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#401368" />
        </radialGradient>
      </defs>
    </svg>
  );
}

// ── Exhaust flame ─────────────────────────────────────────────────────────────
// Animated tapering flame cone in orchid/amethyst tones.
function FlameSVG() {
  return (
    <>
      <style>{`
        @keyframes flameFlicker {
          0%   { transform: scaleX(1)   scaleY(1)   skewX(0deg);  opacity: 1;   }
          20%  { transform: scaleX(1.1) scaleY(0.9) skewX(2deg);  opacity: 0.9; }
          40%  { transform: scaleX(0.9) scaleY(1.1) skewX(-1deg); opacity: 1;   }
          60%  { transform: scaleX(1.05)scaleY(0.95)skewX(1deg);  opacity: 0.9; }
          80%  { transform: scaleX(0.95)scaleY(1.05)skewX(-2deg); opacity: 1;   }
          100% { transform: scaleX(1)   scaleY(1)   skewX(0deg);  opacity: 1;   }
        }
        .flame-anim {
          animation: flameFlicker 140ms ease-in-out infinite;
          transform-origin: 50% 0%;
        }
      `}</style>
      <svg
        width="64"
        height="80"
        viewBox="0 0 64 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flame-anim"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        {/* Outer flame — wide, orchid */}
        <path
          d="M32 0 C20 10 14 30 18 55 C22 70 28 80 32 80 C36 80 42 70 46 55 C50 30 44 10 32 0Z"
          fill="url(#flameOuter)"
          opacity="0.75"
        />
        {/* Inner flame — narrow, bright mist/white */}
        <path
          d="M32 4 C26 14 23 34 25 52 C27 64 30 76 32 76 C34 76 37 64 39 52 C41 34 38 14 32 4Z"
          fill="url(#flameInner)"
          opacity="0.9"
        />
        {/* Core hot streak */}
        <path
          d="M32 8 C30 20 29 40 31 58 C31.5 65 32 72 32 72 C32 72 32.5 65 33 58 C35 40 34 20 32 8Z"
          fill="url(#flameCore)"
        />
        <defs>
          <linearGradient id="flameOuter" x1="32" y1="0" x2="32" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6B2FA8" stopOpacity="1" />
            <stop offset="40%" stopColor="#B09AD9" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#401368" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="flameInner" x1="32" y1="4" x2="32" y2="76" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#EFE9F5" stopOpacity="1" />
            <stop offset="50%" stopColor="#B09AD9" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#6B2FA8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="flameCore" x1="32" y1="8" x2="32" y2="72" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="60%" stopColor="#EFE9F5" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#B09AD9" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
}

// ── Particle streak ───────────────────────────────────────────────────────────
interface StreakProps {
  id: number;
  delay: number;    // ms
  offsetX: number;  // px from rocket center
  duration: number; // ms — how long the streak falls
  opacity: number;
  width: number;
  height: number;
  color: string;
}

function ParticleStreak({ id, delay, offsetX, duration, opacity, width, height, color }: StreakProps) {
  const animId = `streak-${id}`;
  return (
    <>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: translateY(-40px); opacity: ${opacity}; }
          20%  { opacity: ${opacity}; }
          100% { transform: translateY(${height + 80}px); opacity: 0; }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `calc(50% + ${offsetX}px - ${width / 2}px)`,
          top: 0,
          width,
          height,
          background: `linear-gradient(to bottom, ${color} 0%, transparent 100%)`,
          borderRadius: width / 2,
          animation: `${animId} ${duration}ms linear ${delay}ms both`,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

// ── Smoke puff ────────────────────────────────────────────────────────────────
interface SmokePuffProps {
  id: number;
  delay: number;
  offsetX: number;
  offsetY: number;
}

function SmokePuff({ id, delay, offsetX, offsetY }: SmokePuffProps) {
  const animId = `smoke-${id}`;
  const size = 28 + (id * 17) % 24;
  return (
    <>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: translate(0, 0) scale(0.4); opacity: 0.55; }
          40%  { opacity: 0.35; }
          100% { transform: translate(${offsetX}px, ${offsetY + 60}px) scale(2.2); opacity: 0; }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '-20px',
          marginLeft: -size / 2 + offsetX / 2,
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(176,154,217,0.4) 0%, rgba(64,19,104,0.2) 50%, transparent 70%)',
          animation: `${animId} 1000ms ease-out ${delay}ms both`,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

// ── Particle config (deterministic by launch count) ───────────────────────────
const STREAK_COLORS = ['#B09AD9', '#EFE9F5', '#FFFFFF', '#9B7DC5', '#D4C5F0'];

function makeStreaks(seed: number): StreakProps[] {
  return Array.from({ length: 8 }, (_, i) => {
    const s = seed * 7 + i * 43;
    return {
      id: i,
      delay: (s % 5) * 80 + 80,
      offsetX: ((s * 13) % 140) - 70,
      duration: 900 + (s % 500),
      opacity: 0.4 + (s % 50) / 100,
      width: 2 + (s % 3),
      height: 40 + (s % 40),
      color: STREAK_COLORS[s % STREAK_COLORS.length],
    };
  });
}

function makeSmokePuffs(seed: number): SmokePuffProps[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: i,
    delay: i * 100 + (seed % 3) * 40,
    offsetX: ((seed * 3 + i * 17) % 80) - 40,
    offsetY: (seed * 5 + i * 23) % 40,
  }));
}

// ── Launch text label ─────────────────────────────────────────────────────────
function LaunchLabel({ payload, visible }: { payload: RocketLaunchPayload; visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: '15vh',
        left: '50%',
        transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(12px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 280ms cubic-bezier(0.16,1,0.3,1), transform 280ms cubic-bezier(0.16,1,0.3,1)',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 2,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          background: 'rgba(18, 4, 39, 0.78)',
          border: '1px solid rgba(176,154,217,0.3)',
          borderRadius: '12px',
          padding: '10px 24px',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 4px 32px rgba(107,47,168,0.4), 0 0 0 1px rgba(176,154,217,0.1)',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(239,233,245,0.55)',
            marginBottom: '4px',
          }}
        >
          {payload.symbol ?? 'Position'}
        </div>
        <div
          style={{
            fontSize: '20px',
            fontWeight: 700,
            color: '#B09AD9',
            letterSpacing: '-0.01em',
            textShadow: '0 0 20px rgba(176,154,217,0.55)',
          }}
        >
          Order Placed
        </div>
      </div>
    </div>
  );
}

// ── Main rocket column ────────────────────────────────────────────────────────
// The whole rocket + flame group translates vertically from 110vh to -20vh.
//
// Rocket size: base SVG is 64×96px.
//   Mobile  (<768px): scale 3× → effective ~192px wide
//   Desktop (≥768px): scale 5× → effective ~320px wide
//
// We apply a CSS class `rocket-body-scale` via a <style> block so we can use
// a media query. transform-origin is `bottom center` so scaling expands
// upward from the nozzle — the flight path bottom→top is preserved.
function RocketColumn({ launchCount }: { launchCount: number }) {
  const animId = `rocket-fly-${launchCount}`;
  const streaks = makeStreaks(launchCount);
  const puffs = makeSmokePuffs(launchCount);

  // Horizontal jitter — slight offset each launch so it doesn't always go dead center
  const jitterX = ((launchCount * 37) % 80) - 40; // -40px..+40px

  return (
    <>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: translateX(${jitterX}px) translateY(110vh); }
          100% { transform: translateX(${jitterX + ((launchCount * 13) % 40) - 20}px) translateY(-130vh); }
        }
        .rocket-body-scale {
          transform: scale(3);
          transform-origin: bottom center;
        }
        @media (min-width: 768px) {
          .rocket-body-scale {
            transform: scale(5);
            transform-origin: bottom center;
          }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '50%',
          top: 0,
          marginLeft: -32,   // half of rocket width (64px) — column centering unchanged
          width: 64,
          height: '100vh',
          pointerEvents: 'none',
          animation: `${animId} 2200ms cubic-bezier(0.12, 0.0, 0.28, 1.0) 0ms both`,
          zIndex: 1,
        }}
      >
        {/* Rocket body — positioned relative to the column bottom edge */}
        {/* rocket-body-scale applies 3× on mobile, 5× on desktop via media query */}
        <div
          className="rocket-body-scale"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: 64,
          }}
        >
          {/* Flame below nozzle */}
          <div style={{ position: 'relative', left: 0, top: 0 }}>
            <FlameSVG />
          </div>
          {/* Particle streaks (fly past behind rocket) */}
          <div
            style={{
              position: 'absolute',
              top: '-60px',
              left: 0,
              width: 64,
              height: '200px',
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            {streaks.map((s) => (
              <ParticleStreak key={s.id} {...s} />
            ))}
          </div>
          {/* Rocket body on top */}
          <div style={{ position: 'relative', marginTop: '-8px' }}>
            <RocketSVG />
          </div>
          {/* Smoke puffs at the base */}
          <div
            style={{
              position: 'absolute',
              bottom: '-10px',
              left: 0,
              width: 64,
              pointerEvents: 'none',
            }}
          >
            {puffs.map((p) => (
              <SmokePuff key={p.id} {...p} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Glow bloom at launch point ────────────────────────────────────────────────
function LaunchBloom({ launchCount }: { launchCount: number }) {
  const animId = `bloom-launch-${launchCount}`;
  return (
    <>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: translate(-50%, 0) scale(0.2); opacity: 0.9; }
          30%  { transform: translate(-50%, 0) scale(1.4); opacity: 0.6; }
          100% { transform: translate(-50%, 0) scale(2.8); opacity: 0; }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: '8vh',
          left: '50%',
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239,233,245,0.7) 0%, rgba(176,154,217,0.5) 35%, rgba(107,47,168,0.25) 65%, transparent 80%)',
          pointerEvents: 'none',
          animation: `${animId} 700ms ease-out 0ms both`,
          zIndex: 1,
        }}
      />
    </>
  );
}

// ── Main overlay ───────────────────────────────────────────────────────────────
export function RocketLaunchOverlay() {
  const launchCount = useRocketLaunchStore((s) => s.launchCount);
  const payload = useRocketLaunchStore((s) => s.payload);

  const [active, setActive] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [labelVisible, setLabelVisible] = useState(false);
  const [frozenPayload, setFrozenPayload] = useState<RocketLaunchPayload | null>(null);
  const [activeLaunchCount, setActiveLaunchCount] = useState(0);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  };

  useEffect(() => {
    if (launchCount === 0) return;

    clearTimers();

    setFrozenPayload(payload);
    setActiveLaunchCount(launchCount);
    setActive(true);
    setOverlayOpacity(0);
    setLabelVisible(false);

    // Fade in
    timerRefs.current.push(setTimeout(() => setOverlayOpacity(1), 16));

    // Show label once rocket is ~half way up
    timerRefs.current.push(setTimeout(() => setLabelVisible(true), 400));

    // Start fade-out
    timerRefs.current.push(setTimeout(() => {
      setOverlayOpacity(0);
      setLabelVisible(false);
    }, FADE_OUT_START_MS));

    // Unmount
    timerRefs.current.push(setTimeout(() => {
      setActive(false);
    }, TOTAL_MS + 80));

    return () => clearTimers();
  }, [launchCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998, // just below CelebrationOverlay (9999) so they layer if both fire
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: overlayOpacity,
        transition: overlayOpacity === 0
          ? `opacity ${FADE_OUT_MS}ms ease-in`
          : `opacity ${FADE_IN_MS}ms ease-out`,
      }}
    >
      {/* Subtle amethyst radial vignette — gives depth to the rocket trail */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 60% 80% at 50% 80%, rgba(64,19,104,0.22) 0%, rgba(18,4,39,0.12) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Rocket + flame + streaks */}
      <RocketColumn launchCount={activeLaunchCount} />

      {/* Launch bloom flash at bottom */}
      <LaunchBloom launchCount={activeLaunchCount} />

      {/* "Order Placed" label */}
      {frozenPayload && (
        <LaunchLabel payload={frozenPayload} visible={labelVisible} />
      )}
    </div>,
    getOverlayRoot(),
  );
}
