import type { ReactNode } from 'react';

interface HeroSectionProps {
  title: string;
  subtitle?: string;
  cta?: ReactNode;
  /** Optional accent glow behind the title area */
  glow?: boolean;
  className?: string;
}

export function HeroSection({ title, subtitle, cta, glow = true, className = '' }: HeroSectionProps) {
  return (
    <section className={`relative flex flex-col items-center justify-center py-24 px-6 text-center overflow-hidden ${className}`}>
      {glow && (
        <div
          className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full animate-pulse-glow pointer-events-none'
          style={{ background: 'radial-gradient(ellipse, hsl(var(--primary) / 0.15) 0%, transparent 70%)' }}
        />
      )}
      <h1 className='relative text-5xl font-bold tracking-tight text-foreground sm:text-6xl animate-fade-in-up'>
        {title}
      </h1>
      {subtitle && (
        <p className='relative mt-6 text-lg text-muted-foreground max-w-xl animate-fade-in-up delay-2'>
          {subtitle}
        </p>
      )}
      {cta && <div className='relative mt-8 animate-fade-in-up delay-3'>{cta}</div>}
    </section>
  );
}
