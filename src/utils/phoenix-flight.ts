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
import {
  createPhoenixClient,
  Side,
  Direction,
  StopLossOrderKind,
  ticks,
  priceUsdToTicks,
  decodeConditionalOrderCollection,
} from '@ellipsis-labs/rise';
import type {
  PhoenixClientConfig,
  Authority,
  TriggerOrderParams,
} from '@ellipsis-labs/rise';
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

// ════════════════════════════════════════════════════════════════════════════
// SL/TP CONDITIONAL (TRIGGER) ORDERS — on-chain, Flight-wrapped
// ════════════════════════════════════════════════════════════════════════════
//
// Phoenix supports POSITION-LEVEL conditional orders: a single conditional-order
// record per (trader-subaccount, asset) that carries up to two trigger legs — a
// "greater" leg (fires when mark rises above its trigger) and a "less" leg (fires
// when mark falls below its trigger). For a perp position, take-profit and
// stop-loss map onto these two legs based on the position side:
//
//   LONG  position: TP = price ABOVE entry  → GREATER leg ; SL = price BELOW → LESS leg
//   SHORT position: TP = price BELOW entry  → LESS leg    ; SL = price ABOVE → GREATER leg
//
// In all cases the trigger CLOSES the position, so the trade side of the trigger
// order is the OPPOSITE of the position side (long closes by selling = Ask;
// short closes by buying = Bid).
//
// `placePositionConditionalOrder` with `sizePercent: 100` REPLACES the position's
// conditional record in a single instruction (cancel + replace semantics — no
// stacking), so "edit SL/TP" and "clear one side" are both just a re-place with
// the desired legs (pass `null` for a leg to remove it). Clearing BOTH legs is a
// re-place with both legs null. The instruction requires a ConditionalOrders
// account to exist for the trader subaccount; we prepend a create-account
// instruction in the same tx when it is missing.

/** A trigger price the user has entered, in USD. null/undefined = no trigger on that line. */
export interface ConditionalTriggerInput {
  /** Stop-loss trigger price in USD, or null to clear. */
  stopLossUsd?: number | null;
  /** Take-profit trigger price in USD, or null to clear. */
  takeProfitUsd?: number | null;
}

export interface PlaceConditionalOrdersViaFlightParams {
  /** The wallet public key string of the trader (authority). */
  walletAddress: string;
  /** The Phoenix symbol e.g. "SOL-PERP" (suffix stripped internally). */
  symbol: string;
  /** Position side: 'long' or 'short' — determines which leg SL/TP map onto. */
  positionSide: 'long' | 'short';
  /** Desired trigger prices in USD (null clears that side). */
  triggers: ConditionalTriggerInput;
  /** Trader subaccount index (0 = cross margin, >0 = isolated). */
  traderSubaccountIndex?: number;
}

/**
 * Convert a USD price to Phoenix Ticks for a given market.
 * Reads the market's tickSize / baseLotsDecimals from the orderbook header
 * (exposed via client.rpc) so the conversion matches the on-chain encoding.
 */
async function usdToTicksForMarket(
  client: ReturnType<typeof createFlightClient>,
  bareSymbol: string,
  priceUsd: number,
) {
  const header = await client.rpc.markets.getOrderbookHeader(bareSymbol as never);
  const tickStr = priceUsdToTicks(priceUsd, {
    baseLotsDecimals: header.baseLotsDecimals,
    tickSizeInQuoteLotsPerBaseLot: Number(header.tickSizeInQuoteLotsPerBaseLot),
  });
  return ticks(tickStr);
}

/**
 * Place (or replace) the position's stop-loss / take-profit trigger orders
 * on-chain via the Rise SDK, Flight-wrapped so the app earns the builder fee.
 *
 * Cancel + replace semantics: this REPLACES the whole conditional record for the
 * position, so editing an existing SL/TP or clearing one side is handled by
 * passing the new desired prices (null clears a side). If BOTH sides are null,
 * use `clearConditionalOrdersViaFlight` instead (a no-leg replace would be a
 * no-op record).
 *
 * Handles both cross (subaccountIndex 0) and isolated (>0) positions via
 * `traderSubaccountIndex`.
 */
