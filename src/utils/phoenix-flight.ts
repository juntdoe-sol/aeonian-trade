/**
 * Phoenix Flight builder-code configuration utility (frontend).
 *
 * Flight is Phoenix's builder-code layer that lets the app earn a share of
 * taker fees on SDK-routed orders. It ONLY applies to orders placed through
 * the Rise SDK (e.g. `client.ixs.placeMarketOrder`, `client.ixs.placeLimitOrder`)
 * with the Flight proxy instruction wrapping the Phoenix instruction.
 *
 * It does NOT apply to onchain policy hooks (e.g. `@PhoenixPerpsPlugin`
 * deposit/withdraw/register) — those are governed by Poof policy rules and
 * do not route through the Rise SDK order-building surface.
 *
 * SIGNER BRIDGE NOTE:
 * The Rise SDK returns `@solana/kit` (web3.js v2) instructions (InstructionsWithAccountsAndData).
 * Poof's `signAndSubmitTransaction` accepts web3.js v1 `Transaction` or `VersionedTransaction`
 * from `@solana/web3.js`. The `placeOrderViaFlight` function bridges between these two versions:
 *   - AccountRole WRITABLE_SIGNER (3) → isSigner: true, isWritable: true
 *   - AccountRole READONLY_SIGNER  (2) → isSigner: true, isWritable: false
 *   - AccountRole WRITABLE         (1) → isSigner: false, isWritable: true
 *   - AccountRole READONLY         (0) → isSigner: false, isWritable: false
 *   - programAddress (v2 string) → programId (v1 PublicKey)
 *   - data (ReadonlyUint8Array) → Buffer
 * The assembled v1 Transaction is submitted via signAndSubmitTransaction from @pooflabs/web.
 * On success, the tx signature is returned and the caller should POST it to /api/phoenix/record-trade.
 */

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  MessageV0,
} from '@solana/web3.js';
import { signAndSubmitTransaction } from '@pooflabs/web';
import { createPhoenixClient, Side } from '@ellipsis-labs/rise';
import type { PhoenixClientConfig, Authority } from '@ellipsis-labs/rise';
import {
  PHOENIX_API_BASE_URL,
  PHOENIX_BUILDER_AUTHORITY,
  PHOENIX_BUILDER_PDA_INDEX,
  PHOENIX_BUILDER_SUBACCOUNT_INDEX,
} from '@/lib/constants';
import { getSolanaRpcUrl } from '@/utils/solana-rpc';

export { Side };

/**
 * Create a Rise SDK Phoenix client with Flight builder routing enabled.
 *
 * Flight config is automatically injected using the project's builder authority
 * and subaccount indices from constants. Any additional `PhoenixClientConfig`
 * options you pass are merged on top.
 *
 * @example
 * ```ts
 * const client = createFlightClient({ rpcUrl: 'https://api.mainnet-beta.solana.com' });
 * ```
 */
export function createFlightClient(
  config?: Omit<PhoenixClientConfig, 'flight'>,
) {
  return createPhoenixClient({
    apiUrl: PHOENIX_API_BASE_URL,
    rpcUrl: getSolanaRpcUrl(),
    ...config,
    flight: {
      builderAuthority: PHOENIX_BUILDER_AUTHORITY as Authority,
      builderPdaIndex: Number(PHOENIX_BUILDER_PDA_INDEX),
      builderSubaccountIndex: Number(PHOENIX_BUILDER_SUBACCOUNT_INDEX),
    },
  });
}

/**
 * AccountRole enum values from @solana/kit (web3.js v2):
 *   READONLY         = 0
 *   WRITABLE         = 1
 *   READONLY_SIGNER  = 2
 *   WRITABLE_SIGNER  = 3
 */
function accountRoleToMeta(address: string, role: number): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean } {
  return {
    pubkey: new PublicKey(address),
    isSigner: role >= 2,   // READONLY_SIGNER=2, WRITABLE_SIGNER=3
    isWritable: role === 1 || role === 3, // WRITABLE=1, WRITABLE_SIGNER=3
  };
}

