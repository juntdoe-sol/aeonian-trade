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
  type MouseEventParams,
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
  /** Override chart canvas height in px. Defaults to 220 (mobile). Desktop typically 320+. */
  chartHeight?: number;
  /** When true, renders without the glass-card container so the chart sits flat on the page. */
  flat?: boolean;
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
 * Derives a lightweight-charts priceFormat from a reference price so that
 * sub-$1 candles are never rounded into a flat invisible line.
 *
 * Tiers:
 *   price >= 1000  → precision 2,  minMove 0.01
 *   price >= 1     → precision 4,  minMove 0.0001
 *   price >= 0.1   → precision 5,  minMove 0.00001
 *   price >= 0.01  → precision 6,  minMove 0.000001
 *   price <  0.01  → precision 7,  minMove 0.0000001  (e.g. PUMP ~$0.0013)
 */
function priceFormatForPrice(refPrice: number): { type: 'price'; precision: number; minMove: number } {
  if (refPrice >= 1000) return { type: 'price', precision: 2, minMove: 0.01 };
  if (refPrice >= 1)    return { type: 'price', precision: 4, minMove: 0.0001 };
  if (refPrice >= 0.1)  return { type: 'price', precision: 5, minMove: 0.00001 };
  if (refPrice >= 0.01) return { type: 'price', precision: 6, minMove: 0.000001 };
  return                       { type: 'price', precision: 7, minMove: 0.0000001 };
}

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

// ─── OHLC data shape for overlay ─────────────────────────────────────────────

interface OhlcState {
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePct: number;
}

