import { forwardRef } from 'react';

/** Fixed card text color. Text-color customization was removed — the card always renders white text. */
const TEXT_COLOR = '#ffffff';

export interface PnlShareCardProps {
  market: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  realizedPnl: number;
  pnlPercent: number;
  bgColor: string;
  logoUrl?: string;
  /** Platform/brand logo URL (from useAppLogo), displayed above the date in the footer */
  platformLogoUrl?: string;
  bgImageDataUrl?: string;
  /** Which PnL figure to show as the headline: dollar amount or percentage. Default '$'. */
  pnlMode?: '$' | '%';
  /** X/Twitter avatar as a pre-fetched base64 data URL (remote URLs drop silently in html-to-image) */
  xAvatarDataUrl?: string;
  /** X/Twitter @username to display alongside the avatar */
  xUsername?: string;
}

/** Props for the standalone hidden overlay capture node rendered outside any transform ancestor */
export interface PnlOverlayCaptureProps {
  market: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  realizedPnl: number;
  pnlPercent: number;
  logoUrl?: string;
  /** Platform/brand logo URL (from useAppLogo), displayed above the date in the footer */
  platformLogoUrl?: string;
  /** Background image as a data URL (pre-fetched to avoid cross-origin taint in html-to-image) */
  bgImage?: string;
  /** Fallback solid background color used when no bgImage is provided */
  bgColor?: string;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  /** Which PnL figure to show as the headline: dollar amount or percentage. Default '$'. */
  pnlMode?: '$' | '%';
  /** X/Twitter avatar as a pre-fetched base64 data URL */
  xAvatarDataUrl?: string;
  /** X/Twitter @username */
  xUsername?: string;
}