/**
 * Bridge a single web3.js v2 InstructionsWithAccountsAndData into a web3.js v1 TransactionInstruction.
 * The v2 instruction has:
 *   - programAddress: string (base58)
 *   - accounts: readonly { address: string; role: AccountRole }[]
 *   - data: ReadonlyUint8Array (read-only view — Buffer.from accepts it fine)
 */
function bridgeV2Instruction(ix: {
  programAddress: string;
  accounts: readonly { address: string; role: number }[];
  data: ArrayLike<number>; // ReadonlyUint8Array satisfies ArrayLike<number>
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((acc) => accountRoleToMeta(acc.address, acc.role)),
    data: Buffer.from(ix.data),
  });
}

/**
 * Assemble a v1 Transaction from one or more bridged Flight instructions, run the
 * (non-blocking) pre-broadcast simulation for diagnostics, and submit via Poof's
 * `signAndSubmitTransaction`. Returns the confirmed tx signature.
 *
 * This is the shared submission core used by BOTH the cross-margin path
 * (`placeOrderViaFlight`, single instruction) and the isolated path
 * (`placeIsolatedOrderViaFlight`, an ARRAY of instructions — sync + transfer +
 * place — that MUST all land in ONE transaction to preserve the atomic
 * transfer+place guarantee the iso flow depends on). NOTE: the Flight isolated
 * endpoint does NOT include a register-trader instruction — the parent Phoenix
 * Trader must already be registered before this call (the caller registers it
 * separately via the idempotent @PhoenixPerpsPlugin.registerTrader path).
 */
