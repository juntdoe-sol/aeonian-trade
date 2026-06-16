/**
 * Robustly parse a Phoenix fill timestamp into Unix SECONDS (frontend mirror of
 * the backend `parseFillTimestampSec` in partyserver/src/utils/parse-fill-timestamp.ts).
 *
 * The live Phoenix trades-history API returns `timestamp` as an ISO 8601 STRING
 * (e.g. "2026-06-09T11:56:50Z"). A naive `Number(rawTs)` on that yields NaN,
 * which collapses every fill onto an undefined/zero time and corrupts per-window
 * realized-PnL math. This app's convention is timestamps in seconds.
 *
 * Handling:
 *  - String: try `Date.parse` (epoch ms) → seconds; if NaN, fall back to
 *    `Number(rawTs)` for numeric-string call paths.
 *  - Number: detect ms-vs-seconds — a value > ~1e12 is almost certainly
 *    milliseconds and is divided by 1000; ~1e9–1e10 is already seconds.
 *  - Returns 0 for genuinely unparseable values so callers can apply a fallback.
 */
const MS_THRESHOLD = 1e12;

export function parseFillTimestampSec(rawTs: unknown): number {
  if (typeof rawTs === 'string') {
    const parsedMs = Date.parse(rawTs);
    if (!Number.isNaN(parsedMs)) {
      return Math.floor(parsedMs / 1000);
    }
    const n = Number(rawTs);
    if (Number.isNaN(n)) return 0;
    return n > MS_THRESHOLD ? Math.floor(n / 1000) : Math.floor(n);
  }

  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    return rawTs > MS_THRESHOLD ? Math.floor(rawTs / 1000) : Math.floor(rawTs);
  }

  return 0;
}
