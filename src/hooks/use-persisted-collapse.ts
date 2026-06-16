import { useState, useCallback } from 'react';

/**
 * Safely reads a value from localStorage without throwing.
 * Returns null if localStorage is unavailable or the key is missing.
 */
function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safely writes a value to localStorage without throwing.
 */
function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently ignore (e.g. private mode, storage full)
  }
}

/**
 * Like useState, but persists the boolean to localStorage.
 *
 * - On first mount with no stored value, falls back to `defaultValue`.
 * - Once the user explicitly toggles, that choice is remembered.
 * - localStorage access is fully guarded — never throws.
 *
 * @param key       Stable, unique key (e.g. "aeonian:cardCollapsed:rewards:referFriends")
 * @param defaultValue  Fallback when no persisted value exists yet
 */
export function usePersistedCollapse(key: string, defaultValue: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = safeLocalStorageGet(key);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return defaultValue;
  });

  const setAndPersist = useCallback((next: boolean) => {
    setValue(next);
    safeLocalStorageSet(key, String(next));
  }, [key]);

  return [value, setAndPersist];
}
