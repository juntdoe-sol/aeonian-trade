/**
 * Phoenix Perps market registry — single source of truth.
 *
 * Data sourced from https://public-api.phoenix.trade/exchange (live),
 * filtered to marketStatus === "active".
 * Keys use the "<SYM>-PERP" convention used throughout the codebase.
 *
 * baseLotDecimals: the exponent used to convert a human-readable base token
 * quantity to base lots.
 *   sizeBaseLots = floor(sizeBase × 10^baseLotDecimals)
 *
 * IMPORTANT: baseLotDecimals can be negative (PUMP = -2) or zero, which are
 * legitimate values. Fallback logic must ONLY apply to genuinely absent keys
 * (missing from this map), never to zero or negative values.
 * Use: MARKETS['XYZ-PERP']?.baseLotDecimals ?? 2  (absent key → 2, but 0 and -2 preserved)
 */

export interface PhoenixMarket {
  /** On-chain Solana public key of the Phoenix market account */
  pubkey: string;
  /** Base-lot decimals: sizeBaseLots = floor(size × 10^baseLotDecimals) */
  baseLotDecimals: number;
}

/**
 * Static fallback registry — used when the live endpoint is unreachable.
 * Kept in sync with the active set from https://public-api.phoenix.trade/exchange.
 * Map from "<SYM>-PERP" key to market config.
 */
