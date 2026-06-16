import { cn } from '@/lib/utils';
import { motion, useMotionTemplate, useMotionValue, useSpring } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';

interface GlowingStarsProps {
  children?: React.ReactNode;
  className?: string;
  /** Number of stars. Default 20. */
  count?: number;
  /** Star and glow color. Default uses primary. */
  color?: string;
  /** Star size in px. Default 4 (renders as w-1/h-1). */
  starSize?: number;
  /** Glow radius in px. Default 400. */
  glowSize?: number;
}

interface Star {
  x: number;
  y: number;
  delay: number;
  id: number;
}

/**
 * Card with star sparkle effect on hover.
 *
 * ```tsx
 * <GlowingStars>
 *   card content
 * </GlowingStars>
 * ```
 */
export function GlowingStars({
  children,
  className,
  count = 20,
  color,
  starSize = 4,
  glowSize = 400,
}: GlowingStarsProps) {
  const starColor = color ?? 'hsl(var(--primary))';
  const [hovered, setHovered] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 300, damping: 30 });
  const springY = useSpring(mouseY, { stiffness: 300, damping: 30 });
  const glowBackground = useMotionTemplate`radial-gradient(${glowSize}px circle at ${springX}px ${springY}px, ${starColor}20, transparent 60%)`;

  const stars: Star[] = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: Math.random() * 2,
        id: i,
      })),
    [count],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  return (
    <div
      className={cn('relative overflow-hidden rounded-lg border border-border bg-card', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={onMouseMove}
    >
      <motion.div
        className="pointer-events-none absolute -inset-px z-0 opacity-0 transition-opacity duration-300"
        style={{
          background: glowBackground,
          opacity: hovered ? 1 : 0,
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-0">
        {stars.map((star) => (
          <motion.div
            key={star.id}
            className="absolute rounded-full"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: starSize,
              height: starSize,
              backgroundColor: starColor,
            }}
            animate={
              hovered
                ? { opacity: [0, 1, 0], scale: [0, 1.2, 0] }
                : { opacity: 0, scale: 0 }
            }
            transition={{
              duration: 1.5,
              delay: star.delay,
              repeat: hovered ? Infinity : 0,
              repeatDelay: 1,
            }}
          />
        ))}
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
