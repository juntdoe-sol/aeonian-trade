import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      {...props}
    />
  );
}

export interface LoadingProps extends React.HTMLAttributes<HTMLDivElement> {
  text?: string;
}

export function Loading({ text, className, ...props }: LoadingProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2', className)} {...props}>
      <Spinner className='h-6 w-6' />
      {text && <p className='text-sm text-muted-foreground'>{text}</p>}
    </div>
  );
}
