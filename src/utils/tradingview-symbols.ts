/**
 * Maps AEONIAN market symbols (the -PERP or bare symbol from Phoenix) to
 * TradingView symbol strings for the Advanced Chart embed widget.
 *
 * Crypto uses PYTH: feeds because Phoenix prices come from Pyth oracles.
 * Equities use NASDAQ: prefix.
 * Commodities use TVC: or OANDA: which are well-supported free feeds on TV.
 *
 * If a symbol is NOT in this map, the caller falls back to the existing
 * lightweight-charts + Phoenix candles chart (PriceChart.tsx).
 */

export const TV_SYMBOL_MAP: Record<string, string> = {
  // ─── Crypto (Pyth oracle feeds — matches Phoenix mark price source) ──────────
  'SOL-PERP': 'PYTH:SOLUSD',
  'SOL':      'PYTH:SOLUSD',
  'BTC-PERP': 'PYTH:BTCUSD',
  'BTC':      'PYTH:BTCUSD',
  'ETH-PERP': 'PYTH:ETHUSD',
  'ETH':      'PYTH:ETHUSD',
  'BNB-PERP': 'BINANCE:BNBUSDT',
  'BNB':      'BINANCE:BNBUSDT',
  'NEAR-PERP': 'PYTH:NEARUSD',
  'NEAR':      'PYTH:NEARUSD',
  'TAO-PERP': 'BINANCE:TAOUSDT',
  'TAO':      'BINANCE:TAOUSDT',
  'FET-PERP': 'BINANCE:FETUSDT',
  'FET':      'BINANCE:FETUSDT',
  'ENA-PERP': 'BINANCE:ENAUSDT',
  'ENA':      'BINANCE:ENAUSDT',
  'ONDO-PERP': 'BINANCE:ONDOUSDT',
  'ONDO':      'BINANCE:ONDOUSDT',
  // HYPE removed — BINANCE:HYPEUSDT is not reliably available on TV free tier
  'ZEC-PERP': 'BINANCE:ZECUSDT',
  'ZEC':      'BINANCE:ZECUSDT',
  'LINK-PERP': 'PYTH:LINKUSD',
  'LINK':      'PYTH:LINKUSD',
  'AVAX-PERP': 'PYTH:AVAXUSD',
  'AVAX':      'PYTH:AVAXUSD',
  'DOT-PERP': 'PYTH:DOTUSD',
  'DOT':      'PYTH:DOTUSD',
  'OP-PERP':  'PYTH:OPUSD',
  'OP':       'PYTH:OPUSD',
  'ARB-PERP': 'PYTH:ARBUSD',
  'ARB':      'PYTH:ARBUSD',
  'SUI-PERP': 'PYTH:SUIUSD',
  'SUI':      'PYTH:SUIUSD',
  'APT-PERP': 'PYTH:APTUSD',
  'APT':      'PYTH:APTUSD',
  'INJ-PERP': 'PYTH:INJUSD',
  'INJ':      'PYTH:INJUSD',
  'TIA-PERP': 'PYTH:TIAUSD',
  'TIA':      'PYTH:TIAUSD',
  'JTO-PERP': 'PYTH:JTOUSD',
  'JTO':      'PYTH:JTOUSD',
  'JUP-PERP': 'BINANCE:JUPUSDT',
  'JUP':      'BINANCE:JUPUSDT',
  'BONK-PERP': 'BINANCE:BONKUSDT',
  'BONK':      'BINANCE:BONKUSDT',
  'WIF-PERP': 'BINANCE:WIFUSDT',
  'WIF':      'BINANCE:WIFUSDT',
  'PYTH-PERP': 'BINANCE:PYTHUSDT',
  'PYTH':      'BINANCE:PYTHUSDT',
  'W-PERP':   'BINANCE:WUSDT',
  'W':        'BINANCE:WUSDT',
  'DRIFT-PERP': 'BINANCE:DRIFTUSDT',
  'DRIFT':      'BINANCE:DRIFTUSDT',
  'RAY-PERP': 'BINANCE:RAYUSDT',
  'RAY':      'BINANCE:RAYUSDT',

  // ─── Equities ────────────────────────────────────────────────────────────────
  'NVDA-PERP': 'NASDAQ:NVDA',
  'NVDA':      'NASDAQ:NVDA',
  'GOOGL-PERP': 'NASDAQ:GOOGL',
  'GOOGL':      'NASDAQ:GOOGL',
  'AAPL-PERP': 'NASDAQ:AAPL',
  'AAPL':      'NASDAQ:AAPL',
  'TSLA-PERP': 'NASDAQ:TSLA',
  'TSLA':      'NASDAQ:TSLA',
  'AMD-PERP':  'NASDAQ:AMD',
  'AMD':       'NASDAQ:AMD',
  'MU-PERP':   'NASDAQ:MU',
  'MU':        'NASDAQ:MU',
  'MSFT-PERP': 'NASDAQ:MSFT',
  'MSFT':      'NASDAQ:MSFT',
  'META-PERP': 'NASDAQ:META',
  'META':      'NASDAQ:META',
  'AMZN-PERP': 'NASDAQ:AMZN',
  'AMZN':      'NASDAQ:AMZN',
  'COIN-PERP': 'NASDAQ:COIN',
  'COIN':      'NASDAQ:COIN',
  'MSTR-PERP': 'NASDAQ:MSTR',
  'MSTR':      'NASDAQ:MSTR',

  // ─── Commodities ────────────────────────────────────────────────────────────
  'GOLD-PERP':   'OANDA:XAUUSD',
  'GOLD':        'OANDA:XAUUSD',
  'SILVER-PERP': 'OANDA:XAGUSD',
  'SILVER':      'OANDA:XAGUSD',
  'WTIOIL-PERP': 'TVC:USOIL',
  'WTIOIL':      'TVC:USOIL',

  // ─── NOT MAPPED — fallback to PriceChart for these exotic/custom tokens ─────
  // SKR, MON, MEGA, XPL, LIT — no reliable TradingView symbol
};

/**
 * Returns the TradingView symbol string for a given AEONIAN market symbol,
 * or null if no mapping exists (triggers fallback to PriceChart).
 *
 * Accepts both bare (SOL) and PERP-suffixed (SOL-PERP) formats.
 */
export function getTvSymbol(marketSymbol: string): string | null {
  if (!marketSymbol) return null;
  const normalized = marketSymbol.trim().toUpperCase();
  return TV_SYMBOL_MAP[normalized] ?? null;
}

/**
 * Timeframe mapping: AEONIAN Timeframe → TradingView interval string.
 */
export const TV_INTERVAL_MAP: Record<string, string> = {
  '1m':  '1',
  '5m':  '5',
  '15m': '15',
  '1h':  '60',
  '4h':  '240',
  '1d':  'D',
};
