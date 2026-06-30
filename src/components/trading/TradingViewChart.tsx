import { useEffect, useRef } from 'react';
import { getTvSymbol, TV_INTERVAL_MAP } from '@/utils/tradingview-symbols';
import { PriceChart, type ApiCandle, type Timeframe } from './PriceChart';
import type { TraderPosition } from './types';

// TradingView Advanced Chart widget config shape (subset we use)
interface TvWidgetConfig {
  autosize: boolean;
  symbol: string;
  interval: string;
  timezone: string;
  theme: string;
  style: string;
  locale: string;
  toolbar_bg: string;
  enable_publishing: boolean;
  hide_top_toolbar: boolean;
  hide_legend: boolean;
  save_image: boolean;
  container_id: string;
  backgroundColor: string;
  gridColor: string;
  withdateranges: boolean;
  hide_volume: boolean;
  allow_symbol_change: boolean;
  studies: string[];
}

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: TvWidgetConfig) => object;
    };
  }
}

// ─── Shared TV script loader ──────────────────────────────────────────────────
// The script tag is injected once per page lifetime; subsequent callers skip it.

let tvScriptPromise: Promise<void> | null = null;

function loadTvScript(): Promise<void> {
  if (tvScriptPromise) return tvScriptPromise;
  tvScriptPromise = new Promise((resolve, reject) => {
    if (window.TradingView) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('TradingView script failed to load'));
    document.head.appendChild(script);
  });
  return tvScriptPromise;
}

// ─── TradingViewWidget ────────────────────────────────────────────────────────

interface TradingViewWidgetProps {
  tvSymbol: string;
  interval: string;
  /** Container height in px — widget fills this exactly. */
  height: number;
}

function TradingViewWidget({ tvSymbol, interval, height }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stable unique ID per mount so multiple charts on the same page don't collide
  const containerIdRef = useRef(`tv_chart_${Math.random().toString(36).slice(2, 9)}`);
  const widgetRef = useRef<object | null>(null);

  useEffect(() => {
    let cancelled = false;
    const containerId = containerIdRef.current;

    loadTvScript().then(() => {
      if (cancelled || !containerRef.current || !window.TradingView) return;

      // Clear any previous widget markup before re-creating
      containerRef.current.innerHTML = '';
      // The container div needs the stable ID the widget config references
      containerRef.current.id = containerId;

      widgetRef.current = new window.TradingView.widget({
        autosize: true,
        symbol: tvSymbol,
        interval,
        timezone: 'exchange',
        theme: 'dark',
        style: '1',           // Candles
        locale: 'en',
        toolbar_bg: '#0a0814',
        enable_publishing: false,
        hide_top_toolbar: false,   // show the interval/drawing toolbar
        hide_legend: false,
        save_image: false,
        container_id: containerId,
        backgroundColor: '#0a0814',
        gridColor: 'rgba(255,255,255,0.05)',
        withdateranges: true,
        hide_volume: false,
        allow_symbol_change: false, // we control symbol via props
        studies: [],
      });
    }).catch(() => {
      // Script load failed — parent will fall back to PriceChart
    });

    return () => {
      cancelled = true;
      // The TradingView widget doesn't expose a destroy method via the public
      // widget constructor API — clearing innerHTML is sufficient cleanup.
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  // Recreate widget whenever symbol or interval changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvSymbol, interval]);

  return (
    <div
      ref={containerRef}
      id={containerIdRef.current}
      style={{
        width: '100%',
        height: `${height}px`,
        minHeight: `${height}px`,
        background: '#0a0814',
        borderRadius: 0,
        overflow: 'hidden',
      }}
    />
  );
}

// ─── HybridChart — public export ─────────────────────────────────────────────
// On desktop: renders TradingViewWidget when a mapping exists, else PriceChart.
// On mobile: always renders PriceChart (caller passes isDesktop=false).

interface HybridChartProps {
  symbol: string;
  candles: ApiCandle[];
  isLoading: boolean;
  positions?: TraderPosition[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  /** Desktop chart height in px. Ignored when isDesktop=false. */
  chartHeight?: number;
  /** Whether to attempt the TradingView widget. Pass true only on desktop. */
  isDesktop?: boolean;
}

export function HybridChart({
  symbol,
  candles,
  isLoading,
  positions = [],
  timeframe,
  onTimeframeChange,
  chartHeight = 460,
  isDesktop = false,
}: HybridChartProps) {
  const tvSymbol = isDesktop ? getTvSymbol(symbol) : null;
  const tvInterval = TV_INTERVAL_MAP[timeframe] ?? '15';

  if (tvSymbol) {
    return (
      <div
        className="chart-touch-zone"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: `${chartHeight}px`,
          minHeight: `${chartHeight}px`,
          overflow: 'hidden',
        }}
      >
        <TradingViewWidget
          tvSymbol={tvSymbol}
          interval={tvInterval}
          height={chartHeight}
        />
      </div>
    );
  }

  // Fallback: lightweight-charts PriceChart.
  // Wrap in a sized container so PriceChart's containerRef.current.clientWidth
  // is non-zero at mount time (the flex parent chain on desktop may not yet have
  // provided a layout height, causing createChart to initialise with width=0).
  return (
    <div
      className="chart-touch-zone"
      style={{
        width: '100%',
        height: `${chartHeight}px`,
        minHeight: `${chartHeight}px`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PriceChart
        symbol={symbol}
        candles={candles}
        isLoading={isLoading}
        positions={positions}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        chartHeight={chartHeight}
      />
    </div>
  );
}

export default HybridChart;
