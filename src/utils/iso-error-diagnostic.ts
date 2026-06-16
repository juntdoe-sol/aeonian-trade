// TEMPORARY DIAGNOSTIC UTILITY — remove once we capture the isolated-margin revert.
//
// Problem: the generated collection wrappers (setPhoenixIsoTrade / setPhoenixIsoClose)
// SWALLOW the real on-chain / Phoenix program error internally — they `console.error`
// it and return `false`. So the component's `if (!succeeded)` branch only knows the
// write failed (a boolean), with no access to the verbatim revert reason. The catch
// block never sees a thrown error either.
//
// To make the real reason visible (and screenshottable on mobile, where we can't pull
// console logs), this helper temporarily intercepts console.error around the awaited
// collection call, captures whatever the SDK logs, and returns it so the caller can
// show it verbatim in a long-duration toast. It does NOT change any order-building,
// order-routing, or policy/collection call — it only observes.

let capturing = false;
let captured: string[] = [];

/**
 * Run an async collection call while capturing any console.error output the SDK emits
 * (which is where the swallowed Phoenix/Solana revert reason ends up). The original
 * console.error still fires, so nothing is hidden from the real console.
 *
 * @returns { result, capturedError } — result is the wrapped call's return value
 *          (e.g. the boolean from setPhoenixIsoTrade), capturedError is the joined
 *          verbatim text the SDK logged during the call, or '' if nothing was logged.
 */
export async function captureConsoleErrorDuring<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; capturedError: string }> {
  const original = console.error;
  // Guard against nested/concurrent capture clobbering state.
  const wasCapturing = capturing;
  if (!wasCapturing) {
    capturing = true;
    captured = [];
    console.error = (...args: unknown[]) => {
      try {
        captured.push(
          args
            .map((a) => {
              if (typeof a === 'string') return a;
              try {
                return JSON.stringify(a, Object.getOwnPropertyNames(a as object), 2);
              } catch {
                return String(a);
              }
            })
            .join(' '),
        );
      } catch {
        /* ignore capture failures */
      }
      original.apply(console, args as []);
    };
  }

  try {
    const result = await fn();
    return { result, capturedError: wasCapturing ? '' : captured.join('\n') };
  } finally {
    if (!wasCapturing) {
      console.error = original;
      capturing = false;
    }
  }
}

/**
 * Build a verbose, verbatim diagnostic message from any combination of:
 *  - a thrown error object (err?.message + nested logs/cause/error/data)
 *  - SDK-captured console.error text (the swallowed revert reason)
 *  - a returned doc that may carry a transaction signature
 *
 * Keep it raw — this is a temporary diagnostic, do NOT shorten into something generic.
 */
export function buildIsoErrorMessage(opts: {
  err?: unknown;
  capturedError?: string;
  doc?: Record<string, unknown> | null;
}): string {
  const { err, capturedError, doc } = opts;
  const parts: string[] = [];

  // 1. Primary error message.
  if (err) {
    const anyErr = err as any;
    const msg =
      anyErr?.message ??
      (typeof err === 'string' ? err : undefined) ??
      anyErr?.error?.message ??
      anyErr?.cause?.message;
    if (msg) parts.push(String(msg));

    // 2. Program logs — Phoenix/Solana put the real revert reason here.
    const logSources: unknown[] = [
      anyErr?.logs,
      anyErr?.cause?.logs,
      anyErr?.error?.logs,
      anyErr?.data?.logs,
      anyErr?.cause?.error?.logs,
    ];
    for (const ls of logSources) {
      if (Array.isArray(ls) && ls.length) {
        const tail = ls.slice(-5).join(' | ');
        parts.push(`logs: ${tail}`);
        break;
      }
    }
  }

  // 3. SDK-swallowed console.error text (where the real reason ends up for ISO).
  if (capturedError && capturedError.trim()) {
    // Trim to the most relevant tail so the toast stays readable on a phone but
    // still verbatim.
    const trimmed = capturedError.trim();
    parts.push(`sdk: ${trimmed.length > 1200 ? trimmed.slice(-1200) : trimmed}`);
  }

  // 4. Transaction signature — lets us inspect the on-chain revert directly.
  const sig =
    (err as any)?.signature ??
    (err as any)?.txHash ??
    (err as any)?.tarobase_transaction_hash ??
    (err as any)?.cause?.signature ??
    doc?.signature ??
    doc?.txHash ??
    (doc as any)?.tarobase_transaction_hash;
  if (sig) parts.push(`tx: ${sig}`);

  const out = parts.filter(Boolean).join('\n');
  return out || 'Unknown error (no message, logs, or signature captured)';
}
