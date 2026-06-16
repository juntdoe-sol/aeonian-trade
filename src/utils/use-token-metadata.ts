/**
 * useTokenMetadata — resolves decimals + symbol for an arbitrary set of mints.
 *
 * Known presets (SOL, USDC) are returned immediately from KNOWN_TOKENS.
 * Unknown mints are resolved via GET /api/token/lookup?mint= and cached in a
 * module-level Map so the same mint is never fetched twice per page load.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { KNOWN_TOKENS, type KnownToken } from '@/utils/monthly-reward-tokens';

// Module-level cache so resolutions persist across component unmounts/remounts.
// Only SUCCESSFUL lookups are stored here (failures are tracked separately so
// they can be retried on the next hook invocation).
const cache = new Map<string, KnownToken>();

// Track mints that have recently failed so we don't hammer the endpoint.
// Each entry stores the timestamp of the failure and whether it was definitive
// (404 = fake mint) or transient (network/timeout).
// - Transient failures: retry after TRANSIENT_RETRY_MS (30 s).
// - Definitive 404s: retry after DEFINITIVE_RETRY_MS (24 h) — effectively permanent
//   for a normal session but won't block forever on a stale cache.
const TRANSIENT_RETRY_MS = 30_000;
const DEFINITIVE_RETRY_MS = 86_400_000;

interface FailedEntry {
  at: number;      // Date.now() at failure time
  definitive: boolean; // true = 404 (bad mint), false = transient network/timeout
}
const failedCache = new Map<string, FailedEntry>();

function isMintBlocked(mint: string): boolean {
  const entry = failedCache.get(mint);
  if (!entry) return false;
  const retryAfter = entry.definitive ? DEFINITIVE_RETRY_MS : TRANSIENT_RETRY_MS;
  if (Date.now() - entry.at > retryAfter) {
    failedCache.delete(mint);
    return false;
  }
  return true;
}

// Seed the cache with the known presets immediately.
for (const t of KNOWN_TOKENS) {
  cache.set(t.mint, t);
}

interface TokenLookupResult {
  mint: string;
  decimals: number;
  symbol: string | null;
  name: string | null;
  logoUri: string | null;
}

/**
 * Resolve metadata (symbol, decimals) for a list of mints.
 * Returns a Map<mint, KnownToken>. Entries missing from the map mean the
 * lookup is still in-flight or failed; callers should fall back gracefully.
 */
export function useTokenMetadata(mints: string[]): Map<string, KnownToken> {
  // Snapshot of the cache that triggers re-renders when new entries land.
  const [resolved, setResolved] = useState<Map<string, KnownToken>>(() => {
    const m = new Map<string, KnownToken>();
    for (const mint of mints) {
      const entry = cache.get(mint);
      if (entry) m.set(mint, entry);
    }
    return m;
  });

  // Track which mints we've already kicked off fetches for in this hook instance.
  const fetchingRef = useRef(new Set<string>());

  useEffect(() => {
    // Re-seed resolved with anything already in cache for this mint list.
    // This handles the case where a prior lookup completed AFTER the useState
    // initializer ran (i.e. mints changed after mount).
    setResolved((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const mint of mints) {
        if (!next.has(mint) && cache.has(mint)) {
          next.set(mint, cache.get(mint)!);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const unknown = mints.filter(
      (mint) => !cache.has(mint) && !fetchingRef.current.has(mint) && !isMintBlocked(mint),
    );
    if (unknown.length === 0) return;

    for (const mint of unknown) {
      fetchingRef.current.add(mint);
      api
        .get<TokenLookupResult>(`/api/token/lookup?mint=${encodeURIComponent(mint)}`)
        .then((result) => {
          const entry: KnownToken = {
            mint: result.mint,
            symbol: result.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`,
            decimals: result.decimals,
          };
          // Only cache successful lookups.
          cache.set(mint, entry);
          setResolved((prev) => {
            const next = new Map(prev);
            next.set(mint, entry);
            return next;
          });
        })
        .catch((err: unknown) => {
          // Distinguish definitive failures (404 = fake mint) from transient
          // network/timeout errors. Definitive failures are retried after 24 h;
          // transient ones after 30 s so they resolve once the upstream recovers.
          const msg = err instanceof Error ? err.message.toLowerCase() : '';
          const definitive =
            msg.includes('404') ||
            msg.includes('not a valid') ||
            msg.includes('not found');
          failedCache.set(mint, { at: Date.now(), definitive });
          // Allow a fresh fetch attempt once this hook instance unmounts/remounts
          // (fetchingRef is per-instance, failedCache is module-level with expiry).
          fetchingRef.current.delete(mint);
          // Still update local state with a display fallback so the UI renders
          // something while offline/errored, without poisoning the module cache.
          setResolved((prev) => {
            const next = new Map(prev);
            next.set(mint, {
              mint,
              symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
              decimals: 0,
            });
            return next;
          });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mints.join(',')]);

  return resolved;
}
