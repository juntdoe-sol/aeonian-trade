import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@pooflabs/web';
import { Smartphone, LogOut, Instagram } from 'lucide-react';
import { ADMIN_ADDRESS } from '@/lib/constants';

const DESKTOP_BREAKPOINT = 1024;

function useIsDesktop(): boolean | undefined {
  const [isDesktop, setIsDesktop] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

interface DesktopBlockProps {
  children: React.ReactNode;
}

export function DesktopBlock({ children }: DesktopBlockProps) {
  const isDesktop = useIsDesktop();
  const { user, loading } = useAuth();
  const location = useLocation();

  const isAdmin = !!user?.address && user.address?.trim() === ADMIN_ADDRESS.trim();

  // /admin and /download routes are always accessible on desktop
  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/download')) {
    return <>{children}</>;
  }

  // isDesktop is undefined until the effect runs — treat as "not yet known"
  const desktopKnown = isDesktop !== undefined;

  // While auth is loading on a desktop viewport, show a loading spinner
  // (blank screen was leaving the admin stranded with no feedback)
  if (desktopKnown && isDesktop && loading) {
    return <DesktopLoadingScreen />;
  }

  // Block ALL non-admin users on desktop viewports (logged in or out).
  if (desktopKnown && isDesktop && !isAdmin) {
    return <MobileOnlyGate />;
  }

  return <>{children}</>;
}

function DesktopLoadingScreen() {
  return (
    <div
      className='fixed inset-0 z-[9999] flex items-center justify-center'
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 40%, hsl(270 60% 10%) 0%, hsl(270 60% 4%) 60%, hsl(270 50% 3%) 100%)',
      }}
    >
      <div className='flex flex-col items-center gap-4'>
        {/* Spinner ring */}
        <div
          className='w-8 h-8 rounded-full border-2 animate-spin'
          style={{
            borderColor: 'hsl(270 70% 58% / 0.15)',
            borderTopColor: 'hsl(275 70% 68%)',
          }}
        />
        <p
          className='text-xs tracking-[0.2em] uppercase'
          style={{
            color: 'hsl(270 20% 45%)',
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          Loading…
        </p>
      </div>
    </div>
  );
}

