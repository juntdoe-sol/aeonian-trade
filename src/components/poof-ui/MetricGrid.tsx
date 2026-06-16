import { StatCard } from './StatCard';

interface Metric {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down'; value: string };
  description?: string;
}

interface MetricGridProps {
  metrics: Metric[];
  columns?: 2 | 3 | 4;
  /** Stagger the entrance animation of each card */
  stagger?: boolean;
  className?: string;
}

const gridCols = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;

export function MetricGrid({ metrics, columns = 4, stagger = true, className = '' }: MetricGridProps) {
  return (
    <div className={`grid gap-4 ${gridCols[columns]} ${className}`}>
      {metrics.map((metric, i) => (
        <StatCard
          key={i}
          {...metric}
          className={stagger ? `animate-fade-in-up delay-${Math.min(i + 1, 6)}` : ''}
        />
      ))}
    </div>
  );
}
