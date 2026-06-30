import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCelebrateStore } from '@/utils/celebrate';

const COIN_IMAGE_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3b55c773d40151ea778634';

// Preload the coin image at module load time so it is cached before the first burst.
if (typeof window !== 'undefined') {
  const preload = new Image();
  preload.src = COIN_IMAGE_URL;
}

const TOTAL_MS = 2000;
const FADE_IN_MS = 160;
const FADE_OUT_MS = 500;
const FADE_OUT_START_MS = TOTAL_MS - FADE_OUT_MS;

// Each coin gets a deterministic config derived from its index at burst time.
interface CoinConfig {
  id: number;
  left: number;   // vw percent
  size: number;   // px
  delay: number;  // ms
  drift: number;  // extra horizontal drift in px
  spin: number;   // rotation degrees over duration
}

function makeCoinConfigs(seed: number): CoinConfig[] {
  // 18 coins spread across the viewport
  const count = 18;
  return Array.from({ length: count }, (_, i) => {
    // Pseudo-random but deterministic per burst + per coin index
    const r = (seed * 31 + i * 137 + i * i * 7) % 1000 / 1000;
    const r2 = (seed * 17 + i * 53 + i * 3) % 1000 / 1000;
    const r3 = (seed * 41 + i * 89) % 1000 / 1000;
    return {
      id: i,
      left: 3 + r * 94,           // 3–97vw
      size: 32 + r2 * 36,         // 32–68px
      delay: r3 * 300,            // 0–300ms stagger
      drift: (r - 0.5) * 60,      // -30 to +30px horizontal drift
      spin: 120 + r2 * 240,       // 120–360 degrees of rotation
    };
  });
}

export function CoinRainBurst() {
  const celebrateCount = useCelebrateStore((s) => s.celebrateCount);
  const [active, setActive] = useState(false);
  const [opacity, setOpacity] = useState(0);
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  };

  useEffect(() => {
    if (celebrateCount === 0) return;

    // Cancel any in-progress burst and restart
    clearTimers();
    setCoins(makeCoinConfigs(celebrateCount));
    setActive(true);
    setOpacity(0);

    // Fade in
    timerRefs.current.push(setTimeout(() => setOpacity(1), 16));

    // Start fade-out
    timerRefs.current.push(setTimeout(() => setOpacity(0), FADE_OUT_START_MS));

    // Remove from DOM after full fade-out
    timerRefs.current.push(setTimeout(() => {
      setActive(false);
    }, TOTAL_MS + 80));

    return () => clearTimers();
  }, [celebrateCount]);

  if (!active) return null;

  // Mount directly onto document.body via a portal so the overlay escapes any
  // overflow:hidden or stacking-context ancestor in the React tree (e.g. #root,
  // #app-container). This is required on iOS Safari where a fixed-position
  // descendant of an overflow:hidden ancestor can be silently clipped.
  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity,
        transition: opacity === 0
          ? `opacity ${FADE_OUT_MS}ms ease-in`
          : `opacity ${FADE_IN_MS}ms ease-out`,
      }}
    >
      {coins.map((coin) => (
        <CoinParticle key={coin.id} coin={coin} />
      ))}
    </div>,
    document.body,
  );
}

interface CoinParticleProps {
  coin: CoinConfig;
}

function CoinParticle({ coin }: CoinParticleProps) {
  // Each coin falls from slightly above the viewport to ~80vh down,
  // with a gentle horizontal drift and rotation, all via CSS animation.
  const duration = TOTAL_MS - coin.delay;
  const animId = `coin-fall-${coin.id}`;

  return (
    <div
      style={{
        position: 'absolute',
        top: '-80px',
        left: `${coin.left}vw`,
        width: coin.size,
        height: coin.size,
        animationName: animId,
        animationDuration: `${duration}ms`,
        animationDelay: `${coin.delay}ms`,
        animationTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        animationFillMode: 'both',
      }}
    >
      <style>{`
        @keyframes ${animId} {
          from {
            transform: translateY(0px) translateX(0px) rotate(0deg);
            opacity: 0.95;
          }
          15% {
            opacity: 1;
          }
          to {
            transform: translateY(85vh) translateX(${coin.drift}px) rotate(${coin.spin}deg);
            opacity: 0.7;
          }
        }
      `}</style>
      <img
        src={COIN_IMAGE_URL}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          userSelect: 'none',
          filter: 'drop-shadow(0 4px 12px rgba(255,200,50,0.35))',
        }}
      />
    </div>
  );
}
