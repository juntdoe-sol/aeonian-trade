/**
 * Phoenix / Rise SDK utilities
 *
 * phoenixRegisterTrader, phoenixDeposit, and phoenixWithdraw are routed
 * through Poof-governed onchain collections (@PhoenixPerpsPlugin policy).
 *
 * Stop-loss place/cancel are NOT supported — @PhoenixPerpsPlugin does not yet
 * expose stop-loss primitives. The raw transaction bypass has been removed.
 * Stop-loss UI is disabled in the frontend.
 */

import { setPhoenixDeposit } from '@/lib/collections/phoenixDeposit';
import { getPhoenixTrader } from '@/lib/collections/phoenixTrader';
import { setPhoenixWithdraw } from '@/lib/collections/phoenixWithdraw';
import { set, transformValues } from '@/lib/db-client';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const PHOENIX_API_BASE = 'https://perp-api.phoenix.trade';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RegisterPhase = 'registering' | 'confirming';

export interface RegisterProgress {
  attempt: number;
  phase: RegisterPhase;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Like setPhoenixTrader but throws on error instead of swallowing.
 * Used by phoenixRegisterTrader so the retry loop can distinguish
 * transient session errors from hard policy denials.
 */
async function setPhoenixTraderRaw(traderId: string, data?: Record<string, unknown>): Promise<boolean> {
  const transformedData = transformValues(data || {});
  const succeeded = await set(`phoenixTrader/${traderId}`, transformedData);
  return !!succeeded;
}

// ─── High-level helpers ────────────────────────────────────────────────────────

/**
 * Register a new Phoenix trader account on-chain via Poof policy.
 * Writes to the phoenixTrader/$traderId collection — the policy enforces
 * that $traderId must equal the caller's wallet address.
 *
 * Flow:
 *   1. Existence check — if the trader doc already exists, return immediately.
 *      Re-trading / already-registered (cross-margin) wallets skip everything
 *      below and are never slowed down or re-prompted. Mirrors ActiveAccountFlow.
 *   2. Session-aware write retry — a fresh Privy/social wallet's Poof session
 *      (idToken) can take 1–3s+ to propagate after login(). During that window
 *      @user.address resolves to null server-side and the policy create rule
 *      (@user.address != null && $traderId == @user.address) returns false, so
 *      set() returns false. Retry with backoff over a ~8–10s budget so the
 *      session has time to become active. Hard policy/validation errors are
 *      thrown immediately (no retry).
 *   3. Indexing confirmation poll — set() resolves on write-ACCEPTANCE, not on
 *      on-chain-confirmed-and-indexed. The Flight isolated HTTP endpoint reads
 *      Phoenix's off-chain index and 404s ("Trader … not found") if the trader
 *      isn't visible yet. Poll getPhoenixTrader until the doc is visible (or a
 *      timeout) so the order is never placed against an unseen trader.
 *
 * @param onProgress - Optional callback invoked as registration progresses
 *   so callers can surface progress to the UI.
 */
export async function phoenixRegisterTrader(
  walletAddress: string,
  onProgress?: (state: RegisterProgress) => void,
): Promise<void> {
  if (!walletAddress) {
    throw new Error('Wallet not authenticated — please sign in again before registering.');
  }

  // ── Step 1: idempotent existence check ──────────────────────────────────────
  // If the trader doc already exists, registration is a no-op. Keeps re-trading
  // fast and avoids re-prompting already-registered wallets.
  try {
    const existing = await getPhoenixTrader(walletAddress);
    if (existing) return;
  } catch {
    // A read failure here is non-fatal — fall through to the write/retry path,
    // which will create the doc (and the policy guards against duplicates).
  }

  // ── Step 2: session-aware write retry ───────────────────────────────────────
  // Delays in ms (cumulative ~9.4s): immediate, then increasing backoff so a
  // Privy/social session (1–3s+ to propagate) has time to become active.
  const retryDelays = [0, 400, 800, 1200, 1600, 2000, 2400];

  let wrote = false;
  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt] > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }

    onProgress?.({ attempt, phase: 'registering' });

    let success: boolean;
    try {
      success = await setPhoenixTraderRaw(walletAddress, {});
    } catch (err) {
      // Rethrow errors that are not the transient "session not active" condition
      const msg = err instanceof Error ? err.message : String(err);
      const msgLower = msg.toLowerCase();
      const isSessionNotActive =
        msgLower.includes('session') ||
        msgLower.includes('not active') ||
        msgLower.includes('@user.address') ||
        msgLower.includes('unauthorized') ||
        msgLower.includes('ruledenied') ||
        msgLower.includes('rule denied') ||
        msgLower.includes('permission') ||
        msgLower.includes('denied') ||
        msgLower.includes('forbidden') ||
        msgLower.includes('not allowed');
      if (!isSessionNotActive) {
        throw err; // Real error — surface it immediately, no retry
      }
      // Session not yet propagated — treat as false and retry
      success = false;
    }

    if (success) {
      wrote = true;
      break; // Write accepted — proceed to confirmation poll.
    }

    // false return — session may still be propagating; loop to next attempt.
  }

  if (!wrote) {
    // All write retries exhausted — the session did not become active in time.
    throw new Error(
      'Your session is not active yet. Please wait a moment and try again.'
    );
  }

  // ── Step 3: indexing confirmation poll ──────────────────────────────────────
  // The write was accepted, but the trader may not be on-chain-confirmed and
  // indexed yet. Poll until getPhoenixTrader sees the doc (closing the
  // register→place race) or the budget (~12.4s) is exhausted.
  const pollDelays = [600, 800, 1000, 1200, 1600, 1600, 1800, 1800, 2000];
  for (let attempt = 0; attempt < pollDelays.length; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollDelays[attempt]));

    onProgress?.({ attempt, phase: 'confirming' });

    try {
      const doc = await getPhoenixTrader(walletAddress);
      if (doc) return; // Trader is visible — safe to place the order.
    } catch {
      // Transient read error — keep polling until the budget runs out.
    }
  }

  // Poll budget exhausted — the doc isn't visible yet. Bail with a clear,
  // user-friendly message rather than placing an order against an unseen trader.
  throw new Error(
    'Account registration is still confirming on-chain. Please wait a few seconds and try again.'
  );
}

