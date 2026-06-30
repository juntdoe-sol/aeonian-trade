import { api } from '@/lib/api-client';
import { useGeoBlocked } from '@/hooks/use-geo-blocked';
import { useAuth } from '@pooflabs/web';
import { ArrowDown, ArrowUp, ChevronDown, Search, Star } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { TokenLogo } from './TokenLogo';
import { MarketSidebar } from './MarketSidebar';
import { UserActivityPanel, OrderbookPanel } from './trading/UserActivityPanel';
import { PriceChart, type Timeframe } from './trading/PriceChart';
import { HybridChart } from './trading/TradingViewChart';
import { HyperliquidOrderTicket } from './trading/HyperliquidOrderTicket';
import { MobileOrderSheet } from './MobileOrderSheet';
import { setPhoenixIsolatedSweep } from '@/lib/collections/phoenixIsolatedSweep';
import { AdsCarousel } from './ads/AdsCarousel';
import { startAdsSubscription } from '@/hooks/use-ads';
import type { TraderPosition } from './trading/types';
import {
  type TraderData,
  type RisePosition,
  mapPosition,
  flattenLimitOrders,
  toNumber,
} from '@/utils/phoenix-mappers';
import { ALL_MARKET_KEYS, toPerpKey, getMarketPubkey, toBaseLots, seedLiveMarkets, getMarketCategory, type MarketCategory } from '@/utils/phoenix-markets';
import { placeOrderViaFlight, placeIsolatedOrderViaFlight, Side } from '@/utils/phoenix-flight';
import { recordFlightTrade } from '@/utils/record-trade';
import { celebrate } from '@/utils/celebrate';
import { isDraftEnv, MOCK_DRAFT_POSITION } from '@/utils/draft-mock-position';
import { captureConsoleErrorDuring, buildIsoErrorMessage } from '@/utils/iso-error-diagnostic';
import { useFavoriteMarkets } from '@/hooks/use-favorite-markets';

// ─── Types ───────────────────────────────────────────────────────────────────

