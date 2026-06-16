/**
 * Poof Wallet helper — the one way to call the OKX onchainos CLI from a
 * Poof user worker (non-DO context). For DO context (Flue agents in their
 * just-bash sandbox), the `onchainos` shim wired in poof-flue-runtime.ts
 * already calls through the same sandbox service via the /__poof/wallet
 * fanout — agents don't need this helper directly.
 *
 * Why go through this:
 *   Each wallet exec runs inside a Cloudflare Sandbox container,
 *   isolated per `(appid, walletScopeId)` pair. The container cost is
 *   metered to the project's credit budget via the same UsageCounter DO
 *   that handles AI / MCP / compute. Bypassing this helper means the
 *   call goes nowhere — the onchainos binary isn't bound to user
 *   workers and `poof-wallet.internal` only resolves through the
 *   platform's dispatch outbound worker.
 *
 * Custody model:
 *   `walletScopeId` is the partition inside an appid. Same scope = same
 *   OKX login = same `~/.onchainos/` = same signing authority. Required
 *   field — passing an empty/missing value returns 400. The platform
 *   does NOT pick a default for you because silently sharing wallet
 *   state across "no scope" callers would be a custody footgun.
 *
 *   Typical patterns:
 *     - one wallet per app:       walletScopeId = 'shared'
 *     - one wallet per end user:  walletScopeId = `user-${userId}`
 *     - one wallet per session:   walletScopeId = `session-${sessionId}`
 *
 * Usage:
 *   import { walletRun } from './lib/poof-wallet.js';
 *   const { stdout, stderr, exitCode } = await walletRun(
 *     c.env,
 *     ['wallet', 'balance'],
 *     { walletScopeId: `user-${userId}` },
 *   );
 *   if (exitCode !== 0) {
 *     return ApiErrors.internal(c, `wallet error: ${stderr}`);
 *   }
 *   return sendSuccess(c, { balanceOutput: stdout });
 */

const WALLET_SENTINEL_URL = 'https://poof-wallet.internal/exec';

export interface WalletExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class WalletBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletBlockedError';
  }
}

export class WalletError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export interface WalletRunOptions {
  walletScopeId: string;
}

export async function walletRun(
  _env: unknown,
  argv: string[],
  options: WalletRunOptions,
): Promise<WalletExecResult> {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new WalletError('argv must be a non-empty array of strings', 400);
  }
  if (!options || typeof options.walletScopeId !== 'string' || !options.walletScopeId) {
    throw new WalletError('walletScopeId is required', 400);
  }

  const res = await fetch(WALLET_SENTINEL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ argv, walletScopeId: options.walletScopeId }),
  });

  if (res.status === 403) {
    const text = await res.text().catch(() => 'blocked');
    throw new WalletBlockedError(text);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WalletError(text, res.status);
  }
  return (await res.json()) as WalletExecResult;
}
