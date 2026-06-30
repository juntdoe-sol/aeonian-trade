/**
 * FlipBoardCounter — mechanical split-flap / flip-clock board
 *
 * Takes a formatted amount string like "1,234.56" and renders each digit on
 * its own dark tile with a horizontal hinge seam. When a digit changes between
 * renders the tile plays a quick vertical flip animation.
 *
 * Separators ($, ,, .) are rendered as static glyphs between tiles — they
 * never flip.
 *
 * Sizing:
 *   size="sm"  — mobile card
 *   size="lg"  — desktop floating counter (2x)
 */

import { useEffect, useRef, useState, memo } from 'react';

// ─── CSS injected once ───────────────────────────────────────────────────────
const FLIP_CSS = `
@keyframes flipFlapDown {
  0%   { transform: rotateX(0deg); }
  100% { transform: rotateX(-90deg); }
}
@keyframes flipFlapReveal {
  0%   { transform: rotateX(90deg); }
  100% { transform: rotateX(0deg); }
}

.fbt-root {
  display: inline-flex;
  flex-direction: column;
  position: relative;
  flex-shrink: 0;
}

.fbt-top {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: linear-gradient(180deg, #1e1e23 0%, #141418 55%, #0d0d11 100%);
}
.fbt-top::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.045) 0%, transparent 65%);
  pointer-events: none;
  z-index: 2;
}

.fbt-bottom {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: linear-gradient(180deg, #0a0a0e 0%, #141418 45%, #1a1a1f 100%);
}
.fbt-bottom::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 55%);
  pointer-events: none;
  z-index: 2;
}

/* Hinge seam — the thin mechanical crease at dead centre */
.fbt-seam {
  position: relative;
  z-index: 10;
  flex-shrink: 0;
  background: #08080c;
  box-shadow:
    0 -1px 0 rgba(255,255,255,0.06),
    0  1px 0 rgba(255,255,255,0.04);
}

/* Digit text — top half: glyph centred in a 2x tall box, midpoint on the seam */
.fbt-digit-top {
  position: absolute;
  top: 0;
  left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200%;
  user-select: none;
  z-index: 1;
}
/* Digit text — bottom half: glyph centred in a 2x tall box, midpoint on the seam */
.fbt-digit-bottom {
  position: absolute;
  bottom: 0;
  left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200%;
  user-select: none;
  z-index: 1;
}

/* Animated flap (old top-half rotates down out of view) */
.fbt-flap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transform-origin: 50% 100%;
  background: linear-gradient(180deg, #1e1e23 0%, #141418 55%, #0d0d11 100%);
  z-index: 5;
}
.fbt-flap::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.045) 0%, transparent 65%);
  pointer-events: none;
}
.fbt-flap--run {
  animation: flipFlapDown var(--fbt-dur) ease-in forwards;
}

/* Reveal panel (new bottom-half swings in from the top) */
.fbt-reveal {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transform-origin: 50% 0%;
  background: linear-gradient(180deg, #0a0a0e 0%, #141418 45%, #1a1a1f 100%);
  z-index: 5;
}
.fbt-reveal::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 55%);
  pointer-events: none;
}
.fbt-reveal--run {
  animation: flipFlapReveal var(--fbt-dur) ease-out forwards;
  animation-delay: calc(var(--fbt-dur) * 0.45);
}

@media (prefers-reduced-motion: reduce) {
  .fbt-flap--run, .fbt-reveal--run { animation: none; }
}
`;

let cssInjected = false;
function injectFlipCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const el = document.createElement('style');
  el.dataset.id = 'flip-board-counter';
  el.textContent = FLIP_CSS;
  document.head.appendChild(el);
}

// ─── Single tile ─────────────────────────────────────────────────────────────
const FLIP_DURATION_MS = 220;
// Total animation duration: flap down (220ms) + reveal delay (220*0.45=99ms) + reveal up (220ms)
const FLIP_TOTAL_MS = FLIP_DURATION_MS * 2 + Math.ceil(FLIP_DURATION_MS * 0.45) + 80;

