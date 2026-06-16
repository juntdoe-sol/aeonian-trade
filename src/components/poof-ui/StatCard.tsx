import { TrendingDown, TrendingUp } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down'; value: string };
  description?: string;
  className?: string;
}

export function StatCard({ label, value, trend, description, className = '' }: StatCardProps) {
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border border-border bg-card p-6 transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${className}`}
    >
      {/* Subtle gradient shimmer on hover */}
      <div className='absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none' />

      <p className='relative text-sm font-medium text-muted-foreground'>{label}</p>
      <div className='relative mt-2 flex items-baseline gap-2'>
        <span className='text-3xl font-bold text-card-foreground'>{value}</span>
        {trend && (
          <span
            className={`inline-flex items-center gap-1 text-sm font-medium ${
              trend.direction === 'up' ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {trend.direction === 'up' ? (
              <TrendingUp className='h-4 w-4' />
            ) : (
              <TrendingDown className='h-4 w-4' />
            )}
            {trend.value}
          </span>
        )}
      </div>
      {description && (
        <p className='relative mt-1 text-xs text-muted-foreground'>{description}</p>
      )}
    </div>
  );
}