function MobileOnlyGate() {
  const { user, logout } = useAuth();

  const truncateAddress = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;

  return (
    <div
      className='fixed inset-0 z-[9999] flex flex-col items-center justify-center'
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 40%, hsl(270 60% 10%) 0%, hsl(270 60% 4%) 60%, hsl(270 50% 3%) 100%)',
      }}
    >
      {/* Subtle top glow line */}
      <div
        className='absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px'
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, hsl(270 70% 58% / 0.6) 40%, hsl(275 70% 62% / 0.8) 50%, hsl(270 70% 58% / 0.6) 60%, transparent 100%)',
        }}
      />

      {/* Content card */}
      <div
        className='relative flex flex-col items-center gap-6 px-12 py-10 text-center'
        style={{
          background: 'hsl(270 45% 10% / 0.6)',
          border: '1px solid hsl(270 35% 20%)',
          borderRadius: '1rem',
          backdropFilter: 'blur(20px)',
          boxShadow:
            '0 0 0 1px hsl(270 70% 58% / 0.08), 0 24px 80px hsl(270 60% 4% / 0.8), inset 0 1px 0 hsl(270 70% 58% / 0.12)',
          maxWidth: '440px',
        }}
      >
        {/* Icon container */}
        <div
          className='flex items-center justify-center w-16 h-16 rounded-2xl'
          style={{
            background: 'hsl(270 70% 58% / 0.12)',
            border: '1px solid hsl(270 70% 58% / 0.25)',
            boxShadow: '0 0 24px hsl(270 70% 58% / 0.15), inset 0 1px 0 hsl(270 70% 58% / 0.2)',
          }}
        >
          <Smartphone
            size={28}
            style={{ color: 'hsl(275 70% 68%)' }}
          />
        </div>

        {/* Heading */}
        <div className='flex flex-col gap-2'>
          <p
            className='text-xs font-semibold tracking-[0.2em] uppercase'
            style={{
              color: 'hsl(275 70% 68%)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            Mobile Only
          </p>
          <h1
            className='text-2xl font-bold leading-snug'
            style={{
              color: 'hsl(0 0% 100%)',
              fontFamily: "'Inter', system-ui, sans-serif",
              letterSpacing: '-0.02em',
            }}
          >
            For the best experience,
            <br />
            please open{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, hsl(270 70% 68%) 0%, hsl(300 65% 72%) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              AEONIAN
            </span>{' '}
            on your
            <br />
            mobile device.
          </h1>
        </div>

        {/* Subtext */}
        <p
          className='text-sm leading-relaxed'
          style={{
            color: 'hsl(270 20% 58%)',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          The desktop version is coming soon.
        </p>

        {/* Bottom accent line */}
        <div
          className='w-full h-px mt-2'
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, hsl(270 70% 58% / 0.3) 50%, transparent 100%)',
          }}
        />

        {/* Domain hint */}
        <p
          className='text-xs tracking-widest uppercase'
          style={{
            color: 'hsl(270 20% 40%)',
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          aeonian.trade
        </p>

        {/* Social links */}
        <div className='flex items-center justify-center gap-3'>
          <a
            href='https://x.com/Aeonian_Arena'
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200'
            style={{
              background: 'hsl(270 70% 58% / 0.08)',
              border: '1px solid hsl(270 70% 58% / 0.22)',
              color: 'hsl(275 70% 68%)',
            }}
            aria-label='Follow AEONIAN on X'
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'hsl(270 70% 58% / 0.16)';
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'hsl(270 70% 58% / 0.4)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'hsl(270 70% 58% / 0.08)';
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'hsl(270 70% 58% / 0.22)';
            }}
          >
            <svg viewBox='0 0 24 24' fill='currentColor' width={16} height={16}>
              <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z' />
            </svg>
          </a>
          <a
            href='https://www.instagram.com/aeonian_arena'
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200'
            style={{
              background: 'hsl(270 70% 58% / 0.08)',
              border: '1px solid hsl(270 70% 58% / 0.22)',
              color: 'hsl(275 70% 68%)',
            }}
            aria-label='Follow AEONIAN on Instagram'
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'hsl(270 70% 58% / 0.16)';
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'hsl(270 70% 58% / 0.4)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'hsl(270 70% 58% / 0.08)';
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'hsl(270 70% 58% / 0.22)';
            }}
          >
            <Instagram size={16} />
          </a>
        </div>

        {/* Admin escape hatch — visible when a wallet is connected */}
        {user?.address && (
          <div
            className='w-full flex flex-col items-center gap-3 pt-2'
            style={{ borderTop: '1px solid hsl(270 35% 18%)' }}
          >
            {/* Connected-as label */}
            <div className='flex flex-col items-center gap-1'>
              <p
                className='text-xs tracking-[0.15em] uppercase'
                style={{
                  color: 'hsl(270 20% 38%)',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                Connected as
              </p>
              <p
                className='text-sm'
                style={{
                  color: 'hsl(275 70% 68%)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  letterSpacing: '0.04em',
                }}
              >
                {truncateAddress(user.address)}
              </p>
            </div>

            {/* Logout / switch wallet button */}
            <button
              onClick={() => logout()}
              className='flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200'
              style={{
                background: 'hsl(270 70% 58% / 0.08)',
                border: '1px solid hsl(270 70% 58% / 0.22)',
                color: 'hsl(275 70% 68%)',
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: '0.06em',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'hsl(270 70% 58% / 0.16)';
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  'hsl(270 70% 58% / 0.4)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'hsl(270 70% 58% / 0.08)';
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  'hsl(270 70% 58% / 0.22)';
              }}
            >
              <LogOut size={12} />
              Switch Wallet
            </button>
          </div>
        )}
      </div>

      {/* Bottom glow */}
      <div
        className='absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] pointer-events-none'
        style={{
          background:
            'radial-gradient(ellipse at 50% 100%, hsl(270 70% 58% / 0.06) 0%, transparent 60%)',
        }}
      />
    </div>
  );
}
