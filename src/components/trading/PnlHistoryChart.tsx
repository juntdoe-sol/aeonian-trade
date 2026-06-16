import { api } from '@/lib/api-client';
import { useAuth } from '@pooflabs/web';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { TradeFill } from './types';
import { parseFillTimestampSec } from '@/utils/parse-fill-timestamp';

// ─── FIFO realized PnL computation ───────────────────────────────────────────

interface PnlPoint {
  time: number; // Unix seconds
  value: number; // cumulative realized PnL in USD
}

interface PositionLot {
  price: number;
  size: number; // remaining size in this lot
  side: 'long' | 'short';
}

/**
 * Computes a cumulative realized PnL series from a list of trade fills.
 *
 * Strategy: FIFO per symbol. Each "long" fill that is later closed by a "short"
 * fill (or vice versa) generates realized PnL. Fees are subtracted from every fill.
 *
 * Note: perpetuals fills represent opening/closing of positions. When the
 * current net side flips direction we treat the trade as a close + re-open.
 */
function computeCumulativePnl(fills: TradeFill[]): PnlPoint[] {
  // Normalize timestamp (live API delivers ISO strings) to unix seconds, sort
  // oldest first.
  const sorted = [...fills]
    .map((f) => ({ fill: f, ts: parseFillTimestampSec(f.timestamp) }))
    .filter(({ fill, ts }) => ts > 0 && fill.price && fill.size && fill.side)
    .sort((a, b) => a.ts - b.ts);

  if (sorted.length === 0) return [];

  let cumulativePnl = 0;
  const points: PnlPoint[] = [];

  // FIFO lots per symbol
  const lots: Record<string, PositionLot[]> = {};

  for (const { fill, ts } of sorted) {
    const sym = fill.symbol ?? '__';
    const price = fill.price!;
    const size = fill.size!;
    const fee = fill.fee ?? 0;
    const rawSide = fill.side?.toLowerCase() ?? '';
    const isLong = rawSide === 'buy' || rawSide === 'long';
    const isSell = rawSide === 'sell' || rawSide === 'short';

    // Always subtract fee from realized PnL on every fill
    cumulativePnl -= Math.abs(fee);

    if (!lots[sym]) lots[sym] = [];
    const symLots = lots[sym];

    const openSide: 'long' | 'short' = isLong ? 'long' : 'short';
    const closeSide: 'long' | 'short' = isLong ? 'short' : 'long';

    // Check if there are opposing lots to close first
    const opposingLots = symLots.filter((l) => l.side === closeSide);
    let remaining = size;

    if (opposingLots.length > 0) {
      // Close against opposing lots (FIFO)
      for (const lot of opposingLots) {
        if (remaining <= 0) break;
        const closeSize = Math.min(lot.size, remaining);
        // PnL = (exit - entry) * size for long, (entry - exit) * size for short
        const pnlPerUnit = closeSide === 'long'
          ? price - lot.price   // closing a long: sell price - buy price
          : lot.price - price;  // closing a short: short price - buy-back price
        cumulativePnl += pnlPerUnit * closeSize;
        lot.size -= closeSize;
        remaining -= closeSize;
      }
      // Remove exhausted lots
      lots[sym] = symLots.filter((l) => l.size > 0.000001);
    }

    // Whatever is left opens a new lot
    if (remaining > 0.000001) {
      lots[sym].push({ price, size: remaining, side: openSide });
    }

    points.push({
      time: ts,
      value: Math.round(cumulativePnl * 100) / 100,
    });
  }

  // Deduplicate: if two fills share the same second, keep latest
  const deduped: PnlPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === points.length - 1 || points[i].time !== points[i + 1].time) {
      deduped.push(points[i]);
    } else {
      // Skip intermediate points with same timestamp; next iteration will include the last
    }
  }

  // Ensure strictly increasing times (lightweight-charts requirement)
  const strict: PnlPoint[] = [];
  let lastTime = -Infinity;
  for (const p of deduped) {
    if (p.time > lastTime) {
      strict.push(p);
      lastTime = p.time;
    }
  }

  return strict;
}

// ─── Chart colors ─────────────────────────────────────────────────────────────

