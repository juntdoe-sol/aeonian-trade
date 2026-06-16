import React, { type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface RippleProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Size of the innermost circle in px. Default 210. */
  mainCircleSize?: number;
  /** Opacity of the innermost circle. Default 0.24. */
  mainCircleOpacity?: number;
  /** Number of concentric circles. Default 8. */
  numCircles?: number;
  /** Circle color. Default uses primary. */
  color?: string;
}

/**
 * Concentric ripple circles — place inside a `relative` container.
 * Non-cosmic alternative background, great for clean/corporate/fintech vibes.
 *
 * ```tsx
 * <section className="relative h-[500px]">
 *   <Ripple />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export const Ripple = React.memo(function Ripple({
  mainCircleSize = 210,
  mainCircleOpacity = 0.24,
  numCircles = 8,
  color,
  className,
  ...props
}: RippleProps) {
  const circleColor = color ?? 'hsl(var(--primary))';

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 select-none [mask-image:linear-gradient(to_bottom,white,transparent)]',
        className,
      )}
      {...props}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 70;
        const opacity = mainCircleOpacity - i * 0.03;
        const borderOpacity = 0.08 + i * 0.04;

        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              opacity,
              backgroundColor: circleColor,
              borderStyle: i === numCircles - 1 ? 'dashed' : 'solid',
              borderWidth: '1px',
              borderColor: circleColor,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%) scale(1)',
              animation: `ripple 3.5s ease-in-out ${i * 0.06}s infinite`,
              filter: `opacity(${borderOpacity})`,
            } as CSSProperties}
          />
        );
      })}
    </div>
  );
});
