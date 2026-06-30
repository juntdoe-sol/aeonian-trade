import { useState, useEffect, useCallback } from 'react';
import { useAuth, getIdToken } from '@pooflabs/web';
import { createAuthenticatedApiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  UserPlus,
  UserCheck,
  Activity,
  TrendingUp,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Chart colors read from CSS variables so they stay in sync with the theme.
// These match the HSL values in src/theme.ts applied to :root via poof-styling.css.
const CHART = {
  primary: 'hsl(var(--primary))',
  muted: 'hsl(var(--muted-foreground))',
  border: 'hsl(var(--border))',
  card: 'hsl(var(--card))',
  text: 'hsl(var(--foreground))',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type RangeKey = '24h' | '7d' | '1m' | '3m' | '6m' | '1y';

interface DailyActivePoint {
  date: string;
  count: number;
}

interface AnalyticsData {
  range: string;
  totalUsers: number;
  newUsers: number;
  activeTraders: number;
  returningUsers: number;
  tradingVolume: number;
  tradingVolumeCross: number;
  tradingVolumeIsolated: number;
  dailyActiveTraders: DailyActivePoint[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}K`;
  }
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * For the chart x-axis, format the ISO date string to a compact label.
 * Short ranges (24h, 7d): show "Jun 20"
 * Longer ranges: show "Jun 20" or just "Jun" for monthly groupings — we still
 * show the full daily labels but skip them on the axis for readability.
 */
function formatDateLabel(dateStr: string): string {
  // dateStr is YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Decide how many x-axis ticks to show based on the number of data points.
 * We thin the labels to avoid overlapping text.
 */
function buildTickInterval(pointCount: number): number {
  if (pointCount <= 10) return 1;
  if (pointCount <= 31) return 3;
  if (pointCount <= 92) return 7;
  return 14;
}

// ─── Chart Tooltip ───────────────────────────────────────────────────────────

interface TooltipPayload {
  value: number;
  payload: DailyActivePoint;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{
        background: CHART.card,
        borderColor: CHART.border,
        color: CHART.text,
      }}
    >
      <p className="font-semibold mb-0.5">{label}</p>
      <p className="font-mono">
        <span style={{ color: CHART.primary }}>{count}</span>{' '}
        <span style={{ color: CHART.muted }}>
          {count === 1 ? 'trader' : 'traders'}
        </span>
      </p>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  description?: string;
  breakdown?: string;
}

function MetricCard({ icon: Icon, label, value, description, breakdown }: MetricCardProps) {
  return (
    <Card className="glass-card">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
              {label}
            </p>
            <p className="text-2xl font-bold font-mono text-foreground tabular-nums leading-tight">
              {value}
            </p>
            {description && (
              <p className="text-[11px] text-muted-foreground mt-1">{description}</p>
            )}
            {breakdown && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono">{breakdown}</p>
            )}
          </div>
          <div className="shrink-0 rounded-lg p-2 bg-primary/10 border border-primary/20">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Daily Active Traders Chart ───────────────────────────────────────────────

interface DailyChartProps {
  points: DailyActivePoint[];
  loading: boolean;
}

function DailyActiveChart({ points, loading }: DailyChartProps) {
  const tickInterval = buildTickInterval(points.length);
  // Build x-axis tick array: include only every Nth date label
  const ticks = points
    .filter((_, i) => i % tickInterval === 0 || i === points.length - 1)
    .map((p) => p.date);

  const maxCount = Math.max(...points.map((p) => p.count), 1);
  // Round up y-axis max to a nice number
  const yMax = Math.ceil(maxCount * 1.15) || 5;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Daily Active Traders
          </CardTitle>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        {loading && points.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : points.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <p className="text-xs text-muted-foreground">No trade data for this range.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={points}
              margin={{ top: 6, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={CHART.border}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={formatDateLabel}
                tick={{ fontSize: 10, fill: CHART.muted }}
                axisLine={false}
                tickLine={false}
                dy={6}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, yMax]}
                tick={{ fontSize: 10, fill: CHART.muted }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                content={<ChartTooltip />}
                labelFormatter={formatDateLabel}
                cursor={{ stroke: CHART.border, strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke={CHART.primary}
                strokeWidth={2}
                dot={points.length <= 14 ? { r: 3, fill: CHART.primary, strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: CHART.primary, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Range Toggle ─────────────────────────────────────────────────────────────

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
];

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function AnalyticsTab() {
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>('7d');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  const fetchAnalytics = useCallback(async (selectedRange: RangeKey) => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) {
        toast.error('Session expired. Please log in again.');
        setLoading(false);
        return;
      }
      const authApi = createAuthenticatedApiClient(token, user.address);
      const result = await authApi.get(`/api/admin/analytics?range=${selectedRange}`);
      setData(result as AnalyticsData);
      setLastFetched(Date.now());
    } catch (err) {
      toast.error('Failed to load analytics');
      console.error('Analytics fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch on mount and when range changes
  useEffect(() => {
    fetchAnalytics(range);
  }, [range, fetchAnalytics]);

  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? range.toUpperCase();

  const metrics: MetricCardProps[] = data
    ? [
        {
          icon: Users,
          label: 'Total Users',
          value: formatCount(data.totalUsers),
          description: 'All registered traders, all time',
        },
        {
          icon: UserPlus,
          label: 'New Users',
          value: formatCount(data.newUsers),
          description: `Registered in the last ${rangeLabel}`,
        },
        {
          icon: UserCheck,
          label: 'Returning Users',
          value: formatCount(data.returningUsers),
          description: `Wallets with 2+ trades in the last ${rangeLabel}`,
        },
        {
          icon: Activity,
          label: 'Active Traders',
          value: formatCount(data.activeTraders),
          description: `Unique wallets that traded in the last ${rangeLabel}`,
        },
        {
          icon: TrendingUp,
          label: 'Trading Volume',
          value: formatUsd(data.tradingVolume),
          description: `Total notional USD in the last ${rangeLabel}`,
          breakdown: `Cross ${formatUsd(data.tradingVolumeCross)} · Isolated ${formatUsd(data.tradingVolumeIsolated)}`,
        },
      ]
    : [];

  const chartPoints: DailyActivePoint[] = data?.dailyActiveTraders ?? [];

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Performance Analytics</h2>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {lastFetched && !loading && (
            <Badge variant="outline" className="text-[10px] font-mono">
              Updated {new Date(lastFetched).toLocaleTimeString()}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1.5 px-2.5"
          disabled={loading}
          onClick={() => fetchAnalytics(range)}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Range toggle */}
      <div className="flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`
              px-3 py-1.5 rounded-md text-xs font-semibold transition-all
              ${range === r.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-primary/10 border border-transparent hover:border-primary/20'
              }
            `}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Metric tiles */}
      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="pt-5 pb-5">
                <div className="animate-pulse space-y-2">
                  <div className="h-3 w-24 rounded bg-muted/40" />
                  <div className="h-7 w-20 rounded bg-muted/40" />
                  <div className="h-3 w-32 rounded bg-muted/30" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>
      )}

      {/* Daily active traders line chart */}
      <DailyActiveChart points={chartPoints} loading={loading && !data} />

      {/* Note about data coverage */}
      <p className="text-[11px] text-muted-foreground">
        Trading volume reflects both cross-margin (phoenixTradeRecord) and isolated-margin (phoenixIsoTrade) notional USD. Active and returning trader counts reflect cross-margin trades only. Daily active trader chart reflects cross-margin trades only.
      </p>
    </div>
  );
}
