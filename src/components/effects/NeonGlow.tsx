import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface NeonGlowProps {
  children: ReactNode;
  className?: string;
  /** Glow color. Default uses primary. */
  color?: string;
  /** Glow intensity/spread in px. Default 20. */
  spread?: number;
  /** Enable pulse animation. Default true. */
  pulse?: boolean;
  /** Pulse duration in seconds. Default 2. */
  pulseDuration?: number;
  /** Apply as text glow (text-shadow) instead of box glow (box-shadow). Default false. */
  text?: boolean;
}

/**
 * Neon glow wrapper — adds a colored glow to any element or text.
 *
 * ```tsx
 * <NeonGlow>
 *   <h2 className="text-4xl font-bold">Glowing Title</h2>
 * </NeonGlow>
 * ```
 */
export function NeonGlow({
  children,
  className,
  color,
  spread = 20,
  pulse = true,
  pulseDuration = 2,
  text = false,
}: NeonGlowProps) {
  const glowColor = color ?? 'hsl(var(--primary))';

  const glowStyle = text
    ? {
        textShadow: `0 0 ${spread / 2}px ${glowColor}, 0 0 ${spread}px ${glowColor}, 0 0 ${spread * 2}px ${glowColor}`,
      }
    : {
        filter: `drop-shadow(0 0 ${spread / 2}px ${glowColor}) drop-shadow(0 0 ${spread}px ${glowColor})`,
      };

  return (
    <div
      className={cn('relative inline-block', className)}
      style={{
        ...glowStyle,
        animation: pulse ? `neon-pulse ${pulseDuration}s ease-in-out infinite` : undefined,
      }}
    >
      <style>{`
        @keyframes neon-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
      {children}
    </div>
  );
}
