import type { ReactNode } from 'react';

interface IconBadgeProps {
  icon: ReactNode;
  /** 'primary' | 'accent' | 'muted' | 'destructive' */
  color?: 'primary' | 'accent' | 'muted' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const colorStyles = {
  primary: 'bg-primary/10 text-primary ring-primary/20',
  accent: 'bg-accent/10 text-accent ring-accent/20',
  muted: 'bg-muted text-muted-foreground ring-border',
  destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
} as const;

const sizeStyles = {
  sm: 'h-8 w-8 [&>svg]:h-4 [&>svg]:w-4',
  md: 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5',
  lg: 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6',
} as const;

export function IconBadge({ icon, color = 'primary', size = 'md', className = '' }: IconBadgeProps) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-lg ring-1 ${colorStyles[color]} ${sizeStyles[size]} ${className}`}
    >
      {icon}
    </div>
  );
}
