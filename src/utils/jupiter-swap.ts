/**
 * Jupiter Aggregator swap utility
 *
 * Handles SOL ↔ USDC swaps via Jupiter's public lite-api quote/swap API.
 * No API key required. Transactions are VersionedTransactions serialized as base64.
 *
 * Mint addresses:
 *   SOL  = So11111111111111111111111111111111111111112  (wrapped SOL, 9 decimals)
 *   USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (6 decimals)
 *
 * Platform fee: PLATFORM_FEE_BPS basis points (0.1%) sent to FEE_WALLET on every swap.
 * The fee is best-effort — if Jupiter rejects the feeAccount (e.g. ATA not yet
 * initialized), the swap falls back to executing without the fee rather than blocking.
 */

import { VersionedTransaction, PublicKey, Connection } from '@solana/web3.js';
import { signAndSubmitTransaction } from '@pooflabs/web';
import { getSolanaRpcUrl } from '@/utils/solana-rpc';

export const JUPITER_QUOTE_API = 'https://lite-api.jup.ag/swap/v1';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Platform fee in basis points (10 bps = 0.1%).
 * Tune this constant to adjust the fee rate.
 */
export const PLATFORM_FEE_BPS = 10;

/**
 * Wallet that receives platform fees from every swap.
 */
const FEE_WALLET = 'PNX9utQBdEs4W7vMNop4wkuzPEsd84dGbMgFeVcoKYa';

// SPL Token program and Associated Token Program IDs — used for ATA derivation.
// These are stable, canonical addresses; no need to import spl-token.
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ');

/**
 * Derive the Associated Token Account (ATA) address for `owner` and `mint`
 * using PublicKey.findProgramAddressSync — deterministic, no RPC call needed.
 * Returns the ATA as a base-58 string.
 */
function deriveAta(owner: PublicKey, mint: PublicKey): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata.toBase58();
}

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

export type SwapDirection = 'SOL_TO_USDC' | 'USDC_TO_SOL';

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface SwapQuote {
  quoteResponse: JupiterQuoteResponse;
  /** Human-readable output amount (not in smallest units) */
  outAmountHuman: number;
  /** Price impact as a percentage string */
  priceImpactPct: string;
}

/**
 * Convert human-readable token amount to smallest units (lamports / micro-USDC).
 */
export function toSmallestUnits(amount: number, decimals: number): string {
  return Math.round(amount * Math.pow(10, decimals)).toString();
}

/**
 * Convert smallest units to human-readable amount.
 */
export function fromSmallestUnits(units: string, decimals: number): number {
  return parseInt(units, 10) / Math.pow(10, decimals);
}

/**
 * Check whether the fee wallet's ATA for the given output mint exists on-chain.
 * Jupiter requires an already-initialized ATA; if it doesn't exist the swap tx
 * will reference a non-existent account and Privy's simulation will reject it.
 *
 * Returns true if the account exists (fee should be charged), false otherwise.
 * Any RPC error is treated as "ATA absent" — fail-safe to not break swaps.
 *
 * Exported so callers (e.g. SwapTab) can check once on mount and pass the result
 * to both fetchJupiterQuote (includeFee) and executeJupiterSwap (withFee) so that
 * the quote and swap always agree on whether the platform fee is included.
 */
export async function feeAtaExistsOnChain(outputMint: string): Promise<boolean> {
  try {
    const outputMintPubkey = new PublicKey(outputMint);
    const feeWalletPubkey = new PublicKey(FEE_WALLET);
    const feeAccountPubkey = new PublicKey(deriveAta(feeWalletPubkey, outputMintPubkey));
    const connection = new Connection(getSolanaRpcUrl(), 'confirmed');
    const accountInfo = await connection.getAccountInfo(feeAccountPubkey);
    return accountInfo !== null;
  } catch (err) {
    console.warn('[jupiter-swap] feeAta existence check failed, proceeding without fee:', err);
    return false;
  }
}

/**
 * Fetch a Jupiter quote for the given swap direction and amount.
 * Returns null if the amount is zero or the fetch fails.
 *
 * Pass `includeFee: true` to add platformFeeBps to the quote (only when the fee
 * ATA is confirmed to exist on-chain — checked by the caller in executeJupiterSwap).
 *
 * @param direction - SOL_TO_USDC or USDC_TO_SOL
 * @param amountHuman - Human-readable input amount (e.g. 1.5 for 1.5 SOL)
 * @param slippageBps - Slippage in basis points (default 50 = 0.5%)
 * @param includeFee - Whether to request the platform fee on this quote (default true)
 */
