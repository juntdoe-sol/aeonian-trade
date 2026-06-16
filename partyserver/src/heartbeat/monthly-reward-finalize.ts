/**
 * Heartbeat task: monthly-reward-finalize
 *
 * On the first run after a calendar-month boundary, finalizes the PRIOR
 * calendar month's prize pot IF it has not already been finalized.
 *
 * Idempotency
 * -----------
 * Finalization writes monthlyRewardWinners/<priorMonthKey> exactly once.
 * If that document already exists, the task returns immediately — so it can
 * safely run on any cron cadence (e.g. hourly) without double-finalizing.
 *
 * Flow
 * ----
 * 1. Compute priorMonthKey ("YYYY_MM", UTC) and potAccountId
 *    ("monthlyPot_<priorMonthKey>").
 * 2. If monthlyRewardWinners/<priorMonthKey> exists → already finalized, skip.
 * 3. Read the top-3 traders by rank from the MONTHLY pnlLeaderboard. If fewer
 *    than 3 ranked traders exist → SKIP (no partial winners).
 * 4. Sum every monthlyRewardDeposit matching potAccountId, grouped by mint.
 *    If the pot is empty → SKIP.
 * 5. Take up to MONTHLY_REWARD_MAX_TOKENS (5) distinct mints, ordered SOL-first
 *    then by mint string, assign to slots 1..5 with the full pot total per slot.
 * 6. Write the monthlyRewardWinners snapshot.
 * 7. Create 3 monthlyRewardAllotment docs (allotmentId = "<potAccountId>_<rank>")
 *    with claimed=false and amtN = rank% of totalN via integer math
 *    (multiply-before-divide): rank1 = (totalN*5000)//10000,
 *    rank2 = (totalN*3500)//10000, rank3 = (totalN*1500)//10000.
 *
 * The Heartbeat signs as PROJECT_VAULT_ADDRESS, which is the only authorized
 * writer for monthlyRewardWinners and monthlyRewardAllotment.
 */

import { getAllMonthlyRewardDeposit } from '../collections/monthlyRewardDeposit.js';
import {
  getMonthlyRewardWinners,
  setMonthlyRewardWinners,
} from '../collections/monthlyRewardWinners.js';
import { setMonthlyRewardAllotment } from '../collections/monthlyRewardAllotment.js';
import { getAllPnlLeaderboard } from '../collections/pnlLeaderboard.js';
import { Address, Time } from '../db-client.js';
import { SOL, MONTHLY_REWARD_MAX_TOKENS } from '../constants.js';
import { notifyMonthlyWinners } from '../utils/notify-monthly-winners.js';

const MAX_TOKENS = Number(MONTHLY_REWARD_MAX_TOKENS) || 5;

// rank-share basis points (out of 10000)
const RANK_BPS = [5000, 3500, 1500]; // rank1, rank2, rank3

/** Build "YYYY_MM" (UTC) for the calendar month immediately before `now`. */
function priorMonthKeyUTC(now: Date): string {
  // Move to the first day of the current month, then step back one day to land
  // in the prior month — robust across year boundaries.
  const firstOfThisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const prior = new Date(firstOfThisMonth - 1);
  const y = prior.getUTCFullYear();
  const m = prior.getUTCMonth() + 1; // 1-based
  return `${y}_${String(m).padStart(2, '0')}`;
}

