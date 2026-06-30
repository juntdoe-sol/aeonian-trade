/**
 * Shared helpers for the Monthly PnL Reward feature on the frontend.
 *
 * Tokens in a prize pot are identified by their mint. We keep a small known
 * registry for the two presets the admin deposits most often (native SOL and
 * USDC) so the UI can show a friendly symbol + correctly scaled amount.
 * Unknown mints degrade gracefully to a truncated mint string and base units.
 */

import { SOL, USDC } from '@/lib/constants';

export interface KnownToken {
  /** Mint identifier used on-chain / in deposit docs. `SOL` is the reserved 'solana' string. */
  mint: string;
  /** Display symbol (used for TokenLogo + labels). */
  symbol: string;
  /** Decimals used to convert base units → human amount. */
  decimals: number;
}

/** Presets the admin can deposit with one click. SOL is native; USDC is an SPL token. */
export const KNOWN_TOKENS: KnownToken[] = [
  { mint: SOL, symbol: 'SOL', decimals: 9 },
  { mint: USDC, symbol: 'USDC', decimals: 6 },
  { mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', symbol: 'SKR', decimals: 6 },
];

const BY_MINT = new Map(KNOWN_TOKENS.map((t) => [t.mint, t]));

/** Resolve a known token by mint, or undefined for custom/unknown mints. */
export function knownTokenForMint(mint: string): KnownToken | undefined {
  return BY_MINT.get(mint);
}

/** Friendly symbol for a mint. Falls back to a short mint preview. */
export function symbolForMint(mint: string): string {
  const known = BY_MINT.get(mint);
  if (known) return known.symbol;
  if (mint === SOL) return 'SOL';
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** Decimals for a mint. Unknown mints default to 0 (treat base units as whole). */
export function decimalsForMint(mint: string): number {
  return BY_MINT.get(mint)?.decimals ?? 0;
}

/** Convert a human amount to integer base units for a mint. */
export function toBaseUnits(humanAmount: number, mint: string): number {
  const decimals = decimalsForMint(mint);
  return Math.round(humanAmount * Math.pow(10, decimals));
}

/** Convert integer base units to a human number for a mint. */
export function fromBaseUnits(baseUnits: number, mint: string): number {
  const decimals = decimalsForMint(mint);
  return baseUnits / Math.pow(10, decimals);
}

/**
 * Format a base-unit amount for display, e.g. "1.5 SOL" or "250 USDC".
 * Trims trailing zeros and caps fractional precision at the token's decimals.
 */
export function formatTokenAmount(baseUnits: number, mint: string): string {
  const decimals = decimalsForMint(mint);
  const human = fromBaseUnits(baseUnits, mint);
  const maxFrac = Math.min(decimals, 6);
  const str = human.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return `${str} ${symbolForMint(mint)}`;
}

/** Build the deterministic potAccountId for a given monthKey ("YYYY_MM"). */
export function potAccountIdForMonth(monthKey: string): string {
  return `monthlyPot_${monthKey}`;
}

/** Current calendar month key "YYYY_MM" (UTC), matching the backend finalizer. */
export function currentMonthKeyUTC(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return `${y}_${String(m).padStart(2, '0')}`;
}

/** Human-readable month label, e.g. "June 2026", from a "YYYY_MM" key. */
export function monthLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('_');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return monthKey;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Per-rank share percentages used by the finalizer (display only). */
export const RANK_SHARE_PCT: Record<number, number> = { 1: 50, 2: 35, 3: 15 };

/** Apply a rank's share to a base-unit total using the same integer math as the backend. */
export function rankShareBaseUnits(total: number, rank: number): number {
  const bps = rank === 1 ? 5000 : rank === 2 ? 3500 : rank === 3 ? 1500 : 0;
  return Math.floor((total * bps) / 10000);
}
