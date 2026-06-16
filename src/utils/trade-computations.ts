// ─── Realized PnL computation for closed trades ──────────────────────────────

import type { TradeFill } from '@/components/trading/types';
import { normalizeFills } from '@/utils/trader-profile';

export interface ClosedTrade {
  symbol: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  realizedPnl: number;
  timestamp: number;
}

/** Strip a trailing -PERP/PERP suffix so symbols display as bare tokens ("SOL"). */
function bareSymbol(s: string): string {
  return (s || '').replace(/-?perp$/i, '').toUpperCase() || 'PERP';
}

/**
 * Computes individual closed trades from a list of raw Phoenix `trades-history`
 * fills.
 *
 * The raw upstream fills do NOT carry `size`/`side` and deliver `timestamp` as an
 * ISO string, so we FIRST normalize them via the shared `normalizeFills` helper
 * (size ← |baseLotsDelta|, side ← sign of baseLotsDelta, timestamp → unix seconds,
 * symbol → upstream symbol/market/pair or a generic 'PERP' fallback).
 *
 * Each CLOSING fill (one with a non-zero realizedPnl) becomes one ClosedTrade row.
 * We render closing fills directly rather than FIFO-pairing across the history,
 * because a per-fill `symbol` isn't reliably present to key lots per market — this
 * mirrors the approach already validated in `trader-profile.ts`. `realizedPnl` is
 * the upstream realized PnL net of that fill's fees.
 *
 * Side / entry derivation: a closing fill's own `side` is the direction of the
 * trade that CLOSES the position, so the position being closed is the opposite —
 * a sell ('short' delta) closes a Long, a buy ('long' delta) closes a Short. The
 * fill `price` is the EXIT price; the entry price is recovered from the gross
 * realized PnL (before fees):
 *   Long  close: pnl = (exit − entry) · size  →  entry = exit − pnl/size
 *   Short close: pnl = (entry − exit) · size  →  entry = exit + pnl/size
 * When size is unavailable we fall back to entry == exit rather than fabricate.
 */
export function computeClosedTrades(fills: TradeFill[]): ClosedTrade[] {
  const normalized = normalizeFills(fills ?? []);

  return normalized
    .filter((f) => f.timestamp > 0 && f.realizedPnl !== 0)
    .sort((a, b) => b.timestamp - a.timestamp) // newest-first
    .map((f) => {
      // The position being closed is the opposite of the closing fill's direction.
      const closedSide: 'Long' | 'Short' = f.side === 'long' ? 'Short' : 'Long';
      const exitPrice = f.price;
      const grossPnl = f.realizedPnl; // before fees, the price-movement component
      // Recover entry from the realized PnL when we have a non-zero size & price.
      let entryPrice = exitPrice;
      if (f.size > 0 && exitPrice > 0) {
        const perUnit = grossPnl / f.size;
        entryPrice =
          closedSide === 'Long'
            ? exitPrice - perUnit // long: pnl = exit - entry
            : exitPrice + perUnit; // short: pnl = entry - exit
        if (!isFinite(entryPrice) || entryPrice <= 0) entryPrice = exitPrice;
      }
      return {
        symbol: bareSymbol(f.symbol),
        side: closedSide,
        entryPrice,
        exitPrice,
        size: f.size,
        realizedPnl: f.realizedPnl - f.fees,
        timestamp: f.timestamp,
      };
    });
}
