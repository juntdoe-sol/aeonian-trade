import type { ReactNode } from 'react';

interface FeatureSectionProps {
  heading?: string;
  description?: string;
  children: ReactNode;
  /** Visual style variant */
  variant?: 'default' | 'card' | 'spotlight';
  className?: string;
}

export function FeatureSection({
  heading,
  description,
  children,
  variant = 'default',
  className = '',
}: FeatureSectionProps) {
  const variantStyles = {
    default: '',
    card: 'rounded-lg border border-border/50 bg-card/30 p-6 sm:p-8',
    spotlight: 'rounded-lg bg-gradient-to-br from-primary/5 via-transparent to-accent/5 p-6 sm:p-8 ring-1 ring-border/30',
  };

  return (
    <section className={`relative py-12 ${variantStyles[variant]} ${className}`}>
      {/* Top accent line */}
      <div className='absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent' />

      <div className='container'>
        {(heading || description) && (
          <div className='mb-8'>
            {heading && (
              <h2 className='text-2xl font-bold text-foreground animate-fade-in-up'>{heading}</h2>
            )}
            {description && (
              <p className='mt-3 text-muted-foreground max-w-2xl leading-relaxed animate-fade-in-up delay-1'>
                {description}
              </p>
            )}
          </div>
        )}
        <div className='animate-fade-in-up delay-2'>
          {children}
        </div>
      </div>
    </section>
  );
}
