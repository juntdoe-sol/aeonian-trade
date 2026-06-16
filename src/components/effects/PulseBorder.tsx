import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface PulseBorderProps {
  children: ReactNode;
  className?: string;
  /** Glow color. Default uses primary. */
  color?: string;
  /** Pulse animation duration in seconds. Default 2. */
  duration?: number;
  /** Glow spread in px. Default 8. */
  spread?: number;
  /** Border radius. Default "inherit". */
  borderRadius?: string;
}

/**
 * Pulsing glow border — wrap any card/element for an animated glow outline.
 *
 * ```tsx
 * <PulseBorder className="rounded-xl">
 *   <div className="rounded-xl bg-card p-6">content</div>
 * </PulseBorder>
 * ```
 */
export function PulseBorder({
  children,
  className,
  color,
  duration = 2,
  spread = 8,
  borderRadius = 'inherit',
}: PulseBorderProps) {
  const glowColor = color ?? 'hsl(var(--primary))';

  return (
    <div
      className={cn('relative', className)}
      style={{ borderRadius }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          boxShadow: `0 0 ${spread}px ${glowColor}, inset 0 0 ${spread}px ${glowColor}`,
          animation: `pulse-border ${duration}s ease-in-out infinite`,
          borderRadius,
        }}
      />
      <style>{`
        @keyframes pulse-border {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
      {children}
    </div>
  );
}
