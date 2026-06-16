import { forwardRef } from 'react';

export interface PromoShareCardProps {
  logoUrl?: string;
  backgroundUrl?: string;
}

const PromoShareCard = forwardRef<HTMLDivElement, PromoShareCardProps>(
  ({ logoUrl, backgroundUrl }, ref) => {
    const backgroundStyle: React.CSSProperties = backgroundUrl
      ? {
          backgroundColor: '#0f1a2e',
          backgroundImage: `url(${backgroundUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }
      : {
          backgroundColor: '#0f1a2e',
          backgroundImage: 'linear-gradient(135deg, #0a0a0a 0%, #141414 100%)',
        };

    return (
      <div
        ref={ref}
        style={{
          width: '1200px',
          height: '675px',
          ...backgroundStyle,
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: "'Inter', 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, sans-serif",
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 64px',
          boxSizing: 'border-box',
        }}
      >
        {/* Decorative gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 70% 60% at 80% 30%, rgba(99,102,241,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Subtle grid pattern */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.05,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            pointerEvents: 'none',
          }}
        />

        {/* Top row: logo (big, right-aligned) */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="AEONIAN"
              style={{ height: '120px', width: 'auto', objectFit: 'contain' }}
            />
          ) : (
            <div
              style={{
                height: '120px',
                width: '120px',
                borderRadius: '20px',
                background: 'rgba(255,255,255,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                fontWeight: 800,
              }}
            >
              X
            </div>
          )}
        </div>

        {/* Center: taglines */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          {/* Localized soft gradient directly behind the center text for legibility (not a full-card scrim) */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: '120%',
              height: '180%',
              background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,0,0,0.35) 0%, transparent 75%)',
              pointerEvents: 'none',
              zIndex: -1,
            }}
          />
          <div
            style={{
              fontSize: '56px',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              background: 'linear-gradient(90deg, #ffffff 0%, #a5b4fc 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.55))',
            }}
          >
            Trade Perps. Win Battles. Earn Points directly from your phone.
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 500,
              marginTop: '20px',
              color: '#e4e4e7',
              letterSpacing: '0.01em',
              textShadow: '0 1px 6px rgba(0,0,0,0.6)',
            }}
          >
            Install AEONIAN on your Seeker:Solana Mobile now!
          </div>
        </div>

        {/* Bottom row: footer */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: '20px',
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#a855f7', letterSpacing: '0.02em' }}>
            aeonian.trade
          </span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#52525b' }}>
            Powered by Solana Perps
          </span>
        </div>
      </div>
    );
  }
);

PromoShareCard.displayName = 'PromoShareCard';

export default PromoShareCard;
