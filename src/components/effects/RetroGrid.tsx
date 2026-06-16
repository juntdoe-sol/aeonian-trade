import { cn } from '@/lib/utils';

interface RetroGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Perspective angle in degrees. Default 65. */
  angle?: number;
  /** Grid cell size in px. Default 60. */
  cellSize?: number;
  /** Overall opacity. Default 0.5. */
  opacity?: number;
  /** Grid line color. Default uses border theme color. */
  color?: string;
  /** Grid scroll speed multiplier. Default 1. Higher = faster. */
  speed?: number;
  /** Grid line width in px. Default 1. */
  lineWidth?: number;
}

/**
 * Perspective grid background — synthwave/retro/vaporwave aesthetic.
 * Place inside a `relative` container.
 *
 * ```tsx
 * <section className="relative min-h-[60vh]">
 *   <RetroGrid angle={65} />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export function RetroGrid({
  className,
  angle = 65,
  cellSize = 60,
  opacity = 0.5,
  color,
  speed = 1,
  lineWidth = 1,
  ...props
}: RetroGridProps) {
  const lineColor = color ?? 'hsl(var(--border))';
  const dur = `${15 / speed}s`;

  return (
    <div
      className={cn(
        'pointer-events-none absolute size-full overflow-hidden [perspective:200px]',
        className,
      )}
      style={{ opacity }}
      {...props}
    >
      <div
        className="absolute inset-0"
        style={{ transform: `rotateX(${angle}deg)` }}
      >
        <div
          style={{
            height: '300vh',
            width: '600vw',
            marginLeft: '-200%',
            transformOrigin: '100% 0 0',
            backgroundImage: `linear-gradient(to right, ${lineColor} ${lineWidth}px, transparent 0), linear-gradient(to bottom, ${lineColor} ${lineWidth}px, transparent 0)`,
            backgroundSize: `${cellSize}px ${cellSize}px`,
            backgroundRepeat: 'repeat',
            imageRendering: 'auto',
            willChange: 'transform',
            animation: `grid ${dur} linear infinite`,
          }}
        />
      </div>
      {/* Fade out at horizon and bottom to prevent hard edges */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, hsl(var(--background)) 5%, transparent 30%, transparent 85%, hsl(var(--background)) 100%)`,
        }}
      />
    </div>
  );
}
