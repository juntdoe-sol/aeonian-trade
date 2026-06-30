/**
 * Deterministic default avatar picker.
 *
 * Given a wallet address and a pool of avatar URLs, always returns the
 * same avatar for the same wallet (consistent across reloads and renders).
 *
 * Uses djb2 (Dan Bernstein's hash #2), a simple char-loop hash that
 * produces a stable uint32 without any external dependencies.
 */

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // (hash << 5) + hash === hash * 33
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  return hash;
}

/**
 * Pick a default avatar URL deterministically from a pool.
 *
 * @param walletAddress - The user's Solana wallet address (or null/undefined for guests)
 * @param urls - Stable, sorted list of avatar URLs (sort by createdAt asc, then id)
 * @returns The avatar URL for this wallet, or null when the pool is empty or wallet is falsy.
 */
export function pickDefaultAvatar(
  walletAddress: string | null | undefined,
  urls: string[],
): string | null {
  if (!walletAddress || urls.length === 0) return null;
  const index = djb2Hash(walletAddress) % urls.length;
  return urls[index] ?? null;
}