async function submitFlightTransaction(
  walletAddress: string,
  v1Instructions: TransactionInstruction[],
): Promise<string> {
  // Assemble v1 Transaction — recentBlockhash is fetched internally by
  // signAndSubmitTransaction (Poof wallet), so we do not need to fetch it here.
  const tx = new Transaction();
  tx.feePayer = new PublicKey(walletAddress);
  // Phoenix Eternal's place-order + funding-settlement (and, for isolated orders,
  // the extra register/sync/transfer legs) exceeds Solana's default 200k CU limit,
  // so raise the compute budget before the Flight order instruction(s).
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  for (const ix of v1Instructions) {
    tx.add(ix);
  }

  // ── PRE-BROADCAST SIMULATION (diagnostic only — NON-BLOCKING) ────────────
  // Simulate the transaction before submitting so program logs are visible in
  // the browser console. The result — pass, fail, or RPC error — does NOT gate
  // the real submit; execution always continues to signAndSubmitTransaction.
  //
  // We MUST use the VersionedTransaction overload of simulateTransaction with
  // sigVerify:false. The legacy Transaction overload (simulateTransaction(tx, signers[]))
  // attempts to sign the tx locally using the provided signers; passing an empty
  // array throws "No signers" before any RPC call is made, so we never see logs.
  // The VersionedTransaction overload accepts { sigVerify, replaceRecentBlockhash }
  // and does NOT attempt local signing, so it works for unsigned transactions.
  try {
    const simConnection = new Connection(getSolanaRpcUrl(), 'processed');
    const { blockhash } = await simConnection.getLatestBlockhash('processed');
    tx.recentBlockhash = blockhash;

    const message = MessageV0.compile({
      payerKey: new PublicKey(walletAddress),
      instructions: tx.instructions,
      recentBlockhash: blockhash,
    });
    const versionedTx = new VersionedTransaction(message);

    const simResult = await simConnection.simulateTransaction(versionedTx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'processed',
    });

    console.log('[phoenix-flight] pre-broadcast sim result', {
      err: simResult.value.err,
      unitsConsumed: simResult.value.unitsConsumed,
      logs: simResult.value.logs,
    });

    if (simResult.value.err) {
      console.error('[phoenix-flight] pre-broadcast sim ON-CHAIN ERROR', simResult.value.err, simResult.value.logs);
      console.error('[phoenix-flight] sim logs (individual lines):');
      (simResult.value.logs ?? []).forEach((line) => console.error('  ', line));
    } else {
      console.info('[phoenix-flight] pre-broadcast sim OK', {
        unitsConsumed: simResult.value.unitsConsumed,
      });
      console.info('[phoenix-flight] sim logs (individual lines):');
      (simResult.value.logs ?? []).forEach((line) => console.info('  ', line));
    }
  } catch (simErr) {
    console.error('[phoenix-flight] pre-broadcast sim threw:', simErr);
  }
  // ── END SIMULATION ────────────────────────────────────────────────────────

  // Submit via Poof wallet (triggers wallet popup).
  // signAndSubmitTransaction handles blockhash fetch, signing, sending, and confirming.
  try {
    const txSignature = await signAndSubmitTransaction(tx, new PublicKey(walletAddress));
    console.log('[phoenix-flight] Order placed. txSignature:', txSignature);
    return txSignature;
  } catch (rawErr) {
    // Log the full raw error so the developer can see every field in the console.
    console.error('[phoenix-flight] signAndSubmitTransaction error (raw):', rawErr);

    // Build a rich human-readable message that surfaces nested detail from RPC
    // or SDK error responses (e.g. error.response.data, logs, error.message).
    let detail = '';

    if (rawErr && typeof rawErr === 'object') {
      const e = rawErr as Record<string, unknown>;

      const responseData = (e['response'] as Record<string, unknown> | undefined)?.['data'];
      if (responseData !== undefined) {
        detail = typeof responseData === 'string'
          ? responseData
          : JSON.stringify(responseData);
      }

      const innerError = e['error'];
      if (!detail && innerError !== undefined) {
        detail = typeof innerError === 'string'
          ? innerError
          : JSON.stringify(innerError);
      }

      const logs = e['logs'];
      if (logs !== undefined) {
        const logsStr = Array.isArray(logs) ? logs.join('\n') : JSON.stringify(logs);
        detail = detail ? `${detail}\nLogs:\n${logsStr}` : `Logs:\n${logsStr}`;
      }

      if (!detail && typeof e['message'] === 'string') {
        detail = e['message'] as string;
      }
    }

    const baseMsg = rawErr instanceof Error ? rawErr.message : String(rawErr);
    const fullMsg = detail && detail !== baseMsg
      ? `${baseMsg}: ${detail}`
      : baseMsg;

    throw new Error(fullMsg);
  }
}

export interface PlaceOrderViaFlightParams {
  /** The wallet public key string of the trader (authority). */
  walletAddress: string;
  /** The Phoenix symbol e.g. "SOL-PERP" */
  symbol: string;
  /** Side: Side.Bid (long/buy) or Side.Ask (short/sell) */
  side: Side;
  /**
   * Size in HUMAN-READABLE base-token units (e.g. 1.404 for 1.404 SOL).
   * The Rise SDK's buildMarketOrderPacket / buildLimitOrderPacket expect this value
   * and internally multiply by 10^baseLotDecimals to produce base lots.
   * Do NOT pre-convert to lots before passing here — that would cause a double-conversion
   * and produce orders 10^baseLotDecimals (e.g. 100x for SOL-PERP) too large.
   */
  sizeBase: number;
  /** For limit orders: price in USD. For market orders: omit or set null. */
  limitPriceUsd?: number | null;
  /** Trader subaccount index (0 = cross margin, >0 = isolated) */
  traderSubaccountIndex?: number;
}

export interface PlaceOrderViaFlightResult {
  txSignature: string;
}