export async function placeConditionalOrdersViaFlight(
  params: PlaceConditionalOrdersViaFlightParams,
): Promise<PlaceOrderViaFlightResult> {
  const {
    walletAddress,
    symbol,
    positionSide,
    triggers,
    traderSubaccountIndex = 0,
  } = params;

  const bareSymbol = symbol.replace(/-PERP$/i, '');
  const client = createFlightClient();

  // The trigger order CLOSES the position → trade side is the opposite of the
  // position side (long closes by selling = Ask; short closes by buying = Bid).
  const closeSide = positionSide === 'long' ? Side.Ask : Side.Bid;

  // Map SL/TP onto the greater/less legs by position side.
  //   LONG : TP = above (greater), SL = below (less)
  //   SHORT: TP = below (less),    SL = above (greater)
  const tpUsd = triggers.takeProfitUsd ?? null;
  const slUsd = triggers.stopLossUsd ?? null;

  let greaterUsd: number | null = null;
  let lessUsd: number | null = null;
  if (positionSide === 'long') {
    greaterUsd = tpUsd; // take-profit above
    lessUsd = slUsd;    // stop-loss below
  } else {
    greaterUsd = slUsd; // stop-loss above
    lessUsd = tpUsd;    // take-profit below
  }

  const buildLeg = async (
    triggerUsd: number | null,
    direction: Direction,
  ): Promise<TriggerOrderParams | null> => {
    if (triggerUsd == null || !(triggerUsd > 0)) return null;
    const triggerTicks = await usdToTicksForMarket(client, bareSymbol, triggerUsd);
    return {
      triggerDirection: direction,
      tradeSide: closeSide,
      orderKind: StopLossOrderKind.IOC, // market-close the position when triggered
      triggerPrice: triggerTicks,
      // Execution at the trigger price (IOC sweeps the book from there).
      executionPrice: triggerTicks,
    };
  };

  const greaterTriggerOrder = await buildLeg(greaterUsd, Direction.GreaterThan);
  const lessTriggerOrder = await buildLeg(lessUsd, Direction.LessThan);

  // Ensure the trader's ConditionalOrders account exists; prepend a create-account
  // instruction in the SAME tx when missing.
  const v1Instructions: TransactionInstruction[] = [];
  const createIx = await maybeBuildCreateConditionalOrdersAccountIx(
    client,
    walletAddress,
    traderSubaccountIndex,
  );
  if (createIx) v1Instructions.push(createIx);

  // Build the position-level conditional order instruction (Flight-wrapped via
  // the client's defaultFlight routing). sizePercent:100 closes the full position.
  const ix = (await client.ixs.placePositionConditionalOrder({
    authority: walletAddress as Authority,
    symbol: bareSymbol as never,
    greaterTriggerOrder,
    lessTriggerOrder,
    sizePercent: 100,
    traderSubaccountIndex,
  })) as {
    programAddress: string;
    accounts: readonly { address: string; role: number }[];
    data: ArrayLike<number>;
  };

  v1Instructions.push(bridgeV2Instruction(ix));

  const txSignature = await submitFlightTransaction(walletAddress, v1Instructions);
  return { txSignature };
}

/**
 * Clear BOTH the stop-loss and take-profit trigger orders for a position by
 * replacing its conditional record with no active legs. Flight-wrapped.
 */
export async function clearConditionalOrdersViaFlight(params: {
  walletAddress: string;
  symbol: string;
  traderSubaccountIndex?: number;
}): Promise<PlaceOrderViaFlightResult> {
  const { walletAddress, symbol, traderSubaccountIndex = 0 } = params;
  const bareSymbol = symbol.replace(/-PERP$/i, '');
  const client = createFlightClient();

  const v1Instructions: TransactionInstruction[] = [];
  const createIx = await maybeBuildCreateConditionalOrdersAccountIx(
    client,
    walletAddress,
    traderSubaccountIndex,
  );
  if (createIx) v1Instructions.push(createIx);

  const ix = (await client.ixs.placePositionConditionalOrder({
    authority: walletAddress as Authority,
    symbol: bareSymbol as never,
    greaterTriggerOrder: null,
    lessTriggerOrder: null,
    sizePercent: 100,
    traderSubaccountIndex,
  })) as {
    programAddress: string;
    accounts: readonly { address: string; role: number }[];
    data: ArrayLike<number>;
  };

  v1Instructions.push(bridgeV2Instruction(ix));

  const txSignature = await submitFlightTransaction(walletAddress, v1Instructions);
  return { txSignature };
}

/**
 * Derive the trader's ConditionalOrders PDA and, if the account does not yet
 * exist on-chain, return a create-account v1 instruction to prepend. Returns
 * null when the account already exists.
 */
