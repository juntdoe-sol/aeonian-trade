/**
 * MarketSidebar — Desktop-only persistent left panel (~220px) for market selection.
 * Replaces the dropdown on ≥1024px viewports. Shows live mark prices + 24h change.
 * Reuses the same data already fetched by TradePage (markets-overview), passed in as props.
 *
 * Styled to match Phantom wallet's Perps markets sidebar:
 * - Flat opaque dark surface (no heavy glass blur)
 * - Horizontal segmented tab control (scrollable, no wrap)
 * - Single-line market rows: logo | symbol + leverage pill | price + % change
 * - Phantom-flat palette: #0d0d0d bg / #1a1a1f cards / #ab9ff2 accent
 */

import { ChevronDown, Star } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TokenLogo } from './TokenLogo';
import { useFavoriteMarkets } from '@/hooks/use-favorite-markets';
import { getMarketCategory, type MarketCategory } from '@/utils/phoenix-markets';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketMeta {
  maxLeverage: number;
  isolatedOnly: boolean;
  markPrice?: number;
  change24h?: number;
}

interface MarketSidebarProps {
  /** Currently selected market symbol (e.g. "SOL-PERP") */
  selectedSymbol: string;
  /** Full list of available PERP symbols */
  availableSymbols: string[];
  /** Live metadata per symbol — markPrice, change24h, leverage, isolatedOnly */
  marketMetaMap: Map<string, MarketMeta>;
  /** Whether the sidebar is collapsed to a slim strip */
  collapsed?: boolean;
  /** Called when the user clicks the collapse/expand toggle */
  onToggle?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip "-PERP" suffix for display (e.g. "SOL-PERP" → "SOL") */
function displayLabel(sym: string): string {
  return sym.endsWith('-PERP') ? sym.slice(0, -5) : sym;
}

/** Compact price with precision that scales by magnitude. Returns null when no real price. */
function formatRowPrice(p: number | undefined): string | null {
  if (p == null || !(p > 0)) return null;
  let decimals: number;
  if (p >= 1000) decimals = 2;
  else if (p >= 1) decimals = 2;
  else if (p >= 0.01) decimals = 4;
  else decimals = 6;
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Compact 24h % change. Returns null when no real value. */
function formatRowChange(v: number | undefined): string | null {
  if (v == null || !isFinite(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

type PickerCategory = 'all' | MarketCategory | 'favorites';

const CATEGORY_TABS: { id: PickerCategory; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'favorites', label: 'Starred' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'commodities', label: 'Commod.' },
  { id: 'equities', label: 'Equities' },
];

// ─── Phantom-flat palette constants ───────────────────────────────────────────

const C = {
  bg: '#0d0d0d',
  surface: '#131316',
  surfaceHover: '#1a1a1f',
  surfaceActive: '#1e1e25',
  border: 'rgba(255,255,255,0.06)',
  borderSubtle: 'rgba(255,255,255,0.04)',
  accent: '#ab9ff2',
  accentDim: 'rgba(171,159,242,0.12)',
  accentBorder: 'rgba(171,159,242,0.22)',
  text: '#e8e8f0',
  textMuted: '#6b6b80',
  textDim: '#4a4a5a',
  green: '#4ade80',
  red: '#f87171',
  tabActive: '#1c1c24',
  tabActiveBorder: 'rgba(255,255,255,0.08)',
};

// ─── MarketSidebar ────────────────────────────────────────────────────────────

const SIDEBAR_EXPANDED_WIDTH = 284;
const SIDEBAR_COLLAPSED_WIDTH = 36;
// Must match DESKTOP_HEADER_H in TradePage so all four column headers align on one row.
const SIDEBAR_HEADER_H = 60;

export function MarketSidebar({ selectedSymbol, availableSymbols, marketMetaMap, collapsed = false, onToggle }: MarketSidebarProps) {
  const navigate = useNavigate();
  const [search] = useState('');
  const [category, setCategory] = useState<PickerCategory>('all');
  const { isFavorite, toggleFavorite } = useFavoriteMarkets();
  const [hoveredSym, setHoveredSym] = useState<string | null>(null);

  // Filter + sort the market list
  const q = search.trim().toLowerCase();
  const visibleSymbols = availableSymbols
    .filter((sym) => {
      const bare = displayLabel(sym).toLowerCase();
      const matchesSearch = q === '' || bare.includes(q);
      const matchesCat =
        category === 'all'
          ? true
          : category === 'favorites'
          ? isFavorite(sym)
          : getMarketCategory(sym) === category;
      return matchesSearch && matchesCat;
    })
    .map((sym, i) => ({ sym, i }))
    .sort((a, b) => {
      const favA = isFavorite(a.sym) ? 0 : 1;
      const favB = isFavorite(b.sym) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      return a.i - b.i;
    })
    .map(({ sym }) => sym);

  const currentWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  return (
    <aside
      style={{
        width: currentWidth,
        minWidth: currentWidth,
        maxWidth: currentWidth,
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        borderRight: `1px solid ${C.border}`,
        height: '100%',
        // overflow must be visible so the toggle pill button can protrude past the
        // right border into the chart area without being clipped. Scrolling is handled
        // by the inner market list div (sidebar-market-scroll), not the aside itself.
        overflow: 'visible',
        position: 'relative',
        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* ── Edge pill toggle — positioned on the RIGHT outer edge of the sidebar,
           vertically centered. Uses the branded pill image asset. ── */}
      <button
        onClick={onToggle}
        aria-label={collapsed ? 'Expand markets sidebar' : 'Collapse markets sidebar'}
        style={{
          position: 'absolute',
          right: -18,
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
          alt={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            width: 18,
            height: 48,
            objectFit: 'contain',
            display: 'block',
            // Flip horizontally when collapsed so the chevron points right (expand)
            transform: collapsed ? 'scaleX(-1)' : 'none',
            transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>

      {collapsed ? (
        /* ── Collapsed: empty slim strip (toggle is the edge pill above) ── */
        <div style={{ height: '100%' }} />
      ) : (
        /* ── Expanded: full sidebar content ── */
        <>
          {/* ── Header band: category dropdown — sized to SIDEBAR_HEADER_H so it
               aligns on one row with the Chart / Order Book / ticket header bands. ── */}
          <div
            style={{
              height: SIDEBAR_HEADER_H,
              minHeight: SIDEBAR_HEADER_H,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              padding: '0 8px',
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: '100%',
                    padding: '0 16px',
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: C.accent,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    outline: 'none',
                    boxShadow: `inset 0 -2px 0 ${C.accent}`,
                    transition: 'background 0.12s ease, color 0.12s ease',
                  }}
                >
                  {CATEGORY_TABS.find((t) => t.id === category)?.label ?? 'ALL'}
                  <ChevronDown size={14} style={{ color: C.accent, flexShrink: 0, opacity: 0.85 }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='start'
                sideOffset={4}
                style={{
                  background: '#1a1a1f',
                  border: `1px solid ${C.accentBorder}`,
                  borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                  minWidth: 140,
                  padding: '4px 0',
                }}
              >
                {CATEGORY_TABS.map((tab) => {
                  const active = category === tab.id;
                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      onClick={() => setCategory(tab.id)}
                      style={{
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                        color: active ? C.accent : C.text,
                        background: active ? C.accentDim : 'transparent',
                        borderRadius: 6,
                        margin: '1px 4px',
                        padding: '7px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      {tab.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── Markets list ── */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '3px 0',
            }}
            className='sidebar-market-scroll'
          >
            {visibleSymbols.length === 0 ? (
              <div
                style={{
                  padding: '24px 12px',
                  textAlign: 'center',
                  fontSize: 12,
                  color: C.textDim,
                }}
              >
                No markets
              </div>
            ) : (
              visibleSymbols.map((sym) => {
                const meta = marketMetaMap.get(sym);
                const isSelected = sym === selectedSymbol;
                const isHovered = hoveredSym === sym;
                const rowPrice = formatRowPrice(meta?.markPrice);
                const rowChange = formatRowChange(meta?.change24h);
                const positive = (meta?.change24h ?? 0) >= 0;
                const fav = isFavorite(sym);

                return (
                  <div
                    key={sym}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 72px 64px',
                      alignItems: 'center',
                      columnGap: 10,
                      margin: '1px 4px',
                      padding: '6px 6px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      background: isSelected
                        ? C.surfaceActive
                        : isHovered
                        ? C.surfaceHover
                        : 'transparent',
                      border: isSelected
                        ? `1px solid rgba(255,255,255,0.07)`
                        : '1px solid transparent',
                      transition: 'background 0.1s ease, border-color 0.1s ease',
                      position: 'relative',
                    }}
                    onClick={() => navigate(`/trade/${sym}`)}
                    onMouseEnter={() => setHoveredSym(sym)}
                    onMouseLeave={() => setHoveredSym(null)}
                    role='button'
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/trade/${sym}`);
                      }
                    }}
                  >
                    {/* Column 1: token logo + symbol + leverage pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 0, overflow: 'hidden' }}>
                      <div style={{ flexShrink: 0, marginRight: 7 }}>
                        <TokenLogo symbol={sym} size={24} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: C.text,
                            letterSpacing: '-0.01em',
                            lineHeight: 1,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 72,
                          }}
                        >
                          {displayLabel(sym)}
                        </span>

                        {/* Leverage pill — Phantom style: muted gray rounded */}
                        {meta?.maxLeverage != null && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 500,
                              padding: '2px 4px',
                              borderRadius: 3,
                              background: 'rgba(255,255,255,0.07)',
                              color: C.textMuted,
                              lineHeight: 1.4,
                              letterSpacing: '0.02em',
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {meta.maxLeverage}x
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Column 2: price — right-aligned, stays in its own column even when % is absent */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                      {rowPrice && (
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: rowChange == null
                              ? C.textMuted
                              : Math.abs(meta?.change24h ?? 0) < 0.01
                              ? C.textMuted
                              : positive ? C.green : C.red,
                            letterSpacing: '-0.025em',
                            lineHeight: 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {rowPrice}
                        </span>
                      )}
                    </div>

                    {/* Column 3: % change + hover-visible star — right-aligned */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
                      {rowChange && (
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: Math.abs(meta?.change24h ?? 0) < 0.01 ? C.textMuted : positive ? C.green : C.red,
                            letterSpacing: '0.01em',
                            lineHeight: 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {rowChange}
                        </span>
                      )}

                      {/* Favorite star — subtle, only visible on hover or when active */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(sym);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 14,
                          height: 14,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          flexShrink: 0,
                          opacity: fav ? 1 : isHovered ? 0.5 : 0,
                          transition: 'opacity 0.15s ease',
                        }}
                        aria-label={fav ? 'Remove from starred' : 'Add to starred'}
                      >
                        <Star
                          size={10}
                          fill={fav ? C.accent : 'none'}
                          style={{ color: fav ? C.accent : C.textMuted }}
                        />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Scrollbar + tab strip styling */}
      <style>{`
        .sidebar-market-scroll::-webkit-scrollbar {
          width: 2px;
        }
        .sidebar-market-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidebar-market-scroll::-webkit-scrollbar-thumb {
          background: rgba(171, 159, 242, 0.15);
          border-radius: 2px;
        }
        .sidebar-market-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(171, 159, 242, 0.30);
        }
      `}</style>
    </aside>
  );
}