interface FlipTileProps {
  char: string;
  tileW: number;
  tileH: number;
  fontSize: number;
}

const FlipTile = memo(function FlipTile({ char, tileW, tileH, fontSize }: FlipTileProps) {
  const [animKey, setAnimKey] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [fromChar, setFromChar] = useState(char);    // the "old" char shown during flip

  // Use refs for values that must be stable inside setTimeout closures
  const prevCharRef = useRef(char);
  const flippingRef = useRef(false);           // mirrors `flipping` without stale-closure risk
  const pendingCharRef = useRef<string | null>(null); // latest char queued while flipping
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { injectFlipCSS(); }, []);

  useEffect(() => {
    if (char === prevCharRef.current) return;

    // If a flip is currently running, just remember the latest target digit.
    // We'll pick it up once the current animation finishes.
    if (flippingRef.current) {
      pendingCharRef.current = char;
      return;
    }

    const startFlip = (fromC: string, toC: string) => {
      prevCharRef.current = toC;
      flippingRef.current = true;
      pendingCharRef.current = null;

      setFromChar(fromC);
      setAnimKey(k => k + 1);
      setFlipping(true);

      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        flippingRef.current = false;
        setFlipping(false);

        // If another char arrived while we were animating, kick off one more flip now
        const next = pendingCharRef.current;
        if (next !== null && next !== prevCharRef.current) {
          startFlip(prevCharRef.current, next);
        }
      }, FLIP_TOTAL_MS);
    };

    startFlip(prevCharRef.current, char);
  }, [char]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const halfH = tileH / 2;
  const seam = Math.max(2, Math.round(tileH * 0.03));
  const br = Math.round(Math.min(tileW, tileH) * 0.1);

  const textStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    fontWeight: 900,
    color: '#F2F2F2',
    letterSpacing: '-0.01em',
    fontFamily: "'Arial Black', 'Impact', 'Arial', sans-serif",
    lineHeight: 1.25,
  };

  return (
    <div
      className="fbt-root"
      style={{
        width: tileW,
        borderRadius: br,
        ['--fbt-dur' as string]: `${FLIP_DURATION_MS}ms`,
      }}
    >
      {/* ── Top half ── */}
      <div
        className="fbt-top"
        style={{
          height: halfH,
          borderRadius: `${br}px ${br}px 0 0`,
        }}
      >
        {/* Static current digit top */}
        <div className="fbt-digit-top" style={{ ...textStyle, height: tileH }}>
          {char}
        </div>

        {/* Animated flap: old digit rotating away */}
        {flipping && (
          <div
            key={`flap-${animKey}`}
            className="fbt-flap fbt-flap--run"
            style={{ borderRadius: `${br}px ${br}px 0 0` }}
          >
            <div className="fbt-digit-top" style={{ ...textStyle, height: tileH }}>
              {fromChar}
            </div>
          </div>
        )}
      </div>

      {/* ── Hinge seam ── */}
      <div className="fbt-seam" style={{ height: seam, width: tileW }} />

      {/* ── Bottom half ── */}
      <div
        className="fbt-bottom"
        style={{
          height: halfH,
          borderRadius: `0 0 ${br}px ${br}px`,
        }}
      >
        {/* Static current digit bottom */}
        <div className="fbt-digit-bottom" style={{ ...textStyle, height: tileH }}>
          {char}
        </div>

        {/* Reveal panel: new digit swinging in */}
        {flipping && (
          <div
            key={`reveal-${animKey}`}
            className="fbt-reveal fbt-reveal--run"
            style={{ borderRadius: `0 0 ${br}px ${br}px` }}
          >
            <div className="fbt-digit-bottom" style={{ ...textStyle, height: tileH }}>
              {char}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Tile size config ─────────────────────────────────────────────────────────
const SIZE_CONFIG = {
  sm: { tileW: 30, tileH: 42, fontSize: 22, gapPx: 3, sepSize: 20 },
  /** md = near-full-width mobile hero counter — fills ~342px for 8 digits + 2 seps on 390px viewport */
  md: { tileW: 36, tileH: 52, fontSize: 26, gapPx: 2, sepSize: 18 },
  lg: { tileW: 56, tileH: 78, fontSize: 40, gapPx: 5, sepSize: 38 },
  /** xl = 2× lg — used for desktop prize pot display */
  xl: { tileW: 112, tileH: 156, fontSize: 80, gapPx: 10, sepSize: 76 },
};

// ─── Public component ─────────────────────────────────────────────────────────
export interface FlipBoardCounterProps {
  /** Pre-formatted amount string e.g. "1,234.56" (no leading $) */
  value: string;
  /** "sm" = mobile card (small), "md" = mobile hero (near-full-width), "lg" = desktop counter, "xl" = 2× desktop */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Gold accent color for board border/glow and separator glyphs */
  accentColor?: string;
  className?: string;
  /** When true, scales the board down to fit its container width (never clips) */
  fitWidth?: boolean;
}

const SEPARATORS = new Set(['$', ',', '.', ' ']);

/**
 * Scales its child down (never up) so the board always fits the available
 * width, regardless of digit count or viewport. Prevents the leading/trailing
 * tiles from being clipped by a narrower ancestor.
 */
function FitToWidth({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [boxH, setBoxH] = useState<number | undefined>(undefined);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const compute = () => {
      const avail = outer.clientWidth;
      const natW = inner.offsetWidth;
      const natH = inner.offsetHeight;
      const s = natW > 0 ? Math.min(1, avail / natW) : 1;
      setScale(s);
      setBoxH(natH * s);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      style={{ width: '100%', height: boxH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        ref={innerRef}
        style={{ transform: `scale(${scale})`, transformOrigin: 'center center', display: 'inline-flex', flexShrink: 0 }}
      >
        {children}
      </div>
    </div>
  );
}

export function FlipBoardCounter({
  value,
  size = 'sm',
  accentColor = '#C8962A',
  className = '',
  fitWidth = false,
}: FlipBoardCounterProps) {
  useEffect(() => { injectFlipCSS(); }, []);

  const { tileW, tileH, fontSize, gapPx, sepSize } = SIZE_CONFIG[size];

  const chars = value.split('');

  // Faint gold glow border
  const glowColor = accentColor + '44';

  const board = (
    <div
      className={`inline-flex items-center flex-nowrap justify-center ${className}`}
      style={{
        gap: `${gapPx}px`,
        padding: size === 'xl' ? '20px 28px' : size === 'lg' ? '10px 14px' : size === 'md' ? '7px 10px' : '6px 9px',
        borderRadius: size === 'xl' ? 26 : size === 'lg' ? 13 : size === 'md' ? 10 : 9,
        background: 'rgba(8,8,12,0.97)',
        border: `1.5px solid ${accentColor}55`,
        boxShadow: `0 0 ${size === 'xl' ? 56 : size === 'lg' ? 28 : size === 'md' ? 20 : 16}px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      {chars.map((char, i) => {
        // Stable key per position index — tiles never reorder
        const key = `tile-${i}`;

        if (SEPARATORS.has(char)) {
          if (char === ' ') return null;
          return (
            <span
              key={key}
              style={{
                fontSize: `${sepSize}px`,
                fontWeight: 800,
                color: accentColor,
                lineHeight: 1,
                opacity: 0.8,
                userSelect: 'none',
                alignSelf: 'center',
                flexShrink: 0,
              }}
            >
              {char}
            </span>
          );
        }

        return (
          <FlipTile
            key={key}
            char={char}
            tileW={tileW}
            tileH={tileH}
            fontSize={fontSize}
          />
        );
      })}
    </div>
  );

  return fitWidth ? <FitToWidth>{board}</FitToWidth> : board;
}
