import { useState } from 'react';
import { getTokenColor, getFallbackLogoUrl, getTokenLogoUrl } from '@/utils/token-logos';

interface TokenLogoProps {
  symbol: string;
  size?: number;
  className?: string;
}

/**
 * Displays a token logo image with a 3-level fallback chain:
 *   1. Curated symbol→URL map (CoinGecko CDN, verified)
 *   2. spothq/cryptocurrency-icons SVG (generic, may 404)
 *   3. Colored circle with first letter of base symbol
 */
export function TokenLogo({ symbol, size = 24, className = '' }: TokenLogoProps) {
  // 0 = try primary, 1 = try generic fallback, 2 = show letter avatar
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  const base = symbol.replace(/-PERP$/i, '').toUpperCase();
  const letter = base.charAt(0);
  const color = getTokenColor(symbol);

  const primaryUrl = getTokenLogoUrl(symbol);
  const genericUrl = getFallbackLogoUrl(symbol);

  const circleStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
  };

  // Stage 2: letter avatar (final fallback)
  if (stage === 2) {
    return (
      <div
        className={className}
        style={{
          ...circleStyle,
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.42,
          fontWeight: 700,
          color: '#000',
          letterSpacing: '-0.01em',
        }}
      >
        {letter}
      </div>
    );
  }

  // Stage 1: generic cryptocurrency-icons SVG fallback
  if (stage === 1) {
    return (
      <img
        src={genericUrl}
        alt={base}
        width={size}
        height={size}
        onError={() => setStage(2)}
        className={className}
        style={{ ...circleStyle, objectFit: 'cover' }}
      />
    );
  }

  // Stage 0: primary curated URL (if available) or skip straight to stage 1
  if (primaryUrl) {
    return (
      <img
        src={primaryUrl}
        alt={base}
        width={size}
        height={size}
        onError={() => setStage(1)}
        className={className}
        style={{ ...circleStyle, objectFit: 'cover' }}
      />
    );
  }

  // No primary URL — try generic fallback immediately
  return (
    <img
      src={genericUrl}
      alt={base}
      width={size}
      height={size}
      onError={() => setStage(2)}
      className={className}
      style={{ ...circleStyle, objectFit: 'cover' }}
    />
  );
}