export async function fetchJupiterQuote(
  direction: SwapDirection,
  amountHuman: number,
  slippageBps = 50,
  includeFee = true,
): Promise<SwapQuote | null> {
  if (!amountHuman || amountHuman <= 0) return null;

  const inputMint = direction === 'SOL_TO_USDC' ? SOL_MINT : USDC_MINT;
  const outputMint = direction === 'SOL_TO_USDC' ? USDC_MINT : SOL_MINT;
  const inputDecimals = direction === 'SOL_TO_USDC' ? SOL_DECIMALS : USDC_DECIMALS;
  const outputDecimals = direction === 'SOL_TO_USDC' ? USDC_DECIMALS : SOL_DECIMALS;

  const amount = toSmallestUnits(amountHuman, inputDecimals);

  const url = new URL(`${JUPITER_QUOTE_API}/quote`);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount);
  url.searchParams.set('slippageBps', String(slippageBps));
  // Only include platformFeeBps when the fee ATA exists — keeps quote and swap consistent.
  if (includeFee) {
    url.searchParams.set('platformFeeBps', String(PLATFORM_FEE_BPS));
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Jupiter quote failed (${res.status}): ${body}`);
  }

  const quoteResponse: JupiterQuoteResponse = await res.json();
  const outAmountHuman = fromSmallestUnits(quoteResponse.outAmount, outputDecimals);
  const priceImpactPct = quoteResponse.priceImpactPct;

  return { quoteResponse, outAmountHuman, priceImpactPct };
}

/**
 * Build and submit a Jupiter swap transaction via the user's connected Poof wallet.
 *
 * The Jupiter /swap endpoint returns a base64-encoded VersionedTransaction.
 * We deserialize it, then pass it to signAndSubmitTransaction from @pooflabs/web —
 * the same helper used for Phoenix Flight orders throughout this app.
 *
 * Platform fee: PLATFORM_FEE_BPS bps are collected into the fee wallet's ATA for the
 * output mint. Jupiter requires that ATA to exist on-chain before it will include the
 * fee instruction. If the ATA isn't initialized yet the swap is executed without the fee.
 *
 * IMPORTANT — quote / swap consistency: the caller must pass the same `withFee` value
 * that was used as `includeFee` when calling fetchJupiterQuote. If the quote had
 * platformFeeBps baked in, the swap body must include feeAccount (and vice-versa).
 * Pass the result of feeAtaExistsOnChain() as `withFee` for both calls to guarantee this.
 *
 * @param quoteResponse - The full quote object returned by fetchJupiterQuote
 * @param walletAddress - The user's Solana public key string
 * @param withFee - Whether the quote was fetched with platformFeeBps (default: auto-check)
 * @returns The confirmed transaction signature
 */
export async function executeJupiterSwap(
  quoteResponse: JupiterQuoteResponse,
  walletAddress: string,
  withFee?: boolean,
): Promise<string> {
  // If the caller didn't pre-check the ATA, do it now.
  // NOTE: when the caller already called feeAtaExistsOnChain() to determine includeFee
  // for the quote, they should pass that same result as `withFee` to avoid a second
  // RPC round-trip and to guarantee quote/swap consistency.
  const ataExists = withFee !== undefined ? withFee : await feeAtaExistsOnChain(quoteResponse.outputMint);

  let feeAccount: string | undefined;
  if (ataExists) {
    try {
      const outputMintPubkey = new PublicKey(quoteResponse.outputMint);
      const feeWalletPubkey = new PublicKey(FEE_WALLET);
      feeAccount = deriveAta(feeWalletPubkey, outputMintPubkey);
    } catch {
      // Derivation should never fail for valid pubkeys, but fail-safe to no-fee.
      feeAccount = undefined;
    }
  } else {
    console.info('[jupiter-swap] fee ATA not initialised — executing swap without platform fee');
  }

  /**
   * Inner helper: call Jupiter /swap, optionally attaching the feeAccount.
   * Returns the raw Response so we can inspect the status before throwing.
   */
  const buildSwap = (includeFeeAccount: boolean) =>
    fetch(`${JUPITER_QUOTE_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: walletAddress,
        wrapAndUnwrapSol: true, // auto-wrap/unwrap native SOL ↔ wSOL
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
        ...(includeFeeAccount && feeAccount ? { feeAccount } : {}),
      }),
    });

  // Build the swap: with fee if ATA exists, without fee otherwise.
  // No reactive fallback needed — the ATA check above already decided.
  let swapRes = await buildSwap(!!feeAccount);

  // Safety net: if Jupiter still rejects and we had a feeAccount (unexpected), retry once
  // without it so the swap is never blocked due to a fee-side issue.
  if (!swapRes.ok && feeAccount) {
    console.warn(
      `[jupiter-swap] feeAccount swap build failed (${swapRes.status}), retrying without fee`,
    );
    swapRes = await buildSwap(false);
  }

  if (!swapRes.ok) {
    const body = await swapRes.text().catch(() => swapRes.statusText);
    throw new Error(`Jupiter swap build failed (${swapRes.status}): ${body}`);
  }

  const { swapTransaction } = await swapRes.json();

  if (!swapTransaction) {
    throw new Error('Jupiter did not return a swap transaction');
  }

  // 3. Deserialize the base64 VersionedTransaction
  const txBytes = Buffer.from(swapTransaction, 'base64');
  const versionedTx = VersionedTransaction.deserialize(txBytes);

  // 4. Submit via Poof wallet — the same signAndSubmitTransaction call used by
  //    placeOrderViaFlight. Poof handles blockhash refresh, signing, and confirming.
  const txSignature = await signAndSubmitTransaction(
    versionedTx,
    new PublicKey(walletAddress),
  );

  return txSignature;
}
