/**
 * Heartbeat task: liquidation-detect
 *
 * Detects Phoenix position liquidations and fans out alerts. Runs each tick.
 *
 * DETECTION MODEL
 * ---------------
 * A position is a *liquidation candidate* when a symbol+side that WAS present in
 * the previous tick's snapshot is NO LONGER present this tick AND the trader's
 * account collateral has collapsed near zero. A voluntary close also makes a
 * position vanish, but a voluntary close returns collateral to the account — so
 * collateral-near-zero is the discriminator that separates a wipeout from a
 * normal close.
 *
 * FALSE-POSITIVE GUARD (two-tick confirmation)
 * --------------------------------------------
 * The Phoenix trader upstream intermittently returns collateral=0 for funded
 * accounts (a documented "stale-zero flicker"). To avoid firing on a single
 * flicker we require confirmation across TWO consecutive ticks: a candidate is
 * first stored as `pending` in the snapshot; it only emits a liquidation if it's
 * STILL gone with near-zero collateral on the next tick. If the position
 * reappears or collateral recovers, the pending flag is cleared. Traders whose
 * upstream call ERRORED this tick are skipped entirely (an API failure must not
 * look like a disappearance).
 *
 * Snapshot JSON shape (stored in positionSnapshots.positions as a string):
 *   { positions: NormPosition[], pending: PendingLiq[] }
 *
 * Per-tick work is bounded: we only fetch traders that either have a snapshot or
 * are discovered with open positions this tick.
 */

import { getAllPhoenixTrader } from '../collections/phoenixTrader.js';
import { getAllPhoenixTradeRecord } from '../collections/phoenixTradeRecord.js';
import { getAllPhoenixIsoTrade } from '../collections/phoenixIsoTrade.js';
import { getAllPhoenixOrder } from '../collections/phoenixOrder.js';
import {
  getManyPositionSnapshots,
  buildUpdatePositionSnapshots,
  buildDeletePositionSnapshots,
} from '../collections/positionSnapshots.js';
import { buildLiquidations } from '../collections/liquidations.js';
import { setMany, Address, Time } from '../db-client.js';
import { notifyLiquidation } from '../utils/notify-followers.js';
import { PHOENIX_API_BASE_URL } from '../constants.js';

/** Collateral threshold (US cents) below which an account counts as "collapsed". $3.00. */
const COLLATERAL_NEAR_ZERO_CENTS = 300;

/** Minimum base58 wallet length sanity check. */
const isWallet = (s: unknown): s is string => typeof s === 'string' && s.length >= 32;

/** Normalized open position carried in the snapshot. */
interface NormPosition {
  symbol: string;
  side: 'long' | 'short';
  sizeBaseLots?: number;
  collateralCents?: number;
  market?: string;
}

/** A candidate awaiting second-tick confirmation. */
interface PendingLiq {
  symbol: string;
  side: 'long' | 'short';
  sizeBaseLots?: number;
  collateralCentsBefore?: number;
  market?: string;
}

interface SnapshotData {
  positions: NormPosition[];
  pending: PendingLiq[];
}

/** Result of fetching+normalizing a trader's current state. */
interface TraderTick {
  positions: NormPosition[];
  /** Account-level collateral in US cents. */
  collateralCents: number;
  /** True when the upstream call failed — caller must skip detection for this trader. */
  errored: boolean;
}

