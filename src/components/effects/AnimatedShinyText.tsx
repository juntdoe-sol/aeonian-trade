import type { ComponentPropsWithoutRef, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<'span'> {
  /** Width of the shimmer highlight in px. Default 100. */
  shimmerWidth?: number;
  /** Animation duration in seconds. Default 8. */
  speed?: number;
  /** Shimmer color. Default uses foreground at 80% opacity. Pass any CSS color. */
  color?: string;
}

/**
 * Inline text with a sweeping shimmer highlight — great for badges, labels, CTAs.
 *
 * ```tsx
 * <div className="inline-flex items-center rounded-full border px-4 py-1.5">
 *   <AnimatedShinyText>✨ Introducing v2.0</AnimatedShinyText>
 * </div>
 * ```
 */
export function AnimatedShinyText({
  children,
  className,
  shimmerWidth = 100,
  speed = 8,
  color,
  ...props
}: AnimatedShinyTextProps) {
  const shimmerColor = color ?? 'hsl(var(--foreground) / 0.8)';

  return (
    <span
      style={{
        '--shiny-width': `${shimmerWidth}px`,
        animationDuration: `${speed}s`,
      } as CSSProperties}
      className={cn(
        'animate-shiny-text bg-clip-text bg-no-repeat [background-position:0_0] [background-size:var(--shiny-width)_100%] [transition:background-position_1s_cubic-bezier(.6,.6,0,1)_infinite]',
        className,
      )}
      {...props}
    >
      <span
        style={{
          backgroundImage: `linear-gradient(to right, transparent, ${shimmerColor}, transparent)`,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          backgroundSize: 'var(--shiny-width) 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'inherit',
        }}
      >
        {children}
      </span>
    </span>
  );
}
