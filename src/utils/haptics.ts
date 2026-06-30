const STORAGE_KEY = 'aeonian:haptics:enabled';

function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    // restricted storage context — ignore
  }
}

/**
 * Returns true if haptic feedback is enabled.
 * Defaults to enabled (true) when the key is absent from localStorage.
 */
export function isHapticsEnabled(): boolean {
  const stored = safeLocalStorageGet(STORAGE_KEY);
  if (stored === null) return true; // default on
  return stored !== 'false';
}

/**
 * Persists the haptics enabled/disabled preference to localStorage.
 */
export function setHapticsEnabled(enabled: boolean): void {
  safeLocalStorageSet(STORAGE_KEY, String(enabled));
}

/**
 * Fire a short ~12ms vibration pulse.
 * No-ops silently when:
 *   - haptics are disabled by the user
 *   - the Web Vibration API is unavailable (iOS Safari, desktop browsers)
 *   - any unexpected error occurs
 */
export function hapticTap(): void {
  try {
    if (!isHapticsEnabled()) return;
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.vibrate !== 'function'
    ) {
      return;
    }
    navigator.vibrate(12);
  } catch {
    // never throw — haptics are best-effort
  }
}
