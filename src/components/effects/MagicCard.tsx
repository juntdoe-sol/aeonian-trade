import { motion, useMotionTemplate, useMotionValue } from 'motion/react';
import React, { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface MagicCardProps {
  children?: React.ReactNode;
  className?: string;
  /** Radius of the gradient spotlight in px. Default 200. */
  gradientSize?: number;
  /** Inner fill color on hover. Default uses background. */
  gradientColor?: string;
  /** Opacity of inner fill. Default 0.8. */
  gradientOpacity?: number;
  /** Border gradient start color. */
  gradientFrom?: string;
  /** Border gradient end color. */
  gradientTo?: string;
}

/**
 * Card with mouse-following gradient border glow.
 *
 * ```tsx
 * <MagicCard gradientFrom="hsl(var(--primary))" gradientTo="hsl(var(--accent))">
 *   card content
 * </MagicCard>
 * ```
 */
export function MagicCard({
  children,
  className,
  gradientSize = 200,
  gradientColor = 'hsl(var(--muted))',
  gradientOpacity = 0.8,
  gradientFrom = 'hsl(var(--primary))',
  gradientTo = 'hsl(var(--accent))',
}: MagicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (cardRef.current) {
        const { left, top } = cardRef.current.getBoundingClientRect();
        mouseX.set(e.clientX - left);
        mouseY.set(e.clientY - top);
      }
    },
    [mouseX, mouseY],
  );

  const handleMouseOut = useCallback(() => {
    mouseX.set(-gradientSize);
    mouseY.set(-gradientSize);
  }, [mouseX, mouseY, gradientSize]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('mouseleave', handleMouseOut);
    return () => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseleave', handleMouseOut);
    };
  }, [handleMouseMove, handleMouseOut]);

  return (
    <div ref={cardRef} className={cn('group relative rounded-xl', className)}>
      {/* Gradient border layer */}
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: useMotionTemplate`
            radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
              ${gradientFrom}, ${gradientTo}, hsl(var(--border)) 100%)
          `,
        }}
      />
      {/* Background fill */}
      <div className="absolute inset-px rounded-[inherit] bg-background" />
      {/* Inner glow */}
      <motion.div
        className="pointer-events-none absolute inset-px rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: useMotionTemplate`
            radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 100%)
          `,
          opacity: gradientOpacity,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
