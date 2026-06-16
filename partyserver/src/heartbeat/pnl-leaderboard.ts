/**
 * Heartbeat task: pnl-leaderboard
 *
 * Recomputes per-trader realized-PnL aggregates across four rolling windows
 * (daily, weekly, monthly, all-time) and upserts one pnlLeaderboard row per
 * trader per period. Designed to run every 15 minutes.
 *
 * PnL unit decision
 * ------------------
 * The Phoenix trades-history API returns `realizedPnl` and `fees` per fill.
 * The backfill route (/api/admin/backfill-trade-records, ~line 1810) interprets
 * `virtualQuoteLotsDelta` as whole-USD notional via Math.abs(virtualQuoteLotsDelta).
 * That route treats the raw number as already in USD (no lot-size conversion),
 * which is consistent with how Phoenix documents it: virtualQuoteLotsDelta is
 * the fill's USD-quoted value (base × price). We apply the same interpretation
 * to `realizedPnl` and `fees` — both are returned in whole USD by the API.
 * Net PnL per fill = realizedPnl − fees (both in USD), then multiply by 100
 * for cents: Math.round(netPnlUsd * 100).
 *
 * IMPORTANT: "all-time" is bounded by the API's pagination cap
 * (maxTradesPerWallet, currently 500 per run). Older trades beyond that cap
 * will not be reflected in the all-time aggregate until a larger backfill is run.
 */

import { getAllPhoenixTrader } from '../collections/phoenixTrader.js';
import { getAllPhoenixTradeRecord } from '../collections/phoenixTradeRecord.js';
import { getAllPhoenixIsoTrade } from '../collections/phoenixIsoTrade.js';
import { getAllPhoenixOrder } from '../collections/phoenixOrder.js';
import { setPnlLeaderboard } from '../collections/pnlLeaderboard.js';
import { getManyLeaderboardPrivacy } from '../collections/leaderboardPrivacy.js';
import { parseFillTimestampSec } from '../utils/parse-fill-timestamp.js';
import { Address, Time } from '../db-client.js';
import { PHOENIX_API_BASE_URL } from '../constants.js';

const MAX_TRADES_PER_WALLET = 500;
const PAGE_SIZE = 100;

// Rolling window cutoffs in seconds
const NOW_S = () => Math.floor(Date.now() / 1000);
const DAY_S = 86400;
const WEEK_S = 7 * DAY_S;
const MONTH_S = 30 * DAY_S;

type Period = 'daily' | 'weekly' | 'monthly' | 'all';

interface FillRecord {
  realizedPnl: number;
  fees: number;
  timestamp: number; // unix seconds
}

interface PeriodAggregate {
  realizedPnlUsdCents: number;
  tradeCount: number;
}

