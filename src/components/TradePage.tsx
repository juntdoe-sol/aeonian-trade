import { api } from '@/lib/api-client';
import { useGeoBlocked } from '@/hooks/use-geo-blocked';
import { useAuth } from '@pooflabs/web';
import { ArrowDown, ArrowUp, ChevronDown, Search, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { TokenLogo } from './TokenLogo';
import { UserActivityPanel, OrderbookPanel } from './trading/UserActivityPanel';
import { PriceChart, type Timeframe } from './trading/PriceChart';
import { HyperliquidOrderTicket } from './trading/HyperliquidOrderTicket';
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
}

// Per-market metadata fetched from markets-overview (maxLeverage, isolatedOnly, live price)
interface MarketMeta {
  maxLeverage: number;
  isolatedOnly: boolean;
  /** Live mark price for the market row, when the overview resolved one. */
  markPrice?: number;
  /** 24h percent change for the market row, when the overview resolved one. */
  change24h?: number;
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

  const [isDesktopLayout, setIsDesktopLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false,
  );

  // SHARED collapse state for the Price Chart / Order Book panels. A single boolean
  // drives BOTH panels so toggling the chevron on either one maximizes/minimizes them
  // together — they're always in the same collapsed-or-expanded state.
  //   • Desktop: defaults to collapsed (true) so the trade form is front-and-center.
  //   • Mobile: defaults to EXPANDED (false) — the chart/orderbook starts maximized and
  //     the order form is coordinated to be mutually exclusive with it (see
  //     orderFormExpanded below). Detect the same way the layout does (>=1024px).
  const [panelsCollapsed, setPanelsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true; // SSR — desktop default
    return window.innerWidth >= 1024; // desktop collapsed, mobile expanded
  });

  // MOBILE ONLY: tracks whether the order form is expanded into its full entry block.
  // Mutually exclusive with the chart/orderbook section — expanding the order form
  // collapses the panels (and vice-versa). Defaults to false (collapsed → just the
  // Long/Short buttons). Has no effect on desktop, where the full ticket always renders.
  const [orderFormExpanded, setOrderFormExpanded] = useState(false);

  // Aliases so the desktop chart/orderbook headers and the mobile switcher all read
  // and write the same shared state.
  const chartCollapsed = panelsCollapsed;
  const orderbookCollapsed = panelsCollapsed;
  const setChartCollapsed = setPanelsCollapsed;
  const setOrderbookCollapsed = setPanelsCollapsed;
  const mobileCollapsed = panelsCollapsed;

  // MOBILE chart/orderbook toggle. Maximizing the panels (collapsed → false) also
  // collapses the order form back to just the Long/Short buttons, keeping the two
  // sections mutually exclusive. Minimizing the panels does not force the form open.
  const setMobileCollapse = useCallback((updater: boolean | ((v: boolean) => boolean)) => {
    setPanelsCollapsed((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (!next) setOrderFormExpanded(false); // panels maximized → collapse the order form
      return next;
    });
  }, []);

  // MOBILE order-form expand. Clicking Long/Short in the collapsed form sets the side,
  // minimizes the chart/orderbook (panelsCollapsed = true) and expands the full form.
  const handleOrderFormExpand = useCallback(() => {
    setPanelsCollapsed(true);
    setOrderFormExpanded(true);
  }, []);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktopLayout(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

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

  return (
    <div className='min-h-screen pb-28 text-white'>
      {/* Shared app header with Phoenix wordmark */}
      <AppHeader />

      {/* Market header */}
      <div className='glass-header sticky top-[50px] z-40 px-4 pt-1.5 pb-3'>
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
            <div className='glass-card-strong absolute top-full left-0 right-0 z-50 flex flex-col' style={{ background: 'linear-gradient(to bottom, #0a0a0a, #111114)', backdropFilter: 'blur(12px)' }}>
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
                          background: active ? 'rgba(183,148,246,0.15)' : 'rgba(255,255,255,0.04)',
                          border: active ? '1px solid rgba(183,148,246,0.4)' : '1px solid rgba(255,255,255,0.06)',
                          color: active ? '#b794f6' : '#8A8A8A',
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
                        // Show the live mark price when one exists; hide entirely otherwise
                        // (no misleading dash for rows without a real price source).
                        return rowPrice ? (
                          <span className='text-xs font-semibold tabular-nums' style={{ color: '#C8C8D0' }}>
                            {rowPrice}
                          </span>
                        ) : null;
                      })()}
                      {(() => {
                        const rowChange = formatRowChange(meta?.change24h);
                        // Only render when the overview resolved a real 24h change for this
                        // market (omitted for Pyth-priced commodities — no placeholder/dash).
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

      <div className='px-4 pt-4 space-y-3'>
        {/* ─── Price Chart + Order Book ───────────────────────────────────────
            Desktop (lg+): side-by-side two-column grid, chart wider than the book,
            both always visible. Mobile: a compact tabbed switcher shows one at a time. */}

        {isDesktopLayout ? (
          /* DESKTOP: side-by-side. Chart ~62% / Order Book ~38%. Both always visible. */
          <div className='grid grid-cols-[1.6fr_1fr] gap-3'>
            <div className='glass-card w-full rounded-xl overflow-hidden'>
              <button
                type='button'
                aria-expanded={!chartCollapsed}
                onClick={() => setChartCollapsed((v) => !v)}
                className='flex w-full items-center px-4 border-b border-white/5 transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(183,148,246,0.6)] focus-visible:ring-inset'
                style={{ minHeight: '48px' }}
              >
                <span className='text-sm font-semibold' style={{ color: '#FFF' }}>
                  Chart
                </span>
                <ChevronDown
                  className={`ml-auto h-4 w-4 transition-all duration-200${chartCollapsed ? ' panel-chevron-hint' : ''}`}
                  style={{
                    color: chartCollapsed ? 'rgba(183,148,246,0.95)' : '#8A8A8A',
                    filter: chartCollapsed ? 'drop-shadow(0 0 5px rgba(183,148,246,0.5))' : 'none',
                    transform: chartCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  }}
                />
              </button>
              {!chartCollapsed && (
                <div className='px-3 pb-3 pt-3'>
                  <PriceChart
                    symbol={symbol}
                    candles={candles}
                    isLoading={isLoadingCandles}
                    positions={symbolPositions}
                    timeframe={timeframe}
                    onTimeframeChange={(tf) => setTimeframe(tf)}
                  />
                </div>
              )}
            </div>

            <div className='glass-card w-full rounded-xl overflow-hidden flex flex-col'>
              <button
                type='button'
                aria-expanded={!orderbookCollapsed}
                onClick={() => setOrderbookCollapsed((v) => !v)}
                className='flex w-full items-center px-4 border-b border-white/5 transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(183,148,246,0.6)] focus-visible:ring-inset'
                style={{ minHeight: '48px' }}
              >
                <span className='text-sm font-semibold' style={{ color: '#FFF' }}>
                  Orderbook
                </span>
                <ChevronDown
                  className={`ml-auto h-4 w-4 transition-all duration-200${orderbookCollapsed ? ' panel-chevron-hint' : ''}`}
                  style={{
                    color: orderbookCollapsed ? 'rgba(183,148,246,0.95)' : '#8A8A8A',
                    filter: orderbookCollapsed ? 'drop-shadow(0 0 5px rgba(183,148,246,0.5))' : 'none',
                    transform: orderbookCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  }}
                />
              </button>
              {!orderbookCollapsed && (
                <div className='py-2 flex-1' style={{ minHeight: '220px' }}>
                  <OrderbookPanel symbol={symbol} />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* MOBILE / TABLET: compact tabbed switcher. Only the selected panel renders. */
          <div className='glass-card w-full rounded-xl overflow-hidden'>
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

              {/* Collapse/expand dropdown — centered between the two toggle options */}
              <button
                type='button'
                aria-expanded={!mobileCollapsed}
                aria-label={mobileCollapsed ? 'Expand panel' : 'Collapse panel'}
                onClick={() => setMobileCollapse((v) => !v)}
                className='group flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(183,148,246,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(183,148,246,0.6)] focus-visible:ring-inset'
                style={{ minHeight: '40px', width: '40px' }}
              >
                <ChevronDown
                  className={`h-[1.15rem] w-[1.15rem] transition-all duration-200 group-hover:scale-110${mobileCollapsed ? ' panel-chevron-hint' : ''}`}
                  style={{
                    color: mobileCollapsed ? 'rgba(183,148,246,0.95)' : '#8A8A8A',
                    filter: mobileCollapsed ? 'drop-shadow(0 0 5px rgba(183,148,246,0.55))' : 'none',
                    transform: mobileCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  }}
                />
              </button>

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

            {!mobileCollapsed && (
              mobilePanel === 'chart' ? (
                <div className='px-3 pb-3 pt-3'>
                  <PriceChart
                    symbol={symbol}
                    candles={candles}
                    isLoading={isLoadingCandles}
                    positions={symbolPositions}
                    timeframe={timeframe}
                    onTimeframeChange={(tf) => setTimeframe(tf)}
                  />
                </div>
              ) : (
                <div className='py-2' style={{ minHeight: '220px' }}>
                  <OrderbookPanel symbol={symbol} />
                </div>
              )
            )}
          </div>
        )}

        {/* Hyperliquid-style order entry panel.
            MOBILE ONLY: collapsible so the chart/orderbook and the full order form are
            mutually exclusive (collapsed = just the Long/Short buttons). Desktop renders
            the full form as before (collapsible undefined → unchanged behavior). */}
        <HyperliquidOrderTicket
          symbol={symbol}
          markPrice={markPrice ?? lastPrice}
          isBlocked={blocked}
          traderData={traderData}
          loading={traderLoading || authLoading}
          maxLeverage={currentMarketMeta?.maxLeverage}
          isolatedOnly={currentMarketMeta?.isolatedOnly}
          collapsible={!isDesktopLayout}
          expanded={orderFormExpanded}
          onExpand={handleOrderFormExpand}
        />

        {/* Ads carousel — shown only to logged-out visitors */}
        {!user && !authLoading && <AdsCarousel />}

        {/* Positions & Activity panel — Positions, Orders, Orderbook tabs (logged-in only) */}
        {user && (
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
          />
        )}

      </div>

      <BottomTabNav />
    </div>
  );
}

export default TradePage;
