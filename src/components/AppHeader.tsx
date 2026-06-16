import { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Trophy, Instagram } from 'lucide-react';
import { Link } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';

const FULL_LOGO_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a2ad652d3980483add4a6c8';

interface AppHeaderProps {
  /** Optional right-side content (e.g. a refresh button) */
  right?: ReactNode;
  /** Additional inline style for the outer container */
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Shared sticky top header used across all pages.
 * Shows the full Phoenix wordmark logo (icon + PHOENIX text).
 * Right side: portfolio balance pill + Deposit/Withdraw buttons (for logged-in users),
 * plus any extra content passed via the `right` prop.
 */
export function AppHeader({ right, style, className = '' }: AppHeaderProps) {
  return (
    <div
      className={`glass-header sticky top-0 z-40 flex items-center justify-between px-4 py-0 ${className}`}
      style={style}
    >
      {/* Logo */}
      <div className='flex items-center gap-2 py-2'>
        <img
          src={FULL_LOGO_URL}
          alt='AEONIAN'
          style={{
            height: 34,
            width: 'auto',
            maxWidth: 150,
            objectFit: 'contain',
          }}
        />
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
      </div>

      {/* Right slot: X link, Rewards nav, any extra content */}
      <div className='flex items-center gap-1'>
        {/* X / Twitter link */}
        <a
          href='https://x.com/Aeonian_Arena'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center justify-center w-8 h-8 rounded-lg transition-colors'
          style={{ color: '#8A8A8A' }}
          aria-label='Follow AEONIAN on X'
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width={16} height={16}>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
            </svg>
        </a>

        {/* Instagram link */}
        <a
          href='https://www.instagram.com/aeonian_arena'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center justify-center w-8 h-8 rounded-lg transition-colors'
          style={{ color: '#8A8A8A' }}
          aria-label='Follow AEONIAN on Instagram'
        >
          <Instagram size={16} />
        </a>

        {/* In-app notification bell (logged-in users only) */}
        <NotificationBell />

        {/* Rewards nav button */}
        <Link
          to='/rewards'
          aria-label='Rewards'
          title='Rewards'
          className='flex items-center justify-center p-1.5 rounded-lg transition-colors'
          style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
        >
          <Trophy size={16} />
        </Link>

        {right && <div className='flex items-center ml-1'>{right}</div>}
      </div>
    </div>
  );
}
