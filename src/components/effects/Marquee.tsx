import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef } from 'react';

interface MarqueeProps extends ComponentPropsWithoutRef<'div'> {
  /** Reverse scroll direction. */
  reverse?: boolean;
  /** Pause on hover. */
  pauseOnHover?: boolean;
  /** Scroll vertically instead of horizontally. */
  vertical?: boolean;
  /** How many times to duplicate children for seamless loop. Default 4. */
  repeat?: number;
  children: React.ReactNode;
}

/**
 * Infinite scrolling marquee — logos, testimonials, social proof.
 *
 * ```tsx
 * <Marquee pauseOnHover>
 *   <img src="logo1.svg" />
 *   <img src="logo2.svg" />
 * </Marquee>
 * ```
 */
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  vertical = false,
  repeat = 4,
  children,
  ...props
}: MarqueeProps) {
  return (
    <div
      {...props}
      className={cn(
        'group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]',
        vertical ? 'flex-col' : 'flex-row',
        className,
      )}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex shrink-0 justify-around [gap:var(--gap)]',
            vertical ? 'animate-marquee-vertical flex-col' : 'animate-marquee flex-row',
            pauseOnHover && 'group-hover:[animation-play-state:paused]',
            reverse && '[animation-direction:reverse]',
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
