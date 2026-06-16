/**
 * Fetches live trading data for an ARBITRARY trader wallet (not just the logged-in
 * user) so the UserProfilePopup can render anyone's PnL and activity.
 *
 * Reuses the same public Phoenix endpoints the rest of the app consumes:
 *   - /api/phoenix/trader/:address            → unrealized PnL + collateral
 *   - /api/phoenix/trader/:address/trades-history → fills (the SAME source the
 *     pnl-leaderboard heartbeat trusts)
 *
 * Field-shape reality (see .claude/memory/reference_phoenix_trades_history_notional.md):
 *   The trades-history upstream does NOT return `size` or `side`, and `timestamp`
 *   is an ISO 8601 STRING. The authoritative per-fill fields are:
 *     baseLotsDelta, virtualQuoteLotsDelta, price, realizedPnl, fees, liquidity, timestamp
 *   A per-fill `symbol`/`market` is usually NOT present, so we can't reliably FIFO-key
 *   lots per market.
 *
 * Approach (mirrors the leaderboard heartbeat's source of truth):
 *   - REALIZED 24h/7d/30d windows: sum (realizedPnl − fees) over fills whose parsed
 *     timestamp falls in each window. This matches partyserver/src/heartbeat/
 *     pnl-leaderboard.ts exactly and does NOT depend on FIFO symbol-keying.
 *   - RECENT TRADES list: built directly from CLOSING fills (those with a non-zero
 *     realizedPnl), since per-fill symbol isn't reliable enough for correct FIFO
 *     entry/exit pairing. Each closing fill becomes one activity row.
 */

import { api } from '@/lib/api-client';
import type { ClosedTrade } from '@/utils/trade-computations';
import type { TradeFill } from '@/components/trading/types';
import { parseFillTimestampSec } from '@/utils/parse-fill-timestamp';
import { toNumber, mapPosition, type TraderData, type RisePosition } from '@/utils/phoenix-mappers';
import {
  getManyPhoenixTradeRecord,
  type PhoenixTradeRecordResponse,
} from '@/lib/collections/phoenixTradeRecord';

/** A trader's currently-open position, flattened + enriched for the profile popup. */
export interface OpenPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  /** Live unrealized PnL (USD) for this position. */
  unrealizedPnl: number;
  /** Effective leverage (positionValue / initialMargin), or null when not computable. */
  leverage: number | null;
}

export interface TraderProfileData {
  /** Currently-open positions across all sub-accounts, newest/biggest-first. */
  openPositions: OpenPosition[];
  /** Live unrealized PnL in USD (from open positions), or null if unavailable. */
  unrealizedPnl: number | null;
  /** Realized PnL (USD) over rolling windows, summed from per-fill realizedPnl − fees. */
  realized24h: number;
  realized7d: number;
  realized30d: number;
  /** Closing fills as activity rows, newest-first (each with its own realized PnL). */
  closedTrades: ClosedTrade[];
  /** Raw fills newest-first (fallback activity when no closed trades resolved). */
  fills: TradeFill[];
  /** True if the Phoenix API had no record of this wallet (404). */
  notFound: boolean;
}

const DAY_S = 86400;
const WEEK_S = 7 * DAY_S;
const MONTH_S = 30 * DAY_S;

/** Tolerance (seconds) for matching a live fill to a DB phoenixTradeRecord by time. */
const RECORD_MATCH_WINDOW_S = 90;