// Shape returned by /candles endpoint (perp-api.phoenix.trade)
interface ApiCandle {
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

interface MarketInfo {
  symbol?: string;
  maxLeverage?: number;
  isolatedOnly?: boolean;
  /** On-chain market pubkey — passed through from the backend overview so live-only
   *  markets (not yet in the static MARKETS registry) can still be traded. */
  marketPubkey?: string;
  /** Base lot decimals from the exchange config — needed to size orders correctly. */
  baseLotDecimals?: number;
  /** Live mark price — markets-overview resolves this per market (OKX → Pyth → Phoenix candle). */
  markPrice?: number;
  /** Live last-trade price fallback when markPrice is absent. */
  lastPrice?: number;
  /** 24h percent change — markets-overview resolves this (OKX open24h / Phoenix 1d candle).
   *  Absent for Pyth-priced commodities (no clean 24h-open from Pyth latest). */
  change24h?: number;
  /** 24-hour trading volume in USD from markets-overview. */
  volume24h?: number;
  /** Open interest in USD from markets-overview. */
  openInterest?: number;
}

// Per-market metadata fetched from markets-overview (maxLeverage, isolatedOnly, live price)
interface MarketMeta {
  maxLeverage: number;
  isolatedOnly: boolean;
  /** Live mark price for the market row, when the overview resolved one. */
  markPrice?: number;
  /** 24h percent change for the market row, when the overview resolved one. */
  change24h?: number;
  /** 24-hour trading volume in USD. */
  volume24h?: number;
  /** Open interest in USD. */
  openInterest?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(p: number | undefined): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}


function formatUsd(v: number | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Compact price for the market-picker rows — precision scales with magnitude so
// BTC/ETH show fewer decimals and small-cap tokens show more. Returns null when
// there's no real price (so the row hides the column instead of showing a dash).
function formatRowPrice(p: number | undefined): string | null {
  if (p == null || !(p > 0)) return null;
  let decimals: number;
  if (p >= 1000) decimals = 2;
  else if (p >= 1) decimals = 2;
  else if (p >= 0.01) decimals = 4;
  else decimals = 6;
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// Compact 24h percent change for the market-picker rows. Returns null when there's
// no real change value (so the row omits the indicator instead of showing a placeholder).
function formatRowChange(v: number | undefined): string | null {
  if (v == null || !isFinite(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// OrderTicket replaced by HyperliquidOrderTicket (imported above)

// Strip "-PERP" suffix for display only — keep the underlying symbol intact for data queries
function displayLabel(sym: string): string {
  return sym.endsWith('-PERP') ? sym.slice(0, -5) : sym;
}

type PickerCategory = 'all' | MarketCategory;
const PICKER_TABS: { id: PickerCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'equities', label: 'Equities' },
];

// Deduplicate symbols: if both "SOL" and "SOL-PERP" exist, keep only "SOL-PERP"
function deduplicateSymbols(symbols: string[]): string[] {
  const perpSet = new Set(symbols.filter((s) => s.endsWith('-PERP')));
  return symbols.filter((s) => {
    // If this is a bare asset name AND a "-PERP" version exists, drop the bare one
    if (!s.endsWith('-PERP') && perpSet.has(`${s}-PERP`)) return false;
    return true;
  });
}



// ─── Main Trade Page ──────────────────────────────────────────────────────────

const LS_SIDEBAR_KEY = 'aeonian:sidebarCollapsed';
const LS_ORDERBOOK_KEY = 'aeonian:orderbook:collapsed';

// ─── Desktop column-header band ──────────────────────────────────────────────
// All four desktop columns (Markets · Chart · Order Book · Order ticket) carry a
// header band of THIS height so their headers align on one top row, Phantom-style.
const DESKTOP_HEADER_H = 60;

// Shared type treatment for every header tab/label across the four columns so the
// whole top row reads as one consistent tab band (same size, weight, casing).
const DESKTOP_HEADER_TAB_STYLE: CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  lineHeight: 1,
  padding: '0 12px',
  whiteSpace: 'nowrap',
  transition: 'color 0.12s ease',
};

export function TradePage() {
  const { symbol = 'SOL-PERP' } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { blocked } = useGeoBlocked('phoenix');
  const { user, login, loading: authLoading } = useAuth();

  // Kick off the ads subscription immediately on trade page mount — before auth
  // resolves — so the carousel has data ready the instant it becomes visible.
  // startAdsSubscription() is idempotent; calling it multiple times is safe.
  startAdsSubscription();

  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState<PickerCategory>('all');
  const { isFavorite, toggleFavorite } = useFavoriteMarkets();
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [marketMetaMap, setMarketMetaMap] = useState<Map<string, MarketMeta>>(new Map());
  const [traderData, setTraderData] = useState<TraderData | null>(null);
  const [traderLoading, setTraderLoading] = useState(false);

  // Timeframe state for the chart
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');

  // Price Chart + Order Book layout is responsive:
  //  • Desktop (lg+, >=1024px): rendered side-by-side, both always visible.
  //  • Mobile/tablet: a compact tabbed switcher shows only one panel at a time.
  // We render ONE layout tree at a time (driven by `isDesktopLayout`) so the chart's
  // candle polling and the order book's 2s polling never run twice in parallel.
  // `mobilePanel` controls which panel the mobile tab shows; defaults to the chart.
  const [mobilePanel, setMobilePanel] = useState<'chart' | 'orderbook'>('chart');

  // Desktop Order Book | Trades tab. Trades is a labeled placeholder (no recent-
  // trades data is fetched client-side), so this only ever holds 'book' today —
  // kept as state so the active-tab styling has a single source of truth.
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');

  const [isDesktopLayout, setIsDesktopLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false,
  );

  // Desktop markets sidebar collapse state — persisted to localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(LS_SIDEBAR_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(LS_SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Desktop order book collapse state — persisted to localStorage, mirrors sidebar pattern
  const [orderbookCollapsed, setOrderbookCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(LS_ORDERBOOK_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const toggleOrderbook = useCallback(() => {
    setOrderbookCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(LS_ORDERBOOK_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // MOBILE SHEET: state for the slide-up order entry bottom sheet.
  // orderSheetOpen drives MobileOrderSheet open/close.
  // orderSheetSide tracks which side was tapped (Long=buy / Short=sell).
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [orderSheetSide, setOrderSheetSide] = useState<'buy' | 'sell'>('buy');

  const openOrderSheet = useCallback((side: 'buy' | 'sell') => {
    setOrderSheetSide(side);
    setOrderSheetOpen(true);
  }, []);

  const closeOrderSheet = useCallback(() => {
    setOrderSheetOpen(false);
  }, []);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktopLayout(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // On desktop the Trade page fills the full viewport with its own internal scroll
  // regions. Lock #app-main so it does not itself scroll — this prevents the sticky
  // AppHeader from being dragged out of view. Restore on unmount / mobile.
  useEffect(() => {
    if (!isDesktopLayout) return;
    const appMain = document.getElementById('app-main');
    if (!appMain) return;
    const prev = appMain.style.overflowY;
    appMain.style.overflowY = 'hidden';
    return () => { appMain.style.overflowY = prev; };
  }, [isDesktopLayout]);

  // 24h price change — derived from a separate 1d candle fetch
  const [change24h, setChange24h] = useState<number | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const traderIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live candles from /api/phoenix/candles — used for price display and chart
  const [candles, setCandles] = useState<ApiCandle[]>([]);
  const [isLoadingCandles, setIsLoadingCandles] = useState(true);
  const candlesIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const candlesAbortRef = useRef<AbortController | null>(null);
  const fetchCandlesRef = useRef<((capturedSymbol: string, capturedTimeframe: Timeframe, signal: AbortSignal, attempt?: number) => Promise<void>) | null>(null);

  // Snapshot polling: fetch market list (config only) once for the symbol picker
  const snapshotFetchedRef = useRef(false);

  const fetchSymbolList = useCallback(async () => {
    try {
      // Use markets-overview (has maxLeverage + isolatedOnly + marketPubkey + baseLotDecimals
      // + live markPrice/lastPrice/change24h for every market in one call). This is the same
      // source the dropdown rows read their live mark price from — no extra endpoint needed.
      const raw = await api.get<unknown>('/api/phoenix/markets-overview');
      const list: MarketInfo[] = Array.isArray(raw)
        ? (raw as MarketInfo[])
        : ((raw as { markets?: MarketInfo[] })?.markets ?? []);

      // Seed the live registry so toPerpKey / getMarketPubkey / getMarket can resolve
      // symbols that are live on Phoenix but not yet in the static MARKETS map. Only needs
      // to run once — the registry is append-only and the symbol set is stable.
      if (!snapshotFetchedRef.current) {
        seedLiveMarkets(list.map((m) => ({
          symbol: m.symbol,
          marketPubkey: m.marketPubkey,
          baseLotDecimals: m.baseLotDecimals,
        })));

        // Build the symbol list from the live overview for ALL active symbols —
        // after seedLiveMarkets(), toPerpKey() resolves both static and live-only symbols.
        const rawSymbols = list.map((m) => m.symbol ?? '').filter(Boolean);
        const fromOverview = deduplicateSymbols(rawSymbols)
          .map((s) => toPerpKey(s))
          .filter((s): s is string => s !== null);
        // If the live overview returns nothing, show all markets from the static registry
        const symbols = fromOverview.length > 0 ? fromOverview : ALL_MARKET_KEYS;
        setAvailableSymbols(symbols);
        snapshotFetchedRef.current = true;
      }

      // Rebuild per-market metadata map (keyed by normalised PERP symbol) on every call so
      // the dropdown's live mark price refreshes — leverage/iso flags are stable, price moves.
      const metaMap = new Map<string, MarketMeta>();
      for (const m of list) {
        const perpSym = toPerpKey(m.symbol ?? '');
        if (perpSym) {
          // Prefer mark price, fall back to last-trade price; only keep a real positive value.
          const livePrice = m.markPrice ?? m.lastPrice;
          metaMap.set(perpSym, {
            maxLeverage: m.maxLeverage ?? 1,
            isolatedOnly: m.isolatedOnly ?? false,
            markPrice: typeof livePrice === 'number' && livePrice > 0 ? livePrice : undefined,
            // Only keep a finite change value; markets without one (e.g. Pyth commodities)
            // simply omit the indicator in the row.
            change24h: typeof m.change24h === 'number' && isFinite(m.change24h) ? m.change24h : undefined,
            // volume24h and openInterest are real numbers from Phoenix config when present
            volume24h: typeof m.volume24h === 'number' && m.volume24h > 0 ? m.volume24h : undefined,
            openInterest: typeof m.openInterest === 'number' && m.openInterest > 0 ? m.openInterest : undefined,
          });
        }
      }
      if (metaMap.size > 0) setMarketMetaMap(metaMap);
    } catch {
      // Overview unreachable — show all static markets so the picker is always populated.
      if (!snapshotFetchedRef.current) {
        setAvailableSymbols(ALL_MARKET_KEYS);
        snapshotFetchedRef.current = true;
      }
    }
  }, []);

  // Candle polling: fetch /api/phoenix/candles every 7s for live prices and chart
  const fetchCandles = useCallback(async (capturedSymbol: string, capturedTimeframe: Timeframe, signal: AbortSignal, attempt = 0) => {
    try {
      const raw = await api.get<unknown>(
        `/api/phoenix/candles?symbol=${encodeURIComponent(capturedSymbol)}&timeframe=${capturedTimeframe}&limit=200`,
      );
      if (signal.aborted) return;
      // api.get unwraps {success, data} — raw may be the array directly or nested
      const arr: ApiCandle[] = Array.isArray(raw) ? (raw as ApiCandle[]) : ((raw as { data?: ApiCandle[] })?.data ?? []);
      if (arr.length > 0) {
        setCandles(arr);
        setIsLoadingCandles(false);
      }
    } catch {
      if (signal.aborted) return;
      // Retry once after ~1s on first failure
      if (attempt === 0) {
        setTimeout(() => {
          if (!signal.aborted) fetchCandlesRef.current?.(capturedSymbol, capturedTimeframe, signal, 1);
        }, 1000);
      } else {
        setIsLoadingCandles(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  fetchCandlesRef.current = fetchCandles;

  // Reset and restart candle polling when symbol or timeframe changes
  useEffect(() => {
    // Cancel any in-flight request from the previous symbol/timeframe
    if (candlesAbortRef.current) candlesAbortRef.current.abort();
    if (candlesIntervalRef.current) clearInterval(candlesIntervalRef.current);

    const controller = new AbortController();
    candlesAbortRef.current = controller;

    setCandles([]);
    setIsLoadingCandles(true);
    setChange24h(null);
    fetchSymbolList();
    fetchCandles(symbol, timeframe, controller.signal);

    // Fetch 24h change from 1d timeframe (2 candles: yesterday and today)
    api.get<unknown>(
      `/api/phoenix/candles?symbol=${encodeURIComponent(symbol)}&timeframe=1d&limit=2`,
    ).then((raw) => {
      if (controller.signal.aborted) return;
      const arr: ApiCandle[] = Array.isArray(raw) ? (raw as ApiCandle[]) : ((raw as { data?: ApiCandle[] })?.data ?? []);
      if (arr.length >= 2) {
        const prev = arr[arr.length - 2];
        const curr = arr[arr.length - 1];
        if (prev.markClose && curr.markClose && prev.markClose !== 0) {
          setChange24h(((curr.markClose - prev.markClose) / prev.markClose) * 100);
        }
      } else if (arr.length === 1) {
        // Only one candle — compute change within today using open vs close
        const c = arr[0];
        if (c.markOpen && c.markClose && c.markOpen !== 0) {
          setChange24h(((c.markClose - c.markOpen) / c.markOpen) * 100);
        }
      }
    }).catch(() => { /* non-critical, ignore */ });

    candlesIntervalRef.current = setInterval(() => {
      if (!controller.signal.aborted) fetchCandles(symbol, timeframe, controller.signal);
    }, 7000);

    return () => {
      controller.abort();
      if (candlesIntervalRef.current) clearInterval(candlesIntervalRef.current);
    };
  }, [symbol, timeframe, fetchCandles, fetchSymbolList]);

  // Fetch trader data — same pattern as PortfolioPage
  const fetchTrader = useCallback(async () => {
    // During the transient auth-init window (~1-3s), useAuth() can flicker to
    // user=undefined before settling back to the authenticated object. Guard
    // against that by only clearing trader data when auth has fully settled
    // (authLoading === false) AND there is genuinely no logged-in user.
    // While loading is still true, just bail out and leave the last-known data
    // intact — same spirit as the catch block below that preserves data on API errors.
    if (!user?.address) {
      if (!authLoading) setTraderData(null);
      return;
    }
    setTraderLoading(true);
    try {
      const data = await api.get<TraderData>(`/api/phoenix/trader/${user.address}`);
      // Zero-guard: if the new response shows zero collateral but we already have
      // a good non-zero reading in state, keep the existing value.
      // This prevents a transient stale-zero from the upstream overwriting the
      // known-good balance on the screen. A genuine zero-balance account (no prior
      // non-zero state) is still accepted normally.
      setTraderData((prev) => {
        const incomingCollateral = toNumber(data?.collateralBalance);
        const existingCollateral = prev ? toNumber(prev.collateralBalance) : 0;
        if (incomingCollateral === 0 && existingCollateral > 0) {
          // Discard the stale zero — keep the last known non-zero balance.
          return prev;
        }
        return data;
      });
    } catch {
      // Preserve the last-known-good trader data on a transient API error.
      // Setting null here would zero out the displayed balance and trigger a
      // spurious "Insufficient margin" state even though the user's funds are fine.
      // We intentionally do NOT call setTraderData(null) on a background refresh failure.
    } finally {
      setTraderLoading(false);
    }
    // Draft-only: inject a fake profitable position so the win-celebration flow
    // can be tested on Poofnet where the live Phoenix API is unreachable.
    if (isDraftEnv) {
      setTraderData((prev) => {
        const positions = prev?.positions ?? [];
        const alreadyHasMock = positions.some((p) => p._isMockDraftPosition);
        if (alreadyHasMock) return prev;
        const mockPositions = [...positions, MOCK_DRAFT_POSITION];
        if (prev) {
          return { ...prev, positions: mockPositions };
        }
        // No real trader data (404) — create a minimal shell just to hold the mock.
        return {
          collateralBalance:                    { value: 0, decimals: 6, ui: '0' },
          effectiveCollateral:                  { value: 0, decimals: 6, ui: '0' },
          effectiveCollateralForWithdrawals:    { value: 0, decimals: 6, ui: '0' },
          unrealizedPnl:                        { value: 0, decimals: 6, ui: '0' },
          portfolioValue:                       { value: 0, decimals: 6, ui: '0' },
          positions: mockPositions,
          limitOrders: {},
        } satisfies TraderData;
      });
    }
  }, [user?.address, authLoading]);

  useEffect(() => {
    fetchTrader();
  }, [fetchTrader]);

  // Keep the dropdown's live mark prices fresh while the picker is open.
  // Re-pulls markets-overview (20s server-cached) on open and every 10s thereafter,
  // reusing the exact same source the rows render from. No new endpoint.
  useEffect(() => {
    if (!showMarketPicker) return;
    fetchSymbolList();
    const id = setInterval(() => fetchSymbolList(), 10_000);
    return () => clearInterval(id);
  }, [showMarketPicker, fetchSymbolList]);

  // Desktop sidebar: always visible, so keep live prices fresh continuously.
  // The same 20s server-cache means this poll never fires more than 3× per minute
  // in practice. Separate from the dropdown effect so mobile is unaffected.
  useEffect(() => {
    if (!isDesktopLayout) return;
    const id = setInterval(() => fetchSymbolList(), 10_000);
    return () => clearInterval(id);
  }, [isDesktopLayout, fetchSymbolList]);

  // Periodic trader data refetch — every 15s while logged in.
  // Keeps the balance self-healing after a transient stale-zero read without
  // requiring the user to navigate away. The zero-guard in fetchTrader ensures
  // a polling read that returns $0 never overwrites a previously good balance.
  // Mirror the candle-poll pattern: store the interval in a ref and clear on unmount.
  useEffect(() => {
    if (!user?.address) {
      if (traderIntervalRef.current) {
        clearInterval(traderIntervalRef.current);
        traderIntervalRef.current = null;
      }
      return;
    }
    traderIntervalRef.current = setInterval(() => {
      fetchTrader();
    }, 15_000);
    return () => {
      if (traderIntervalRef.current) {
        clearInterval(traderIntervalRef.current);
        traderIntervalRef.current = null;
      }
    };
  }, [user?.address, fetchTrader]);

  // Derive live prices from candles
  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const markPrice = latestCandle?.markClose;
  const lastPrice = latestCandle?.close;

  // Per-market leverage metadata for the currently selected symbol
  const currentMarketMeta = marketMetaMap.get(symbol);

  // Positions for the current symbol (raw RisePosition[] for the chart)
  const rawPositions = Array.isArray(traderData?.positions) ? traderData.positions as RisePosition[] : [];
  const symbolPositions = rawPositions
    .filter((p) => !p.symbol || p.symbol.replace(/-PERP$/i, '').toUpperCase() === symbol.replace(/-PERP$/i, '').toUpperCase())
    .map(mapPosition);

  // Live mark price per open-position symbol, used as a safety-net in the Positions card.
  // Seed from each position's own raw markPrice (the live Phoenix mark, when present), then
  // overlay the live candle markClose for the currently-charted symbol so it always has the
  // freshest value. Symbols with no live price simply fall back to entry price downstream.
  const liveMarkBySymbol = (() => {
    const map = new Map<string, number>();
    for (const pos of rawPositions) {
      const sym = pos.symbol;
      if (!sym) continue;
      const mark = pos.markPrice ? toNumber(pos.markPrice) : 0;
      if (mark > 0) map.set(sym, mark);
    }
    if (markPrice != null && markPrice > 0) map.set(symbol, markPrice);
    return map.size > 0 ? map : undefined;
  })();

  // Close position handler — submits a market order in the opposite direction at full size.
  // For isolated positions (subaccountIndex > 0), also sweeps collateral back to main wallet after close.
  async function handleClosePosition(pos: TraderPosition) {
    if (!user?.address) { errorToast('Log in to close positions.'); return; }

    // Snapshot PnL immediately (before any async work) so we use the value the
    // user saw at click time, not a potentially-stale reactive value that may
    // have flickered to 0 by the time the close resolves.
    const snapshotPnl = pos.pnl ?? 0;

    // Draft-only: short-circuit for the injected test position.
    // Fires celebrate() directly without attempting a real Phoenix transaction.
    if (isDraftEnv && pos._isMockDraftPosition) {
      toast.success('Test position closed. (draft only)');
      if (snapshotPnl > 0) celebrate(snapshotPnl, pos.symbol ?? symbol);
      // Remove the mock from the local state so the list updates.
      setTraderData((prev) => {
        if (!prev) return prev;
        return { ...prev, positions: prev.positions.filter((p) => !p._isMockDraftPosition) };
      });
      return;
    }

    const posSymbol = pos.symbol ?? symbol;
    const marketPubkey = getMarketPubkey(posSymbol);
    if (!marketPubkey) { errorToast(`This market isn't available right now: ${posSymbol}.`); return; }
    if (!pos.size || pos.size <= 0) { errorToast("This position can't be closed right now."); return; }
    // Narrowed copy — TS loses the `pos.size` narrowing inside the nested async closure below.
    const closeSizeBase = pos.size;

    const closeSide = pos.side?.toLowerCase() === 'long' ? 'short' : 'long';

    // Determine whether this is an isolated sub-account position (index > 0) or cross (index 0 / unset)
    const isIsolated = typeof pos.subaccountIndex === 'number' && pos.subaccountIndex > 0;
    const subaccountIndex = isIsolated ? (pos.subaccountIndex as number) : 0;

    const key = `${posSymbol}:${pos.side ?? ''}`;
    setClosingKey(key);
    const toastId = toast.loading(`Closing your ${pos.side?.toLowerCase()} ${pos.symbol?.replace(/-PERP$/, '')} position — approve in your wallet…`);

    try {
      const sizeUsdValue = Math.floor((pos.size ?? 0) * (pos.markPrice ?? 0));
      const sizeBaseLots = toBaseLots(posSymbol, pos.size);

      // Realized PnL as a % of margin (cost basis), for the "big win" flag.
      // margin = notional / leverage, so pnl% of margin = (pnl * leverage) / notional * 100.
      // Use the live notional (size × markPrice) and the position's leverage; omit
      // when either is missing so the backend falls back to the $500-only threshold.
      const notionalUsd = (pos.size ?? 0) * (pos.markPrice ?? 0);
      const closePnlPct =
        pos.pnl != null && pos.leverage != null && pos.leverage > 0 && notionalUsd > 0
          ? (pos.pnl * pos.leverage) / notionalUsd * 100
          : undefined;

      // This handler always closes the FULL position (it submits the entire remaining
      // size, pos.size). isFullClose is therefore true whenever the requested close size
      // equals the full position's base lots. The phoenixIsoClose hook uses this flag to
      // atomically sweep freed collateral back to cross/main in the SAME tx on a full close.
      const fullPositionBaseLots = toBaseLots(posSymbol, pos.size);
      const isFullClose = sizeBaseLots >= fullPositionBaseLots;

      // Place the close order in the opposite direction.
      // Isolated positions (subaccountIndex > 0) MUST go through phoenixIsoClose, whose onchain hook
      // runs syncParentToChild BEFORE the reduce order — phoenixOrder skips that step and reverts on-chain.
      // Cross-margin closes (subaccountIndex 0) continue to use phoenixOrder unchanged.
      if (isIsolated) {
        // Isolated close via the Flight SDK so the builder fee is collected (this
        // brings isolated closes onto the same fee rail as cross). A reduce-only
        // close on an isolated subaccount; on a FULL close let the SDK sweep freed
        // collateral back to the parent atomically (skipTransferToParent:false), on a
        // PARTIAL close keep it on the subaccount (the separate sweep below handles it).
        // Flight bypasses the phoenixIsoClose collection, so we re-create its points +
        // trade-record side-effects via /api/phoenix/record-trade.
        //
        // SIZE UNITS: placeIsolatedOrderViaFlight expects HUMAN-READABLE base size
        // (pos.size), NOT base lots — the API converts to lots server-side.
        // TEMPORARY DIAGNOSTIC: capture any swallowed console.error so a revert reason
        // still surfaces verbatim.
        const { result: closeResult, capturedError } = await captureConsoleErrorDuring(async () => {
          try {
            return await placeIsolatedOrderViaFlight({
              walletAddress: user.address,
              symbol: posSymbol,
              side: closeSide === 'long' ? Side.Bid : Side.Ask,
              sizeBase: closeSizeBase, // human-readable base units
              limitPriceUsd: null, // market close
              subaccountIndex,
              isReduceOnly: true,
              skipTransferToParent: !isFullClose,
            });
          } catch (isoErr) {
            return { error: isoErr } as const;
          }
        });

        toast.dismiss(toastId);

        if (!closeResult || 'error' in closeResult) {
          // TEMPORARY DIAGNOSTIC: show the verbatim revert reason for screenshotting.
          const isoErr = closeResult && 'error' in closeResult ? closeResult.error : undefined;
          console.error('[ISO CLOSE] raw failure:', { capturedError, isoErr, diagnostic: buildIsoErrorMessage({ err: isoErr, capturedError }) });
          errorToast("We couldn't close your position. Please try again.");
          setClosingKey(null);
          return;
        }

        await recordFlightTrade(
          {
            txSignature: closeResult.txSignature,
            trader: user.address,
            market: marketPubkey,
            symbol: posSymbol,
            side: closeSide,
            sizeBaseLots,
            leverage: pos.leverage ?? 1,
            orderType: 'market',
            subaccountIndex,
            sizeUsd: sizeUsdValue,
            isClose: true,
            pnlUsdCents: pos.pnl != null ? Math.round(pos.pnl * 100) : undefined,
            pnlPct: closePnlPct,
          },
          login,
        );
      } else {
        // Cross-margin close: route through the Flight SDK so the builder fee is
        // collected. Flight bypasses the phoenixOrder collection, so we re-create
        // its points + trade-record side-effects via /api/phoenix/record-trade.
        //
        // SIZE UNITS: placeOrderViaFlight expects HUMAN-READABLE base size (pos.size),
        // NOT base lots — the Rise SDK converts to lots internally.
        let txSignature: string;
        try {
          const result = await placeOrderViaFlight({
            walletAddress: user.address,
            symbol: posSymbol,
            side: closeSide === 'long' ? Side.Bid : Side.Ask,
            sizeBase: pos.size, // human-readable base units
            limitPriceUsd: null, // market close
            traderSubaccountIndex: 0, // 0 = cross margin
          });
          txSignature = result.txSignature;
        } catch (flightErr) {
          toast.dismiss(toastId);
          console.error('[CLOSE] cross flight failure:', flightErr);
          errorToast("We couldn't close your position. Please try again.");
          setClosingKey(null);
          return;
        }

        toast.dismiss(toastId);

        await recordFlightTrade(
          {
            txSignature,
            trader: user.address,
            market: marketPubkey,
            symbol: posSymbol,
            side: closeSide,
            sizeBaseLots,
            leverage: pos.leverage ?? 1,
            orderType: 'market',
            subaccountIndex: 0,
            sizeUsd: sizeUsdValue,
            isClose: true,
            pnlUsdCents: pos.pnl != null ? Math.round(pos.pnl * 100) : undefined,
            pnlPct: closePnlPct,
          },
          login,
        );
      }

      toast.success('Position closed.');
      if (snapshotPnl > 0) celebrate(snapshotPnl, pos.symbol ?? symbol);
      fetchTrader();

      // For isolated PARTIAL closes, sweep the freed collateral back to the main wallet
      // in a separate transaction. On a FULL close the phoenixIsoClose hook already swept
      // (transferToCross) atomically inside the same close tx, so firing a second sweep here
      // would be redundant and prompt a pointless second wallet signature — skip it.
      if (isIsolated && !isFullClose) {
        const sweepToastId = toast.loading('Moving funds back to your main account…');
        try {
          const sweepId = crypto.randomUUID();
          const swept = await setPhoenixIsolatedSweep(sweepId, { subaccountIndex });
          toast.dismiss(sweepToastId);
          if (swept) {
            toast.success('Funds moved back to your main account.');
          } else {
            errorToast("Your position closed, but we couldn't move the funds back. You can move them manually from your portfolio.");
          }
        } catch (sweepErr) {
          toast.dismiss(sweepToastId);
          console.error('[CLOSE] sweep failure:', sweepErr);
          errorToast("Your position closed, but we couldn't move the funds back. You can move them manually from your portfolio.");
        }
      }
    } catch (err) {
      toast.dismiss(toastId);
      // TEMPORARY DIAGNOSTIC: surface the verbatim error (message + program logs + tx sig).
      console.error('[CLOSE] raw thrown error:', err, buildIsoErrorMessage({ err }));
      errorToast("We couldn't close your position. Please try again.");
    } finally {
      setClosingKey(null);
    }
  }

  // ─── DESKTOP LAYOUT (≥1024px) ──────────────────────────────────────────────
  // Rendered ONLY when isDesktopLayout is true. Mobile layout below is unchanged.
  if (isDesktopLayout) {
    const displayMark = markPrice != null && markPrice > 0
      ? `$${formatPrice(markPrice)}`
      : lastPrice != null && lastPrice > 0
      ? `$${formatPrice(lastPrice)}`
      : null;

    return (
      <div
        className='text-white'
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          overflow: 'hidden',
        }}
      >
        {/* ── Top header bar ── */}
        <AppHeader />

        {/* ── 4-column body: Sidebar | Chart | Orderbook | Ticket ──
            Each column owns its OWN header band (height DESKTOP_HEADER_H) so all
            four headers align on a single top row — Phantom-style. The floating
            full-width stats bar was removed; its contents now live inside the
            chart column's own header band below. */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {/* COL 1: Market sidebar */}
          <MarketSidebar
            selectedSymbol={symbol}
            availableSymbols={availableSymbols}
            marketMetaMap={marketMetaMap}
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
          />

          {/* COL 2+3 wrapper: Chart + (below) positions panel — vertical PanelGroup */}
          <PanelGroup
            direction="vertical"
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {/* TOP PANEL: Chart + Orderbook side by side */}
            <Panel defaultSize={70} minSize={35} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Chart + Orderbook row — fills the top Panel */}
            <div
              style={{
                display: 'flex',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              {/* COL 2: Chart — stretches to fill available height.
                  Its OWN header band carries the symbol identity (left) and the
                  Mark / 24h Change + Rewards (right) — replacing the old floating
                  stats bar, Phantom-style. */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  minHeight: 0,
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {/* Chart card header band */}
                <div
                  style={{
                    height: DESKTOP_HEADER_H,
                    minHeight: DESKTOP_HEADER_H,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '0 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flexShrink: 0,
                  }}
                >
                  {/* LEFT: token identity + leverage / iso pills */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <TokenLogo symbol={symbol} size={16} />
                    <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                      {displayLabel(symbol)}
                    </span>
                    {currentMarketMeta?.maxLeverage != null && (
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 5,
                          background: 'rgba(183,148,246,0.18)',
                          color: '#b794f6',
                          letterSpacing: '0.04em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {currentMarketMeta.maxLeverage}x
                      </span>
                    )}
                    {currentMarketMeta?.isolatedOnly && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 5,
                          background: 'rgba(99,102,241,0.18)',
                          color: '#818cf8',
                          letterSpacing: '0.04em',
                        }}
                      >
                        ISO
                      </span>
                    )}
                  </div>

                  {/* RIGHT: Mark + 24h Change + Rewards (far right) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexShrink: 0 }}>
                    {/* Mark */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, lineHeight: 1 }}>
                      <span style={{ fontSize: 11, color: '#5A5A6A', letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 500 }}>
                        Mark
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#E0E0E8', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                        {isLoadingCandles && displayMark == null ? '—' : (displayMark ?? '—')}
                      </span>
                    </div>

                    {/* 24h Change — hidden when no real value (no placeholder dash) */}
                    {change24h != null && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, lineHeight: 1 }}>
                        <span style={{ fontSize: 11, color: '#5A5A6A', letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 500 }}>
                          24h Change
                        </span>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: change24h >= 0 ? '#4ADE80' : '#FF5252',
                            letterSpacing: '-0.01em',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {`${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`}
                        </span>
                      </div>
                    )}

                  </div>
                </div>

                <DesktopPriceChart
                  symbol={symbol}
                  candles={candles}
                  isLoading={isLoadingCandles}
                  positions={symbolPositions}
                  timeframe={timeframe}
                  onTimeframeChange={(tf) => setTimeframe(tf)}
                />
              </div>

              {/* COL 3: Orderbook — collapsible, mirrors sidebar pattern */}
              <div
                style={{
                  width: orderbookCollapsed ? 36 : 290,
                  minWidth: orderbookCollapsed ? 36 : 290,
                  maxWidth: orderbookCollapsed ? 36 : 290,
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0,
                  overflow: 'visible',
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                  position: 'relative',
                  transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                {/* Edge pill toggle — LEFT outer edge of the orderbook, vertically centered.
                    Mirrors the sidebar toggle exactly: same pill image, same positioning,
                    but on the left side. Arrow flips to point expand/collapse correctly.
                    Orderbook is to the RIGHT of chart, so collapsed=point-right (expand),
                    expanded=point-left (collapse). The sidebar image points left by default,
                    so no scaleX for collapsed (point right = default) and scaleX(-1) for expanded. */}
                <button
                  onClick={toggleOrderbook}
                  aria-label={orderbookCollapsed ? 'Expand order book' : 'Collapse order book'}
                  style={{
                    position: 'absolute',
                    left: -18,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                    opacity: 0.85,
                    transition: 'opacity 0.15s ease, transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(1.08)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '0.85';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(1)';
                  }}
                >
                  <img
                    src='https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3be3c865ed135dbf0b54e2'
                    alt={orderbookCollapsed ? 'Expand order book' : 'Collapse order book'}
                    style={{
                      width: 18,
                      height: 48,
                      objectFit: 'contain',
                      display: 'block',
                      // Default pill image arrow points LEFT (collapse direction for sidebar).
                      // For the orderbook on the RIGHT side of chart:
                      //   expanded → flip to point RIGHT (scaleX(-1)) = collapse toward right
                      //   collapsed → keep default LEFT-pointing = expand (reveal) the orderbook
                      transform: orderbookCollapsed ? 'none' : 'scaleX(-1)',
                      transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                </button>

                {/* Inner content — hidden when collapsed via overflow:hidden on a wrapper */}
                <div
                  style={{
                    width: 290,
                    minWidth: 290,
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    overflow: 'hidden',
                    opacity: orderbookCollapsed ? 0 : 1,
                    transition: 'opacity 0.18s ease',
                    pointerEvents: orderbookCollapsed ? 'none' : 'auto',
                  }}
                >
                  {/* Order Book | Trades tab band — same height + type treatment as
                      the chart header so all four column headers align on one row. */}
                  <div
                    style={{
                      height: DESKTOP_HEADER_H,
                      minHeight: DESKTOP_HEADER_H,
                      display: 'flex',
                      alignItems: 'stretch',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      flexShrink: 0,
                    }}
                  >
                    <button
                      onClick={() => setBookTab('book')}
                      style={{
                        ...DESKTOP_HEADER_TAB_STYLE,
                        color: bookTab === 'book' ? '#ffffff' : '#6b6b80',
                        boxShadow: bookTab === 'book' ? 'inset 0 -2px 0 rgba(171,159,242,0.7)' : 'none',
                      }}
                    >
                      Order Book
                    </button>
                  </div>
                  {/* Book content — fills remaining panel height; DesktopOrderbook measures it */}
                  <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                    <DesktopOrderbook symbol={symbol} />
                  </div>
                </div>
              </div>
            </div>
            </Panel>

            {/* Draggable resize handle between chart section and positions panel */}
            <PanelResizeHandle className="desktop-resize-handle">
              {/* Visible grip indicator — a subtle pill in the center */}
              <div className="desktop-resize-handle__grip" />
            </PanelResizeHandle>

            {/* BOTTOM PANEL: Positions/activity — scrollable within the panel */}
            <Panel defaultSize={30} minSize={15} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <UserActivityPanel
                  symbol={symbol}
                  positions={rawPositions.map(mapPosition)}
                  openOrders={flattenLimitOrders(traderData?.limitOrders)}
                  parentLoading={traderLoading}
                  onClosePosition={handleClosePosition}
                  closeDisabled={blocked}
                  closingKey={closingKey}
                  hideHistoryTabs
                  liveMarkBySymbol={liveMarkBySymbol}
                  flat
                />
              </div>
            </div>
            </Panel>
          </PanelGroup>

          {/* COL 4: Order ticket — fixed width, full height */}
          <div
            style={{
              width: 300,
              minWidth: 300,
              maxWidth: 300,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
              borderLeft: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ flex: 1, overflow: 'auto', paddingBottom: 96 }}>
              <HyperliquidOrderTicket
                symbol={symbol}
                markPrice={markPrice ?? lastPrice}
                isBlocked={blocked}
                traderData={traderData}
                loading={traderLoading || authLoading}
                maxLeverage={currentMarketMeta?.maxLeverage}
                isolatedOnly={currentMarketMeta?.isolatedOnly}
                headerBandHeight={DESKTOP_HEADER_H}
                flat
              />

              {/* Ads carousel for logged-out visitors */}
              {!user && !authLoading && (
                <div style={{ margin: '12px 12px 0' }}>
                  <AdsCarousel />
                </div>
              )}
            </div>
          </div>
        </div>
        <BottomTabNav />
      </div>
    );
  }

  // ─── MOBILE LAYOUT (below 1024px) ────────────────────────────────────────────
  // Chart/orderbook is ALWAYS fully visible. Order entry lives in MobileOrderSheet,
  // triggered by the persistent Long/Short bar docked above BottomTabNav.
  return (
    <div className='min-h-screen text-white' style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 176px)' }}>
      {/* Shared app header with Phoenix wordmark */}
      <AppHeader />

      {/* Market header */}
      <div className='sticky top-[50px] z-40 px-4 pt-1.5 pb-3' style={{ background: 'hsl(var(--background))' }}>
        <button onClick={() => { setShowMarketPicker((v) => !v); setPickerSearch(''); setPickerCategory('all'); }} className='flex items-center gap-2 mb-1.5'>
          <TokenLogo symbol={symbol} size={24} />
          <span className='font-bold text-xl'>{displayLabel(symbol)}</span>
          <ChevronDown
            size={32}
            className={`transition-transform duration-300 ease-out ${showMarketPicker ? '' : 'market-chevron-hint'}`}
            style={showMarketPicker ? { color: '#8A8A8A', transform: 'rotate(180deg)' } : { color: '#8A8A8A' }}
          />
        </button>

        {showMarketPicker && availableSymbols.length > 0 && (() => {
          const q = pickerSearch.trim().toLowerCase();
          const visibleSymbols = availableSymbols
            .filter((sym) => {
              const bare = displayLabel(sym).toLowerCase();
              const matchesSearch = q === '' || bare.includes(q);
              const matchesCategory = pickerCategory === 'all' || getMarketCategory(sym) === pickerCategory;
              return matchesSearch && matchesCategory;
            })
            // Pin favorites to the top, preserving each group's existing order.
            .map((sym, i) => ({ sym, i }))
            .sort((a, b) => {
              const favA = isFavorite(a.sym) ? 0 : 1;
              const favB = isFavorite(b.sym) ? 0 : 1;
              if (favA !== favB) return favA - favB;
              return a.i - b.i;
            })
            .map(({ sym }) => sym);
          return (
            <div className='glass-card-strong absolute top-full left-0 right-0 z-50 flex flex-col' style={{ background: 'linear-gradient(to bottom, #0a0a0a, #111114)' }}>
              {/* Search + category tabs (fixed above the scrollable list) */}
              <div className='px-4 pt-3 pb-2 space-y-2'>
                <div className='relative'>
                  <Search size={14} className='absolute left-3 top-1/2 -translate-y-1/2' style={{ color: '#8A8A8A' }} />
                  <input
                    type='text'
                    autoFocus
                    placeholder='Search markets...'
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className='w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none'
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
                  />
                </div>
                <div className='flex items-center gap-2 overflow-x-auto -mx-1 px-1'>
                  {PICKER_TABS.map((tab) => {
                    const active = pickerCategory === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setPickerCategory(tab.id)}
                        className='shrink-0 text-xs font-semibold px-3 py-1 rounded-full transition-colors'
                        style={{
                          background: active ? '#1a1a1f' : 'transparent',
                          border: active ? '1px solid rgba(171,159,242,0.3)' : '1px solid rgba(255,255,255,0.06)',
                          color: active ? '#ab9ff2' : '#8A8A8A',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Scrollable market list */}
              <div className='px-4 pb-2 space-y-1 max-h-64 overflow-y-auto'>
                {visibleSymbols.length === 0 ? (
                  <div className='py-6 text-center text-sm' style={{ color: '#8A8A8A' }}>No markets found</div>
                ) : visibleSymbols.map((sym) => {
                  const meta = marketMetaMap.get(sym);
                  return (
                    <button key={sym} onClick={() => { navigate(`/trade/${sym}`); setShowMarketPicker(false); }}
                      className='w-full text-left py-2 pl-1 pr-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-2'
                      style={{ background: sym === symbol ? 'rgba(255,255,255,0.08)' : 'transparent', color: sym === symbol ? '#b794f6' : '#FFF' }}>
                      <span
                        role='button'
                        tabIndex={0}
                        aria-label={isFavorite(sym) ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(sym); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleFavorite(sym); } }}
                        className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors active:scale-90 hover:bg-white/10'
                      >
                        <Star
                          size={16}
                          fill={isFavorite(sym) ? '#b794f6' : 'none'}
                          style={{ color: isFavorite(sym) ? '#b794f6' : '#8A8A8A' }}
                        />
                      </span>
                      <TokenLogo symbol={sym} size={20} />
                      <span className='flex-1'>{displayLabel(sym)}</span>
                      {(() => {
                        const rowPrice = formatRowPrice(meta?.markPrice);
                        return rowPrice ? (
                          <span className='text-xs font-semibold tabular-nums' style={{ color: '#C8C8D0' }}>
                            {rowPrice}
                          </span>
                        ) : null;
                      })()}
                      {(() => {
                        const rowChange = formatRowChange(meta?.change24h);
                        if (rowChange == null) return null;
                        const positive = (meta?.change24h ?? 0) >= 0;
                        return (
                          <span
                            className='text-[10px] font-bold tabular-nums px-1 py-0.5 rounded'
                            style={{
                              background: positive ? 'rgba(74,222,128,0.12)' : 'rgba(255,82,82,0.12)',
                              color: positive ? '#4ADE80' : '#FF5252',
                              lineHeight: 1,
                            }}
                          >
                            {rowChange}
                          </span>
                        );
                      })()}
                      {meta?.maxLeverage != null && (
                        <span
                          className='text-[9px] font-bold px-1 py-0.5 rounded'
                          style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', lineHeight: 1 }}
                        >
                          {meta.maxLeverage}x
                        </span>
                      )}
                      {meta?.isolatedOnly && (
                        <span
                          className='text-[9px] font-bold px-1 py-0.5 rounded'
                          style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', lineHeight: 1 }}
                        >
                          ISO
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className='flex items-center gap-3 flex-wrap'>
          {isLoadingCandles && markPrice == null && lastPrice == null ? (
            <div
              className='rounded-lg'
              style={{
                width: '140px',
                height: '36px',
                background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.04) 75%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s infinite',
              }}
            />
          ) : (
            <span className='text-3xl font-bold tabular-nums'>{markPrice != null && markPrice > 0 ? `$${formatPrice(markPrice)}` : lastPrice != null && lastPrice > 0 ? `$${formatPrice(lastPrice)}` : '—'}</span>
          )}
          {/* 24h price change badge */}
          {change24h != null && (
            <span
              className='flex items-center gap-0.5 text-sm font-bold tabular-nums px-2 py-0.5 rounded-lg'
              style={{
                background: change24h >= 0 ? 'rgba(74,222,128,0.12)' : 'rgba(255,82,82,0.12)',
                color: change24h >= 0 ? '#4ADE80' : '#FF5252',
              }}
            >
              {change24h >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
              <span className='text-[10px] font-normal ml-0.5' style={{ opacity: 0.7 }}>24h</span>
            </span>
          )}
        </div>
      </div>

      {/* Mobile chart/orderbook — always fully visible, no collapse toggle */}
      <div className='w-full overflow-hidden'>
        {/* Chart / Orderbook tab bar — no collapse button */}
        <div
          className='flex items-center gap-1 p-1 border-b border-white/5'
          role='tablist'
          aria-label='Chart and order book'
        >
          {/* Chart tab */}
          {(() => {
            const active = mobilePanel === 'chart';
            return (
              <button
                type='button'
                role='tab'
                aria-selected={active}
                onClick={() => setMobilePanel('chart')}
                className='flex-1 rounded-lg text-sm font-semibold transition-colors'
                style={{
                  minHeight: '40px',
                  color: active ? '#FFF' : '#8A8A8A',
                  background: active ? 'rgba(183,148,246,0.16)' : 'transparent',
                }}
              >
                Chart
              </button>
            );
          })()}

          {/* Orderbook tab */}
          {(() => {
            const active = mobilePanel === 'orderbook';
            return (
              <button
                type='button'
                role='tab'
                aria-selected={active}
                onClick={() => setMobilePanel('orderbook')}
                className='flex-1 rounded-lg text-sm font-semibold transition-colors'
                style={{
                  minHeight: '40px',
                  color: active ? '#FFF' : '#8A8A8A',
                  background: active ? 'rgba(183,148,246,0.16)' : 'transparent',
                }}
              >
                Orderbook
              </button>
            );
          })()}
        </div>

        {/* Panel content — always rendered */}
        {mobilePanel === 'chart' ? (
          <div>
            <PriceChart
              symbol={symbol}
              candles={candles}
              isLoading={isLoadingCandles}
              positions={symbolPositions}
              timeframe={timeframe}
              onTimeframeChange={(tf) => setTimeframe(tf)}
              flat
            />
          </div>
        ) : (
          <div style={{ minHeight: '220px' }}>
            <OrderbookPanel symbol={symbol} />
          </div>
        )}
      </div>

      {/* Positions & Activity panel — always rendered so disconnected wallet
          state shows Login button in Positions / Open Orders tabs */}
      <div className='px-4 pt-4 space-y-3'>
        <UserActivityPanel
          symbol={symbol}
          positions={rawPositions.map(mapPosition)}
          openOrders={flattenLimitOrders(traderData?.limitOrders)}
          parentLoading={traderLoading}
          onClosePosition={handleClosePosition}
          closeDisabled={blocked}
          closingKey={closingKey}
          hideHistoryTabs
          liveMarkBySymbol={liveMarkBySymbol}
          flat
        />
      </div>

      {/* Ads carousel — shown only to logged-out visitors */}
      {!user && !authLoading && (
        <div className='px-4 pt-4'>
          <AdsCarousel />
        </div>
      )}

      {/* ── Persistent Long/Short bar — docked above BottomTabNav ── */}
      {/* md:hidden keeps this mobile-only (BottomTabNav uses md:hidden too) */}
      {/* z-[45]: below the nav pill (z-50) but positioned above it in the viewport via
          bottom offset. The nav pill is ~72px high + 12px mb-3 + 24px legal strip = ~108px
          total, so we push the bar up by that amount above the safe-area. */}
      <div
        className='md:hidden fixed left-0 right-0 z-[45]'
        style={{
          bottom: 'calc(108px + env(safe-area-inset-bottom))',
        }}
      >
          <div
            style={{
              margin: '0 16px',
              padding: '8px 8px',
              background: 'rgba(10,6,20,0.92)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: 16,
              border: '1px solid rgba(176,154,217,0.14)',
              boxShadow: '0 -4px 20px rgba(64,19,104,0.3)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            <button
              onClick={() => openOrderSheet('buy')}
              disabled={blocked}
              aria-label='Open Long order'
              style={{
                padding: '13px 0',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: '0.01em',
                background: blocked
                  ? 'rgba(34,197,94,0.15)'
                  : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: blocked ? 'rgba(34,197,94,0.5)' : '#000',
                border: 'none',
                cursor: blocked ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.15s ease, transform 0.1s ease',
              }}
              onTouchStart={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.82'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)'; }}
              onTouchEnd={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
            >
              Long
            </button>
            <button
              onClick={() => openOrderSheet('sell')}
              disabled={blocked}
              aria-label='Open Short order'
              style={{
                padding: '13px 0',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: '0.01em',
                background: blocked
                  ? 'rgba(239,68,68,0.15)'
                  : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: blocked ? 'rgba(239,68,68,0.5)' : '#fff',
                border: 'none',
                cursor: blocked ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.15s ease, transform 0.1s ease',
              }}
              onTouchStart={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.82'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.97)'; }}
              onTouchEnd={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
            >
              Short
            </button>
          </div>
      </div>

      {/* ── Slide-up order entry sheet ── */}
      <MobileOrderSheet
        open={orderSheetOpen}
        onClose={closeOrderSheet}
        initialSide={orderSheetSide}
        symbol={symbol}
        markPrice={markPrice ?? lastPrice}
        isBlocked={blocked}
        traderData={traderData}
        loading={traderLoading || authLoading}
        maxLeverage={currentMarketMeta?.maxLeverage}
        isolatedOnly={currentMarketMeta?.isolatedOnly}
      />

      <BottomTabNav />
    </div>
  );
}


// ─── Desktop chart wrapper — fills the column with an expanded chart ─────────
// Gives the chart more vertical real estate on desktop.

interface DesktopPriceChartProps {
  symbol: string;
  candles: ApiCandle[];
  isLoading: boolean;
  positions: TraderPosition[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
}

// Minimum fallback height used when the ResizeObserver hasn't fired yet or
// reports zero (e.g. when the flex parent chain has no explicit height).
const DESKTOP_CHART_MIN_HEIGHT = 200;

function DesktopPriceChart({
  symbol,
  candles,
  isLoading,
  positions,
  timeframe,
  onTimeframeChange,
}: DesktopPriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(DESKTOP_CHART_MIN_HEIGHT);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      // Accept any positive height so the chart can shrink when the panel is resized
      if (h && h > 60) setContainerHeight(Math.floor(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="chart-touch-zone"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <HybridChart
        symbol={symbol}
        candles={candles}
        isLoading={isLoading}
        positions={positions}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        chartHeight={containerHeight}
        isDesktop={true}
      />
    </div>
  );
}

// ─── Desktop orderbook — measures its own height and fills with levels ───────

// Row height (px) for each order-book level, matching the 'py-0.5' + font size.
const OB_ROW_H = 18;
// Fixed overhead: column-header row + spread bar + bottom padding.
const OB_OVERHEAD_H = 20 + 34 + 16;
// Minimum levels per side regardless of height.
const OB_MIN_LEVELS = 4;
// Maximum levels per side (caps how many API levels we request).
const OB_MAX_LEVELS = 30;

function DesktopOrderbook({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [levels, setLevels] = useState(10);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h <= 0) return;
      const available = h - OB_OVERHEAD_H;
      // Two sides (asks + bids) share the available row space.
      const perSide = Math.max(OB_MIN_LEVELS, Math.min(OB_MAX_LEVELS, Math.floor(available / OB_ROW_H / 2)));
      setLevels(perSide);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ height: '100%', overflow: 'hidden' }}>
      <OrderbookPanel symbol={symbol} desktopLevels={levels} />
    </div>
  );
}

export default TradePage;