/**
 * Place a Phoenix perps order via the Rise Flight SDK (builder-code fee collection).
 *
 * This is the ONLY function that should be used for new order placement.
 * It replaces the old `setPhoenixOrder(...)` call.
 *
 * Steps:
 * 1. Build the order instruction via Rise SDK (Flight proxy wraps the Phoenix instruction).
 * 2. Bridge v2 instruction → v1 TransactionInstruction.
 * 3. Get a fresh blockhash from the Solana RPC.
 * 4. Assemble a v1 Transaction and submit via Poof's `signAndSubmitTransaction`.
 * 5. Return the confirmed tx signature.
 *
 * The caller should POST the signature + order details to /api/phoenix/record-trade
 * to record the trade and award points.
 */
export async function placeOrderViaFlight(
  params: PlaceOrderViaFlightParams,
): Promise<PlaceOrderViaFlightResult> {
  const {
    walletAddress,
    symbol,
    side,
    sizeBase,
    limitPriceUsd,
    traderSubaccountIndex = 0,
  } = params;

  // Strip -PERP suffix for the Rise SDK (it expects bare symbols like "SOL")
  const bareSymbol = symbol.replace(/-PERP$/i, '');

  // Create the Flight-enabled client with mainnet RPC
  const client = createFlightClient();

  // Build the order packet and then the instruction
  // For market orders: use placeMarketOrder (ImmediateOrCancel with priceInTicks=null)
  // For limit orders: use placeLimitOrder (LimitOrderPacket with priceInTicks > 0)
  // data is ReadonlyUint8Array from @solana/kit — we use ArrayLike<number> to accept it.
  let ix: {
    programAddress: string;
    accounts: readonly { address: string; role: number }[];
    data: ArrayLike<number>;
  };

  if (limitPriceUsd != null && limitPriceUsd > 0) {
    // Limit order path
    const orderPacket = await client.orderPackets.buildLimitOrderPacket({
      symbol: bareSymbol as ReturnType<typeof import('@ellipsis-labs/rise')['symbol']>,
      side,
      priceUsd: limitPriceUsd,
      baseUnits: sizeBase, // human-readable base-token quantity; SDK converts to lots internally
      clientOrderId: BigInt(Date.now()),
    });

    ix = await client.ixs.placeLimitOrder({
      authority: walletAddress as Authority,
      symbol: bareSymbol as ReturnType<typeof import('@ellipsis-labs/rise')['symbol']>,
      orderPacket,
      traderSubaccountIndex,
    });
  } else {
    // Market order path
    const orderPacket = await client.orderPackets.buildMarketOrderPacket({
      symbol: bareSymbol as ReturnType<typeof import('@ellipsis-labs/rise')['symbol']>,
      side,
      baseUnits: sizeBase, // human-readable base-token quantity; SDK converts to lots internally
    });

    ix = await client.ixs.placeMarketOrder({
      authority: walletAddress as Authority,
      symbol: bareSymbol as ReturnType<typeof import('@ellipsis-labs/rise')['symbol']>,
      orderPacket,
      traderSubaccountIndex,
    });
  }

  // ── v2 → v1 Bridge ────────────────────────────────────────────────────────
  // The Rise SDK returns an @solana/kit (v2) instruction. Poof's wallet uses
  // @solana/web3.js v1. We map the v2 AccountMeta shape to v1 keys.
  const v1Ix = bridgeV2Instruction(ix);

  // Assemble, simulate (diagnostic), and submit via the shared core.
  const txSignature = await submitFlightTransaction(walletAddress, [v1Ix]);

  return { txSignature };
}

