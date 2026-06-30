/**
 * MarketsTable — center column of DiscoveryPage.
 * Lists all Phoenix perps from markets-overview. Columns: symbol (bare),
 * mark price, 24h change, max leverage. Rows tap to /trade/{full-symbol}.
 */

import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api-client';
import { TrendingUp, TrendingDown, Search } from 'lucide-react';
import { TokenLogo } from '@/components/TokenLogo';

interface MarketRow {
  perpSymbol: string; // "SOL-PERP"
  bareSymbol: string; // "SOL"
  markPrice?: number;
  change24h?: number;
  maxLeverage?: number;
  volume24h?: number;
}

interface RawMarket {
  symbol?: string;
  markPrice?: number;
  lastPrice?: number;
  change24h?: number;
  maxLeverage?: number;
  volume24h?: number;
}

// Module-level cache (shared with useMarketList hook TTL)
let cachedMarkets: MarketRow[] | null = null;
let cachedAt = 0;
const TTL = 60_000;

function toBareSymbol(raw: string): string {
  return raw.replace(/-PERP$/i, '');
}
function toPerpSymbol(raw: string): string {
  return raw.endsWith('-PERP') ? raw : `${raw}-PERP`;
}

function formatPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(3)}`;
  return `$${p.toPrecision(4)}`;
}

function formatChange(c: number): string {
  const sign = c >= 0 ? '+' : '';
  return `${sign}${c.toFixed(2)}%`;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function MarketsTable() {
  const navigate = useNavigate();
  const [markets, setMarkets] = useState<MarketRow[]>(cachedMarkets ?? []);
  const [loading, setLoading] = useState(!cachedMarkets);
  const [query, setQuery] = useState('');
  const [totalVolume, setTotalVolume] = useState<number | null>(null);

  useEffect(() => {
    api.get<{ totalVolume24h: number }>('/api/phoenix/total-volume')
      .then((data) => {
        // Show any valid numeric response — including $0 volume.
        // Previously the `> 0` guard was hiding the value even on a successful 200.
        if (typeof data?.totalVolume24h === 'number') {
          setTotalVolume(data.totalVolume24h);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (cachedMarkets && Date.now() - cachedAt < TTL) {
      setMarkets(cachedMarkets);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get<unknown>('/api/phoenix/markets-overview')
      .then((raw) => {
        if (cancelled) return;
        const list: RawMarket[] = Array.isArray(raw)
          ? (raw as RawMarket[])
          : ((raw as { markets?: RawMarket[] })?.markets ?? []);
        const rows: MarketRow[] = list
          .filter((m) => m.symbol)
          .map((m) => ({
            perpSymbol: toPerpSymbol(m.symbol!),
            bareSymbol: toBareSymbol(m.symbol!),
            markPrice: typeof m.markPrice === 'number' && m.markPrice > 0 ? m.markPrice : (typeof m.lastPrice === 'number' && m.lastPrice > 0 ? m.lastPrice : undefined),
            change24h: typeof m.change24h === 'number' && isFinite(m.change24h) ? m.change24h : undefined,
            maxLeverage: m.maxLeverage,
            volume24h: typeof m.volume24h === 'number' && m.volume24h > 0 ? m.volume24h : undefined,
          }));
        cachedMarkets = rows;
        cachedAt = Date.now();
        setMarkets(rows);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return markets;
    const q = query.trim().toLowerCase();
    return markets.filter((m) => m.bareSymbol.toLowerCase().includes(q));
  }, [markets, query]);

  const BG = '#1a1a1f';
  const BORDER = '#2a2a35';
  const ACCENT = '#ab9ff2';
  const MUTED = '#6b6b7a';
  const POS = '#4ADE80';
  const NEG = '#FF5252';

  return (
    <div
      className='flex flex-col h-full rounded-xl overflow-hidden'
      style={{ background: BG, border: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div
        className='flex items-center justify-between px-4 py-3 border-b flex-shrink-0'
        style={{ borderColor: BORDER }}
      >
        <span className='text-sm font-semibold' style={{ color: '#e8e8f0' }}>
          Markets
        </span>
        <div className='flex items-center gap-2.5'>
          {totalVolume !== null && (
            <span className='text-xs' style={{ color: MUTED }}>
              24h Vol{' '}
              <span style={{ color: '#e8e8f0' }}>{formatVolume(totalVolume)}</span>
            </span>
          )}
          {!loading && (
            <span className='text-xs' style={{ color: MUTED }}>
              {markets.length} pairs
            </span>
          )}
        </div>
      </div>

      {/* Search */}
      <div className='px-3 py-2 flex-shrink-0' style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className='flex items-center gap-2 rounded-lg px-3 py-1.5' style={{ background: '#111116' }}>
          <Search size={13} style={{ color: MUTED, flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search markets...'
            className='flex-1 bg-transparent text-xs outline-none placeholder:text-[#6b6b7a]'
            style={{ color: '#e8e8f0' }}
          />
        </div>
      </div>

      {/* Column headers */}
      <div
        className='grid gap-0 px-4 py-2 text-[11px] font-medium flex-shrink-0'
        style={{
          color: MUTED,
          borderBottom: `1px solid ${BORDER}`,
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
        }}
      >
        <span>Asset</span>
        <span className='text-right'>Price</span>
        <span className='text-right'>24h</span>
        <span className='text-right'>Max Lev.</span>
      </div>

      {/* Rows */}
      <div className='flex-1 overflow-y-auto' style={{ minHeight: 0 }}>
        {loading ? (
          <div className='flex items-center justify-center py-12'>
            <div className='text-xs' style={{ color: MUTED }}>Loading markets...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex items-center justify-center py-12'>
            <div className='text-xs' style={{ color: MUTED }}>No markets found</div>
          </div>
        ) : (
          filtered.map((m, i) => {
            const changeColor = m.change24h == null ? MUTED : m.change24h >= 0 ? POS : NEG;
            return (
              <button
                key={m.perpSymbol}
                onClick={() => navigate(`/trade/${m.perpSymbol}`)}
                className='w-full grid gap-0 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.07]'
                style={{
                  gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}40` : 'none',
                }}
              >
                {/* Symbol */}
                <div className='flex items-center gap-2 min-w-0'>
                  <TokenLogo symbol={m.bareSymbol} size={24} />
                  <div className='min-w-0'>
                    <div className='text-xs font-semibold truncate' style={{ color: '#e8e8f0' }}>
                      {m.bareSymbol}
                    </div>
                    {m.volume24h != null && (
                      <div className='text-[10px]' style={{ color: MUTED }}>
                        {formatVolume(m.volume24h)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mark price */}
                <div className='text-right tabular-nums'>
                  <span className='text-xs font-medium' style={{ color: '#e8e8f0' }}>
                    {m.markPrice != null ? formatPrice(m.markPrice) : '—'}
                  </span>
                </div>

                {/* 24h change */}
                <div className='text-right tabular-nums flex items-center justify-end gap-1'>
                  {m.change24h != null ? (
                    <>
                      {m.change24h >= 0
                        ? <TrendingUp size={10} style={{ color: changeColor }} />
                        : <TrendingDown size={10} style={{ color: changeColor }} />
                      }
                      <span className='text-xs font-medium' style={{ color: changeColor }}>
                        {formatChange(m.change24h)}
                      </span>
                    </>
                  ) : (
                    <span className='text-xs' style={{ color: MUTED }}>—</span>
                  )}
                </div>

                {/* Max leverage */}
                <div className='text-right'>
                  <span className='text-xs font-medium' style={{ color: m.maxLeverage ? ACCENT : MUTED }}>
                    {m.maxLeverage ? `${m.maxLeverage}x` : '—'}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