/**
 * Deposit USDC into Phoenix collateral via Poof policy.
 * amountUsdc is in full USDC units (e.g. 10 = $10).
 * Converts to USDC smallest units (6 decimals) before writing.
 */
export async function phoenixDeposit(
  walletAddress: string,
  amountUsdc: number,
): Promise<void> {
  const amtMicro = Math.round(amountUsdc * 1_000_000);
  const depositId = crypto.randomUUID();
  const success = await setPhoenixDeposit(depositId, { amt: amtMicro });
  if (!success) {
    throw new Error('Deposit was denied by policy. Ensure your wallet is connected and has sufficient USDC.');
  }
}

/**
 * Withdraw USDC from Phoenix collateral via Poof policy.
 * amountUsdc is in full USDC units; use 0 to attempt full withdrawal.
 * Converts to USDC smallest units (6 decimals) before writing.
 */
export async function phoenixWithdraw(
  walletAddress: string,
  amountUsdc: number,
): Promise<void> {
  const amtMicro = Math.round(amountUsdc * 1_000_000);
  const withdrawId = crypto.randomUUID();
  const success = await setPhoenixWithdraw(withdrawId, { amt: amtMicro });
  if (!success) {
    throw new Error('Withdrawal was denied by policy. Ensure your wallet is connected and has sufficient collateral.');
  }
}

/**
 * Stop-loss placement and cancellation are NOT available.
 *
 * @PhoenixPerpsPlugin does not yet expose stop-loss primitives, and the previous
 * raw-transaction bypass (sendKitInstructions / signAndSubmitTransaction) has been
 * removed as a security fix. Stop-loss UI is disabled in the frontend until
 * Poof-governed stop-loss support is added.
 */
