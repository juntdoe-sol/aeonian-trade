import { Instagram, Download, TrendingUp, TrendingDown, BarChart2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

// ─── Footer data fetching ─────────────────────────────────────────────────────
// SOL price/change: markets-overview (cached 20s server-side)
// Total 24h volume: dedicated /api/phoenix/total-volume endpoint (cached 60s server-side)
// Both are lightweight single-request fetches from the client.

interface MarketOverviewItem {
  symbol?: string;
  markPrice?: number;
  change24h?: number;
}

interface FooterMarketCache {
  solPrice: number | null;
  solChange24h: number | null;
  fetchedAt: number;
}

interface TotalVolumeCache {
  totalVolume24h: number | null;
  fetchedAt: number;
}

let solCache: FooterMarketCache | null = null;
let solInflight: Promise<FooterMarketCache> | null = null;
const SOL_CACHE_TTL_MS = 30_000;

let volCache: TotalVolumeCache | null = null;
let volInflight: Promise<TotalVolumeCache> | null = null;
const VOL_CACHE_TTL_MS = 65_000; // slightly longer than server 60s so we don't race

async function getSolData(): Promise<FooterMarketCache> {
  if (solCache && Date.now() - solCache.fetchedAt < SOL_CACHE_TTL_MS) {
    return solCache;
  }
  if (!solInflight) {
    solInflight = (async () => {
      const overviewRaw = await api.get<unknown>('/api/phoenix/markets-overview');
      const list: MarketOverviewItem[] = Array.isArray(overviewRaw)
        ? (overviewRaw as MarketOverviewItem[])
        : ((overviewRaw as { markets?: MarketOverviewItem[] })?.markets ?? []);
      let solPrice: number | null = null;
      let solChange24h: number | null = null;
      for (const m of list) {
        const sym = (m.symbol ?? '').toUpperCase().replace(/-PERP$/i, '');
        if (sym === 'SOL' && m.markPrice && m.markPrice > 0) {
          solPrice = m.markPrice;
          solChange24h = typeof m.change24h === 'number' ? m.change24h : null;
          break;
        }
      }
      return { solPrice, solChange24h, fetchedAt: Date.now() };
    })()
      .then((data) => { solCache = data; solInflight = null; return data; })
      .catch((err) => { solInflight = null; throw err; });
  }
  return solInflight;
}

async function getTotalVolume(): Promise<TotalVolumeCache> {
  if (volCache && Date.now() - volCache.fetchedAt < VOL_CACHE_TTL_MS) {
    return volCache;
  }
  if (!volInflight) {
    volInflight = (async () => {
      const raw = await api.get<unknown>('/api/phoenix/total-volume');
      const totalVolume24h =
        typeof (raw as { totalVolume24h?: number })?.totalVolume24h === 'number' &&
        (raw as { totalVolume24h: number }).totalVolume24h > 0
          ? (raw as { totalVolume24h: number }).totalVolume24h
          : null;
      return { totalVolume24h, fetchedAt: Date.now() };
    })()
      .then((data) => { volCache = data; volInflight = null; return data; })
      .catch((err) => { volInflight = null; throw err; });
  }
  return volInflight;
}

// ─── Animated number display ──────────────────────────────────────────────────
// Gentle slide-in animation when the value changes — matches flat-dark aesthetic.

interface AnimatedStatProps {
  value: string | null;
  label: string;
  icon: React.ReactNode;
  valueColor?: string;
}

function AnimatedStat({ value, label, icon, valueColor }: AnimatedStatProps) {
  const [displayed, setDisplayed] = useState<string | null>(value);
  const [animating, setAnimating] = useState(false);
  const prevRef = useRef<string | null>(value);

  useEffect(() => {
    if (value !== prevRef.current && value !== null) {
      setAnimating(true);
      const t = setTimeout(() => {
        setDisplayed(value);
        setAnimating(false);
        prevRef.current = value;
      }, 120);
      return () => clearTimeout(t);
    }
    if (value !== null) {
      setDisplayed(value);
      prevRef.current = value;
    }
  }, [value]);

  if (!displayed) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        color: 'rgba(160,160,170,0.7)',
      }}
    >
      <span style={{ color: valueColor ?? 'rgba(171,159,242,0.55)', display: 'flex', alignItems: 'center' }}>
        {icon}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'rgba(110,110,125,0.8)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: valueColor ?? 'rgba(220,220,230,0.85)',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          transition: animating ? 'opacity 0.12s ease, transform 0.12s ease' : 'opacity 0.18s ease, transform 0.18s ease',
          opacity: animating ? 0 : 1,
          transform: animating ? 'translateY(3px)' : 'translateY(0)',
        }}
      >
        {displayed}
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSolPrice(p: number): string {
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// ─── DesktopFooter ────────────────────────────────────────────────────────────

/**
 * DesktopFooter — shown only on md+ screens (~32px tall).
 * Live SOL price + 24H Volume (left), copyright (center), legal links (right).
 */
const SOL_UP_COLOR = '#34d399';
const SOL_DOWN_COLOR = '#f87171';

export function DesktopFooter() {
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [totalVolume, setTotalVolume] = useState<number | null>(null);
  const [solChange24h, setSolChange24h] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    function loadSol() {
      getSolData()
        .then((data) => {
          if (cancelled) return;
          setSolPrice(data.solPrice);
          setSolChange24h(data.solChange24h);
        })
        .catch(() => { /* degrade silently */ });
    }

    function loadVolume() {
      getTotalVolume()
        .then((data) => {
          if (cancelled) return;
          setTotalVolume(data.totalVolume24h);
        })
        .catch(() => { /* degrade silently */ });
    }

    loadSol();
    loadVolume();
    // SOL price refreshes every 30s; volume every 65s (server caches 60s)
    const solId = setInterval(loadSol, 30_000);
    const volId = setInterval(loadVolume, 65_000);
    return () => {
      cancelled = true;
      clearInterval(solId);
      clearInterval(volId);
    };
  }, []);

  const solPriceStr = solPrice ? formatSolPrice(solPrice) : null;
  const volumeStr = totalVolume ? formatVolume(totalVolume) : null;
  // Color the SOL price by its 24h move: green when up on the day, red when down.
  const solDirection: 'up' | 'down' | null =
    solChange24h == null ? null : solChange24h >= 0 ? 'up' : 'down';
  const solColor =
    solDirection === 'up' ? SOL_UP_COLOR : solDirection === 'down' ? SOL_DOWN_COLOR : undefined;

  return (
    <footer
      className='hidden md:flex items-center justify-between flex-shrink-0 relative z-10'
      style={{
        height: 32,
        minHeight: 32,
        padding: '0 16px',
        background: '#0a0a0a',
        borderTop: '1px solid rgba(255,255,255,0.055)',
      }}
    >
      {/* Left: live market stats + social icons */}
      <div className='flex items-center gap-4'>
        {/* Live stats — only rendered when data is available */}
        <AnimatedStat
          value={solPriceStr}
          label='SOL'
          valueColor={solColor}
          icon={
            solDirection === 'down'
              ? <TrendingDown size={10} strokeWidth={2} />
              : <TrendingUp size={10} strokeWidth={2} />
          }
        />
        {volumeStr && (
          <>
            <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.07)', display: 'inline-block', flexShrink: 0 }} />
            <AnimatedStat
              value={volumeStr}
              label='24H VOL.'
              icon={<BarChart2 size={10} strokeWidth={2} />}
            />
          </>
        )}

        {/* Divider before social icons */}
        {(solPriceStr || volumeStr) && (
          <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.07)', display: 'inline-block', flexShrink: 0 }} />
        )}

        {/* Social icons */}
        <a
          href='https://x.com/Aeonian_Arena'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='Follow AEONIAN on X'
          className='flex items-center justify-center transition-colors hover:text-white'
          style={{ color: 'rgba(130,130,145,0.55)' }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width={11} height={11}>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
          </svg>
        </a>
        <a
          href='https://www.instagram.com/aeonian_arena'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='Follow AEONIAN on Instagram'
          className='flex items-center justify-center transition-colors hover:text-white'
          style={{ color: 'rgba(130,130,145,0.55)' }}
        >
          <Instagram size={11} />
        </a>
      </div>

      {/* Center: copyright */}
      <span
        className='text-[10px] absolute left-1/2 -translate-x-1/2'
        style={{ color: 'rgba(90,90,105,0.65)', letterSpacing: '0.04em' }}
      >
        &copy; {new Date().getFullYear()} AEONIAN
      </span>

      {/* Right: legal links */}
      <div className='flex items-center gap-3'>
        <Link
          to='/privacy'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: 'rgba(80,80,95,0.75)', letterSpacing: '0.02em' }}
        >
          Privacy
        </Link>
        <Link
          to='/license'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: 'rgba(80,80,95,0.75)', letterSpacing: '0.02em' }}
        >
          License
        </Link>
        <Link
          to='/copyright'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: 'rgba(80,80,95,0.75)', letterSpacing: '0.02em' }}
        >
          Copyright
        </Link>
        <Link
          to='/about'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: 'rgba(80,80,95,0.75)', letterSpacing: '0.02em' }}
        >
          About
        </Link>
        <Link
          to='/download'
          className='flex items-center transition-colors hover:text-white'
          style={{ color: 'rgba(80,80,95,0.75)' }}
          aria-label='Download App'
        >
          <Download size={10} strokeWidth={1.8} />
        </Link>
      </div>
    </footer>
  );
}
