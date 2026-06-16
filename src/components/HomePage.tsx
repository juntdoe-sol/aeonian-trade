import { api } from '@/lib/api-client';
import { ArrowDown, ArrowUp, Flame, RefreshCw, Search, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { TokenLogo } from './TokenLogo';
import { getMarketCategory, type MarketCategory } from '@/utils/phoenix-markets';
import { useFavoriteMarkets } from '@/hooks/use-favorite-markets';

type CategoryFilter = 'all' | MarketCategory;
const CATEGORY_TABS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'equities', label: 'Equities' },
];

interface MarketSnapshot {
  symbol: string;
  // markPrice and lastPrice come from /candles, not snapshot
  markPrice?: number;
  lastPrice?: number;
  openInterest?: number;
  volume24h?: number;
  change24h?: number; // computed from daily candle open vs current price
  maxLeverage?: number;
  isolatedOnly?: boolean;
}

interface RankingResponse {
  volume24h?: number;
  volume7d?: number;
  volume30d?: number;
  openInterest?: number;
  users?: number;
  trades?: number;
  markets?: number;
  maxLeverage?: number;
  [key: string]: unknown;
}

function formatPrice(price: number | undefined): string {
  if (price == null) return '—';
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatOI(value: number | undefined): string {
  if (value == null || value === 0) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}


export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [markets, setMarkets] = useState<MarketSnapshot[]>([]);
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const { isFavorite, toggleFavorite } = useFavoriteMarkets();

  const filteredMarkets = markets
    .filter((m) => {
      const matchesSearch = m.symbol.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = category === 'all' || getMarketCategory(m.symbol) === category;
      return matchesSearch && matchesCategory;
    })
    // Pin favorites to the top, preserving the existing relative order within each group.
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const favA = isFavorite(a.m.symbol) ? 0 : 1;
      const favB = isFavorite(b.m.symbol) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      return a.i - b.i;
    })
    .map(({ m }) => m);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [overviewResult, rankingResult] = await Promise.allSettled([
        api.get<{ markets: MarketSnapshot[] }>('/api/phoenix/markets-overview'),
        api.get<RankingResponse>('/api/rankings/phoenix'),
      ]);

      let list: MarketSnapshot[] = [];
      if (overviewResult.status === 'fulfilled') {
        list = overviewResult.value.markets ?? [];
      }

      if (rankingResult.status === 'fulfilled') {
        setRanking(rankingResult.value);
      }

      setMarkets(list);
    } catch {
      // silently fail - show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className='min-h-screen pb-28 text-white'>
      {/* Header */}
      <AppHeader
        right={
          <button
            onClick={() => fetchData(true)}
            className='p-2 rounded-lg transition-colors'
            style={{ color: refreshing ? '#b794f6' : '#8A8A8A' }}
            disabled={refreshing}
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        }
      />

      <div className='px-4 pt-4 space-y-4'>
        {/* Stats card */}
        {ranking && (
          <div>
            <div className='glass-card rounded-xl p-4 grid grid-cols-3 gap-3'>
              <div>
                <div className='text-xs mb-1' style={{ color: '#8A8A8A' }}>
                  24h Volume
                </div>
                <div className='font-bold text-base tabular-nums'>
                  {formatOI(ranking.volume24h)}
                </div>
              </div>
              <div>
                <div className='text-xs mb-1' style={{ color: '#8A8A8A' }}>
                  7d Volume
                </div>
                <div className='font-bold text-base tabular-nums'>
                  {formatOI(ranking.volume7d)}
                </div>
              </div>
              <div>
                <div className='text-xs mb-1' style={{ color: '#8A8A8A' }}>
                  30d Volume
                </div>
                <div className='font-bold text-base tabular-nums'>
                  {formatOI(ranking.volume30d)}
                </div>
              </div>
            </div>
            <div className='text-center mt-1.5' style={{ color: '#555', fontSize: '10px' }}>
              phoenix.trade global stats
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className='relative'>
          <Search size={14} className='absolute left-3 top-1/2 -translate-y-1/2' style={{ color: '#8A8A8A' }} />
          <input
            type='text'
            placeholder='Search markets...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none'
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
          />
        </div>

        {/* Category tabs */}
        <div className='flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5'>
          {CATEGORY_TABS.map((tab) => {
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className='shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors'
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

        {/* Column headers */}
        <div
          className='grid px-1 text-xs font-medium'
          style={{
            gridTemplateColumns: '1fr auto auto auto',
            color: '#8A8A8A',
          }}
        >
          <span>Market</span>
          <span className='text-right w-24'>Mark Price</span>
          <span className='text-right w-16'>24h</span>
          <span className='text-right w-20'>Open Interest</span>
        </div>

        {/* Markets list */}
        {loading ? (
          <div className='space-y-3'>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className='h-16 rounded-xl animate-pulse glass-card'
              />
            ))}
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className='text-center py-16' style={{ color: '#8A8A8A' }}>
            <Flame size={32} className='mx-auto mb-3 opacity-30' />
            <p className='text-sm'>{search ? 'No markets found' : 'Markets unavailable'}</p>
            <p className='text-xs mt-1'>{search ? 'Try a different search term' : 'Check connection or try refreshing'}</p>
          </div>
        ) : (
          <div className='space-y-2'>
            {filteredMarkets.map((market) => {
              return (
                <button
                  key={market.symbol}
                  onClick={() => navigate(`/trade/${market.symbol.replace(/-PERP$/i, '') + '-PERP'}`)}
                  className='glass-card w-full rounded-xl p-4 text-left transition-all active:scale-98 hover:bg-white/5'
                >
                  <div
                    className='grid items-center'
                    style={{ gridTemplateColumns: '1fr auto auto auto' }}
                  >
                    {/* Symbol with logo */}
                    <div className='flex items-center gap-2'>
                      <span
                        role='button'
                        tabIndex={0}
                        aria-label={isFavorite(market.symbol) ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(market.symbol); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleFavorite(market.symbol); } }}
                        className='-ml-1 mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors active:scale-90 hover:bg-white/5'
                      >
                        <Star
                          size={17}
                          fill={isFavorite(market.symbol) ? '#b794f6' : 'none'}
                          style={{ color: isFavorite(market.symbol) ? '#b794f6' : '#8A8A8A' }}
                        />
                      </span>
                      <TokenLogo symbol={market.symbol} size={28} />
                      <div>
                        <div className='font-bold text-sm'>{market.symbol.replace(/-PERP$/i, '')}</div>
                        <div className='flex items-center gap-1 mt-0.5'>
                          {market.maxLeverage != null && (
                            <span
                              className='text-[9px] font-bold px-1 py-0.5 rounded'
                              style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', lineHeight: 1 }}
                            >
                              {market.maxLeverage}x
                            </span>
                          )}
                          {market.isolatedOnly && (
                            <span
                              className='text-[9px] font-bold px-1 py-0.5 rounded'
                              style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8', lineHeight: 1 }}
                            >
                              ISO
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Mark price (from candles) */}
                    <div className='text-right w-24'>
                      <div className='font-bold text-sm tabular-nums'>
                        {market.markPrice != null && market.markPrice > 0 ? `$${formatPrice(market.markPrice)}` : market.lastPrice != null && market.lastPrice > 0 ? `$${formatPrice(market.lastPrice)}` : '—'}
                      </div>
                    </div>

                    {/* 24h change */}
                    <div className='text-right w-16'>
                      {market.change24h != null ? (
                        <div
                          className='inline-flex items-center gap-0.5 text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-md'
                          style={{
                            background: market.change24h >= 0 ? 'rgba(74,222,128,0.12)' : 'rgba(255,82,82,0.12)',
                            color: market.change24h >= 0 ? '#4ADE80' : '#FF5252',
                          }}
                        >
                          {market.change24h >= 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                          {market.change24h >= 0 ? '+' : ''}{market.change24h.toFixed(2)}%
                        </div>
                      ) : (
                        <span className='text-xs tabular-nums' style={{ color: '#555' }}>—</span>
                      )}
                    </div>

                    {/* OI */}
                    <div className='text-right w-20'>
                      <div className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
                        {formatOI(market.openInterest)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <BottomTabNav />
    </div>
  );
};

export default HomePage;