export async function monthlyRewardFinalize(): Promise<void> {
  const startMs = Date.now();
  const now = new Date();
  const monthKey = priorMonthKeyUTC(now);
  const potAccountId = `monthlyPot_${monthKey}`;

  console.log(`[monthly-reward-finalize] Evaluating prior month ${monthKey} (pot=${potAccountId})`);

  // 1. Idempotency — already finalized?
  const existing = await getMonthlyRewardWinners(monthKey);
  if (existing) {
    console.log(`[monthly-reward-finalize] ${monthKey} already finalized, skipping.`);
    return;
  }

  // 2. Top-3 traders by rank on the MONTHLY leaderboard.
  const monthlyRows = await getAllPnlLeaderboard("where period = 'monthly'");
  const ranked = monthlyRows
    .filter((r) => typeof r.rank === 'number' && r.rank >= 1 && r.trader && r.trader.length >= 32)
    .sort((a, b) => a.rank - b.rank);

  if (ranked.length < 3) {
    console.log(`[monthly-reward-finalize] Only ${ranked.length} ranked monthly traders (<3) — SKIP, no partial winners.`);
    return;
  }
  const winners = ranked.slice(0, 3); // rank 1, 2, 3

  // 3. Sum deposits for this pot, grouped by mint.
  const allDeposits = await getAllMonthlyRewardDeposit();
  const potDeposits = allDeposits.filter((d) => d.potAccountId === potAccountId);

  if (potDeposits.length === 0) {
    console.log(`[monthly-reward-finalize] No deposits for ${potAccountId} — empty pot, SKIP.`);
    return;
  }

  const totalsByMint = new Map<string, number>();
  for (const d of potDeposits) {
    if (!d.mint) continue;
    const amt = Number(d.amount) || 0;
    if (amt <= 0) continue;
    totalsByMint.set(d.mint, (totalsByMint.get(d.mint) ?? 0) + amt);
  }

  if (totalsByMint.size === 0) {
    console.log(`[monthly-reward-finalize] All deposits for ${potAccountId} summed to 0 — SKIP.`);
    return;
  }

  // 4. Deterministic slot ordering: SOL first, then by mint string ascending.
  const mints = Array.from(totalsByMint.keys()).sort((a, b) => {
    if (a === SOL && b !== SOL) return -1;
    if (b === SOL && a !== SOL) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const cappedMints = mints.slice(0, MAX_TOKENS);
  if (mints.length > MAX_TOKENS) {
    console.warn(`[monthly-reward-finalize] ${mints.length} distinct mints exceeds cap ${MAX_TOKENS}; only the first ${MAX_TOKENS} will be paid out.`);
  }
  const tokenCount = cappedMints.length;

  // 5. Build the winners snapshot (full pot total per slot).
  const winnersDoc: Record<string, unknown> = {
    monthKey,
    potAccountId,
    winner1: Address.publicKey(winners[0].trader),
    winner2: Address.publicKey(winners[1].trader),
    winner3: Address.publicKey(winners[2].trader),
    tokenCount,
    finalizedAt: Time.Now,
  };
  cappedMints.forEach((mint, i) => {
    const slot = i + 1; // 1..5
    winnersDoc[`mint${slot}`] = Address.publicKey(mint);
    winnersDoc[`total${slot}`] = totalsByMint.get(mint) ?? 0;
  });

  const winnersOk = await setMonthlyRewardWinners(monthKey, winnersDoc as never);
  if (!winnersOk) {
    console.error(`[monthly-reward-finalize] Failed to write monthlyRewardWinners/${monthKey} — aborting before allotments.`);
    return;
  }
  console.log(`[monthly-reward-finalize] Wrote winners snapshot for ${monthKey}: ${tokenCount} token slot(s).`);

  // 6. Create the 3 allotment docs with rank-split integer amounts.
  let allotmentsWritten = 0;
  for (let r = 0; r < 3; r++) {
    const rank = r + 1; // 1..3
    const bps = RANK_BPS[r];
    const winner = winners[r].trader;
    const allotmentId = `${potAccountId}_${rank}`;

    const allotmentDoc: Record<string, unknown> = {
      monthKey,
      potAccountId,
      rank,
      winner: Address.publicKey(winner),
      claimed: false,
      // all 5 amt slots required — default to 0
      amt1: 0,
      amt2: 0,
      amt3: 0,
      amt4: 0,
      amt5: 0,
    };

    cappedMints.forEach((mint, i) => {
      const slot = i + 1; // 1..5
      const total = totalsByMint.get(mint) ?? 0;
      // multiply-before-divide integer math
      const share = Math.floor((total * bps) / 10000);
      allotmentDoc[`mint${slot}`] = Address.publicKey(mint);
      allotmentDoc[`amt${slot}`] = share;
    });

    const ok = await setMonthlyRewardAllotment(allotmentId, allotmentDoc as never);
    if (ok) {
      allotmentsWritten++;
    } else {
      console.error(`[monthly-reward-finalize] Failed to write allotment ${allotmentId} (rank ${rank}).`);
    }
  }

  // 7. Notify the 3 winners (best-effort). Runs inside the already-idempotent
  //    finalize path, so winners are notified exactly once. A failed notification
  //    must NOT abort or un-finalize the month — the winners + allotment docs are
  //    the source of truth. notifyMonthlyWinners never throws.
  let notified = 0;
  try {
    notified = await notifyMonthlyWinners(
      monthKey,
      winners.map((w, i) => ({ trader: w.trader, rank: i + 1 })),
    );
  } catch (err) {
    console.error(`[monthly-reward-finalize] winner notifications failed for ${monthKey}:`, err);
  }

  const elapsed = Date.now() - startMs;
  console.log(
    `[monthly-reward-finalize] Done in ${elapsed}ms — month=${monthKey} winners=3 allotments=${allotmentsWritten}/3 tokens=${tokenCount} notified=${notified}/3`,
  );
}
