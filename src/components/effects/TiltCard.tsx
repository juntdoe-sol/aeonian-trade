import { cn } from '@/lib/utils';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Max tilt angle in degrees. Default 8. */
  maxTilt?: number;
  /** Perspective in px. Default 1000. */
  perspective?: number;
  /** Glare overlay on tilt. Default true. */
  glare?: boolean;
  /** Max glare opacity 0–1. Default 0.15. */
  glareOpacity?: number;
  /** Glare color. Default white. */
  glareColor?: string;
  /** Transition speed in ms. Default 300. */
  speed?: number;
}

/**
 * 3D tilt-on-hover card wrapper — wrap any card content.
 *
 * ```tsx
 * <TiltCard className="rounded-xl border bg-card p-6">
 *   card content
 * </TiltCard>
 * ```
 */
export function TiltCard({
  children,
  className,
  maxTilt = 8,
  perspective = 1000,
  glare = true,
  glareOpacity = 0.15,
  glareColor = 'white',
  speed = 300,
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState('rotateX(0deg) rotateY(0deg)');
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const tiltX = (0.5 - y) * maxTilt * 2;
    const tiltY = (x - 0.5) * maxTilt * 2;

    setTransform(`rotateX(${tiltX}deg) rotateY(${tiltY}deg)`);
    setGlarePos({ x: x * 100, y: y * 100 });
  };

  const handleLeave = () => {
    setTransform('rotateX(0deg) rotateY(0deg)');
    setIsHovered(false);
  };

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      style={{
        perspective: `${perspective}px`,
        transform,
        transition: `transform ${speed}ms ease-out`,
        transformStyle: 'preserve-3d',
      }}
      onMouseMove={handleMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleLeave}
    >
      {children}
      {glare && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, ${glareColor}, transparent 60%)`,
            opacity: isHovered ? glareOpacity : 0,
            transition: `opacity ${speed}ms ease-out`,
          }}
        />
      )}
    </div>
  );
}
