import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickSeriesOptions,
  type HistogramSeriesOptions,
  type CandlestickData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import type { TraderPosition } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiCandle {
  time: number; // ms
  open: number;
  close: number;
  high: number;
  low: number;
  markOpen: number;
  markClose: number;
  markHigh: number;
  markLow: number;
  volume: number;
  volumeQuote: number;
  tradeCount: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h';

interface PriceChartProps {
  symbol: string;
  candles: ApiCandle[];
  isLoading: boolean;
  positions?: TraderPosition[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
}

// ─── Chart theme colors ───────────────────────────────────────────────────────

const CHART_COLORS = {
  background: 'transparent',
  grid: 'rgba(255,255,255,0.06)',
  text: '#8A8A8A',
  upCandle: '#4ADE80',
  downCandle: '#FF5252',
  upWick: '#4ADE80',
  downWick: '#FF5252',
  volumeUp: 'rgba(74, 222, 128, 0.22)',
  volumeDown: 'rgba(255, 82, 82, 0.22)',
  border: 'rgba(255,255,255,0.08)',
  crosshair: '#555555',
};

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the inline title string for the entry price line.
 * Format: "Entry $1234.56 | PnL +$1.23 (+2.4%)"
 * When pnl is exactly 0 (position just opened), omits the PnL portion.
 */
function buildEntryTitle(entryPrice: number, pnl: number): string {
  const priceStr = `$${entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (pnl === 0) return `Entry ${priceStr}`;
  const sign = pnl >= 0 ? '+' : '';
  const pnlAbs = Math.abs(pnl);
  const pnlStr = `${sign}$${pnlAbs.toFixed(2)}`;
  const pnlPct = entryPrice > 0 ? (pnl / entryPrice) * 100 : 0;
  const pctStr = `${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
  return `Entry ${priceStr} | PnL ${pnlStr} (${pctStr})`;
}

/**
 * Color for the entry price line, matching PnL direction.
 * Green when in profit, red when in loss, neutral when flat (just opened).
 */
function entryLineColor(pnl: number): string {
  if (pnl > 0) return '#4ADE80';
  if (pnl < 0) return '#FF5252';
  return CHART_COLORS.crosshair;
}

// ─── PriceChart ───────────────────────────────────────────────────────────────

export function PriceChart({
  symbol,
  candles,
  isLoading,
  positions = [],
  timeframe,
  onTimeframeChange,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Track the active price lines so we can remove/re-add them cleanly
  const priceLineRef = useRef<IPriceLine | null>(null);
  const liqLineRef = useRef<IPriceLine | null>(null);
  // Stop-loss / take-profit trigger lines (may be multiple across positions)
  const triggerLinesRef = useRef<IPriceLine[]>([]);

  const [priceMode, setPriceMode] = useState<'last' | 'mark'>('last');

  // ── Build chart on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 220,
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.background },
        textColor: CHART_COLORS.text,
        fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      crosshair: {
        vertLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed },
        horzLine: { color: CHART_COLORS.crosshair, width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.border,
        textColor: CHART_COLORS.text,
      },
      timeScale: {
        borderColor: CHART_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        },
      },
    });
    chartRef.current = chart;

    // Candlestick series (pane 0)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.upCandle,
      downColor: CHART_COLORS.downCandle,
      borderUpColor: CHART_COLORS.upCandle,
      borderDownColor: CHART_COLORS.downCandle,
      wickUpColor: CHART_COLORS.upWick,
      wickDownColor: CHART_COLORS.downWick,
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    } as Partial<CandlestickSeriesOptions>);
    candleSeriesRef.current = candleSeries;

    // Candles use the full height; volume rides as an overlay strip at the bottom
    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.12 },
    });

    // Volume histogram — overlay on the SAME pane (custom price scale id, no
    // separate pane) so there's no pane-separator line. Pinned to bottom ~15%.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    } as Partial<HistogramSeriesOptions>);
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // ResizeObserver
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
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLineRef.current = null;
      liqLineRef.current = null;
      triggerLinesRef.current = [];
    };
  }, []);

  // ── Push candle data into chart ─────────────────────────────────────────────
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || candles.length === 0) return;

    const candleData: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as Time,
      open: priceMode === 'mark' ? c.markOpen : c.open,
      high: priceMode === 'mark' ? c.markHigh : c.high,
      low: priceMode === 'mark' ? c.markLow : c.low,
      close: priceMode === 'mark' ? c.markClose : c.close,
    }));

    const volumeData: HistogramData[] = candles.map((c) => {
      const isUp = (priceMode === 'mark' ? c.markClose : c.close) >= (priceMode === 'mark' ? c.markOpen : c.open);
      return {
        time: Math.floor(c.time / 1000) as Time,
        value: c.volume,
        color: isUp ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
      };
    });

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
  }, [candles, priceMode]);

  // ── Position price line overlay ─────────────────────────────────────────────
  // Stabilize openPosition so identity-equality only breaks when the actual
  // numeric values change — not on every render cycle where TradePage rebuilds
  // the positions array with new object references via .map(mapPosition).
  const matchesSymbol = (posSymbol: string | undefined) =>
    !posSymbol || posSymbol.replace(/-PERP$/i, '').toUpperCase() === symbol.replace(/-PERP$/i, '').toUpperCase();

  const openPosition = useMemo(
    () => positions.find(
      (p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      symbol,
      // Primitive values of the matching position — changing any of these is the
      // only reason the lines should be redrawn. We can't use the object reference
      // directly because TradePage rebuilds a new array on every render.
      positions.find((p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0)?.entryPrice,
      positions.find((p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0)?.liquidationPrice,
      positions.find((p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0)?.stopLossPrice,
      positions.find((p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0)?.takeProfitPrice,
      positions.find((p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0)?.side,
    ]
  );

  // Extract primitives used by the lines effect so the dependency array holds
  // stable scalars rather than the object reference.
  const posEntryPrice = openPosition?.entryPrice ?? null;
  const posLiqPrice = openPosition?.liquidationPrice ?? null;
  const posSlPrice = openPosition?.stopLossPrice ?? null;
  const posTpPrice = openPosition?.takeProfitPrice ?? null;

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    // Remove previous price lines
    if (priceLineRef.current) {
      try { candleSeries.removePriceLine(priceLineRef.current); } catch { /* ignore */ }
      priceLineRef.current = null;
    }
    if (liqLineRef.current) {
      try { candleSeries.removePriceLine(liqLineRef.current); } catch { /* ignore */ }
      liqLineRef.current = null;
    }
    if (triggerLinesRef.current.length > 0) {
      for (const line of triggerLinesRef.current) {
        try { candleSeries.removePriceLine(line); } catch { /* ignore */ }
      }
      triggerLinesRef.current = [];
    }

    if (!posEntryPrice) return;

    // Entry line — solid, colored by PnL direction
    const currentPnl = openPosition?.pnl ?? 0;
    const entryTitle = buildEntryTitle(posEntryPrice, currentPnl);
    const priceLine = candleSeries.createPriceLine({
      price: posEntryPrice,
      color: entryLineColor(currentPnl),
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: entryTitle,
    });
    priceLineRef.current = priceLine;

    // Liquidation line — dashed amber, only when a valid liq price exists
    if (posLiqPrice != null && isFinite(posLiqPrice) && posLiqPrice > 0) {
      const liqLine = candleSeries.createPriceLine({
        price: posLiqPrice,
        color: '#FBBF24',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Liq',
      });
      liqLineRef.current = liqLine;
    }

    // Stop-loss line — dashed red, only when an active SL trigger exists
    if (posSlPrice != null && isFinite(posSlPrice) && posSlPrice > 0) {
      const slLine = candleSeries.createPriceLine({
        price: posSlPrice,
        color: '#FF5252',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'SL',
      });
      triggerLinesRef.current.push(slLine);
    }

    // Take-profit line — dashed green, only when an active TP trigger exists
    if (posTpPrice != null && isFinite(posTpPrice) && posTpPrice > 0) {
      const tpLine = candleSeries.createPriceLine({
        price: posTpPrice,
        color: '#4ADE80',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP',
      });
      triggerLinesRef.current.push(tpLine);
    }
  }, [symbol, posEntryPrice, posLiqPrice, posSlPrice, posTpPrice]);

  // ── Live entry-line title (PnL updates continuously) ───────────────────────
  // Read pnl directly from positions (not from the memoized openPosition whose
  // deps intentionally exclude pnl to avoid recreating the price line on ticks).
  const openPositionPnl = positions.find(
    (p) => matchesSymbol(p.symbol) && p.entryPrice && p.entryPrice > 0
  )?.pnl ?? 0;

  useEffect(() => {
    if (!priceLineRef.current || !posEntryPrice) return;
    priceLineRef.current.applyOptions({
      title: buildEntryTitle(posEntryPrice, openPositionPnl),
      color: entryLineColor(openPositionPnl),
    });
  }, [posEntryPrice, openPositionPnl]);

  return (
    <div
      className='glass-card w-full rounded-xl overflow-hidden relative'
    >
      {/* ── Top controls bar ─────────────────────────────────────────────── */}
      <div
        className='flex items-center justify-between px-3 py-2'
        style={{ borderBottom: `1px solid ${CHART_COLORS.border}` }}
      >
        {/* Timeframe selector */}
        <div className='flex gap-1'>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className='px-2 py-1 rounded text-xs font-medium tabular-nums transition-colors'
              style={{
                background: timeframe === tf ? '#b794f6' : 'rgba(255,255,255,0.04)',
                color: timeframe === tf ? '#fff' : '#8A8A8A',
                border: `1px solid ${timeframe === tf ? '#b794f6' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Last / Mark toggle */}
        <div
          className='flex rounded-lg overflow-hidden glass-inner'
        >
          <button
            onClick={() => setPriceMode('last')}
            className='px-3 py-1 text-xs font-medium transition-colors'
            style={{
              background: priceMode === 'last' ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: priceMode === 'last' ? '#FFF' : '#8A8A8A',
            }}
          >
            Last
          </button>
          <button
            onClick={() => setPriceMode('mark')}
            className='px-3 py-1 text-xs font-medium transition-colors'
            style={{
              background: priceMode === 'mark' ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: priceMode === 'mark' ? '#FFF' : '#8A8A8A',
            }}
          >
            Mark
          </button>
        </div>
      </div>

      {/* ── Chart container ───────────────────────────────────────────────── */}
      <div className='relative'>
        {/* Loading shimmer overlay */}
        {isLoading && candles.length === 0 && (
          <div
            className='absolute inset-0 z-10 rounded-b-xl'
            style={{
              background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
              minHeight: '220px',
            }}
          />
        )}

        <div ref={containerRef} className="chart-touch-zone" style={{ minHeight: '220px' }} />

      </div>
    </div>
  );
}

export default PriceChart;
