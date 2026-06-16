import type { ReactNode } from 'react';

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** Optional link — makes the whole card clickable */
  href?: string;
  className?: string;
}

export function FeatureCard({ icon, title, description, href, className = '' }: FeatureCardProps) {
  const Wrapper = href ? 'a' : 'div';
  const linkProps = href ? { href } : {};

  return (
    <Wrapper
      {...linkProps}
      className={`group relative overflow-hidden rounded-lg border border-border/50 bg-card/50 p-6 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 ${href ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* Hover gradient */}
      <div className='absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none' />

      <div className='relative'>
        <div className='mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover:bg-primary/15'>
          {icon}
        </div>
        <h3 className='text-lg font-semibold text-foreground mb-1.5'>{title}</h3>
        <p className='text-sm text-muted-foreground leading-relaxed'>{description}</p>
      </div>
    </Wrapper>
  );
}
