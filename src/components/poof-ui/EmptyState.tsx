import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in-up ${className}`}
    >
      {icon && (
        <div className='mb-4 text-muted-foreground p-4 rounded-full bg-muted/50 ring-1 ring-border'>
          {icon}
        </div>
      )}
      <h3 className='text-lg font-semibold text-foreground'>{title}</h3>
      {description && (
        <p className='mt-1 text-sm text-muted-foreground max-w-sm'>{description}</p>
      )}
      {action && <div className='mt-4'>{action}</div>}
    </div>
  );
}