const C = {
  bg: 'transparent',
  grid: 'rgba(255,255,255,0.06)',
  text: '#8A8A8A',
  border: 'rgba(255,255,255,0.08)',
  crosshair: '#555555',
  green: '#4ADE80',
  greenFill: 'rgba(74, 222, 128, 0.15)',
  red: '#FF5252',
  redFill: 'rgba(255, 82, 82, 0.15)',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PnlHistoryChart() {
  const { user } = useAuth();
  const [fills, setFills] = useState<TradeFill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  // Fetch fills once user is available
  useEffect(() => {
    if (!user?.address) return;
    setLoading(true);
    api
      .get<unknown>(`/api/phoenix/trader/${user.address}/trades-history?limit=500`)
      .then((res) => {
        const list = Array.isArray(res)
          ? (res as TradeFill[])
          : ((res as { data?: TradeFill[] })?.data ?? []);
        setFills(list);
      })
      .catch(() => setFills([]))
      .finally(() => setLoading(false));
  }, [user?.address]);

  // Compute PnL series
  const pnlPoints = fills ? computeCumulativePnl(fills) : [];
  const finalPnl = pnlPoints.length > 0 ? pnlPoints[pnlPoints.length - 1].value : 0;
  const isPositive = finalPnl >= 0;
  const closedTradeCount = pnlPoints.length;

  const lineColor = isPositive ? C.green : C.red;
  const fillColor = isPositive ? C.greenFill : C.redFill;

  // Build chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 200,
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor: C.text,
        fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        vertLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed },
        horzLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: C.border,
        textColor: C.text,
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: lineColor,
      topColor: fillColor,
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });
    areaSeriesRef.current = areaSeries;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width });
        }
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      areaSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update series color when PnL sign changes
  useEffect(() => {
    if (!areaSeriesRef.current) return;
    areaSeriesRef.current.applyOptions({
      lineColor,
      topColor: fillColor,
    });
  }, [lineColor, fillColor]);

  // Push data into chart
  useEffect(() => {
    const areaSeries = areaSeriesRef.current;
    if (!areaSeries) return;
    if (pnlPoints.length === 0) {
      areaSeries.setData([]);
      return;
    }
    areaSeries.setData(
      pnlPoints.map((p) => ({
        time: p.time as Time,
        value: p.value,
      }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [pnlPoints]);

  // Don't render if user is not logged in
  if (!user) return null;

  const pnlSign = finalPnl >= 0 ? '+' : '';
  const pnlFormatted = `${pnlSign}$${Math.abs(finalPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div
      className='w-full rounded-xl overflow-hidden'
      style={{ background: C.bg, border: `1px solid ${C.border}` }}
    >
      {/* Header */}
      <div
        className='flex items-center justify-between px-4 py-3'
        style={{ borderBottom: `1px solid ${C.border}` }}
      >
        <div className='flex items-center gap-2'>
          {isPositive ? (
            <TrendingUp size={14} style={{ color: C.green }} />
          ) : (
            <TrendingDown size={14} style={{ color: C.red }} />
          )}
          <span className='text-xs font-medium' style={{ color: '#8A8A8A' }}>
            Realized PnL
          </span>
        </div>

        <div className='flex items-center gap-4'>
          {!loading && closedTradeCount > 0 && (
            <span className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
              {closedTradeCount} {closedTradeCount === 1 ? 'trade' : 'trades'}
            </span>
          )}
          {!loading && (
            <span
              className='text-lg font-bold tabular-nums'
              style={{
                color: isPositive ? C.green : C.red,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {closedTradeCount === 0 ? '—' : pnlFormatted}
            </span>
          )}
          {loading && (
            <div
              className='rounded'
              style={{
                width: '100px',
                height: '24px',
                background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s infinite',
              }}
            />
          )}
        </div>
      </div>

      {/* Chart area */}
      {loading ? (
        <div
          style={{
            height: '200px',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }}
        />
      ) : pnlPoints.length === 0 ? (
        <div
          className='flex flex-col items-center justify-center gap-2 py-10 px-6 text-center'
          style={{ minHeight: '200px' }}
        >
          <TrendingUp size={28} style={{ color: '#2A2A2A' }} />
          <p className='text-sm' style={{ color: '#8A8A8A' }}>
            No closed trades yet
          </p>
          <p className='text-xs' style={{ color: '#555' }}>
            Your realized PnL will appear here once you close a position.
          </p>
        </div>
      ) : (
        <div ref={containerRef} style={{ minHeight: '200px' }} />
      )}
    </div>
  );
}

export default PnlHistoryChart;
