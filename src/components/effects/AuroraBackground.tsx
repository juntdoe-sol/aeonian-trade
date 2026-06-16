import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

interface AuroraBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  /** Show radial mask to soften edges. Default true. */
  showRadialGradient?: boolean;
  /** Aurora color. Default uses primary. Pass any CSS color. */
  color?: string;
  /** Blur intensity in px. Default 60. Higher = softer/more diffuse. */
  blur?: number;
  /** Overall opacity 0–1. Default 0.8. */
  intensity?: number;
  /** Animation speed multiplier. Default 1. Lower = slower. */
  speed?: number;
}

/**
 * Northern-lights gradient background — place inside a `relative` container.
 *
 * ```tsx
 * <section className="relative min-h-[60vh]">
 *   <AuroraBackground />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export function AuroraBackground({
  children,
  className,
  showRadialGradient = true,
  color,
  blur = 60,
  intensity = 0.8,
  speed = 1,
}: AuroraBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [resolvedColor, setResolvedColor] = useState<string | null>(null);
  const rawColor = color ?? 'hsl(var(--primary))';

  // Resolve CSS variable colors to usable rgb values
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const temp = document.createElement('div');
    temp.style.color = rawColor;
    el.appendChild(temp);
    const rgb = getComputedStyle(temp).color;
    el.removeChild(temp);
    setResolvedColor(rgb);
  }, [rawColor]);

  const dur = `${8 / speed}s`;

  // Build gradients using resolved color with varying opacity
  const makeGrad = (opacities: number[]) => {
    if (!resolvedColor) return 'none';
    // resolvedColor is like "rgb(R, G, B)" — convert to rgba
    const base = resolvedColor.replace('rgb(', '').replace(')', '');
    return `repeating-linear-gradient(100deg, ${opacities.map((o, i) => `rgba(${base}, ${o}) ${10 + i * 5}%`).join(', ')})`;
  };

  const grad1 = makeGrad([0.6, 0.3, 0.5, 0.2, 0.4]);
  const grad2 = makeGrad([0.5, 0.2, 0.4, 0.1, 0.3]);

  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)}>
      <div
        className={cn(
          'pointer-events-none absolute inset-0',
          '[background-size:300%_200%] saturate-200',
          showRadialGradient &&
            '[mask-image:radial-gradient(ellipse_at_50%_50%,black_30%,transparent_70%)]',
        )}
        style={{
          backgroundImage: grad1,
          opacity: intensity,
          filter: `blur(${blur}px)`,
          animation: `aurora ${dur} ease-in-out infinite`,
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 mix-blend-plus-lighter',
          showRadialGradient &&
            '[mask-image:radial-gradient(ellipse_at_50%_50%,black_30%,transparent_70%)]',
        )}
        style={{
          backgroundImage: grad2,
          backgroundSize: '200% 100%',
          opacity: intensity * 0.75,
          filter: `blur(${blur * 1.5}px)`,
          animation: `aurora ${dur} ease-in-out infinite`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
