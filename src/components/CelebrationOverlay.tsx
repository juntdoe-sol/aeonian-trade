/**
 * CelebrationOverlay — full-screen fireworks + PnL reveal on profitable position close.
 *
 * Renders via createPortal into a dedicated #overlay-root div appended directly
 * to document.documentElement (<html>), NOT document.body.
 *
 * Why: base.css sets `body { position: fixed; inset: 0 }` for the mobile
 * scroll-lock. On iOS Safari a `position: fixed` element becomes the containing
 * block for its own `position: fixed` descendants, so portalling into body makes
 * the overlay invisible. Portalling into <html> escapes that containing block.
 * Same fix as RocketLaunchOverlay — both share the same #overlay-root element.
 *
 * pointer-events: none throughout — never blocks interaction.
 * Auto-dismisses after TOTAL_MS.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCelebrateStore, CelebrationPayload } from '@/utils/celebrate';

// ── Overlay root ──────────────────────────────────────────────────────────────
// Portalling into <html> (document.documentElement) instead of document.body.
// Lazy singleton — created once, never removed.
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
const TOTAL_MS = 3200;
const FADE_IN_MS = 200;
const TEXT_APPEAR_MS = 350;
const FADE_OUT_START_MS = TOTAL_MS - 700;
const FADE_OUT_MS = 700;

// ── AEONIAN brand palette ─────────────────────────────────────────────────────
const FIREWORK_COLORS = [
  '#B09AD9', // Orchid
  '#FFFFFF', // White
  '#EFE9F5', // Mist
  '#b8a0e0', // Orchid lighter
  '#d4c5f0', // Orchid pale
  '#9370cc', // Amethyst mid
  '#c8b8e8', // Orchid soft
  '#FFFFFF', // White (weighted heavier)
  '#B09AD9', // Orchid (weighted heavier)
];

// ── Firework burst ────────────────────────────────────────────────────────────
interface BurstConfig {
  id: number;
  cx: number;    // vw
  cy: number;    // vh
  delay: number; // ms before this burst fires
  scale: number; // 0.6–1.2
  hue: number;   // CSS hue-rotate offset (0–30deg for subtle variation)
}

function makeBursts(seed: number): BurstConfig[] {
  // 7 staggered bursts spread across the viewport
  return [
    { id: 0, cx: 20, cy: 22, delay: 0,   scale: 1.1,  hue: 0 },
    { id: 1, cx: 75, cy: 18, delay: 120, scale: 0.85, hue: 10 },
    { id: 2, cx: 50, cy: 35, delay: 250, scale: 1.2,  hue: 5 },
    { id: 3, cx: 12, cy: 55, delay: 380, scale: 0.75, hue: 15 },
    { id: 4, cx: 85, cy: 48, delay: 460, scale: 0.9,  hue: 8 },
    { id: 5, cx: 38, cy: 65, delay: 580, scale: 1.0,  hue: 20 },
    { id: 6, cx: 65, cy: 25, delay: 700, scale: 0.8,  hue: 12 },
  ].map((b) => ({
    ...b,
    // Slightly vary positions per burst to avoid same layout every time
    cx: b.cx + ((seed * (b.id + 7) * 13) % 200 / 100 - 1) * 5,
    cy: b.cy + ((seed * (b.id + 3) * 19) % 200 / 100 - 1) * 5,
  }));
}

// ── Spark particle within a burst ─────────────────────────────────────────────
interface SparkProps {
  angle: number;       // degrees
  distance: number;    // px
  color: string;
  size: number;        // px
  duration: number;    // ms
  delay: number;       // ms (burst delay + per-spark stagger)
  burstId: number;
  sparkId: number;
}

function Spark({ angle, distance, color, size, duration, delay, burstId, sparkId }: SparkProps) {
  const animId = `spark-${burstId}-${sparkId}`;
  const rad = (angle * Math.PI) / 180;
  const tx = Math.cos(rad) * distance;
  const ty = Math.sin(rad) * distance;
  // Trailing tail — make sparks elongated along travel direction
  const tailLength = size * (1.5 + Math.random() * 1.5);

  return (
    <>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: translate(0, 0) scale(1); opacity: 1; }
          60%  { opacity: 0.85; }
          100% { transform: translate(${tx}px, ${ty}px) scale(0.15); opacity: 0; }
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          width: tailLength,
          height: size,
          background: color,
          borderRadius: '50%',
          boxShadow: `0 0 ${size * 2}px ${size}px ${color}55`,
          transform: `rotate(${angle}deg)`,
          transformOrigin: '0 50%',
          animation: `${animId} ${duration}ms cubic-bezier(0.15, 0.5, 0.5, 1) ${delay}ms both`,
        }}
      />
    </>
  );
}

// ── Single burst at a viewport-relative position ──────────────────────────────
interface FireworkBurstProps {
  burst: BurstConfig;
}

function FireworkBurst({ burst }: FireworkBurstProps) {
  const sparkCount = 22;
  const sparks: SparkProps[] = Array.from({ length: sparkCount }, (_, i) => {
    const angle = (360 / sparkCount) * i + (burst.id * 7);
    const seed = burst.id * 31 + i * 137;
    const colorIndex = (seed) % FIREWORK_COLORS.length;
    return {
      angle,
      distance: (80 + ((seed * 17) % 70)) * burst.scale,
      color: FIREWORK_COLORS[colorIndex],
      size: (2.5 + ((seed * 7) % 3)) * burst.scale,
      duration: 700 + (seed % 400),
      delay: burst.delay + (i % 3) * 20,
      burstId: burst.id,
      sparkId: i,
    };
  });

  // Second ring of shorter sparks — fills gaps between main sparks
  const innerSparks: SparkProps[] = Array.from({ length: 14 }, (_, i) => {
    const angle = (360 / 14) * i + 13 + burst.id * 5;
    const seed = burst.id * 53 + i * 97 + 500;
    const colorIndex = (seed) % FIREWORK_COLORS.length;
    return {
      angle,
      distance: (40 + ((seed * 23) % 35)) * burst.scale,
      color: FIREWORK_COLORS[colorIndex],
      size: (1.5 + ((seed * 11) % 2)) * burst.scale,
      duration: 500 + (seed % 300),
      delay: burst.delay + 40 + (i % 2) * 15,
      burstId: burst.id,
      sparkId: sparkCount + i,
    };
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: `${burst.cx}vw`,
        top: `${burst.cy}vh`,
        width: 0,
        height: 0,
        filter: `hue-rotate(${burst.hue}deg)`,
        pointerEvents: 'none',
      }}
    >
      {[...sparks, ...innerSparks].map((s) => (
        <Spark key={`${s.burstId}-${s.sparkId}`} {...s} />
      ))}
      {/* Flash bloom at burst origin */}
      <FlashBloom burst={burst} />
    </div>
  );
}

