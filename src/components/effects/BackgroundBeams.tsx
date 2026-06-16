import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import { useMemo } from 'react';

interface BackgroundBeamsProps {
  className?: string;
  /** Beam color. Default uses primary. */
  color?: string;
  /** Number of beams. Default 12. */
  count?: number;
  /** Speed multiplier. Default 1. Higher = faster beams. */
  speed?: number;
  /** Beam stroke width. Default 1.5. */
  thickness?: number;
  /** Peak beam opacity 0–1. Default 0.8. */
  intensity?: number;
}

/**
 * Sweeping gradient beams — place inside a `relative` container.
 * Beams flow across the full area with staggered timing.
 *
 * ```tsx
 * <section className="relative min-h-[60vh]">
 *   <BackgroundBeams />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export function BackgroundBeams({
  className,
  color,
  count = 12,
  speed = 1,
  thickness = 1.5,
  intensity = 0.8,
}: BackgroundBeamsProps) {
  const beamColor = color ?? 'hsl(var(--primary))';

  const paths = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const startX = -100 + (i / count) * 400;
      const startY = -50 - i * 20;
      const cp1x = startX + 200 + Math.sin(i) * 100;
      const cp1y = startY + 300;
      const cp2x = startX + 400 + Math.cos(i) * 100;
      const cp2y = startY + 600;
      const endX = startX + 300 + i * 30;
      const endY = startY + 900;
      return `M${startX} ${startY}C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${endX} ${endY}`;
    });
  }, [count]);

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="-100 -200 1000 1200"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {paths.map((d, i) => (
          <motion.path
            key={i}
            d={d}
            stroke={`url(#beam-g-${i})`}
            strokeWidth={thickness}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{
              pathLength: [0, 1],
              opacity: [0, intensity, intensity * 0.6, 0],
            }}
            transition={{
              duration: (3 + (i % 4) * 0.5) / speed,
              ease: 'easeInOut',
              repeat: Infinity,
              repeatDelay: (0.5 + (i % 3) * 0.8) / speed,
              delay: (i * 0.3) / speed,
            }}
          />
        ))}
        <defs>
          {paths.map((_, i) => (
            <linearGradient
              key={i}
              id={`beam-g-${i}`}
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor={beamColor} stopOpacity="0" />
              <stop offset="30%" stopColor={beamColor} stopOpacity="0.7" />
              <stop offset="70%" stopColor={beamColor} stopOpacity="0.7" />
              <stop offset="100%" stopColor={beamColor} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
      </svg>
    </div>
  );
}