export function PriceChart({
  symbol,
  candles,
  isLoading,
  positions = [],
  timeframe,
  onTimeframeChange,
  chartHeight = 220,
  flat,
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

  // OHLC overlay state — updated by crosshair hover or falls back to latest candle
  const [ohlc, setOhlc] = useState<OhlcState | null>(null);

  // ── Build chart on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: chartHeight,
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
      // Initial format — overridden adaptively once candle data loads
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
  // chartHeight intentionally in deps: remounts the chart when height changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartHeight]);

  // ── Crosshair OHLC subscription ─────────────────────────────────────────────
  // Subscribe to crosshair move to update the OHLC overlay with the hovered candle.
  // Falls back to the latest candle when the crosshair leaves the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param: MouseEventParams) => {
      const candleSeries = candleSeriesRef.current;
      if (!candleSeries) return;

      if (param.time && candleSeries) {
        const data = param.seriesData?.get(candleSeries) as CandlestickData | undefined;
        if (data) {
          const change = data.close - data.open;
          const changePct = data.open > 0 ? (change / data.open) * 100 : 0;
          setOhlc({ open: data.open, high: data.high, low: data.low, close: data.close, change, changePct });
          return;
        }
      }
      // Crosshair left or no data — show latest candle
      if (candles.length > 0) {
        const last = candles[candles.length - 1];
        const o = priceMode === 'mark' ? last.markOpen : last.open;
        const h = priceMode === 'mark' ? last.markHigh : last.high;
        const l = priceMode === 'mark' ? last.markLow : last.low;
        const cl = priceMode === 'mark' ? last.markClose : last.close;
        const change = cl - o;
        const changePct = o > 0 ? (change / o) * 100 : 0;
        setOhlc({ open: o, high: h, low: l, close: cl, change, changePct });
      }
    };

    chart.subscribeCrosshairMove(handler);
    return () => { chart.unsubscribeCrosshairMove(handler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartHeight, candles, priceMode]);

  // ── Push candle data into chart ─────────────────────────────────────────────
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || candles.length === 0) return;

    // Map raw candles to lightweight-charts format (ms → s)
    const rawCandleData: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as Time,
      open: priceMode === 'mark' ? c.markOpen : c.open,
      high: priceMode === 'mark' ? c.markHigh : c.high,
      low: priceMode === 'mark' ? c.markLow : c.low,
      close: priceMode === 'mark' ? c.markClose : c.close,
    }));

    const rawVolumeData: HistogramData[] = candles.map((c) => {
      const isUp = (priceMode === 'mark' ? c.markClose : c.close) >= (priceMode === 'mark' ? c.markOpen : c.open);
      return {
        time: Math.floor(c.time / 1000) as Time,
        value: c.volume,
        color: isUp ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
      };
    });

    // lightweight-charts requires strictly-ascending unique timestamps.
    // Sort ascending by time, then dedupe (keep last entry per timestamp).
    const sortAndDedup = <T extends { time: Time }>(data: T[]): T[] => {
      const sorted = [...data].sort((a, b) => (a.time as number) - (b.time as number));
      const seen = new Map<number, T>();
      for (const item of sorted) seen.set(item.time as number, item);
      return Array.from(seen.values()).sort((a, b) => (a.time as number) - (b.time as number));
    };

    const candleData = sortAndDedup(rawCandleData);
    const volumeData = sortAndDedup(rawVolumeData);

    try {
      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      chartRef.current?.timeScale().fitContent();
    } catch (err) {
      console.error(`[PriceChart] setData failed for ${symbol}:`, err);
    }

    // Adapt price format to the actual price magnitude so sub-$1 assets
    // (XLM, ADA, DOGE, PUMP, etc.) don't collapse to a flat invisible line.
    // Use the latest candle's close as the reference price.
    const refClose = candleData[candleData.length - 1]?.close;
    if (refClose != null && refClose > 0) {
      candleSeries.applyOptions({ priceFormat: priceFormatForPrice(refClose) });
    }

    // Update OHLC overlay with the latest candle (crosshair may override this)
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      const o = priceMode === 'mark' ? last.markOpen : last.open;
      const h = priceMode === 'mark' ? last.markHigh : last.high;
      const l = priceMode === 'mark' ? last.markLow : last.low;
      const cl = priceMode === 'mark' ? last.markClose : last.close;
      const change = cl - o;
      const changePct = o > 0 ? (change / o) * 100 : 0;
      setOhlc({ open: o, high: h, low: l, close: cl, change, changePct });
    }
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
      className={flat ? 'w-full overflow-hidden relative' : 'glass-card w-full rounded-xl overflow-hidden relative'}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {/* ── Top controls bar ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderBottom: `1px solid ${CHART_COLORS.border}`,
          gap: 8,
          height: 36,
          flexShrink: 0,
        }}
      >
        {/* Timeframe selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {TIMEFRAMES.map((tf) => {
            const active = timeframe === tf;
            return (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                style={{
                  height: 24,
                  padding: '0 8px',
                  borderRadius: 5,
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  letterSpacing: '0.01em',
                  background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                  color: active ? '#e0e0e8' : '#6A6A7A',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease, color 0.12s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#a0a0b0'; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#6A6A7A'; }}
              >
                {tf}
              </button>
            );
          })}

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 4px', flexShrink: 0 }} />

          {/* Last / Mark toggle — flat pill group */}
          <div style={{ display: 'flex', alignItems: 'center', borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
            {(['last', 'mark'] as const).map((mode) => {
              const active = priceMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setPriceMode(mode)}
                  style={{
                    height: 22,
                    padding: '0 8px',
                    fontSize: 11,
                    fontWeight: active ? 600 : 500,
                    background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                    color: active ? '#e0e0e8' : '#6A6A7A',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.12s ease, color 0.12s ease',
                    textTransform: 'capitalize',
                    letterSpacing: '0.01em',
                  }}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Chart container ───────────────────────────────────────────────── */}
      <div className='relative' style={{ flex: 1, minHeight: 0 }}>
        {/* Loading shimmer overlay */}
        {isLoading && candles.length === 0 && (
          <div
            className='absolute inset-0 z-10 rounded-b-xl'
            style={{
              background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
              minHeight: `${chartHeight}px`,
            }}
          />
        )}

        <div ref={containerRef} className="chart-touch-zone" style={{ minHeight: `${chartHeight}px` }} />

        {/* OHLC overlay — top-left corner of the chart canvas */}
        {ohlc && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 5,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
              fontSize: 11,
              lineHeight: 1,
              padding: '4px 8px',
              borderRadius: 4,
              background: 'rgba(10,10,12,0.97)',
            }}
          >
            <OhlcItem label='O' value={ohlc.open} />
            <OhlcItem label='H' value={ohlc.high} />
            <OhlcItem label='L' value={ohlc.low} />
            <OhlcItem label='C' value={ohlc.close} />
            <span
              style={{
                color: ohlc.change >= 0 ? '#4ADE80' : '#FF5252',
                fontWeight: 600,
              }}
            >
              {ohlc.change >= 0 ? '+' : ''}{ohlc.change.toFixed(2)} ({ohlc.changePct >= 0 ? '+' : ''}{ohlc.changePct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OHLC overlay sub-component ──────────────────────────────────────────────

function formatOhlcValue(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function OhlcItem({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ color: '#C8C8D0' }}>
      <span style={{ color: '#8A8A8A', marginRight: 3 }}>{label}</span>
      {formatOhlcValue(value)}
    </span>
  );
}

export default PriceChart;
