import { ReactNode, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Instagram, LogOut, ChevronDown, Search, Trophy } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@pooflabs/web';
import { truncateAddress } from '@/utils/format-address';
import { useMarketList } from '@/hooks/use-market-list';
import { TokenLogo } from './TokenLogo';

const FULL_LOGO_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a2ad652d3980483add4a6c8';

const DESKTOP_NAV = [
  { label: 'Discover', path: '/discovery', matchPrefix: '/discovery' },
  { label: 'Trade', path: '/trade/SOL-PERP', matchPrefix: '/trade' },
  { label: 'Arena', path: '/battles', matchPrefix: '/battles' },
  { label: 'Portfolio', path: '/portfolio', matchPrefix: '/portfolio' },
];

// Phantom accent — light purple
const PHANTOM_ACCENT = '#ab9ff2';
const MUTED = '#8b8b9a';

interface AppHeaderProps {
  right?: ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

// ─── Desktop Auth Button ──────────────────────────────────────────────────────

function DesktopAuthButton() {
  const { user, login, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (loading) {
    return (
      <div
        className='h-8 w-20 rounded-full animate-pulse'
        style={{ background: 'rgba(171,159,242,0.12)' }}
      />
    );
  }

  if (!user) {
    return (
      <button
        onClick={() => login()}
        className='flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-all'
        style={{
          background: PHANTOM_ACCENT,
          color: '#0d0d0d',
          border: 'none',
          letterSpacing: '0.01em',
        }}
      >
        Log In
      </button>
    );
  }

  const shortAddr = truncateAddress(user.address, 4, 4);

  return (
    <div className='relative' ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className='flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all'
        style={{
          background: 'rgba(171,159,242,0.10)',
          color: '#ffffff',
          border: '1px solid rgba(171,159,242,0.22)',
        }}
      >
        <span
          className='inline-block rounded-full'
          style={{ width: 6, height: 6, background: '#4ade80', flexShrink: 0 }}
        />
        {shortAddr}
        <ChevronDown size={13} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          className='absolute right-0 mt-1.5 rounded-xl py-1 z-50 min-w-[140px]'
          style={{
            background: '#1a1a1f',
            border: '1px solid rgba(171,159,242,0.18)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <button
            onClick={() => { navigate('/portfolio'); setOpen(false); }}
            className='flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors hover:bg-white/5'
            style={{ color: '#e4e4f0' }}
          >
            Account
          </button>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '2px 0' }} />
          <button
            onClick={() => { logout(); setOpen(false); }}
            className='flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors hover:bg-white/5'
            style={{ color: '#f87171' }}
          >
            <LogOut size={13} />
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Desktop Market Search Bar ────────────────────────────────────────────────

function DesktopMarketSearch() {
  const navigate = useNavigate();
  const { symbol: currentSymbol } = useParams<{ symbol: string }>();
  const location = useLocation();
  const isOnTradePage = location.pathname.startsWith('/trade');

  const allSymbols = useMarketList();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill with current market when on trade page
  const placeholder = isOnTradePage && currentSymbol
    ? currentSymbol.replace(/-PERP$/, '')
    : 'Search markets';

  // Filter symbols by query
  const q = query.trim().toLowerCase();
  const filtered = q
    ? allSymbols.filter((s) => s.replace(/-PERP$/, '').toLowerCase().includes(q))
    : allSymbols;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleSelect(sym: string) {
    setOpen(false);
    setQuery('');
    navigate(`/trade/${sym}`);
  }

  function displayLabel(sym: string) {
    return sym.endsWith('-PERP') ? sym.slice(0, -5) : sym;
  }

  return (
    <div ref={containerRef} className='relative hidden md:block' style={{ width: 440 }}>
      {/* Input */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 14px',
          borderRadius: 22,
          background: 'rgba(255,255,255,0.05)',
          border: open
            ? '1px solid rgba(171,159,242,0.5)'
            : '1px solid rgba(255,255,255,0.09)',
          transition: 'border-color 0.15s ease, background 0.15s ease',
          cursor: 'text',
        }}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search size={13} style={{ color: MUTED, flexShrink: 0 }} />
        <input
          ref={inputRef}
          type='text'
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: '#fff',
            fontSize: 13,
            minWidth: 0,
          }}
        />
        {query && (
          <button
            onClick={(e) => { e.stopPropagation(); setQuery(''); }}
            style={{ color: MUTED, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
            aria-label='Clear search'
          >
            <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
              <path d='M2 2l8 8M10 2l-8 8' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#1a1a1f',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(20px)',
            zIndex: 100,
            maxHeight: 360,
            overflowY: 'auto',
            padding: '4px 0',
          }}
          className='market-search-dropdown'
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '16px 14px', fontSize: 12, color: MUTED, textAlign: 'center' }}>
              No markets found
            </div>
          ) : (
            filtered.map((sym) => {
              const bare = displayLabel(sym);
              const isActive = sym === currentSymbol;
              return (
                <button
                  key={sym}
                  onClick={() => handleSelect(sym)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    background: isActive ? 'rgba(171,159,242,0.10)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: isActive ? PHANTOM_ACCENT : '#e0e0e8',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    textAlign: 'left',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  <TokenLogo symbol={sym} size={18} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{bare}</span>
                  <span style={{ fontSize: 11, color: MUTED }}>PERP</span>
                </button>
              );
            })
          )}
        </div>
      )}

      <style>{`
        .market-search-dropdown::-webkit-scrollbar { width: 3px; }
        .market-search-dropdown::-webkit-scrollbar-track { background: transparent; }
        .market-search-dropdown::-webkit-scrollbar-thumb { background: rgba(171,159,242,0.2); border-radius: 2px; }
        .market-search-dropdown::-webkit-scrollbar-thumb:hover { background: rgba(171,159,242,0.38); }
      `}</style>
    </div>
  );
}

