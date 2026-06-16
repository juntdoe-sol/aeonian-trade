import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
  /** Adds a bottom border with gradient accent */
  border?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  border = true,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`relative pb-6 mb-6 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className='mb-4 flex items-center gap-1.5 text-sm text-muted-foreground animate-fade-in'>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className='flex items-center gap-1.5'>
              {i > 0 && <ChevronRight className='h-3 w-3 opacity-40' />}
              {crumb.href ? (
                <a href={crumb.href} className='hover:text-foreground transition-colors'>
                  {crumb.label}
                </a>
              ) : (
                <span className='text-foreground/70'>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h1 className='text-3xl font-bold text-foreground tracking-tight animate-fade-in-up'>
            {title}
          </h1>
          {description && (
            <p className='mt-2 text-muted-foreground max-w-xl leading-relaxed animate-fade-in-up delay-1'>
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className='flex items-center gap-2 animate-fade-in delay-2'>
            {actions}
          </div>
        )}
      </div>
      {border && (
        <div className='absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary/30 via-border/50 to-transparent' />
      )}
    </div>
  );
}