function formatPriceCompact(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatPnl(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/** Shared overlay content used both inside PnlShareCard and for the hidden capture node */
function OverlayContent({
  market,
  side,
  entryPrice,
  exitPrice,
  size,
  realizedPnl,
  pnlPercent,
  logoUrl,
  platformLogoUrl,
  showBgOverlay,
  isPositive,
  pnlColor,
  pnlMode = '$',
  xAvatarDataUrl,
  xUsername,
}: {
  market: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  realizedPnl: number;
  pnlPercent: number;
  logoUrl?: string;
  platformLogoUrl?: string;
  showBgOverlay: boolean;
  isPositive: boolean;
  pnlColor: string;
  pnlMode?: '$' | '%';
  xAvatarDataUrl?: string;
  xUsername?: string;
}) {
  return (
    <>
      {/* Dark overlay when using background image to keep text readable */}
      {showBgOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Decorative gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 80% 60% at 70% 40%, ${isPositive ? 'rgba(74,222,128,0.12)' : 'rgba(255,82,82,0.10)'} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Subtle grid pattern */}
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

      {/* Top row: logo + market + badge */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="logo"
              style={{ height: '36px', width: 'auto', objectFit: 'contain' }}
            />
          ) : (
            <div
              style={{
                height: '36px',
                width: '36px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 700,
                color: TEXT_COLOR,
                WebkitTextFillColor: TEXT_COLOR,
                WebkitTextStroke: '0',
              }}
            >
              A
            </div>
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em', opacity: 0.7, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              CLOSED POSITION
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '2px', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>{market}</div>
          </div>
        </div>

        <span
          style={{
            fontSize: '13px',
            fontWeight: 700,
            padding: '6px 14px',
            borderRadius: '999px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            background: side === 'Long' ? 'rgba(74,222,128,0.18)' : 'rgba(255,82,82,0.18)',
            color: side === 'Long' ? '#4ADE80' : '#FF5252',
            WebkitTextFillColor: side === 'Long' ? '#4ADE80' : '#FF5252',
            WebkitTextStroke: '0',
            border: `1px solid ${side === 'Long' ? 'rgba(74,222,128,0.35)' : 'rgba(255,82,82,0.35)'}`,
          }}
        >
          {side}
        </span>
      </div>

      {/* Center: giant PnL — shows either $ or % based on pnlMode */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'baseline', gap: '16px' }}>
        <div style={{ fontSize: '72px', fontWeight: 800, lineHeight: 1, color: pnlColor, WebkitTextFillColor: pnlColor, WebkitTextStroke: '0' }}>
          {pnlMode === '%' ? formatPct(pnlPercent) : formatPnl(realizedPnl)}
        </div>
      </div>

      {/* Bottom row: prices + footer */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', gap: '40px', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', opacity: 0.5, marginBottom: '4px', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              ENTRY PRICE
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              ${formatPriceCompact(entryPrice)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', opacity: 0.5, marginBottom: '4px', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              EXIT PRICE
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              ${formatPriceCompact(exitPrice)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', opacity: 0.5, marginBottom: '4px', color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              SIZE
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              {size.toFixed(4)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid rgba(255,255,255,0.1)`,
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
              <img
                src={platformLogoUrl}
                alt="AEONIAN"
                style={{ height: '18px', width: 'auto', objectFit: 'contain', opacity: 0.85 }}
              />
            )}
            <span style={{ fontSize: '11px', opacity: 0.4, fontWeight: 500, color: TEXT_COLOR, WebkitTextFillColor: TEXT_COLOR, WebkitTextStroke: '0' }}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

const pnlCardBaseStyle: React.CSSProperties = {
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

const PnlShareCard = forwardRef<HTMLDivElement, PnlShareCardProps>(
  ({ market, side, entryPrice, exitPrice, size, realizedPnl, pnlPercent, bgColor, logoUrl, platformLogoUrl, bgImageDataUrl, pnlMode = '$', xAvatarDataUrl, xUsername }, ref) => {
    const isPositive = realizedPnl >= 0;
    const pnlColor = isPositive ? '#4ADE80' : '#FF5252';

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
      <div
        ref={ref}
        style={{
          ...pnlCardBaseStyle,
          color: TEXT_COLOR,
          ...backgroundStyle,
        }}
      >
        <OverlayContent
          market={market}
          side={side}
          entryPrice={entryPrice}
          exitPrice={exitPrice}
          size={size}
          realizedPnl={realizedPnl}
          pnlPercent={pnlPercent}
          logoUrl={logoUrl}
          platformLogoUrl={platformLogoUrl}
          showBgOverlay={!!bgImageDataUrl}
          isPositive={isPositive}
          pnlColor={pnlColor}
          pnlMode={pnlMode}
          xAvatarDataUrl={xAvatarDataUrl}
          xUsername={xUsername}
        />
      </div>
    );
  }
);

/**
 * Standalone hidden overlay capture node for PNG export.
 * Must be rendered OUTSIDE any transform-scaled ancestor so html-to-image
 * captures it at its natural 800x400 size with no ancestor transform applied.
 * The background (admin data URL) is baked in here so it reliably embeds in
 * the captured PNG on mobile Safari.
 */
export function PnlOverlayCapture({
  market,
  side,
  entryPrice,
  exitPrice,
  size,
  realizedPnl,
  pnlPercent,
  logoUrl,
  platformLogoUrl,
  bgImage,
  bgColor = '#1a3a6e',
  overlayRef,
  pnlMode = '$',
  xAvatarDataUrl,
  xUsername,
}: PnlOverlayCaptureProps) {
  const isPositive = realizedPnl >= 0;
  const pnlColor = isPositive ? '#4ADE80' : '#FF5252';

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
    // Zero-size wrapper: visually hides the child WITHOUT offsetting its computed left/top.
    // html-to-image copies the child's full computed style into the SVG foreignObject clone —
    // if the child has left:-9999px it renders 9999px outside the 800×400 viewBox and gets clipped.
    // Keeping the child at left:0/top:0 inside a zero-size overflow:hidden fixed container
    // keeps it invisible on the live page while preserving its position inside the viewBox.
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      <div
        ref={overlayRef}
        style={{
          ...pnlCardBaseStyle,
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
        <OverlayContent
          market={market}
          side={side}
          entryPrice={entryPrice}
          exitPrice={exitPrice}
          size={size}
          realizedPnl={realizedPnl}
          pnlPercent={pnlPercent}
          logoUrl={logoUrl}
          platformLogoUrl={platformLogoUrl}
          showBgOverlay={!!bgImage}
          isPositive={isPositive}
          pnlColor={pnlColor}
          pnlMode={pnlMode}
          xAvatarDataUrl={xAvatarDataUrl}
          xUsername={xUsername}
        />
      </div>
    </div>
  );
}

PnlShareCard.displayName = 'PnlShareCard';

export default PnlShareCard;