export const MARKETS: Record<string, PhoenixMarket> = {
  // Crypto
  'SOL-PERP':      { pubkey: '71Si24E4uc3oCaPbPZTozC1ptSNNqygjjebxSmErSsC2', baseLotDecimals: 2  },
  'BTC-PERP':      { pubkey: 'AXFz1MuzMUBHi5UKJuK3FDCQ73o3rSzubGU2mPr4LLU7', baseLotDecimals: 4  },
  'ETH-PERP':      { pubkey: '9u7aqptdRFbsnnoHtjK13E5JkeM14EW5fAKTRPidVF88',  baseLotDecimals: 3  },
  'XRP-PERP':      { pubkey: 'CwaHtR69D287PLnoX8zzzk1zqwNQKVJiJQTNs6JrVyna',  baseLotDecimals: 2  },
  'HYPE-PERP':     { pubkey: 'CEx9Mgz5cAmWwy6D5H2xGrhmwKeC5L7KtYhFhVGtiBaZ',  baseLotDecimals: 2  },
  'SKR-PERP':      { pubkey: 'HnKUNWrcrpYqK5Uworv2wH6Ki3ciDVDDYqicE5SRAAWs',  baseLotDecimals: 0  },
  'BNB-PERP':      { pubkey: '4Xd7E3eBXazSoudAMACsNdezA4UuJETURL1S6fqpjcTR',  baseLotDecimals: 2  },
  'DOGE-PERP':     { pubkey: 'Hqt5Vom5L3X3RcKysKnBmLAvjYgo6TGAwoheW658h5cz',  baseLotDecimals: 0  },
  'AAVE-PERP':     { pubkey: 'A6CdPuNY3mp4tsY1ifQoesHKfwYdVv3wqcaKirEGtaMS',  baseLotDecimals: 2  },
  'SUI-PERP':      { pubkey: 'GQS3qn9EjKYpqoLwpvPVbeW9o1bjFYhc1SRMZYw4iNru',  baseLotDecimals: 0  },
  'ZEC-PERP':      { pubkey: 'FTbbqCP2N2NkUHw1nMPpBhiQCrYGiMQAhK7g1G8NJKEt',  baseLotDecimals: 2  },
  'TAO-PERP':      { pubkey: 'CoshgxCZygQnS5jJLi24DkuJN4hddRNdPVSmTWrURbHu',  baseLotDecimals: 3  },
  'LIT-PERP':      { pubkey: 'CuEkf4SopwRHsdYfTy5zE5aohcWXmFh693Fb99nueJ4r',  baseLotDecimals: 1  },
  'MON-PERP':      { pubkey: '7hnu7Fm4UXF3K5wpytJuaSeAjw2XYDN4avgy6ZDKCPhs',  baseLotDecimals: 0  },
  'NEAR-PERP':     { pubkey: 'AHLLA4oggZssMt1M3sfyZ1z2XWt9m6JjNzjS5getE78q',  baseLotDecimals: 0  },
  'XPL-PERP':      { pubkey: '9HTT4Do4i9NM6Lc8vBE1qPEhEDejuNkza3dnUstyzfcp',  baseLotDecimals: 0  },
  'FARTCOIN-PERP': { pubkey: 'ERTPfrA1VzpnefeGWUtoWRuE9r8wak5KL3Mm4EYCVgc7',  baseLotDecimals: 0  },
  'ENA-PERP':      { pubkey: 'CQJduVF57Eycp6M6fPDv5GBUR2TL5cCiriaLBhoCz4dj',  baseLotDecimals: 0  },
  'CHIP-PERP':     { pubkey: '7kqxngbXdGsshqN6btUihJsKDJVXPe7ZENk8EAe41bjN',  baseLotDecimals: 0  },
  'MEGA-PERP':     { pubkey: '6KS7HgwRHZG47d7yJgVQrEJQv3jVCrBwDDRxK3YFCMV4',  baseLotDecimals: 0  },
  'JTO-PERP':      { pubkey: 'AJCsYQYT9ezpdcq28yzVkXos5RKhaWrRbDFASgJxNtu9',  baseLotDecimals: 1  },
  'TON-PERP':      { pubkey: '59qkaEUQJokbc8CGVzNg9ESzGDK8dro4D13UtfekR6JE',  baseLotDecimals: 1  },
  'VVV-PERP':      { pubkey: '5kPZcErZ12YbqhUHzguCgYyjMVHxpiMAW324KL2jWVHQ',  baseLotDecimals: 2  },
  'JUP-PERP':      { pubkey: '9vhQ2yo3b23vQ75iK7qQTRcVkqtpLjaWuphkZ2TQiYEE',  baseLotDecimals: 0  },
  // PUMP: baseLotDecimals = -2 (negative — this is intentional and MUST NOT be clobbered by a ?? fallback)
  'PUMP-PERP':     { pubkey: 'EwveokQBpaTiGkwCHm2yVdwogHm26PRwponFDt7EjEhz',  baseLotDecimals: -2 },
  'MET-PERP':      { pubkey: 'HxhDqvdDJ9qWaWJ5tvMEdyL1CvZmnBtqA5PTRLyr7CB',  baseLotDecimals: 0  },

  // Equities — added from public-api.phoenix.trade/exchange (active, isolated-only) 2026-06-11
  'NVDA-PERP':     { pubkey: 'AzySnZQCNjkQMtm5ZDd2FjKYTjBoNb5Bv5Dsm3WyRkbj', baseLotDecimals: 3  },
  'AAPL-PERP':     { pubkey: '5pheia5Tou27SJnJjQdrRUMpbWmXF5jU7cXMLBt8upzz', baseLotDecimals: 3  },

  // Commodities — added from public-api.phoenix.trade/exchange (active)
  'GOLD-PERP':     { pubkey: '7B7hDscDNBGFpNGypFygoiANCpdM3JR2PY3JbvPvQtmk', baseLotDecimals: 3  },
  'SILVER-PERP':   { pubkey: 'GD4XZsTfAbjromE1zac61AUAhyfXhwFa8soBmUo59WqB', baseLotDecimals: 2  },
  'COPPER-PERP':   { pubkey: 'CYBXMLK8N5SRiWcFRw3vHrLez8bW9uTxSGxr9ZL6MjkJ', baseLotDecimals: 1  },
  'WTIOIL-PERP':   { pubkey: 'aYRsjCr1JEcdPWYeztgRWz8zDTs2mzhQ1hTxNWCmXND',   baseLotDecimals: 2  },

  // Previously missing from registry — verified from live /exchange endpoint 2026-06-05
  'WLD-PERP':      { pubkey: '9fpYNmbtByPavdaQ6NV141aUyYLvcrBnNA6FDkh5aGp8', baseLotDecimals: 0  },
  'MORPHO-PERP':   { pubkey: '7HPBU4Z1ZBxy6xSfHhgHfTFNXfGh8E4NVHZKJZcBytie', baseLotDecimals: 1  },
  'ADA-PERP':      { pubkey: '5A8he2Jx5BN8vYgB2Q6uyjemz33gEbEGxacyqXy6va8q', baseLotDecimals: 0  },
  'FET-PERP':      { pubkey: 'CZCsCBxHca5LPFd4gEZBi9oSeYYH9fcUJzE45b3raQPN', baseLotDecimals: 0  },
  'RENDER-PERP':   { pubkey: 'FTfbBSVcAbN9XhkYV4N9m4zqVB8jALsUkTnv7vmuhZnG', baseLotDecimals: 1  },
  'VIRTUAL-PERP':  { pubkey: '4vAnWXWaoGCS54S6LWUxfeyNyER7SjgWx17riAuoNQPe', baseLotDecimals: 0  },
  'ONDO-PERP':     { pubkey: 'D1Zzj55T5b4yXF4x7nHpSMVXGZ8xGAnmEqYCzh1ZZHDM', baseLotDecimals: 0  },
  'XLM-PERP':      { pubkey: 'AXewQALSfgppjhfsZ6w5pqV7wNR5ShDRXPPTy7yx7yuE', baseLotDecimals: 0  },
  'TRX-PERP':      { pubkey: 'FksNfo3SvhtTZcAJUGT2fviTbrocavYAPgT4iK8YRkMr', baseLotDecimals: 0  },
};

