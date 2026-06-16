import { api } from '@/lib/api-client';
import { useAuth } from '@pooflabs/web';
import { Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FundingHistoryTable } from './FundingHistoryTable';
import { OpenOrdersTable } from './OpenOrdersTable';
import { OrderHistoryTable } from './OrderHistoryTable';
import { PositionsTable } from './PositionsTable';
import { TradeHistoryTable } from './TradeHistoryTable';
import type {
  OrderHistoryEntry,
  TradeFill,
  TraderFundingEntry,
  TraderOrder,
  TraderPosition,
} from './types';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyPhoenixTradeRecord, type PhoenixTradeRecordResponse } from '@/lib/collections/phoenixTradeRecord';
import { subscribeManyPhoenixIsoTrade, type PhoenixIsoTradeResponse } from '@/lib/collections/phoenixIsoTrade';
import { subscribeManyPhoenixOrder, type PhoenixOrderResponse } from '@/lib/collections/phoenixOrder';
import { subscribeManyLiquidations, type LiquidationsResponse } from '@/lib/collections/liquidations';

/** Unified row shape merged from phoenixIsoTrade + phoenixOrder + legacy phoenixTradeRecord + liquidations */
interface UnifiedTrade {
  id: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  sizeUsd?: number;
  leverage?: number;
  sizeBaseLots?: number;
  createdAt?: number; // seconds
  txSignature?: string;
  source: 'iso' | 'order' | 'record' | 'liquidation';
  /** True for a liquidation wipeout — rendered with a red "Liquidated" marker, no PnL/points framing. */
  liquidated?: boolean;
}

