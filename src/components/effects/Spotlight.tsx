import { cn } from '@/lib/utils';

interface SpotlightProps {
  className?: string;
  /** Fill color. Default uses primary theme color. */
  fill?: string;
  /** Scale multiplier for the spotlight size. Default 1. */
  size?: number;
  /** Base fill opacity 0–1. Default 0.21. Higher = more intense. */
  intensity?: number;
  /** Pulse animation duration in seconds. Default 4. Set 0 to disable pulse. */
  pulseDuration?: number;
}

/**
 * Radial spotlight glow — place inside a `relative` container.
 * Animates in on mount, then gently pulses.
 *
 * ```tsx
 * <section className="relative min-h-[60vh]">
 *   <Spotlight fill="hsl(var(--primary))" />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export function Spotlight({
  className,
  fill = 'hsl(var(--primary))',
  size = 1,
  intensity = 0.21,
  pulseDuration = 4,
}: SpotlightProps) {
  const pulseMax = Math.min(intensity * 1.5, 1);

  return (
    <svg
      className={cn(
        'pointer-events-none absolute z-[1] animate-spotlight opacity-0',
        className,
      )}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3787 2842"
      fill="none"
      style={{
        animationFillMode: 'forwards',
        width: `${140 * size}%`,
        height: `${160 * size}%`,
      }}
    >
      <g filter="url(#spotlight-filter)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity={intensity}
        >
          {pulseDuration > 0 && (
            <animate
              attributeName="fill-opacity"
              values={`${intensity};${pulseMax};${intensity}`}
              dur={`${pulseDuration}s`}
              begin="2s"
              repeatCount="indefinite"
            />
          )}
        </ellipse>
      </g>
      <defs>
        <filter
          id="spotlight-filter"
          x="0.860352"
          y="0.838989"
          width="3785.16"
          height="2840.26"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="blur" />
        </filter>
      </defs>
    </svg>
  );
}
