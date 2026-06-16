import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef } from 'react';

interface ParticlesProps {
  /** Number of particles. Default 50. */
  quantity?: number;
  /** Particle color. Default uses primary. */
  color?: string;
  /** Particle size. Default 2. */
  size?: number;
  /** Enable mouse interaction. Default true. */
  interactive?: boolean;
  /** Movement speed. Default 0.3. */
  speed?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  targetAlpha: number;
}

function hexFromHsl(hslStr: string): [number, number, number] {
  // Parse "H S% L%" or just return white as fallback
  const match = hslStr.match(/(\d+\.?\d*)\s+(\d+\.?\d*)%?\s+(\d+\.?\d*)%?/);
  if (!match) return [255, 255, 255];
  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

export function Particles({
  quantity = 50,
  color,
  size = 2,
  interactive = true,
  speed = 0.3,
  className,
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const rafRef = useRef<number>(0);
  const dprRef = useRef(1);

  const resolveColor = useCallback((): [number, number, number] => {
    if (color) {
      // Handle hsl(var(--x)) by reading computed style
      if (color.startsWith('hsl(var(')) {
        const varName = color.match(/--[\w-]+/)?.[0];
        if (varName) {
          const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
          return hexFromHsl(val);
        }
      }
      // Try direct HSL
      return hexFromHsl(color);
    }
    const val = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    return hexFromHsl(val);
  }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
      initParticles(rect.width, rect.height);
    };

    const initParticles = (w: number, h: number) => {
      particlesRef.current = Array.from({ length: quantity }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        size: Math.random() * size + 0.5,
        alpha: 0,
        targetAlpha: Math.random() * 0.6 + 0.1,
      }));
    };

    const [r, g, b] = resolveColor();

    const animate = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      for (const p of particlesRef.current) {
        // Ease alpha
        p.alpha += (p.targetAlpha - p.alpha) * 0.02;

        // Mouse repulsion
        if (interactive) {
          const dx = mouseRef.current.x - p.x;
          const dy = mouseRef.current.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            const force = (120 - dist) / 120;
            p.vx -= (dx / dist) * force * 0.3;
            p.vy -= (dy / dist) * force * 0.3;
          }
        }

        p.x += p.vx;
        p.y += p.vy;

        // Dampen velocity
        p.vx *= 0.99;
        p.vy *= 0.99;

        // Re-add base drift
        p.vx += (Math.random() - 0.5) * 0.01 * speed;
        p.vy += (Math.random() - 0.5) * 0.01 * speed;

        // Wrap
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    resize();
    rafRef.current = requestAnimationFrame(animate);

    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    window.addEventListener('resize', resize);
    if (interactive) canvas.addEventListener('mousemove', onMouse);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      if (interactive) canvas.removeEventListener('mousemove', onMouse);
    };
  }, [quantity, size, speed, interactive, resolveColor]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('pointer-events-auto absolute inset-0 h-full w-full', className)}
    />
  );
}
