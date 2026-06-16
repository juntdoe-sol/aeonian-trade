import { forwardRef } from 'react';

export interface BattleResultShareCardProps {
  winnerHandle: string;
  challengerHandle: string;
  opponentHandle: string;
  challengerPnlPct: number;
  opponentPnlPct: number;
  potUsdc: string;
  appName?: string;
  tagline?: string;
  bgColor?: string;
  fontColor?: string;
  logoUrl?: string;
}

function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

const BattleResultShareCard = forwardRef<HTMLDivElement, BattleResultShareCardProps>(
  ({ winnerHandle, challengerHandle, opponentHandle, challengerPnlPct, opponentPnlPct, potUsdc, appName = 'Trading Battles', tagline = 'Head-to-head Phoenix Perps competition', bgColor = '#0f0f0f', fontColor = '#ffffff', logoUrl }, ref) => {
    const challColor = challengerPnlPct >= 0 ? '#4ADE80' : '#FF5252';
    const oppColor = opponentPnlPct >= 0 ? '#4ADE80' : '#FF5252';

    return (
      <div
        ref={ref}
        style={{
          width: '800px',
          height: '500px',
          background: bgColor,
          color: fontColor,
          position: 'relative',
          overflow: 'hidden',
          fontFamily: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px 56px',
          boxSizing: 'border-box',
        }}
      >
        {/* Decorative gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 80% 60% at 50% 30%, rgba(183,148,246,0.10) 0%, transparent 70%)',
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
            backgroundSize: '40px 40px',
            pointerEvents: 'none',
          }}
        />

        {/* Top row: logo + app name */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="logo"
                style={{ height: '40px', width: 'auto', objectFit: 'contain' }}
              />
            ) : (
              <div
                style={{
                  height: '40px',
                  width: '40px',
                  borderRadius: '10px',
                  background: 'rgba(183,148,246,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  fontWeight: 800,
                  color: '#b794f6',
                }}
              >
                B
              </div>
            )}
            <div>
              <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em' }}>{appName}</div>
              <div style={{ fontSize: '12px', fontWeight: 500, opacity: 0.5, marginTop: '2px' }}>{tagline}</div>
            </div>
          </div>

          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              padding: '8px 18px',
              borderRadius: '999px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              background: 'rgba(255,215,0,0.15)',
              color: '#FFD700',
              border: '1px solid rgba(255,215,0,0.35)',
            }}
          >
            Battle Result
          </span>
        </div>

        {/* Center: Winner announcement */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.5, marginBottom: '12px' }}>
            WINNER
          </div>
          <div style={{ fontSize: '56px', fontWeight: 800, lineHeight: 1.1, color: '#FFD700' }}>
            {winnerHandle}
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#FFD700', opacity: 0.85, marginTop: '8px' }}>
            WON
          </div>
        </div>

        {/* Bottom: PnL comparison + pot */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
            {/* Challenger */}
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', opacity: 0.5, marginBottom: '6px' }}>
                {challengerHandle}
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, lineHeight: 1, color: challColor }}>
                {formatPct(challengerPnlPct)}
              </div>
            </div>

            {/* VS */}
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(183,148,246,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 800,
                color: '#b794f6',
                border: '1px solid rgba(183,148,246,0.3)',
                flexShrink: 0,
                margin: '0 24px',
              }}
            >
              VS
            </div>

            {/* Opponent */}
            <div style={{ textAlign: 'right', flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', opacity: 0.5, marginBottom: '6px' }}>
                {opponentHandle}
              </div>
              <div style={{ fontSize: '36px', fontWeight: 800, lineHeight: 1, color: oppColor }}>
                {formatPct(opponentPnlPct)}
              </div>
            </div>
          </div>

          {/* Pot */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              padding: '14px 0',
              borderTop: '1px solid rgba(255,255,255,0.08)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.1em', opacity: 0.5 }}>POT SIZE</span>
            <span style={{ fontSize: '22px', fontWeight: 800, color: '#4ADE80' }}>{potUsdc}</span>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '14px',
            }}
          >
            <span style={{ fontSize: '11px', opacity: 0.35, fontWeight: 500 }}>
              Powered by Phoenix Perps
            </span>
            <span style={{ fontSize: '11px', opacity: 0.35, fontWeight: 500 }}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>
    );
  }
);

BattleResultShareCard.displayName = 'BattleResultShareCard';

export default BattleResultShareCard;
