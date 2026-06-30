import { useEffect, useState } from 'react';

/**
 * SSR-safe media query hook. Reads window.matchMedia synchronously in the
 * state initializer so the correct value is available on the first render,
 * eliminating layout shift between server and client.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    // Sync in case the value changed between render and effect
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