async function fetchFills(traderWallet: string): Promise<FillRecord[]> {
  const allFills: FillRecord[] = [];
  let before: string | undefined;

  while (allFills.length < MAX_TRADES_PER_WALLET) {
    const url = new URL(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(traderWallet)}/trades-history`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (before) url.searchParams.set('before', before);

    let pageData: unknown;
    try {
      const res = await fetch(url.toString());
      if (res.status === 404) break;
      if (!res.ok) {
        console.warn(`[pnl-leaderboard] Phoenix API ${res.status} for ${traderWallet.slice(0, 8)}… (before=${before ?? 'start'})`);
        break;
      }
      pageData = await res.json();
    } catch (fetchErr) {
      console.warn(`[pnl-leaderboard] Network error for ${traderWallet.slice(0, 8)}…: ${String(fetchErr)}`);
      break;
    }

    // Phoenix may return { trades:[...] }, { fills:[...] }, { data:[...] }, or bare array
    const page = Array.isArray(pageData)
      ? (pageData as Record<string, unknown>[])
      : Array.isArray((pageData as Record<string, unknown>).trades)
        ? ((pageData as Record<string, unknown>).trades as Record<string, unknown>[])
        : Array.isArray((pageData as Record<string, unknown>).fills)
          ? ((pageData as Record<string, unknown>).fills as Record<string, unknown>[])
          : Array.isArray((pageData as Record<string, unknown>).data)
            ? ((pageData as Record<string, unknown>).data as Record<string, unknown>[])
            : [];

    if (page.length === 0) break;

    for (const raw of page) {
      const r = raw as Record<string, unknown>;

      // realizedPnl and fees: both returned as whole USD by Phoenix API.
      // Convention matches how virtualQuoteLotsDelta is used in backfill route
      // (treated as whole-USD notional without any lot-size conversion).
      // First run will log a sample fill to confirm field availability.
      const realizedPnl = Number(r.realizedPnl ?? r.realized_pnl ?? r.pnl ?? 0);
      const fees = Number(r.fees ?? r.fee ?? r.tradeFee ?? r.trade_fee ?? 0);

      // Timestamp: prefer on-chain blockTime, fall through to other variants.
      // Phoenix returns `timestamp` as an ISO 8601 string — parse robustly to seconds.
      const rawTs = r.blockTime ?? r.timestamp ?? r.createdAt ?? r.created_at ?? r.time ?? 0;
      const ts = parseFillTimestampSec(rawTs);

      allFills.push({ realizedPnl, fees, timestamp: ts > 0 ? ts : NOW_S() });
    }

    if (allFills.length >= MAX_TRADES_PER_WALLET || page.length < PAGE_SIZE) break;

    // Advance cursor
    const last = page[page.length - 1] as Record<string, unknown>;
    const lastSig = (last.signature ?? last.txSignature ?? last.transactionSignature ?? last.tx) as string | undefined;
    if (!lastSig || lastSig === before) break;
    before = lastSig;
  }

  return allFills;
}

function computeAggregates(fills: FillRecord[], nowSec: number): Record<Period, PeriodAggregate> {
  const result: Record<Period, PeriodAggregate> = {
    daily: { realizedPnlUsdCents: 0, tradeCount: 0 },
    weekly: { realizedPnlUsdCents: 0, tradeCount: 0 },
    monthly: { realizedPnlUsdCents: 0, tradeCount: 0 },
    all: { realizedPnlUsdCents: 0, tradeCount: 0 },
  };

  for (const fill of fills) {
    // net PnL in USD, then convert to signed cents
    const netUsd = fill.realizedPnl - fill.fees;
    const netCents = Math.round(netUsd * 100);
    const age = nowSec - fill.timestamp;

    // always include in all-time
    result.all.realizedPnlUsdCents += netCents;
    result.all.tradeCount++;

    if (age <= DAY_S) {
      result.daily.realizedPnlUsdCents += netCents;
      result.daily.tradeCount++;
    }
    if (age <= WEEK_S) {
      result.weekly.realizedPnlUsdCents += netCents;
      result.weekly.tradeCount++;
    }
    if (age <= MONTH_S) {
      result.monthly.realizedPnlUsdCents += netCents;
      result.monthly.tradeCount++;
    }
  }

  return result;
}

export async function pnlLeaderboard(): Promise<void> {
  console.log('[pnl-leaderboard] Starting PnL leaderboard computation...');
  const startMs = Date.now();

  // 1. Build the complete set of traders from four sources:
  //    a) phoenixTrader collection (registration-gated)
  //    b) phoenixIsoTrade collection (isolated-margin trades — current path)
  //    c) phoenixOrder collection (cross-margin trades — current path)
  //    d) phoenixTradeRecord collection (legacy verified records, no longer written)
  //   Isolated-only traders who never formally registered would otherwise drop off,
  //   since isolated trades no longer write phoenixTradeRecord.
  const [registeredTraders, isoTrades, orders, tradeRecords] = await Promise.all([
    getAllPhoenixTrader(),
    getAllPhoenixIsoTrade(),
    getAllPhoenixOrder(),
    getAllPhoenixTradeRecord(),
  ]);

  // Union: start with registered trader IDs, then add any trader address from
  // the trade collections that isn't already in the set.
  const walletSet = new Set<string>();
  for (const t of registeredTraders) {
    if (t.id && typeof t.id === 'string' && t.id.length >= 32) {
      walletSet.add(t.id);
    }
  }
  for (const t of isoTrades) {
    if (t.trader && typeof t.trader === 'string' && t.trader.length >= 32) {
      walletSet.add(t.trader);
    }
  }
  for (const o of orders) {
    if (o.trader && typeof o.trader === 'string' && o.trader.length >= 32) {
      walletSet.add(o.trader);
    }
  }
  for (const r of tradeRecords) {
    if (r.trader && typeof r.trader === 'string' && r.trader.length >= 32) {
      walletSet.add(r.trader);
    }
  }

  const wallets = Array.from(walletSet);
  if (wallets.length === 0) {
    console.log('[pnl-leaderboard] No traders found in either collection, exiting.');
    return;
  }
  console.log(
    `[pnl-leaderboard] Processing ${wallets.length} traders ` +
    `(${registeredTraders.length} registered + ${walletSet.size - registeredTraders.filter(t => t.id?.length >= 32).length} from trade records only)`
  );

  const nowSec = NOW_S();
  const periods: Period[] = ['daily', 'weekly', 'monthly', 'all'];

  // 2. Fetch all fills in parallel — collect true PnL per wallet per period
  let sampleLogged = false;
  const walletAggregates = new Map<string, Record<Period, PeriodAggregate>>();

  const fillResults = await Promise.allSettled(
    wallets.map(async (wallet) => {
      if (!wallet || typeof wallet !== 'string' || wallet.length < 32) return;
      const fills = await fetchFills(wallet);
      if (!sampleLogged && fills.length > 0) {
        sampleLogged = true;
        console.log('[pnl-leaderboard] Sample fill fields (first fill of first wallet with data):', JSON.stringify({
          realizedPnl: fills[0].realizedPnl,
          fees: fills[0].fees,
          timestamp: fills[0].timestamp,
        }));
      }
      walletAggregates.set(wallet, computeAggregates(fills, nowSec));
    })
  );
  const fillErrors = fillResults.filter((r) => r.status === 'rejected').length;
  if (fillErrors > 0) {
    console.error(`[pnl-leaderboard] ${fillErrors} wallets failed fill fetch`);
  }

  // 3. Batch-read all privacy preferences in one call (per project convention: no Promise.all of individual gets)
  const allPrivacyDocs = await getManyLeaderboardPrivacy();
  const privacyMap = new Map<string, boolean>();
  for (const doc of allPrivacyDocs) {
    // doc.id is the wallet address (the document key)
    if (doc.id) privacyMap.set(doc.id, doc.hidePnl === true);
  }

  // 4. For each period, compute 1-based ranks from TRUE PnL ordering (before any withholding),
  //    then write rows with rank, pnlHidden, and conditionally withheld realizedPnlUsdCents.
  let rowsWritten = 0;
  let writeErrors = 0;

  for (const period of periods) {
    // Build a sorted list by true realized PnL descending — only wallets with data
    const periodRows: Array<{ wallet: string; truePnlCents: number; tradeCount: number }> = [];
    for (const wallet of wallets) {
      const agg = walletAggregates.get(wallet);
      if (!agg) continue;
      periodRows.push({
        wallet,
        truePnlCents: agg[period].realizedPnlUsdCents,
        tradeCount: agg[period].tradeCount,
      });
    }
    // Sort descending by true PnL — determines rank before any privacy masking
    periodRows.sort((a, b) => b.truePnlCents - a.truePnlCents);

    // Write each row with its true rank and privacy-aware PnL
    const writeResults = await Promise.allSettled(
      periodRows.map(async (row, idx) => {
        const rank = idx + 1; // 1-based
        const pnlHidden = privacyMap.get(row.wallet) ?? false;
        // When hidden, write 0 as the PnL placeholder — the real value must never
        // land in the public collection for hidden users.
        const publicPnlCents = pnlHidden ? 0 : row.truePnlCents;

        const entryId = `${period}:${row.wallet}`;
        const success = await setPnlLeaderboard(entryId, {
          trader: Address.publicKey(row.wallet),
          period,
          realizedPnlUsdCents: publicPnlCents,
          tradeCount: row.tradeCount,
          updatedAt: Time.Now,
          rank,
          pnlHidden,
        });
        if (success) {
          rowsWritten++;
        } else {
          console.warn(`[pnl-leaderboard] Write failed: ${entryId}`);
          writeErrors++;
        }
      })
    );
    const periodRejections = writeResults.filter((r) => r.status === 'rejected').length;
    writeErrors += periodRejections;
  }

  const elapsed = Date.now() - startMs;
  const processed = walletAggregates.size;
  console.log(
    `[pnl-leaderboard] Done in ${elapsed}ms — traders=${wallets.length} processed=${processed} rowsWritten=${rowsWritten} errors=${fillErrors + writeErrors}`
  );
}
