import { Repeat, Wallet, Swords, Download, Compass } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const ARENA_ICON_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a2bdb0d51aa5d57d5684be7';

const TABS = [
  { label: 'Discover', icon: Compass, path: '/discovery' },
  { label: 'Trade', icon: Repeat, path: '/trade/SOL-PERP' },
  { label: 'Arena', icon: Swords, iconUrl: ARENA_ICON_URL, path: '/battles', featured: true },
  { label: 'Account', icon: Wallet, path: '/portfolio' },
];

export function BottomTabNav() {
  const location = useLocation();
  const navigate = useNavigate();

  function isActive(path: string): boolean {
    if (path.startsWith('/trade')) return location.pathname.startsWith('/trade');
    if (path === '/battles') return location.pathname.startsWith('/battles');
    if (path === '/discovery') return location.pathname === '/discovery' || location.pathname === '/';
    return location.pathname === path;
  }

  const ACCENT = 'hsl(275 70% 62%)';
  const INACTIVE = 'rgba(235, 235, 245, 0.6)';

  return (
    <nav
      className='md:hidden fixed bottom-0 left-0 right-0 z-50 pointer-events-none'
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <style>{`
        @keyframes battleShine {
          0% { transform: translateX(-160%) skewX(-20deg); }
          60%, 100% { transform: translateX(260%) skewX(-20deg); }
        }
        .battle-shine {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          width: 45%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
          animation: battleShine 3.2s ease-in-out infinite;
          pointer-events: none;
          border-radius: inherit;
        }
      `}</style>

      {/* Floating frosted-glass pill */}
      <div
        className='pointer-events-auto mx-4 mb-3 flex items-stretch justify-around gap-1 p-1.5 max-w-md md:mx-auto'
        style={{
          borderRadius: '9999px',
          background: '#141418',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
        }}
      >
        {TABS.map((tab) => {
          const active = isActive(tab.path);
          const featured = (tab as { featured?: boolean }).featured;
          const iconUrl = (tab as { iconUrl?: string }).iconUrl;
          return (
            <button
              key={tab.label}
              onClick={() => navigate(tab.path)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className='relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 px-1 overflow-hidden'
              style={{
                color: active ? ACCENT : INACTIVE,
                background: active
                  ? 'linear-gradient(135deg, rgba(168,85,247,0.22), rgba(124,58,237,0.16))'
                  : 'transparent',
                boxShadow: active
                  ? `inset 0 0 0 1px rgba(168,85,247,0.45), 0 0 18px ${featured ? 'rgba(217,70,239,0.35)' : 'rgba(168,85,247,0.22)'}`
                  : 'none',
                transition:
                  'color 0.25s ease, background 0.3s ease, box-shadow 0.3s ease',
              }}
            >
              {featured && active && <span className='battle-shine' />}
              {iconUrl ? (
                <span
                  className='relative'
                  style={{
                    width: 22,
                    height: 22,
                    backgroundColor: 'currentColor',
                    WebkitMaskImage: `url(${iconUrl})`,
                    maskImage: `url(${iconUrl})`,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center',
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                  }}
                />
              ) : (
                <tab.icon
                  size={22}
                  strokeWidth={active ? 2.4 : 1.9}
                  className='relative'
                />
              )}
              <span
                className='relative text-[11px] font-medium leading-none tracking-wide'
                style={{ transition: 'color 0.25s ease' }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legal link strip */}
      <div
        className='pointer-events-auto flex items-center justify-center gap-4 pb-2'
      >
        <Link
          to='/privacy'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: '#4A4A4A' }}
        >
          Privacy
        </Link>
        <span style={{ color: '#2A2A2A', fontSize: 8 }}>&bull;</span>
        <Link
          to='/license'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: '#4A4A4A' }}
        >
          License
        </Link>
        <span style={{ color: '#2A2A2A', fontSize: 8 }}>&bull;</span>
        <Link
          to='/copyright'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: '#4A4A4A' }}
        >
          Copyright
        </Link>
        <span style={{ color: '#2A2A2A', fontSize: 8 }}>&bull;</span>
        <Link
          to='/about'
          className='text-[10px] transition-colors hover:text-white'
          style={{ color: '#4A4A4A' }}
        >
          About
        </Link>
        <span style={{ color: '#2A2A2A', fontSize: 8 }}>&bull;</span>
        <Link
          to='/download'
          aria-label='Download App'
          className='transition-colors hover:text-white'
          style={{ color: '#4A4A4A' }}
        >
          <Download size={12} strokeWidth={1.8} />
        </Link>
      </div>
    </nav>
  );
}