/** Sorted list of all supported market keys (e.g. "SOL-PERP"). */
export const ALL_MARKET_KEYS: string[] = Object.keys(MARKETS);

/**
 * Live market registry — populated at runtime from the backend /api/phoenix/markets-overview
 * response (which in turn sources from https://public-api.phoenix.trade/exchange).
 * Used as a supplement to the static MARKETS map so that newly listed Phoenix tokens
 * are automatically tradeable without requiring a static-registry update.
 *
 * Call `seedLiveMarkets()` with the markets-overview payload to populate.
 * The static MARKETS map always takes precedence (it has audited pubkeys + decimals).
 */
let _liveMarkets: Record<string, PhoenixMarket> = {};

/**
 * Seed the module-level live registry from the markets-overview response.
 * Should be called once after a successful fetch of /api/phoenix/markets-overview.
 *
 * @param entries - array of market entries from the overview (each must have symbol +
 *   marketPubkey + baseLotDecimals to be useful)
 */
export function seedLiveMarkets(entries: Array<{
  symbol?: string;
  marketPubkey?: string;
  baseLotDecimals?: number;
}>): void {
  const next: Record<string, PhoenixMarket> = {};
  for (const entry of entries) {
    const symbol = typeof entry.symbol === 'string' ? entry.symbol.trim() : '';
    if (!symbol || !entry.marketPubkey) continue;
    const key = symbol.endsWith('-PERP') ? symbol : `${symbol}-PERP`;
    // Static registry takes precedence — only add if not already in MARKETS
    if (MARKETS[key]) continue;
    const decimals = (entry.baseLotDecimals !== undefined && entry.baseLotDecimals !== null)
      ? entry.baseLotDecimals
      : 2;
    next[key] = { pubkey: entry.marketPubkey, baseLotDecimals: decimals };
  }
  _liveMarkets = next;
}

/**
 * Return the effective market registry: static MARKETS merged with any live-only entries.
 * Static entries always win on key collision.
 */
export function getEffectiveMarkets(): Record<string, PhoenixMarket> {
  return { ..._liveMarkets, ...MARKETS };
}

/**
 * Shape of a market entry returned by https://public-api.phoenix.trade/exchange.
 */
interface ExchangeMarketEntry {
  symbol: string;
  marketPubkey: string;
  baseLotsDecimals: number;
  marketStatus: string;
  splinePubkey?: string;
  tickSize?: number;
  takerFee?: number;
  makerFee?: number;
  [key: string]: unknown;
}

/**
 * Fetch the authoritative active market list from Phoenix's exchange config endpoint.
 * Filters to marketStatus === "active" and maps each entry to the PhoenixMarket shape.
 * Falls back to the static MARKETS registry on any network/parse failure.
 *
 * Returns a Record<"SYM-PERP", PhoenixMarket> merged with the static registry so that
 * any markets not yet in the live response are still available.
 */
export async function fetchActiveMarkets(): Promise<Record<string, PhoenixMarket>> {
  try {
    const res = await fetch('https://public-api.phoenix.trade/exchange');
    if (!res.ok) return MARKETS;
    const raw = (await res.json()) as unknown;
    const list: ExchangeMarketEntry[] = Array.isArray(raw)
      ? (raw as ExchangeMarketEntry[])
      : Array.isArray((raw as Record<string, unknown>)?.markets)
        ? ((raw as Record<string, unknown>).markets as ExchangeMarketEntry[])
        : [];

    if (list.length === 0) return MARKETS;

    const live: Record<string, PhoenixMarket> = {};
    for (const entry of list) {
      if (entry.marketStatus !== 'active') continue;
      const symbol = typeof entry.symbol === 'string' ? entry.symbol.trim() : '';
      if (!symbol) continue;
      const key = symbol.endsWith('-PERP') ? symbol : `${symbol}-PERP`;
      // baseLotsDecimals may legitimately be 0 or negative — only fall back for missing/undefined
      const decimals = entry.baseLotsDecimals !== undefined && entry.baseLotsDecimals !== null
        ? entry.baseLotsDecimals
        : 2;
      live[key] = {
        pubkey: entry.marketPubkey ?? '',
        baseLotDecimals: decimals,
      };
    }

    // Merge: live data takes precedence; static fills gaps for markets not in live response
    return { ...MARKETS, ...live };
  } catch {
    return MARKETS;
  }
}