export interface PlaceIsolatedOrderViaFlightParams {
  /** The wallet public key string of the trader (authority). */
  walletAddress: string;
  /** The Phoenix symbol e.g. "GOLD-PERP" or "SOL-PERP" */
  symbol: string;
  /** Side: Side.Bid (long/buy) or Side.Ask (short/sell) */
  side: Side;
  /**
   * Size in HUMAN-READABLE base-token units (e.g. 1.404 for 1.404 SOL).
   * Passed to the isolated request as `quantity` (a decimal field the API
   * converts to base lots server-side). Do NOT pre-convert to base lots —
   * `numBaseLots` is the integer-lots field and is intentionally left unset.
   */
  sizeBase: number;
  /** For limit orders: price in USD. For market orders: omit or set null. */
  limitPriceUsd?: number | null;
  /**
   * Collateral to move into the isolated subaccount, in micro-USDC (integer).
   * Required for OPEN; for a full CLOSE the SDK sweeps collateral back to the
   * parent and no transfer is needed (pass undefined/0).
   */
  transferAmount?: number;
  /**
   * The app's isolated subaccount SLOT (the 4th PDA seed; starts at 1).
   *
   * IMPORTANT: this is NOT the Flight request's `pdaIndex`. The Flight isolated
   * HTTP endpoint resolves the isolated subaccount slot SERVER-SIDE (it scans the
   * trader's subaccounts for the one suitable for the asset — see the SDK's
   * `fetchSubaccountForAsset`). The request's `pdaIndex` is the *Trader PDA index*
   * (the 3rd PDA seed), which must equal the index the parent Trader was
   * registered at — always 0 here (`phoenixRegisterTrader` registers at the
   * default `pdaIndex=0`).
   *
   * This value is retained for app-side metadata (the `phoenixSubaccount`
   * tracking record, the separate sweep tx, logging) — it is intentionally NOT
   * forwarded into the request as `pdaIndex`.
   */
  subaccountIndex: number;
  /**
   * true for a reduce-only CLOSE order, false (default) for an OPEN.
   */
  isReduceOnly?: boolean;
  /**
   * Whether to KEEP freed collateral on the isolated subaccount instead of
   * sweeping it back to the parent. For a FULL close pass false (let the SDK
   * sweep back atomically); for a PARTIAL close pass true (a separate sweep tx
   * handles the leftover). Ignored for opens.
   */
  skipTransferToParent?: boolean;
}

/**
 * Place a Phoenix ISOLATED-margin perps order via the Rise Flight SDK so the app
 * earns the builder fee (the cross-margin path already does — this brings isolated
 * orders onto the same fee-collecting rail).
 *
 * The isolated order endpoints (`client.api.orders().placeIsolatedMarketOrder` /
 * `placeIsolatedLimitOrder`) return an ARRAY of instructions (sync + transfer +
 * place) that the SDK bundles to preserve single-transaction atomicity. They do
 * NOT include a register-trader instruction: the Flight HTTP endpoint REQUIRES a
 * pre-existing registered Phoenix Trader account and returns
 * "Source account not found: Trader <wallet> not found." (404) if the wallet is
 * unregistered. Trader registration is handled SEPARATELY by the caller (the
 * idempotent @PhoenixPerpsPlugin.registerTrader path, same as cross-margin)
 * before this function is invoked.
 *
 * Flight fee fields (`flightBuilderAuthority` / `flightFeeCollectorTrader`) are
 * auto-injected by the client's `defaultFlight` routing because the client is
 * created via `createFlightClient()` — so we do NOT pass them explicitly here.
 *
 * Size units: `quantity` carries HUMAN-READABLE base units (the same `sizeBase`
 * the cross path uses); the API converts to lots server-side. `transferAmount` is
 * micro-USDC (integer).
 *
 * `allowCrossAndIsolatedForAsset: true` is set so commodity markets (GOLD, WTIOIL)
 * — which are isolated-only — and assets a user already holds cross do not hard-fail.
 *
 * The caller should POST the signature + order details to /api/phoenix/record-trade
 * to record the trade and award points (the offchain iso hook no longer fires).
 */
