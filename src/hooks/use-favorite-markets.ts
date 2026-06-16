import { useCallback, useEffect, useState } from 'react';

/**
 * Per-device favorite markets, persisted in localStorage.
 *
 * Favorites are keyed by the BARE market symbol (e.g. "SOL", "GOLD") — the
 * "-PERP" suffix is stripped on the way in so the trade-page dropdown (which
 * uses "SOL-PERP" keys) and the HomePage list (which uses bare symbols) read
 * and write the exact same entries.
 *
 * Both surfaces import this hook so a star toggled on one reflects on the other
 * within the same session — a window-level event broadcasts changes to every
 * mounted instance, and writes also update local React state immediately.
 */
export const FAVORITE_MARKETS_KEY = 'aeonian:favorite-markets';
const FAVORITES_EVENT = 'aeonian:favorite-markets-changed';

/** Normalise to a bare, upper-cased symbol used as the stable favorite key. */
function bareSymbol(symbolOrKey: string): string {
  const s = symbolOrKey.trim();
  return (s.toUpperCase().endsWith('-PERP') ? s.slice(0, -5) : s).toUpperCase();
}

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITE_MARKETS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string').map(bareSymbol));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function writeFavorites(set: Set<string>): void {
  try {
    localStorage.setItem(FAVORITE_MARKETS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore quota / private-mode errors
  }
}

export interface UseFavoriteMarkets {
  /** Set of bare favorite symbols (upper-cased). */
  favorites: Set<string>;
  /** True if the given symbol/key is favorited. */
  isFavorite: (symbolOrKey: string) => boolean;
  /** Toggle favorite state for the given symbol/key. */
  toggleFavorite: (symbolOrKey: string) => void;
}

export function useFavoriteMarkets(): UseFavoriteMarkets {
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites());

  // Keep every mounted instance in sync: react to in-session toggles (custom
  // event) and to changes from other tabs (native storage event).
  useEffect(() => {
    const sync = () => setFavorites(readFavorites());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === FAVORITE_MARKETS_KEY) sync();
    };
    window.addEventListener(FAVORITES_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const isFavorite = useCallback(
    (symbolOrKey: string) => favorites.has(bareSymbol(symbolOrKey)),
    [favorites],
  );

  const toggleFavorite = useCallback((symbolOrKey: string) => {
    const key = bareSymbol(symbolOrKey);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeFavorites(next);
      return next;
    });
    // Notify other mounted instances within this tab/session.
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  }, []);

  return { favorites, isFavorite, toggleFavorite };
}
