import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef } from 'react';

interface ShootingStarsProps {
  /** Min speed in px/frame. Default 6. */
  minSpeed?: number;
  /** Max speed in px/frame. Default 12. */
  maxSpeed?: number;
  /** Min delay between stars in ms. Default 400. */
  minDelay?: number;
  /** Max delay between stars in ms. Default 1200. */
  maxDelay?: number;
  /** Star/trail color. Default uses primary. */
  color?: string;
  /** Trail length in px. Default 80. */
  trailLength?: number;
  className?: string;
}

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

/**
 * Animated shooting stars on canvas — place inside a `relative` container.
 *
 * ```tsx
 * <section className="relative min-h-[60vh]">
 *   <ShootingStars />
 *   <div className="relative z-10">content</div>
 * </section>
 * ```
 */
export function ShootingStars({
  minSpeed = 6,
  maxSpeed = 12,
  minDelay = 400,
  maxDelay = 1200,
  color,
  trailLength = 80,
  className,
}: ShootingStarsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const nextSpawnRef = useRef(0);

  const starColor = color ?? 'hsl(var(--primary))';

  const spawn = useCallback(
    (w: number) => {
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      // Angle: 200–240° = down-right to down-left diagonal
      const angleDeg = 200 + Math.random() * 40;
      const angle = angleDeg * (Math.PI / 180);
      // Spawn along top edge or right edge
      const fromTop = Math.random() > 0.3;
      starsRef.current.push({
        x: fromTop ? Math.random() * w : w + 10,
        y: fromTop ? -10 : Math.random() * 100,
        vx: Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed, // negate because canvas y goes down
        life: 0,
        maxLife: 60 + Math.random() * 40,
      });
    },
    [minSpeed, maxSpeed],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let frame = 0;

    // Resolve CSS color to computed value
    const resolveColor = () => {
      const temp = document.createElement('div');
      temp.style.color = starColor;
      document.body.appendChild(temp);
      const resolved = getComputedStyle(temp).color;
      document.body.removeChild(temp);
      return resolved;
    };

    let resolvedColor = resolveColor();
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resolvedColor = resolveColor();
    };
    resize();
    window.addEventListener('resize', resize);

    // Spawn first star quickly
    nextSpawnRef.current = 5;

    const animate = () => {
      frame++;
      ctx.clearRect(0, 0, w, h);

      // Spawn
      if (frame >= nextSpawnRef.current) {
        spawn(w);
        nextSpawnRef.current =
          frame + (minDelay + Math.random() * (maxDelay - minDelay)) / 16;
      }

      // Update & draw
      const alive: Star[] = [];
      for (const s of starsRef.current) {
        s.x += s.vx;
        s.y += s.vy;
        s.life++;

        if (s.x < -100 || s.x > w + 100 || s.y > h + 100 || s.y < -100 || s.life > s.maxLife)
          continue;

        const progress = s.life / s.maxLife;
        const alpha = progress < 0.1 ? progress * 10 : progress > 0.7 ? (1 - progress) / 0.3 : 1;

        // Trail
        const speed = Math.hypot(s.vx, s.vy);
        const tailX = s.x - (s.vx / speed) * trailLength;
        const tailY = s.y - (s.vy / speed) * trailLength;

        const gradient = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(1, resolvedColor);

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();

        // Head glow
        ctx.fillStyle = resolvedColor;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
        ctx.fill();

        alive.push(s);
      }
      ctx.globalAlpha = 1;
      starsRef.current = alive;

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [starColor, minDelay, maxDelay, trailLength, spawn]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    />
  );
}