/** Read a numeric value out of a Phoenix TokenAmount-like object ({ value, ui } etc.). */
function tokenToNumber(t: unknown): number {
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }
  const obj = t as Record<string, unknown>;
  // Prefer the human-readable `ui` string (USD value), matching the frontend toNumber().
  if (typeof obj.ui === 'string') {
    const n = parseFloat(obj.ui);
    if (!isNaN(n)) return n;
  }
  if (typeof obj.value === 'number') return obj.value;
  if (typeof obj.value === 'string') {
    const n = parseFloat(obj.value);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * Fetch a trader's current state from the Phoenix upstream and reduce to a
 * normalized position list + account collateral. Mirrors the selection/union
 * logic of /api/phoenix/trader/:authority: account-level scalars come from the
 * highest-collateral sub-account; positions are the union across all
 * sub-accounts. We talk to the upstream directly (not our own route) per the
 * heartbeat rule of not calling own API routes.
 */
async function fetchTraderTick(wallet: string): Promise<TraderTick> {
  let body: { traders?: unknown[] };
  try {
    const res = await fetch(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(wallet)}/state`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      // 404 = no trader account at all. Treat as "no positions, no error" so a
      // trader who fully exited (account closed) clears cleanly rather than
      // being skipped forever.
      return { positions: [], collateralCents: 0, errored: false };
    }
    if (!res.ok) {
      return { positions: [], collateralCents: 0, errored: true };
    }
    body = (await res.json()) as { traders?: unknown[] };
  } catch {
    return { positions: [], collateralCents: 0, errored: true };
  }

  if (!Array.isArray(body.traders) || body.traders.length === 0) {
    return { positions: [], collateralCents: 0, errored: false };
  }

  type Entry = Record<string, unknown>;
  const entries = body.traders as Entry[];

  const entryCollateral = (e: Entry): number => tokenToNumber(e.collateralBalance);
  // Account collateral = the highest sub-account collateral (the primary funded
  // account), matching how the trader route selects the primary sub-account.
  let accountCollateralUsd = 0;
  for (const e of entries) {
    const c = entryCollateral(e);
    if (c > accountCollateralUsd) accountCollateralUsd = c;
  }

  // Union of positions across all sub-accounts.
  const positions: NormPosition[] = [];
  for (const e of entries) {
    const arr = e.positions;
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      const symbolRaw = typeof p.symbol === 'string' ? p.symbol : '';
      const symbol = symbolRaw.replace(/-PERP$/i, '').toUpperCase();
      if (!symbol) continue;
      const sizeVal = tokenToNumber(p.positionSize);
      if (sizeVal === 0) continue; // not an open position
      const side: 'long' | 'short' = sizeVal >= 0 ? 'long' : 'short';

      // sizeBaseLots: Phoenix exposes the lot count under a few possible keys;
      // fall back to the absolute human size if no lot field is present.
      const lotsRaw = p.sizeBaseLots ?? p.baseLots ?? p.positionSizeBaseLots;
      const sizeBaseLots = lotsRaw != null
        ? Math.abs(Math.round(Number(lotsRaw)))
        : undefined;

      // Per-position margin (isolated) in USD → cents. Used as the per-position
      // collateral signal; the account-level collateral collapse is the primary
      // discriminator.
      const marginUsd = tokenToNumber(p.initialMargin);
      const collateralCents = marginUsd > 0 ? Math.round(marginUsd * 100) : undefined;

      const market = typeof p.marketPubkey === 'string' ? p.marketPubkey
        : typeof p.market === 'string' ? p.market
        : undefined;

      positions.push({
        symbol,
        side,
        ...(sizeBaseLots != null && Number.isFinite(sizeBaseLots) ? { sizeBaseLots } : {}),
        ...(collateralCents != null ? { collateralCents } : {}),
        ...(market ? { market } : {}),
      });
    }
  }

  return {
    positions,
    collateralCents: Math.round(accountCollateralUsd * 100),
    errored: false,
  };
}

/** Parse a snapshot's positions JSON into structured data (tolerant of old/empty shapes). */
function parseSnapshot(json: string | undefined): SnapshotData {
  if (!json) return { positions: [], pending: [] };
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      // Legacy shape: a bare positions array.
      return { positions: parsed as NormPosition[], pending: [] };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      positions: Array.isArray(obj.positions) ? (obj.positions as NormPosition[]) : [],
      pending: Array.isArray(obj.pending) ? (obj.pending as PendingLiq[]) : [],
    };
  } catch {
    return { positions: [], pending: [] };
  }
}

const posKey = (p: { symbol: string; side: string }) => `${p.symbol}:${p.side}`;

export async function liquidationDetect(): Promise<void> {
  console.log('[liquidation-detect] Starting liquidation detection...');
  const startMs = Date.now();

  // 1. Build the candidate trader set:
  //    (a) traders with an existing positionSnapshots doc (we must re-check them
  //        to confirm pending candidates and clear closed positions), plus
  //    (b) registered traders / traders that appear in the trade collections
  //        (same union pnl-leaderboard uses) who may have opened a position.
  const [snapshots, registeredTraders, isoTrades, orders, tradeRecords] = await Promise.all([
    getManyPositionSnapshots(),
    getAllPhoenixTrader(),
    getAllPhoenixIsoTrade(),
    getAllPhoenixOrder(),
    getAllPhoenixTradeRecord(),
  ]);

  const walletSet = new Set<string>();
  const snapshotByWallet = new Map<string, SnapshotData>();
  for (const s of snapshots) {
    if (isWallet(s.id)) {
      walletSet.add(s.id);
      snapshotByWallet.set(s.id, parseSnapshot(s.positions));
    }
  }
  for (const t of registeredTraders) if (isWallet(t.id)) walletSet.add(t.id);
  for (const t of isoTrades) if (isWallet(t.trader)) walletSet.add(t.trader);
  for (const o of orders) if (isWallet(o.trader)) walletSet.add(o.trader);
  for (const r of tradeRecords) if (isWallet(r.trader)) walletSet.add(r.trader);

  const wallets = Array.from(walletSet);
  if (wallets.length === 0) {
    console.log('[liquidation-detect] No traders to scan, exiting.');
    return;
  }
  console.log(`[liquidation-detect] Scanning ${wallets.length} traders (${snapshots.length} with snapshots)...`);

  let confirmed = 0;
  let newPending = 0;
  let skippedErrored = 0;

  // Process each trader independently — one failure never blocks the batch.
  const results = await Promise.allSettled(
    wallets.map(async (wallet) => {
      const prev = snapshotByWallet.get(wallet) ?? { positions: [], pending: [] };
      const tick = await fetchTraderTick(wallet);

      // Skip detection entirely on a failed upstream call — don't treat an API
      // error as a disappearance. Leave the snapshot untouched for next tick.
      if (tick.errored) {
        skippedErrored++;
        return;
      }

      const currentKeys = new Set(tick.positions.map(posKey));
      const prevByKey = new Map(prev.positions.map((p) => [posKey(p), p] as const));
      const accountCollapsed = tick.collateralCents < COLLATERAL_NEAR_ZERO_CENTS;

      // ── Confirm or clear previously-pending candidates ───────────────────────
      const stillPending: PendingLiq[] = [];
      const toEmit: PendingLiq[] = [];
      for (const pend of prev.pending) {
        const key = posKey(pend);
        const reappeared = currentKeys.has(key);
        if (reappeared || !accountCollapsed) {
          // Position came back, or collateral recovered → it was a flicker / re-open.
          // Drop the pending flag.
          continue;
        }
        // Still gone AND collateral still near zero on this second tick → CONFIRMED.
        toEmit.push(pend);
      }

      // ── Detect NEW candidates this tick ──────────────────────────────────────
      // A position present last tick, gone now, with account collateral collapsed.
      // Mark pending (await confirmation next tick) — but only if it isn't already
      // pending and isn't being emitted this tick.
      const emittedKeys = new Set(toEmit.map(posKey));
      const pendingKeys = new Set(prev.pending.map(posKey));
      if (accountCollapsed) {
        for (const [key, prevPos] of prevByKey) {
          if (currentKeys.has(key)) continue; // still open — not a candidate
          if (emittedKeys.has(key) || pendingKeys.has(key)) continue; // already tracked
          stillPending.push({
            symbol: prevPos.symbol,
            side: prevPos.side,
            sizeBaseLots: prevPos.sizeBaseLots,
            // Collateral on the PREVIOUS tick (before the wipeout) — prefer the
            // position's own margin, fall back to nothing (optional field).
            collateralCentsBefore: prevPos.collateralCents,
            market: prevPos.market,
          });
          newPending++;
        }
      }

      // ── Emit confirmed liquidations ──────────────────────────────────────────
      const ops = [] as ReturnType<typeof buildLiquidations>[];
      for (const liq of toEmit) {
        // Backend-generated unique id.
        const liquidationId = `${wallet.slice(0, 8)}-${liq.symbol}-${liq.side}-${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 8)}`;
        ops.push(
          buildLiquidations(liquidationId, {
            trader: Address.publicKey(wallet),
            ...(liq.market ? { market: Address.publicKey(liq.market) } : {}),
            symbol: liq.symbol,
            side: liq.side,
            ...(liq.sizeBaseLots != null ? { sizeBaseLots: liq.sizeBaseLots } : {}),
            ...(liq.collateralCentsBefore != null ? { collateralCentsBefore: liq.collateralCentsBefore } : {}),
            createdAt: Time.Now,
          }),
        );
      }
      if (ops.length > 0) {
        const ok = await setMany(ops);
        if (ok) {
          confirmed += ops.length;
          // Fan out a notification per confirmed liquidation (followers + self).
          await Promise.allSettled(
            toEmit.map((liq) =>
              notifyLiquidation({ trader: wallet, symbol: liq.symbol, side: liq.side }),
            ),
          );
        } else {
          console.warn(`[liquidation-detect] liquidations setMany failed for ${wallet.slice(0, 8)}… (${ops.length})`);
        }
      }

      // ── Persist the new snapshot ─────────────────────────────────────────────
      // If the trader has zero open positions and nothing pending, delete the doc
      // to keep the collection small. Otherwise overwrite with current positions +
      // still-pending candidates.
      if (tick.positions.length === 0 && stillPending.length === 0) {
        if (snapshotByWallet.has(wallet)) {
          const delOk = await setMany([buildDeletePositionSnapshots(wallet)]);
          if (!delOk) console.warn(`[liquidation-detect] snapshot delete failed for ${wallet.slice(0, 8)}…`);
        }
        return;
      }

      const snapshotJson = JSON.stringify({
        positions: tick.positions,
        pending: stillPending,
      });
      const upOk = await setMany([
        buildUpdatePositionSnapshots(wallet, {
          trader: Address.publicKey(wallet),
          positions: snapshotJson,
          updatedAt: Time.Now,
        }),
      ]);
      if (!upOk) console.warn(`[liquidation-detect] snapshot write failed for ${wallet.slice(0, 8)}…`);
    }),
  );

  const failures = results.filter((r) => r.status === 'rejected').length;
  if (failures > 0) console.error(`[liquidation-detect] ${failures} traders failed to process`);

  const elapsed = Date.now() - startMs;
  console.log(
    `[liquidation-detect] Done in ${elapsed}ms — traders=${wallets.length} confirmed=${confirmed} newPending=${newPending} skippedErrored=${skippedErrored} failures=${failures}`,
  );
}
