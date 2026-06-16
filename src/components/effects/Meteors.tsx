import { cn } from '@/lib/utils';
import { useMemo } from 'react';

interface MeteorsProps {
  /** Number of meteors. Default 20. */
  count?: number;
  /** Meteor color. Default uses primary. */
  color?: string;
  /** Spawn area. "top" = top edge only, "full" = top + right edges for fuller coverage. Default "top". */
  spread?: 'top' | 'full';
  /** Speed multiplier. Default 1. Higher = faster meteors. */
  speed?: number;
  /** Trail length class. Default "before:w-12". Pass a Tailwind width like "before:w-20" for longer trails. */
  trailClass?: string;
  className?: string;
}

/**
 * Falling meteor trails — place inside a `relative` container.
 *
 * ```tsx
 * <section className="relative min-h-[60vh]">
 *   <Meteors count={20} />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export function Meteors({
  count = 20,
  color,
  spread = 'top',
  speed = 1,
  trailClass = 'before:w-12',
  className,
}: MeteorsProps) {
  const meteorColor = color ?? 'hsl(var(--primary))';
  const baseDuration = 2 / speed;
  const durationRange = 3 / speed;

  const meteors = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const fromRight = spread === 'full' && i % 3 === 0;
      return {
        id: i,
        left: fromRight ? '105%' : `${Math.random() * 100}%`,
        top: fromRight ? `${Math.random() * 60}%` : '-5%',
        delay: `${Math.random() * 1 + 0.2}s`,
        duration: `${Math.random() * durationRange + baseDuration}s`,
      };
    });
  }, [count, spread, baseDuration, durationRange]);

  return (
    <>
      {meteors.map((m) => (
        <span
          key={m.id}
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-0.5 rotate-[215deg] rounded-full',
            'before:absolute before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-gradient-to-r before:from-current before:to-transparent before:content-[""]',
            trailClass,
            'animate-meteor',
            className,
          )}
          style={{
            top: m.top,
            left: m.left,
            animationDelay: m.delay,
            animationDuration: m.duration,
            color: meteorColor,
            backgroundColor: meteorColor,
            boxShadow: `0 0 0 1px ${meteorColor}20`,
          }}
        />
      ))}
    </>
  );
}