// ─── AppHeader ────────────────────────────────────────────────────────────────

/**
 * Shared sticky top header used across all pages.
 *
 * Mobile: logo + social icons (X/Instagram) + bell — pixel-identical, untouched.
 * Desktop (md+): logo + flat text nav + center market search + bell + auth button.
 */
export function AppHeader({ right, style, className = '' }: AppHeaderProps) {
  const location = useLocation();

  function isActive(matchPrefix: string): boolean {
    return location.pathname.startsWith(matchPrefix);
  }

  return (
    <div
      className={`glass-header sticky top-0 z-40 flex items-center justify-between px-4 py-0 md:py-1 relative ${className}`}
      style={style}
    >
      {/* ── Mobile: Logo only (left) ────────────────────────────────────────── */}
      {/* ── Desktop: Logo + nav links side by side (left column) ────────────── */}
      <div className='flex items-center gap-0 shrink-0'>
        <Link
          to='/'
          className='flex items-center gap-2 py-2 md:py-3 cursor-pointer transition-opacity hover:opacity-80 shrink-0'
          style={{ textDecoration: 'none' }}
        >
          <div className='logo-shine-wrapper' style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
            <img
              src={FULL_LOGO_URL}
              alt='AEONIAN'
              style={{
                height: 34,
                width: 'auto',
                maxWidth: 150,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
          <Badge
            variant='outline'
            className='text-[7px] font-semibold uppercase tracking-wider px-1 py-0 h-3 self-center leading-none'
            style={{
              color: '#8A8A8A',
              borderColor: '#2A2A2A',
              background: 'transparent',
              letterSpacing: '0.08em',
            }}
          >
            BETA
          </Badge>
        </Link>

        {/* Desktop nav links — immediately right of logo, hidden on mobile */}
        <nav className='hidden md:flex items-center gap-5 ml-6'>
          {DESKTOP_NAV.map((tab) => {
            const active = isActive(tab.matchPrefix);
            return (
              <Link
                key={tab.label}
                to={tab.path}
                className='text-sm font-medium transition-colors'
                style={{
                  color: active ? '#ffffff' : MUTED,
                  textDecoration: 'none',
                  letterSpacing: '0.01em',
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLAnchorElement).style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLAnchorElement).style.color = MUTED;
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Desktop center: search bar absolutely centered ───────────────────── */}
      {/* Positioned absolutely so it stays visually centered regardless of left/right column widths */}
      <div className='hidden md:flex absolute left-1/2 -translate-x-1/2 pointer-events-auto'>
        <DesktopMarketSearch />
      </div>

      {/* ── Right cluster ────────────────────────────────────────────────────── */}
      <div className='flex items-center gap-1 shrink-0'>
        {/* X / Twitter link — mobile only (desktop: footer) */}
        <a
          href='https://x.com/Aeonian_Arena'
          target='_blank'
          rel='noopener noreferrer'
          className='md:hidden flex items-center justify-center w-8 h-8 rounded-lg transition-colors'
          style={{ color: '#8A8A8A' }}
          aria-label='Follow AEONIAN on X'
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width={16} height={16}>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
          </svg>
        </a>

        {/* Instagram link — mobile only (desktop: footer) */}
        <a
          href='https://www.instagram.com/aeonian_arena'
          target='_blank'
          rel='noopener noreferrer'
          className='md:hidden flex items-center justify-center w-8 h-8 rounded-lg transition-colors'
          style={{ color: '#8A8A8A' }}
          aria-label='Follow AEONIAN on Instagram'
        >
          <Instagram size={16} />
        </a>

        {/* In-app notification bell (logged-in users only) */}
        <NotificationBell />

        {/* Rewards — desktop only, sits immediately beside the bell */}
        <Link
          to='/rewards'
          title='Rewards'
          className='hidden md:flex items-center gap-1.5 rounded-lg transition-colors'
          style={{
            padding: '6px 10px',
            color: PHANTOM_ACCENT,
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.01em',
            background: 'rgba(171,159,242,0.09)',
            border: '1px solid rgba(171,159,242,0.18)',
            borderRadius: 7,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(171,159,242,0.15)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(171,159,242,0.09)';
          }}
        >
          <Trophy size={13} />
          <span>Rewards</span>
        </Link>

        {/* Log In / account — desktop only */}
        <div className='hidden md:flex items-center ml-2'>
          <DesktopAuthButton />
        </div>

        {right && <div className='flex items-center ml-1'>{right}</div>}
      </div>

      <style>{`
        /*
         * Logo shine — a single Orchid glint band that translates from left to right.
         * The band lives at a fixed width (40% of the wrapper) and starts fully off-screen
         * left (translateX -150%), glides across at constant speed, then exits right
         * (translateX +150%). The pause between sweeps is the time the band spends
         * off-screen before the next cycle begins — no opacity changes, no blink.
         *
         * Timing: 1.4s travel out of a 5s total cycle (28% active, 72% invisible).
         * The active travel portion is the first 28% of the keyframe timeline;
         * the remaining 72% the band stays parked off-screen right (no movement visible).
         */
        @keyframes logo-shine-sweep {
          0%   { transform: translateX(-150%); }
          28%  { transform: translateX(250%); }
          100% { transform: translateX(250%); }
        }

        .logo-shine-wrapper {
          overflow: hidden;
        }

        .logo-shine-wrapper::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 40%;
          height: 100%;
          pointer-events: none;
          background: linear-gradient(
            105deg,
            transparent 0%,
            rgba(107, 47, 168, 0.08) 30%,
            rgba(176, 154, 217, 0.42) 50%,
            rgba(107, 47, 168, 0.08) 70%,
            transparent 100%
          );
          transform: translateX(-150%);
          animation: logo-shine-sweep 5s linear infinite;
          mix-blend-mode: screen;
        }

        @media (prefers-reduced-motion: reduce) {
          .logo-shine-wrapper::after {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
