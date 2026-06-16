/**
 * MonthlyWinnerShareCard — share-card variant celebrating a monthly prize win.
 * Mirrors PnlShareCard's 800x400 fixed layout + hidden capture-node pattern so
 * it reuses the same html-to-image export machinery.
 */

const TEXT_COLOR = '#ffffff';
const GOLD = '#FFD700';

export interface WinnerTokenLine {
  /** Friendly symbol, e.g. "SOL" / "USDC". */
  symbol: string;
  /** Formatted human amount, e.g. "1.5". */
  amount: string;
}

export interface MonthlyWinnerCardProps {
  rank: number;
  monthLabel: string;
  tokens: WinnerTokenLine[];
  platformLogoUrl?: string;
  bgImageDataUrl?: string;
  bgColor: string;
  xAvatarDataUrl?: string;
  xUsername?: string;
}

const RANK_LABEL: Record<number, string> = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };

const cardBaseStyle: React.CSSProperties = {
  width: '800px',
  height: '400px',
  position: 'relative',
  overflow: 'hidden',
  fontFamily: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: '40px 48px',
  boxSizing: 'border-box',
};

function WinnerContent({
  rank,
  monthLabel,
  tokens,
  platformLogoUrl,
  showBgOverlay,
  xAvatarDataUrl,
  xUsername,
}: {
  rank: number;
  monthLabel: string;
  tokens: WinnerTokenLine[];
  platformLogoUrl?: string;
  showBgOverlay: boolean;
  xAvatarDataUrl?: string;
  xUsername?: string;
}) {
  const visible = tokens.filter((t) => t.amount && t.amount !== '0');
  return (
    <>
      {showBgOverlay && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
      )}
      {/* Gold radial glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 80% 60% at 70% 35%, rgba(255,215,0,0.16) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.06,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }}
      />

      {/* Top: badge + rank */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em', opacity: 0.7, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
            MONTHLY PRIZE WINNER
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
            {monthLabel}
          </div>
        </div>
        <span
          style={{
            fontSize: '15px',
            fontWeight: 800,
            padding: '8px 18px',
            borderRadius: '999px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            background: 'rgba(255,215,0,0.18)',
            color: GOLD,
            WebkitTextFillColor: GOLD,
            WebkitTextStroke: '0',
            border: '1px solid rgba(255,215,0,0.4)',
          }}
        >
          {RANK_LABEL[rank] ?? `#${rank}`}
        </span>
      </div>

      {/* Center: tokens won */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.1em', opacity: 0.55, marginBottom: '12px', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
          PRIZE WON
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '14px 28px' }}>
          {visible.length === 0 ? (
            <span style={{ fontSize: '40px', fontWeight: 800, color: GOLD, WebkitTextFillColor: GOLD, WebkitTextStroke: '0' }}>—</span>
          ) : (
            visible.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ fontSize: '52px', fontWeight: 800, lineHeight: 1, color: GOLD, WebkitTextFillColor: GOLD, WebkitTextStroke: '0' }}>
                  {t.amount}
                </span>
                <span style={{ fontSize: '24px', fontWeight: 700, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0', opacity: 0.85 }}>
                  {t.symbol}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          paddingTop: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
            aeonian.trade
            <span style={{ opacity: 0.45, fontWeight: 500, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR }}> · Solana Perps</span>
          </span>
          {xUsername && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.2)' }} />
              {xAvatarDataUrl && (
                <img
                  src={xAvatarDataUrl}
                  alt={xUsername}
                  style={{ width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0 }}
                />
              )}
              <span style={{ fontSize: '11px', fontWeight: 600, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0', opacity: 0.75 }}>
                @{xUsername}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          {platformLogoUrl && (
            <img src={platformLogoUrl} alt="AEONIAN" style={{ height: '18px', width: 'auto', objectFit: 'contain', opacity: 0.85 }} />
          )}
          <span style={{ fontSize: '11px', opacity: 0.4, fontWeight: 500, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
      </div>
    </>
  );
}

export function MonthlyWinnerShareCard({
  rank,
  monthLabel,
  tokens,
  platformLogoUrl,
  bgImageDataUrl,
  bgColor,
  xAvatarDataUrl,
  xUsername,
}: MonthlyWinnerCardProps) {
  const backgroundStyle: React.CSSProperties = bgImageDataUrl
    ? {
        backgroundImage: `url(${bgImageDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: bgColor,
      }
    : { background: bgColor };

  return (
    <div style={{ ...cardBaseStyle, color: TEXT_COLOR, ...backgroundStyle }}>
      <WinnerContent
        rank={rank}
        monthLabel={monthLabel}
        tokens={tokens}
        platformLogoUrl={platformLogoUrl}
        showBgOverlay={!!bgImageDataUrl}
        xAvatarDataUrl={xAvatarDataUrl}
        xUsername={xUsername}
      />
    </div>
  );
}

export interface MonthlyWinnerOverlayCaptureProps extends Omit<MonthlyWinnerCardProps, 'bgImageDataUrl'> {
  bgImage?: string;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

export function MonthlyWinnerOverlayCapture({
  rank,
  monthLabel,
  tokens,
  platformLogoUrl,
  bgImage,
  bgColor,
  overlayRef,
  xAvatarDataUrl,
  xUsername,
}: MonthlyWinnerOverlayCaptureProps) {
  const backgroundStyle: React.CSSProperties = bgImage
    ? {
        backgroundImage: `url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: bgColor,
      }
    : { background: bgColor };

  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none', zIndex: -1 }}
    >
      <div
        ref={overlayRef}
        style={{
          ...cardBaseStyle,
          color: TEXT_COLOR,
          position: 'absolute',
          left: 0,
          top: 0,
          width: '800px',
          height: '400px',
          pointerEvents: 'none',
          ...backgroundStyle,
        }}
      >
        <WinnerContent
          rank={rank}
          monthLabel={monthLabel}
          tokens={tokens}
          platformLogoUrl={platformLogoUrl}
          showBgOverlay={!!bgImage}
          xAvatarDataUrl={xAvatarDataUrl}
          xUsername={xUsername}
        />
      </div>
    </div>
  );
}

export default MonthlyWinnerShareCard;
