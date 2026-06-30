/**
 * useMarketList — lightweight shared hook that fetches and caches the
 * available PERP symbol list from /api/phoenix/markets-overview.
 *
 * The result is module-level cached so the header search and the TradePage
 * both read from the same single fetch. TTL: 60 seconds.
 */

import { api } from '@/lib/api-client';
import { useEffect, useState } from 'react';

interface MarketInfoMinimal {
  symbol?: string;
  markPrice?: number;
}

interface CacheEntry {
  symbols: string[];
  fetchedAt: number;
}

// Module-level cache shared across all hook instances
let cache: CacheEntry | null = null;
let inflight: Promise<string[]> | null = null;
const CACHE_TTL_MS = 60_000;

async function fetchSymbols(): Promise<string[]> {
  const raw = await api.get<unknown>('/api/phoenix/markets-overview');
  const list: MarketInfoMinimal[] = Array.isArray(raw)
    ? (raw as MarketInfoMinimal[])
    : ((raw as { markets?: MarketInfoMinimal[] })?.markets ?? []);

  // The API returns bare symbols ("SOL", "BTC", etc.) with no -PERP suffix.
  // Normalize to the canonical SOL-PERP form that the rest of the app expects.
  const symbols = list
    .map((m) => m.symbol)
    .filter((s): s is string => !!s)
    .map((s) => (s.endsWith('-PERP') ? s : `${s}-PERP`));

  // Deduplicate
  return [...new Set(symbols)];
}

async function getSymbols(): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.symbols;
  }
  if (!inflight) {
    inflight = fetchSymbols()
      .then((symbols) => {
        cache = { symbols, fetchedAt: Date.now() };
        inflight = null;
        return symbols;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

export function useMarketList(): string[] {
  const [symbols, setSymbols] = useState<string[]>(() => cache?.symbols ?? []);

  useEffect(() => {
    let cancelled = false;
    getSymbols()
      .then((s) => { if (!cancelled) setSymbols(s); })
      .catch(() => { /* silently ignore — header search degrades gracefully */ });
    return () => { cancelled = true; };
  }, []);

  return symbols;
}