/**
 * Look up a market config by its "<SYM>-PERP" key or bare symbol (e.g. "SOL").
 * Checks static MARKETS first (audited, takes precedence), then the live registry.
 * Returns undefined if not found in either.
 */
export function getMarket(symbolOrKey: string): PhoenixMarket | undefined {
  const effective = getEffectiveMarkets();
  if (effective[symbolOrKey]) return effective[symbolOrKey];
  const perpKey = `${symbolOrKey}-PERP`;
  return effective[perpKey];
}

/**
 * Resolve the pubkey for a market.
 * Accepts "<SYM>-PERP" or bare "SYM".
 */
export function getMarketPubkey(symbolOrKey: string): string | undefined {
  return getMarket(symbolOrKey)?.pubkey;
}

/**
 * Resolve baseLotDecimals for a market.
 * Accepts "<SYM>-PERP" or bare "SYM".
 * Returns `undefined` if the market is not in the registry (absent key).
 * NOTE: 0 and -2 are valid returned values — do not coerce them with `?? 2`.
 */
export function getBaseLotDecimals(symbolOrKey: string): number | undefined {
  return getMarket(symbolOrKey)?.baseLotDecimals;
}

/**
 * Convert a human-readable base token quantity to base lots for the given market.
 * Uses floor() to round down (standard for perps order entry).
 *
 * Example:
 *   toBaseLots('SOL-PERP', 1.5)  → floor(1.5 × 10^2) = 150
 *   toBaseLots('PUMP-PERP', 100) → floor(100 × 10^-2) = 1
 */
export function toBaseLots(symbolOrKey: string, size: number, fallbackDecimals = 2): number {
  const market = getMarket(symbolOrKey);
  const decimals = market !== undefined ? market.baseLotDecimals : fallbackDecimals;
  return Math.floor(size * Math.pow(10, decimals));
}

/** Market category used by the UI category-tab filters. */
export type MarketCategory = 'crypto' | 'commodities' | 'equities';

/** Bare symbols classified as commodities (everything else defaults to crypto). */
const COMMODITY_SYMBOLS = new Set(['GOLD', 'SILVER', 'COPPER', 'WTIOIL']);
/** Bare symbols classified as equities. */
const EQUITY_SYMBOLS = new Set(['NVDA', 'AAPL', 'SPCX', 'GOOGL', 'TSLA', 'MU']);

/**
 * Classify a market symbol/key into a UI category.
 * Accepts "<SYM>-PERP" or bare "SYM"; the "-PERP" suffix is stripped before matching.
 *   Commodities: GOLD, SILVER, COPPER, WTIOIL
 *   Equities:    NVDA, AAPL
 *   Crypto:      everything else (default)
 */
export function getMarketCategory(symbolOrKey: string): MarketCategory {
  const bare = (symbolOrKey.endsWith('-PERP') ? symbolOrKey.slice(0, -5) : symbolOrKey).toUpperCase();
  if (COMMODITY_SYMBOLS.has(bare)) return 'commodities';
  if (EQUITY_SYMBOLS.has(bare)) return 'equities';
  return 'crypto';
}

/**
 * Strip the "-PERP" suffix for display (e.g. "SOL-PERP" → "SOL").
 */
export function displaySymbol(perpKey: string): string {
  return perpKey.endsWith('-PERP') ? perpKey.slice(0, -5) : perpKey;
}

/**
 * Normalise a symbol to its "<SYM>-PERP" key used as map keys throughout.
 * Accepts bare symbols ("SOL") or already-suffixed keys ("SOL-PERP").
 * Checks both the static MARKETS registry and the live registry seeded at runtime.
 * Returns null if the symbol is not in either registry.
 */
export function toPerpKey(symbol: string): string | null {
  const effective = getEffectiveMarkets();
  if (effective[symbol]) return symbol;
  const k = `${symbol}-PERP`;
  if (effective[k]) return k;
  return null;
}
