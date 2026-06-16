import * as React from 'react';
import { cn } from '@/lib/utils';

interface ShineBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Border width in px. Default 1.5. */
  borderWidth?: number;
  /** Animation duration in seconds. Default 8. */
  duration?: number;
  /** Shine color(s). Accepts a single color or array. Default uses primary. */
  shineColor?: string | string[];
}

/**
 * Animated shining border overlay — place inside a `relative` container.
 *
 * ```tsx
 * <div className="relative rounded-xl border bg-card p-6">
 *   <ShineBorder shineColor={['hsl(var(--primary))', 'hsl(var(--accent))']} />
 *   card content
 * </div>
 * ```
 */
export function ShineBorder({
  borderWidth = 1.5,
  duration = 8,
  shineColor = 'hsl(var(--primary))',
  className,
  style,
  ...props
}: ShineBorderProps) {
  const colors = Array.isArray(shineColor) ? shineColor.join(',') : shineColor;

  return (
    <div
      style={{
        '--shine-border-width': `${borderWidth}px`,
        backgroundImage: `radial-gradient(transparent, transparent, ${colors}, transparent, transparent)`,
        backgroundSize: '300% 300%',
        mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        padding: 'var(--shine-border-width)',
        animation: `shine ${duration}s infinite linear`,
        ...style,
      } as React.CSSProperties}
      className={cn(
        'pointer-events-none absolute inset-0 size-full rounded-[inherit] will-change-[background-position]',
        className,
      )}
      {...props}
    />
  );
}