/** Strict base58 charset validation before interpolating into a where-clause. */
function isValidBase58Address(addr: string | undefined): addr is string {
  return !!addr && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/** A phoenixTradeRecord reduced to what's needed to recover a fill's real symbol. */
interface SymbolRecord {
  /** Raw stored symbol, e.g. 'SOL-PERP' (kept raw so the popup's -PERP strip works). */
  symbol: string;
  /** Normalized side: 'long' | 'short' (record stores lowercase). */
  side: 'long' | 'short';
  /** Order-placement time in unix seconds (record.createdAt is Time.Now seconds). */
  timestamp: number;
}

/** A raw Phoenix fill normalized into the numeric shape the popup needs. */
export interface NormalizedFill {
  symbol: string;
  /** 'long' = positive baseLotsDelta (buy), 'short' = negative (sell). */
  side: 'long' | 'short';
  /** Magnitude of baseLotsDelta. */
  size: number;
  price: number;
  realizedPnl: number;
  fees: number;
  /** Unix seconds (parsed from the ISO-string upstream timestamp). */
  timestamp: number;
}

/** Pull the fills array out of whatever envelope the upstream/backend returns. */
function unwrapFills(raw: unknown): TradeFill[] {
  if (Array.isArray(raw)) return raw as TradeFill[];
  const r = raw as Record<string, unknown> | null | undefined;
  return ((r?.trades ?? r?.fills ?? r?.data ?? []) as TradeFill[]) ?? [];
}

/**
 * Normalize raw Phoenix fills into NormalizedFill.
 *
 * - size  ← |baseLotsDelta|
 * - side  ← sign of baseLotsDelta (>= 0 → long, < 0 → short)
 * - price ← price
 * - realizedPnl / fees ← passed through (whole USD per the API)
 * - timestamp ← ISO string parsed to unix seconds (reuses parseFillTimestampSec)
 *
 * A per-fill symbol is mapped through only if the upstream actually provides one
 * (symbol / market / pair); otherwise it falls back to a generic 'PERP' label so
 * the activity row still renders a meaningful pill.
 */
export function normalizeFills(raw: TradeFill[]): NormalizedFill[] {
  const out: NormalizedFill[] = [];
  for (const f of raw) {
    if (!f) continue;
    const baseDelta = Number(f.baseLotsDelta ?? 0);
    const size = Math.abs(baseDelta);
    const side: 'long' | 'short' = baseDelta >= 0 ? 'long' : 'short';
    const price = Number(f.price ?? 0);
    const realizedPnl = Number(f.realizedPnl ?? 0);
    const fees = Number(f.fees ?? f.fee ?? 0);
    const timestamp = parseFillTimestampSec(f.timestamp);

    const rawSymbol = (f.symbol ?? f.market ?? f.pair ?? '') as string;
    const symbol = rawSymbol ? String(rawSymbol).toUpperCase() : 'PERP';

    out.push({ symbol, side, size, price, realizedPnl, fees, timestamp });
  }
  return out;
}

/**
 * Load this trader's phoenixTradeRecord docs and reduce them to SymbolRecords.
 *
 * Reuses the SAME query pattern the "My Trades" tab uses (UserActivityPanel):
 *   `where trader = '<address>'` with strict base58 validation before interpolation.
 * That tab subscribes for the logged-in user; here we adapt the same filter to the
 * arbitrary target trader and do a one-shot getMany (no live subscription needed).
 *
 * NOTE: phoenixTradeRecord only covers Aeonian-placed trades and EXCLUDES cross-margin
 * trades, so it will not cover every live fill — that gap is expected and handled by
 * the 'PERP' fallback in enrichSymbol().
 */
async function loadSymbolRecords(address: string): Promise<SymbolRecord[]> {
  if (!isValidBase58Address(address)) return [];
  try {
    const docs = await getManyPhoenixTradeRecord(`where trader = '${address}'`);
    const out: SymbolRecord[] = [];
    for (const d of docs ?? []) {
      const sym = (d as PhoenixTradeRecordResponse).symbol;
      if (!sym) continue;
      const side: 'long' | 'short' =
        String((d as PhoenixTradeRecordResponse).side).toLowerCase() === 'short' ? 'short' : 'long';
      out.push({ symbol: String(sym), side, timestamp: Number(d.createdAt ?? 0) });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Recover the real raw symbol (e.g. 'SOL-PERP') for a normalized fill by matching it
 * to a phoenixTradeRecord. Match = same side AND record.createdAt within
 * RECORD_MATCH_WINDOW_S of the fill timestamp (both in unix seconds). Returns the
 * record's RAW symbol on a match (so UserProfilePopup's -PERP strip still applies),
 * or the original fill symbol (the 'PERP' fallback) when nothing matches. Price is
 * never used to infer the pair — only an explicit record match upgrades the label.
 */
function enrichSymbol(
  fillSide: 'long' | 'short',
  fillTs: number,
  records: SymbolRecord[],
): string | null {
  let best: SymbolRecord | null = null;
  let bestDelta = Infinity;
  for (const r of records) {
    if (r.side !== fillSide) continue;
    const delta = Math.abs(r.timestamp - fillTs);
    if (delta <= RECORD_MATCH_WINDOW_S && delta < bestDelta) {
      best = r;
      bestDelta = delta;
    }
  }
  return best ? best.symbol : null;
}

/**
 * Map the raw TraderData.positions union into the compact OpenPosition shape the
 * profile popup renders. Reuses mapPosition() (the same flattening PositionsTable
 * relies on) for symbol/side/size/entryPrice/pnl, and derives effective leverage
 * from positionValue / initialMargin (both TokenAmounts on RisePosition). Filters
 * out dust / closed entries (zero size).
 */
function mapOpenPositions(positions: RisePosition[] | undefined): OpenPosition[] {
  if (!Array.isArray(positions)) return [];
  const out: OpenPosition[] = [];
  for (const raw of positions) {
    const flat = mapPosition(raw);
    const size = flat.size ?? 0;
    if (!(size > 0)) continue; // skip empty/closed entries
    const positionValue = toNumber(raw.positionValue);
    const initialMargin = toNumber(raw.initialMargin);
    const leverage = initialMargin > 0 && positionValue > 0 ? positionValue / initialMargin : null;
    out.push({
      symbol: flat.symbol ?? '',
      side: flat.side === 'short' ? 'short' : 'long',
      size,
      entryPrice: flat.entryPrice ?? 0,
      unrealizedPnl: flat.pnl ?? 0,
      leverage,
    });
  }
  // Largest first so the most meaningful exposure leads.
  return out.sort((a, b) => Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl));
}

/**
 * Fetch + compute everything the profile popup needs for `address`.
 * Never throws — returns a result object; `notFound` flags a Phoenix 404.
 */
export async function fetchTraderProfile(address: string): Promise<TraderProfileData> {
  const empty: TraderProfileData = {
    openPositions: [],
    unrealizedPnl: null,
    realized24h: 0,
    realized7d: 0,
    realized30d: 0,
    closedTrades: [],
    fills: [],
    notFound: false,
  };

  const [stateResult, fillsResult, recordsResult] = await Promise.allSettled([
    api.get<TraderData>(`/api/phoenix/trader/${address}`),
    api.get<unknown>(`/api/phoenix/trader/${address}/trades-history?limit=500`),
    loadSymbolRecords(address),
  ]);

  // DB-backed pair records (Aeonian trades only; excludes cross-margin). Used to
  // recover the real symbol for live fills — falls back to 'PERP' when unmatched.
  const symbolRecords: SymbolRecord[] =
    recordsResult.status === 'fulfilled' ? recordsResult.value : [];

  // ── Unrealized PnL + open positions from trader state ───────────────────────
  let unrealizedPnl: number | null = null;
  let openPositions: OpenPosition[] = [];
  let notFound = false;
  if (stateResult.status === 'fulfilled') {
    const data = stateResult.value;
    // unrealizedPnl is a TokenAmount on TraderData; read its numeric value.
    if (data?.unrealizedPnl) {
      unrealizedPnl = toNumber(data.unrealizedPnl);
    }
    openPositions = mapOpenPositions(data?.positions);
  } else {
    const msg = stateResult.reason instanceof Error ? stateResult.reason.message : String(stateResult.reason ?? '');
    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      notFound = true;
    }
  }

  // ── Fills → rolling realized PnL + recent-trade activity rows ───────────────
  let closedTrades: ClosedTrade[] = [];
  let rawFills: TradeFill[] = [];
  let realized24h = 0;
  let realized7d = 0;
  let realized30d = 0;

  if (fillsResult.status === 'fulfilled') {
    rawFills = unwrapFills(fillsResult.value);
    const normalized = normalizeFills(rawFills);

    const nowSec = Math.floor(Date.now() / 1000);

    // Realized windows: sum (realizedPnl − fees) per window. Mirrors the
    // pnl-leaderboard heartbeat's computeAggregates() exactly.
    for (const f of normalized) {
      const netUsd = f.realizedPnl - f.fees;
      if (netUsd === 0) continue; // non-closing fills contribute nothing
      const age = nowSec - f.timestamp;
      if (age <= DAY_S) realized24h += netUsd;
      if (age <= WEEK_S) realized7d += netUsd;
      if (age <= MONTH_S) realized30d += netUsd;
    }

    // Recent trades: each CLOSING fill (non-zero realizedPnl) is one row.
    // We render the fill directly rather than FIFO-pairing, because per-fill
    // symbol isn't reliably present to key lots per market.
    closedTrades = normalized
      .filter((f) => f.realizedPnl !== 0)
      .sort((a, b) => b.timestamp - a.timestamp) // newest-first
      .map((f) => ({
        // Prefer the real pair from our DB record (raw 'SOL-PERP' form, so the
        // popup's -PERP strip yields a bare 'SOL'); keep the 'PERP' fallback when
        // there's no matching record (cross-margin / non-Aeonian trades).
        symbol: enrichSymbol(f.side, f.timestamp, symbolRecords) ?? f.symbol,
        side: f.side === 'long' ? 'Long' : 'Short',
        entryPrice: f.price,
        exitPrice: f.price,
        size: f.size,
        realizedPnl: f.realizedPnl - f.fees,
        timestamp: f.timestamp,
      }));
  }

  return {
    ...empty,
    openPositions,
    unrealizedPnl,
    realized24h,
    realized7d,
    realized30d,
    closedTrades,
    fills: rawFills,
    notFound,
  };
}