/** base58 wallet addresses are 32-44 chars of [1-9A-HJ-NP-Za-km-z]; validate before interpolating into a query */
function isValidBase58Address(addr: string | undefined): addr is string {
  return !!addr && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

type ActivityTab = 'positions' | 'open-orders' | 'order-history' | 'trades' | 'poof-trades' | 'funding-history';

const TAB_LABELS: { id: ActivityTab; label: string }[] = [
  { id: 'positions', label: 'Positions' },
  // Primary history view: closed positions with realized PnL + per-row PnL share card.
  { id: 'trades', label: 'History' },
  { id: 'poof-trades', label: 'My Trades' },
  { id: 'open-orders', label: 'Open Orders' },
  // Secondary: the raw order log.
  { id: 'order-history', label: 'Order Log' },
  { id: 'funding-history', label: 'Funding' },
];

/** Strip trailing -PERP/-perp suffix for case-insensitive comparison */
function bareSymbol(s: string): string {
  return s.replace(/-perp$/i, '').toUpperCase();
}

// ─── Orderbook sub-component ─────────────────────────────────────────────────

interface OrderbookData {
  bids?: [number, number][];
  asks?: [number, number][];
  mid?: number;
}

function formatOBPrice(p: number | undefined): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatOBSize(s: number): string {
  if (s >= 1000) return s.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return s.toFixed(s >= 1 ? 2 : 4);
}

/** A level enriched with the cumulative size running outward from the best price. */
interface OBLevel {
  price: number;
  size: number;
  total: number;
}

export function OrderbookPanel({ symbol }: { symbol?: string }) {
  const [orderbook, setOrderbook] = useState<OrderbookData | null>(null);
  const [errored, setErrored] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrderbook = useCallback(async () => {
    if (!symbol) return;
    try {
      const data = await api.get<unknown>(`/api/phoenix/orderbook/${symbol}`);
      const ob = (data as { data?: OrderbookData })?.data ?? (data as OrderbookData);
      setOrderbook(ob);
      setErrored(false);
    } catch {
      setErrored(true);
    }
  }, [symbol]);

  useEffect(() => {
    // Reset state when the market changes so a stale book / error never lingers.
    setOrderbook(null);
    setErrored(false);
    fetchOrderbook();
    intervalRef.current = setInterval(fetchOrderbook, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchOrderbook]);

  if (!symbol) {
    return <div className='text-center py-8 text-xs' style={{ color: '#8A8A8A' }}>Select a market to view orderbook</div>;
  }

  // Best bid first (descending price); best ask first (ascending price).
  // Keep the book compact — ~7 levels per side fits fully on a mobile viewport
  // without the card needing to scroll.
  const LEVELS_PER_SIDE = 7;
  const rawBids = [...(orderbook?.bids ?? [])]
    .filter(([p, s]) => p > 0 && s > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, LEVELS_PER_SIDE);
  const rawAsks = [...(orderbook?.asks ?? [])]
    .filter(([p, s]) => p > 0 && s > 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, LEVELS_PER_SIDE);

  const buildLevels = (levels: [number, number][]): OBLevel[] => {
    let running = 0;
    return levels.map(([price, size]) => {
      running += size;
      return { price, size, total: running };
    });
  };

  const bidLevels = buildLevels(rawBids);
  const askLevels = buildLevels(rawAsks);

  // Depth-bar scale: widest cumulative total across both sides.
  const maxTotal = Math.max(
    bidLevels.length ? bidLevels[bidLevels.length - 1].total : 0,
    askLevels.length ? askLevels[askLevels.length - 1].total : 0,
    1,
  );

  const bestBid = bidLevels[0]?.price;
  const bestAsk = askLevels[0]?.price;
  const hasLevels = bidLevels.length > 0 || askLevels.length > 0;

  // Terminal states — never hang on "Loading…" forever.
  if (errored) {
    return (
      <div className='text-center py-8 text-xs' style={{ color: '#FF5252' }}>
        Failed to load orderbook. Retrying…
      </div>
    );
  }
  if (!orderbook) {
    return <div className='text-center py-8 text-xs' style={{ color: '#8A8A8A' }}>Loading orderbook…</div>;
  }
  if (!hasLevels) {
    return <div className='text-center py-8 text-xs' style={{ color: '#8A8A8A' }}>No open orders in the book</div>;
  }

  let spreadAbs: number | null = null;
  let spreadPct: number | null = null;
  if (bestBid != null && bestAsk != null) {
    spreadAbs = bestAsk - bestBid;
    const ref = orderbook.mid ?? (bestAsk + bestBid) / 2;
    if (ref > 0) spreadPct = (spreadAbs / ref) * 100;
  }

  const HEADER_COL = { color: '#8A8A8A', fontSize: '10px', letterSpacing: '0.02em' } as const;

  const Row = ({ lvl, side }: { lvl: OBLevel; side: 'ask' | 'bid' }) => {
    const isAsk = side === 'ask';
    const color = isAsk ? '#FF5252' : '#4ADE80';
    // Cumulative-depth bar anchored to the right (price/total) edge, fading inward
    // so the deepest levels read clearly while staying subtle on the dark glass.
    const rgb = isAsk ? '255,82,82' : '74,222,128';
    const barBg = `linear-gradient(to left, rgba(${rgb},0.22) 0%, rgba(${rgb},0.07) 100%)`;
    const widthPct = Math.max((lvl.total / maxTotal) * 100, 1.5);
    return (
      <div className='relative grid grid-cols-3 text-[11px] tabular-nums px-3 py-0.5 overflow-hidden'>
        <div
          className='absolute inset-y-0 right-0 pointer-events-none transition-[width] duration-300 ease-out'
          style={{ background: barBg, width: `${widthPct}%` }}
        />
        <span style={{ color, position: 'relative' }}>{formatOBPrice(lvl.price)}</span>
        <span className='text-right' style={{ color: '#C8C8C8', position: 'relative' }}>{formatOBSize(lvl.size)}</span>
        <span className='text-right' style={{ color: '#8A8A8A', position: 'relative' }}>{formatOBSize(lvl.total)}</span>
      </div>
    );
  };

  return (
    <div>
      {/* Column header */}
      <div className='grid grid-cols-3 px-3 pb-1'>
        <span style={HEADER_COL}>Price (USDC)</span>
        <span className='text-right' style={HEADER_COL}>Size (USDC)</span>
        <span className='text-right' style={HEADER_COL}>Total (USDC)</span>
      </div>

      {/* Asks — best ask nearest the spread, so render descending (worst first). */}
      {[...askLevels].reverse().map((lvl, i) => (
        <Row key={`ask-${i}`} lvl={lvl} side='ask' />
      ))}

      {/* Spread */}
      <div
        className='flex items-center justify-center gap-2 text-xs py-1 my-1'
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span style={{ color: '#8A8A8A', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Spread</span>
        <span className='tabular-nums font-medium' style={{ color: '#C8C8C8' }}>
          {spreadAbs != null ? formatOBPrice(spreadAbs) : '—'}
        </span>
        {spreadPct != null && (
          <span className='tabular-nums' style={{ color: '#8A8A8A' }}>
            ({spreadPct.toFixed(3)}%)
          </span>
        )}
      </div>

      {/* Bids — best bid nearest the spread (top). */}
      {bidLevels.map((lvl, i) => (
        <Row key={`bid-${i}`} lvl={lvl} side='bid' />
      ))}
    </div>
  );
}

// ─── PoofTradesTable — renders phoenixTradeRecord entries ────────────────────

function formatTs(ts: number | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatSizeUsd(v: number | undefined): string {
  if (v == null) return '—';
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function PoofTradesTable({
  records,
  showSymbol = true,
}: {
  records: UnifiedTrade[];
  showSymbol?: boolean;
}) {
  if (records.length === 0) {
    return (
      <div className='glass-card rounded-xl p-6 text-center'>
        <p className='text-sm' style={{ color: '#8A8A8A' }}>No verified trades yet</p>
        <p className='text-xs mt-1' style={{ color: '#555' }}>
          Trades placed via the order ticket appear here after on-chain confirmation.
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-1.5'>
      {records.map((r) => {
        // ── Liquidation row — a wipeout, not a normal trade. Red marker, no
        //    PnL/points framing. Only render values that actually exist. ────────
        if (r.liquidated) {
          const sideLabel = r.side?.toUpperCase();
          return (
            <div
              key={r.id}
              className='rounded-xl p-3 space-y-1'
              style={{
                background: 'linear-gradient(135deg, rgba(255,82,82,0.14), rgba(255,82,82,0.05))',
                border: '1px solid rgba(255,82,82,0.4)',
                boxShadow: '0 0 14px rgba(255,82,82,0.18)',
              }}
            >
              <div className='flex items-center justify-between gap-2'>
                <div className='flex items-center gap-2 flex-wrap'>
                  {showSymbol && <span className='font-bold text-sm'>{r.symbol ?? '—'}</span>}
                  {sideLabel && (
                    <span
                      className='text-xs px-1.5 py-0.5 rounded font-medium'
                      style={{ background: 'rgba(255,82,82,0.18)', color: '#FF5252' }}
                    >
                      {sideLabel}
                    </span>
                  )}
                  <span
                    className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded uppercase tracking-wide'
                    style={{
                      background: 'rgba(255,82,82,0.22)',
                      color: '#FF5252',
                      border: '1px solid rgba(255,82,82,0.5)',
                      fontSize: '9px',
                      fontWeight: 800,
                    }}
                  >
                    <Zap size={10} style={{ color: '#FF5252' }} />
                    Liquidated
                  </span>
                </div>
                <span className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
                  {formatTs(r.createdAt)}
                </span>
              </div>
              {/* Only show a lots line when we actually have a size — never a dash. */}
              {r.sizeBaseLots != null && (
                <div className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
                  {r.sizeBaseLots} lots
                </div>
              )}
            </div>
          );
        }

        const isBuy = r.side?.toLowerCase() === 'long';
        return (
          <div key={r.id} className='glass-inner rounded-xl p-3 space-y-1'>
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2 flex-wrap'>
                {showSymbol && <span className='font-bold text-sm'>{r.symbol ?? '—'}</span>}
                <span
                  className='text-xs px-1.5 py-0.5 rounded font-medium'
                  style={{
                    background: isBuy ? 'rgba(74,222,128,0.15)' : 'rgba(255,82,82,0.15)',
                    color: isBuy ? '#4ADE80' : '#FF5252',
                  }}
                >
                  {r.side?.toUpperCase()}
                </span>
                {r.orderType && (
                  <span className='text-xs capitalize' style={{ color: '#8A8A8A' }}>{r.orderType}</span>
                )}
                <span className='text-xs px-1 py-0.5 rounded' style={{ background: 'rgba(183,148,246,0.12)', color: '#b794f6', fontSize: '9px', fontWeight: 700 }}>
                  CONFIRMED
                </span>
              </div>
              <span className='text-xs font-medium tabular-nums' style={{ color: '#b794f6' }}>
                {formatSizeUsd(r.sizeUsd)}
              </span>
            </div>
            <div className='flex items-center justify-between text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
              <span>{r.leverage ?? '—'}x · {r.sizeBaseLots ?? '—'} lots</span>
              <span>{formatTs(r.createdAt)}</span>
            </div>
            {r.txSignature && (
              <a
                href={`https://solscan.io/tx/${r.txSignature}`}
                target='_blank'
                rel='noopener noreferrer'
                className='text-xs underline'
                style={{ color: '#555' }}
              >
                {r.txSignature.slice(0, 12)}…{r.txSignature.slice(-6)}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface UserActivityPanelProps {
  /** When provided, filters data to this market symbol */
  symbol?: string;
  /** Pre-loaded positions from parent (e.g. PortfolioPage already fetches trader data) */
  positions?: TraderPosition[];
  /** Pre-loaded open orders from parent */
  openOrders?: TraderOrder[];
  /** Whether parent data is still loading */
  parentLoading?: boolean;
  /** Called when user clicks Close on a position row */
  onClosePosition?: (pos: TraderPosition) => void;
  /** Whether the close button should be disabled (e.g. geo-blocked) */
  closeDisabled?: boolean;
  /** Which position is currently submitting a close (symbol:side key) */
  closingKey?: string | null;
  /** Hide the History, My Trades, Order Log, and Funding tabs (e.g. on the trade page) */
  hideHistoryTabs?: boolean;
  /** Hide the Open Orders and Orderbook tabs (e.g. on the portfolio page) */
  hideOrdersAndOrderbook?: boolean;
  /**
   * Live mark prices keyed by normalised symbol (e.g. "SOL-PERP"), passed down
   * to PositionsTable → OpenPositionShareModal so share cards always show a real price.
   */
  liveMarkBySymbol?: Map<string, number>;
}

export function UserActivityPanel({
  symbol,
  positions: externalPositions,
  openOrders: externalOrders,
  parentLoading,
  onClosePosition,
  closeDisabled,
  closingKey,
  hideHistoryTabs,
  hideOrdersAndOrderbook,
  liveMarkBySymbol,
}: UserActivityPanelProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActivityTab>('positions');

  const HIDDEN_WHEN_HISTORY_OFF: ActivityTab[] = ['order-history', 'poof-trades', 'trades', 'funding-history'];
  const HIDDEN_WHEN_ORDERS_OFF: ActivityTab[] = ['open-orders'];
  const visibleTabs = TAB_LABELS.filter((t) => {
    if (hideHistoryTabs && HIDDEN_WHEN_HISTORY_OFF.includes(t.id)) return false;
    if (hideOrdersAndOrderbook && HIDDEN_WHEN_ORDERS_OFF.includes(t.id)) return false;
    return true;
  });

  // Per-tab data & loading state
  const [orderHistory, setOrderHistory] = useState<OrderHistoryEntry[]>([]);
  const [tradesHistory, setTradesHistory] = useState<TradeFill[]>([]);
  const [fundingHistory, setFundingHistory] = useState<TraderFundingEntry[]>([]);
  const [loadingOrderHistory, setLoadingOrderHistory] = useState(false);
  const [loadingTradesHistory, setLoadingTradesHistory] = useState(false);
  const [loadingFundingHistory, setLoadingFundingHistory] = useState(false);

  // "My Trades" merges three sources, all filtered to the current user's wallet:
  //   • phoenixIsoTrade  — isolated-margin trades (current path)
  //   • phoenixOrder     — cross-margin trades (current path)
  //   • phoenixTradeRecord — legacy verified records (historical, no longer written)
  // Validate the wallet address against a strict base58 charset before interpolation.
  const addrValid = isValidBase58Address(user?.address);
  const traderFilter = addrValid ? `where trader = '${user!.address}'` : '';

  const { data: isoTrades } = useRealtimeData<PhoenixIsoTradeResponse[]>(
    subscribeManyPhoenixIsoTrade,
    addrValid,
    traderFilter,
  );
  const { data: phoenixOrders } = useRealtimeData<PhoenixOrderResponse[]>(
    subscribeManyPhoenixOrder,
    addrValid,
    traderFilter,
  );
  const { data: poofTradeRecords } = useRealtimeData<PhoenixTradeRecordResponse[]>(
    subscribeManyPhoenixTradeRecord,
    addrValid,
    traderFilter,
  );
  // Liquidations the connected wallet was wiped out on — merged into "My Trades"
  // as red rows so a wipeout reads distinctly from a normal trade.
  const { data: liquidations } = useRealtimeData<LiquidationsResponse[]>(
    subscribeManyLiquidations,
    addrValid,
    addrValid ? `where trader = '${user!.address}'` : '',
  );

  const safePoofTrades = (() => {
    const merged: UnifiedTrade[] = [];

    for (const t of isoTrades ?? []) {
      merged.push({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        orderType: 'market',
        sizeUsd: t.sizeUsd,
        leverage: t.leverage,
        sizeBaseLots: t.sizeBaseLots,
        createdAt: t.tarobase_created_at,
        txSignature: t.tarobase_transaction_hash,
        source: 'iso',
      });
    }
    for (const o of phoenixOrders ?? []) {
      merged.push({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        orderType: o.orderType,
        sizeUsd: o.sizeUsd,
        leverage: o.leverage,
        sizeBaseLots: o.sizeBaseLots,
        createdAt: o.tarobase_created_at,
        txSignature: o.tarobase_transaction_hash,
        source: 'order',
      });
    }
    for (const r of poofTradeRecords ?? []) {
      merged.push({
        id: r.id,
        symbol: r.symbol,
        side: r.side,
        orderType: r.orderType,
        sizeUsd: r.sizeUsd,
        leverage: r.leverage,
        sizeBaseLots: r.sizeBaseLots,
        createdAt: r.createdAt,
        txSignature: r.txSignature,
        source: 'record',
      });
    }

    for (const l of liquidations ?? []) {
      merged.push({
        id: `liq-${l.id}`,
        symbol: l.symbol,
        side: l.side,
        sizeBaseLots: l.sizeBaseLots,
        createdAt: l.createdAt,
        source: 'liquidation',
        liquidated: true,
      });
    }

    // De-dupe by tx signature (a single logical trade shouldn't appear twice post-refactor).
    const seenTx = new Set<string>();
    const deduped = merged.filter((t) => {
      if (!t.txSignature) return true;
      if (seenTx.has(t.txSignature)) return false;
      seenTx.add(t.txSignature);
      return true;
    });

    return deduped
      .filter((t) => !symbol || t.symbol?.replace(/-PERP$/i, '').toUpperCase() === bareSymbol(symbol))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  })();

  // Only fetch the history tabs when they're selected, to avoid unnecessary requests
  useEffect(() => {
    if (!user?.address) return;
    if (activeTab !== 'order-history') return;
    if (orderHistory.length > 0) return;
    setLoadingOrderHistory(true);
    api
      .get<unknown>(`/api/phoenix/trader/${user.address}/order-history`)
      .then((res) => {
        // Backend now normalizes to array; be defensive in case of unexpected shape
        const list = Array.isArray(res)
          ? (res as OrderHistoryEntry[])
          : ((res as { orders?: OrderHistoryEntry[]; data?: OrderHistoryEntry[] })?.orders
            ?? (res as { data?: OrderHistoryEntry[] })?.data
            ?? []);
        setOrderHistory(
          symbol
            ? list.filter((o) => o.symbol != null && bareSymbol(o.symbol) === bareSymbol(symbol))
            : list
        );
      })
      .catch((err) => { console.error('[order-history] fetch failed:', err); })
      .finally(() => setLoadingOrderHistory(false));
  }, [activeTab, user?.address, symbol, orderHistory.length]);

  useEffect(() => {
    if (!user?.address) return;
    if (activeTab !== 'trades') return;
    if (tradesHistory.length > 0) return;
    setLoadingTradesHistory(true);
    api
      .get<unknown>(`/api/phoenix/trader/${user.address}/trades-history?limit=500`)
      .then((res) => {
        // Backend now normalizes to array; be defensive in case of unexpected shape
        const list = Array.isArray(res)
          ? (res as TradeFill[])
          : ((res as { trades?: TradeFill[]; fills?: TradeFill[]; data?: TradeFill[] })?.trades
            ?? (res as { fills?: TradeFill[] })?.fills
            ?? (res as { data?: TradeFill[] })?.data
            ?? []);
        setTradesHistory(
          symbol
            ? list.filter((f) => f.symbol != null && bareSymbol(f.symbol) === bareSymbol(symbol))
            : list
        );
      })
      .catch((err) => { console.error('[trades-history] fetch failed:', err); })
      .finally(() => setLoadingTradesHistory(false));
  }, [activeTab, user?.address, symbol, tradesHistory.length]);

  useEffect(() => {
    if (!user?.address) return;
    if (activeTab !== 'funding-history') return;
    if (fundingHistory.length > 0) return;
    setLoadingFundingHistory(true);
    api
      .get<unknown>(`/api/phoenix/trader/${user.address}/funding-history`)
      .then((res) => {
        // Backend now normalizes to array; be defensive in case of unexpected shape
        const list = Array.isArray(res)
          ? (res as TraderFundingEntry[])
          : ((res as { payments?: TraderFundingEntry[]; data?: TraderFundingEntry[] })?.payments
            ?? (res as { data?: TraderFundingEntry[] })?.data
            ?? []);
        setFundingHistory(
          symbol
            ? list.filter((f) => f.symbol != null && bareSymbol(f.symbol) === bareSymbol(symbol))
            : list
        );
      })
      .catch(() => {})
      .finally(() => setLoadingFundingHistory(false));
  }, [activeTab, user?.address, symbol, fundingHistory.length]);

  const showSymbol = !symbol; // hide symbol column when we're on a specific market page

  return (
    <div className='glass-card rounded-xl overflow-hidden'>
      {/* Tab bar */}
      <div className='flex overflow-x-auto' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {visibleTabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className='flex-shrink-0 px-4 py-2.5 text-xs font-medium transition-colors'
            style={{
              color: activeTab === id ? '#b794f6' : '#8A8A8A',
              borderBottom: activeTab === id ? '2px solid #b794f6' : '2px solid transparent',
              marginBottom: '-1px',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className='p-3'>
        {!user ? (
          <div className='py-6 text-center'>
            <p className='text-sm' style={{ color: '#8A8A8A' }}>Log in to view your activity</p>
          </div>
        ) : (
          <>
            {activeTab === 'positions' && (
              <PositionsTable
                positions={externalPositions ?? []}
                loading={parentLoading}
                onClose={onClosePosition}
                closeDisabled={closeDisabled}
                closingKey={closingKey}
                liveMarkBySymbol={liveMarkBySymbol}
              />
            )}
            {activeTab === 'open-orders' && !hideOrdersAndOrderbook && (
              <OpenOrdersTable
                orders={externalOrders ?? []}
                loading={parentLoading}
                showSymbol={showSymbol}
              />
            )}
            {activeTab === 'order-history' && (
              <OrderHistoryTable
                orders={orderHistory}
                loading={loadingOrderHistory}
                showSymbol={showSymbol}
              />
            )}
            {activeTab === 'poof-trades' && (
              <PoofTradesTable records={safePoofTrades} showSymbol={showSymbol} />
            )}
            {activeTab === 'trades' && (
              <TradeHistoryTable
                fills={tradesHistory}
                loading={loadingTradesHistory}
                showSymbol={showSymbol}
              />
            )}
            {activeTab === 'funding-history' && (
              <FundingHistoryTable
                entries={fundingHistory}
                loading={loadingFundingHistory}
                showSymbol={showSymbol}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