export async function placeIsolatedOrderViaFlight(
  params: PlaceIsolatedOrderViaFlightParams,
): Promise<PlaceOrderViaFlightResult> {
  const {
    walletAddress,
    symbol,
    side,
    sizeBase,
    limitPriceUsd,
    transferAmount,
    subaccountIndex,
    isReduceOnly = false,
    skipTransferToParent = false,
  } = params;

  // Strip -PERP suffix for the Rise SDK (it expects bare symbols like "SOL")
  const bareSymbol = symbol.replace(/-PERP$/i, '');

  // The isolated HTTP endpoint expects the side as the string "bid"/"ask", but
  // `Side` is a NUMERIC enum (Bid = 0, Ask = 1) — String(side) would send "0".
  const sideStr = side === Side.Bid ? 'bid' : 'ask';

  // ── pdaIndex vs subaccountIndex (THE iso-open 404 fix) ──────────────────────
  // The Flight request's `pdaIndex` is the *Trader PDA index* (the 3rd PDA seed
  // of `["trader", authority, traderPdaIndex(u8), subaccountIndex(u8)]`). Phoenix
  // uses it — together with a SERVER-RESOLVED isolated subaccount slot — to derive
  // the order's "source account" Trader PDA. The parent Trader is registered ONLY
  // at the default `pdaIndex=0` (`phoenixRegisterTrader` → registerTrader(wallet)
  // with no index arg). Previously the app threaded its isolated SLOT (>=1) into
  // `pdaIndex`, so Phoenix derived `[authority, pdaIndex=1, …]` — a PDA that was
  // never registered — and returned 404 "Source account not found: Trader … not
  // found" on EVERY isolated open. The isolated slot is NOT a request field; the
  // server picks it via `fetchSubaccountForAsset`. So `pdaIndex` must be the
  // registered Trader PDA index (0); the transfer/sync legs the endpoint builds
  // also operate under `traderPdaIndex = pdaIndex = 0`, so collateral funds the
  // SAME Trader PDA the order places against.
  const REGISTERED_TRADER_PDA_INDEX = 0;
  // `subaccountIndex` (the app slot) is intentionally referenced here only to keep
  // it a live param; it is used by callers for metadata/sweeps, not in the request.
  void subaccountIndex;

  // Create the Flight-enabled client. `defaultFlight` routing auto-injects the
  // builder fee fields onto the isolated order request.
  const client = createFlightClient();

  // The isolated order builders live on the V1OrdersClient (client.api.orders()),
  // and each returns an ARRAY of @solana/kit (v2) instructions.
  let ixs: Array<{
    programAddress: string;
    accounts: readonly { address: string; role: number }[];
    data: ArrayLike<number>;
  }>;

  if (limitPriceUsd != null && limitPriceUsd > 0) {
    ixs = (await client.api.orders().placeIsolatedLimitOrder({
      authority: walletAddress,
      symbol: bareSymbol,
      side: sideStr,
      price: limitPriceUsd, // human-readable USD price; API converts to ticks
      quantity: sizeBase, // human-readable base units; API converts to lots
      ...(transferAmount != null ? { transferAmount } : {}),
      pdaIndex: REGISTERED_TRADER_PDA_INDEX, // Trader PDA index of the registered parent (0), NOT the iso slot
      allowCrossAndIsolatedForAsset: true,
      isReduceOnly,
      skipTransferToParent,
    })) as typeof ixs;
  } else {
    ixs = (await client.api.orders().placeIsolatedMarketOrder({
      authority: walletAddress,
      symbol: bareSymbol,
      side: sideStr,
      quantity: sizeBase, // human-readable base units; API converts to lots
      ...(transferAmount != null ? { transferAmount } : {}),
      pdaIndex: REGISTERED_TRADER_PDA_INDEX, // Trader PDA index of the registered parent (0), NOT the iso slot
      allowCrossAndIsolatedForAsset: true,
      isReduceOnly,
      skipTransferToParent,
    })) as typeof ixs;
  }

  // ── v2 → v1 Bridge ────────────────────────────────────────────────────────
  // Bridge EACH v2 instruction in the array and submit them ALL in ONE transaction
  // to preserve the atomic transfer+place guarantee the isolated flow relies on.
  const v1Instructions = ixs.map(bridgeV2Instruction);

  const txSignature = await submitFlightTransaction(walletAddress, v1Instructions);

  return { txSignature };
}