async function maybeBuildCreateConditionalOrdersAccountIx(
  client: ReturnType<typeof createFlightClient>,
  walletAddress: string,
  traderSubaccountIndex: number,
): Promise<TransactionInstruction | null> {
  const condAddress = await deriveConditionalOrdersAddress(
    client,
    walletAddress,
    traderSubaccountIndex,
  );

  // Check existence by attempting to fetch the raw account. A throw (or empty
  // data) means the account is not initialized yet.
  let exists = false;
  try {
    const acct = await client.rpc.accounts.fetchAccount(condAddress);
    exists = !!acct?.data && acct.data.length > 0;
  } catch {
    exists = false;
  }
  if (exists) return null;

  const createIx = (await client.ixs.buildCreateConditionalOrdersAccount({
    authority: walletAddress as Authority,
    traderSubaccountIndex,
  })) as {
    programAddress: string;
    accounts: readonly { address: string; role: number }[];
    data: ArrayLike<number>;
  };
  return bridgeV2Instruction(createIx);
}

/** Derive the ConditionalOrders PDA address for a trader subaccount. */
async function deriveConditionalOrdersAddress(
  client: ReturnType<typeof createFlightClient>,
  walletAddress: string,
  traderSubaccountIndex: number,
) {
  const traderAccount = await client.pda.getTraderAddress({
    authority: walletAddress as Authority,
    traderPdaIndex: 0, // parent Trader is always registered at index 0
    subaccountIndex: traderSubaccountIndex,
  });
  return client.pda.getConditionalOrdersAddress({ traderAccount });
}

export interface ActiveConditionalTriggers {
  stopLossUsd: number | null;
  takeProfitUsd: number | null;
}

/**
 * Read back the position's currently-active on-chain SL/TP trigger prices (USD).
 *
 * Fetches and decodes the trader's ConditionalOrderCollection, finds the active
 * conditional order for this market's assetId, and converts the active legs'
 * trigger ticks back to USD using the market's tick params. Maps the greater/less
 * legs onto SL/TP by position side (inverse of the placement mapping).
 *
 * Returns { stopLossUsd: null, takeProfitUsd: null } when there is no
 * conditional-order account, no matching order, or the legs are inactive — so
 * callers can render "no trigger set" without special-casing the absent account.
 */
export async function readActiveConditionalTriggers(params: {
  walletAddress: string;
  symbol: string;
  positionSide: 'long' | 'short';
  traderSubaccountIndex?: number;
}): Promise<ActiveConditionalTriggers> {
  const { walletAddress, symbol, positionSide, traderSubaccountIndex = 0 } = params;
  const bareSymbol = symbol.replace(/-PERP$/i, '');
  const client = createFlightClient();

  const empty: ActiveConditionalTriggers = { stopLossUsd: null, takeProfitUsd: null };

  let collection;
  try {
    const condAddress = await deriveConditionalOrdersAddress(
      client,
      walletAddress,
      traderSubaccountIndex,
    );
    const acct = await client.rpc.accounts.fetchAccount(condAddress);
    if (!acct?.data || acct.data.length === 0) return empty;
    collection = decodeConditionalOrderCollection(acct.data);
  } catch {
    return empty;
  }

  // Resolve this market's assetId + tick params from the orderbook header.
  let header;
  try {
    header = await client.rpc.markets.getOrderbookHeader(bareSymbol as never);
  } catch {
    return empty;
  }
  const assetId = header.assetId;
  const tickSize = Number(header.tickSizeInQuoteLotsPerBaseLot);
  const baseLotsDecimals = header.baseLotsDecimals;

  // Ticks → USD: invert priceUsdToTicks. price = ticks * tickSize / 10^baseLotsDecimals
  // (priceUsdToTicks computes ticks = round(priceUsd * 10^baseLotsDecimals / tickSize)).
  const ticksToUsd = (t: bigint): number => {
    if (tickSize <= 0) return 0;
    return (Number(t) * tickSize) / Math.pow(10, baseLotsDecimals);
  };

  // Find the active conditional order for this asset.
  const order = collection.orders.find(
    (o) => o.assetId === assetId && o.isActive,
  );
  if (!order) return empty;

  const greaterUsd = order.greaterTriggerOrder?.isActive
    ? ticksToUsd(order.greaterTriggerOrder.triggerPrice as unknown as bigint)
    : null;
  const lessUsd = order.lessTriggerOrder?.isActive
    ? ticksToUsd(order.lessTriggerOrder.triggerPrice as unknown as bigint)
    : null;

  // Inverse of the placement mapping:
  //   LONG : greater = TP, less = SL
  //   SHORT: greater = SL, less = TP
  if (positionSide === 'long') {
    return {
      takeProfitUsd: greaterUsd && greaterUsd > 0 ? greaterUsd : null,
      stopLossUsd: lessUsd && lessUsd > 0 ? lessUsd : null,
    };
  }
  return {
    stopLossUsd: greaterUsd && greaterUsd > 0 ? greaterUsd : null,
    takeProfitUsd: lessUsd && lessUsd > 0 ? lessUsd : null,
  };
}