// ── Flash bloom — bright flash at the burst origin point ───────────────────────
function FlashBloom({ burst }: { burst: BurstConfig }) {
  const animId = `bloom-${burst.id}`;
  const size = 60 * burst.scale;
  return (
    <>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: scale(0); opacity: 1; }
          30%  { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(176,154,217,0.6) 50%, transparent 70%)',
          transform: 'translate(-50%, -50%)',
          animation: `${animId} 400ms ease-out ${burst.delay}ms both`,
          boxShadow: `0 0 ${size}px ${size / 2}px rgba(176,154,217,0.4)`,
        }}
      />
    </>
  );
}

// ── PnL text card ──────────────────────────────────────────────────────────────
function PnlCard({ payload, visible }: { payload: CelebrationPayload; visible: boolean }) {
  const pnlFormatted = `+$${payload.pnl.toFixed(2)}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 1,
        transition: `opacity ${TEXT_APPEAR_MS}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${TEXT_APPEAR_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
      }}
    >
      <div
        style={{
          background: '#1a1a1f',
          border: '1px solid #2a2a2f',
          borderRadius: '20px',
          padding: '28px 44px',
          boxShadow: 'none',
          textAlign: 'center',
          minWidth: '240px',
        }}
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(239, 233, 245, 0.65)',
            marginBottom: '8px',
          }}
        >
          {payload.symbol ? `${payload.symbol}` : 'Position Closed'}
        </div>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(176, 154, 217, 0.7)',
            marginBottom: '16px',
          }}
        >
          Congratulations
        </div>
        <div
          style={{
            fontSize: '42px',
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            textShadow: 'none',
          }}
        >
          {pnlFormatted}
        </div>
      </div>
    </div>
  );
}

// ── Main overlay ───────────────────────────────────────────────────────────────
export function CelebrationOverlay() {
  const celebrateCount = useCelebrateStore((s) => s.celebrateCount);
  const payload = useCelebrateStore((s) => s.payload);

  const [active, setActive] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [textVisible, setTextVisible] = useState(false);
  const [frozenPayload, setFrozenPayload] = useState<CelebrationPayload | null>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [bursts, setBursts] = useState<BurstConfig[]>([]);

  const clearTimers = () => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  };

  useEffect(() => {
    if (celebrateCount === 0) return;

    clearTimers();

    // Snapshot the payload at burst time
    setFrozenPayload(payload);
    setBursts(makeBursts(celebrateCount));
    setActive(true);
    setOverlayOpacity(0);
    setTextVisible(false);

    // Fade in overlay
    timerRefs.current.push(setTimeout(() => setOverlayOpacity(1), 16));

    // Reveal text card slightly after first burst lands
    timerRefs.current.push(setTimeout(() => setTextVisible(true), 300));

    // Start fade-out
    timerRefs.current.push(setTimeout(() => {
      setOverlayOpacity(0);
      setTextVisible(false);
    }, FADE_OUT_START_MS));

    // Unmount
    timerRefs.current.push(setTimeout(() => {
      setActive(false);
    }, TOTAL_MS + 80));

    return () => clearTimers();
  }, [celebrateCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: overlayOpacity,
        transition: overlayOpacity === 0
          ? `opacity ${FADE_OUT_MS}ms ease-in`
          : `opacity ${FADE_IN_MS}ms ease-out`,
      }}
    >
      {/* Subtle vignette to give fireworks depth */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 80% 70% at 50% 45%, rgba(64, 19, 104, 0.18) 0%, rgba(18, 4, 39, 0.28) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Firework bursts */}
      {bursts.map((burst) => (
        <FireworkBurst key={burst.id} burst={burst} />
      ))}

      {/* PnL card — centered over fireworks */}
      {frozenPayload && (
        <PnlCard payload={frozenPayload} visible={textVisible} />
      )}
    </div>,
    getOverlayRoot(),
  );
}
