/**
 * Battle Resolver Heartbeat Task
 *
 * Runs every ~30 seconds (cron: "* * * * *" — every minute, platform minimum).
 * Responsibilities:
 *   0. Scans pending royal-rumble battles → activates if minParticipants met, cancels if >5 days old
 *   1. Scans pending head-to-head battles with 2 participants joined → marks them active
 *   2. Scans active head-to-head battles past endTime → resolves winner via Phoenix PnL, claims pot
 *   3. Scans active royal-rumble battles past endTime → resolves top 3 winners via Phoenix PnL, creates rumble claim
 */

import { getManyBattles, updateBattles, type BattlesResponse } from '../collections/battles.js';
import { getManyBattleParticipants, type BattleParticipantsResponse } from '../collections/battleParticipants.js';
import { getManyPotContributions, type PotContributionsResponse } from '../collections/potContributions.js';
import { setBattleClaims } from '../collections/battleClaims.js';
import { setRumbleClaims } from '../collections/rumbleClaims.js';
import { setBattleRefunds } from '../collections/battleRefunds.js';
import { Address } from '../db-client.js';
import { PHOENIX_API_BASE_URL } from '../constants.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TokenAmount {
  value: number;
  decimals: number;
  ui: string;
}

interface TraderData {
  portfolioValue: TokenAmount;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(t: TokenAmount | null | undefined): number {
  if (!t) return 0;
  const parsed = parseFloat(t.ui);
  return isNaN(parsed) ? 0 : parsed;
}

async function fetchPhoenixPortfolioMicro(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`${PHOENIX_API_BASE_URL}/trader/${encodeURIComponent(wallet)}/state`);
    if (!res.ok) return null;
    const body = await res.json() as { traders?: TraderData[] };
    const trader = Array.isArray(body.traders) && body.traders.length > 0 ? body.traders[0] : null;
    if (!trader) return null;
    const portfolioUsd = toNumber(trader.portfolioValue);
    return Math.round(portfolioUsd * 1_000_000);
  } catch (err) {
    console.error(`[battle-resolver] fetchPhoenixPortfolioMicro(${wallet}) failed:`, err);
    return null;
  }
}

// ─── Phase 0: Activate / Cancel Royal Rumbles ─────────────────────────────────

async function activateRoyalRumbles(
  battles: BattlesResponse[],
  allParticipants: BattleParticipantsResponse[],
): Promise<void> {
  const pendingRumbles = battles.filter((b) => b.type === 'royalrumble' && b.status === 'pending');
  if (pendingRumbles.length === 0) {
    console.log('[battle-resolver] No pending royal rumbles to check');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const fiveDaysSeconds = 432_000;

  for (const battle of pendingRumbles) {
    try {
      const participants = allParticipants.filter((p) => p.battleId === battle.id);
      const minNeeded = battle.minParticipants ?? 5;

      // Cancel if pending too long
      if (battle.createdAt > 0 && now - battle.createdAt > fiveDaysSeconds) {
        console.log(`[battle-resolver] Cancelling expired rumble ${battle.id} (${participants.length} participants, pending >5d)`);

        // Create refund record for each participant
        for (const p of participants) {
          const refundId = `${battle.id}_${p.wallet}`;
          const refundOk = await setBattleRefunds(refundId, {
            battleId: battle.id,
            wallet: Address.publicKey(p.wallet),
            amountMicro: p.betAmountMicro,
            refundedAt: now,
          });
          if (!refundOk) {
            console.warn(`[battle-resolver] Failed to create refund for ${p.wallet.slice(0, 8)}… in rumble ${battle.id}`);
          }
        }

        const cancelOk = await updateBattles(battle.id, { status: 'cancelled' });
        if (cancelOk) {
          console.log(`[battle-resolver] Rumble ${battle.id} cancelled with refunds`);
        } else {
          console.warn(`[battle-resolver] Failed to cancel rumble ${battle.id}`);
        }
        continue;
      }

      // Activate if min participants met
      if (participants.length >= minNeeded) {
        const startTime = now;
        const endTime = now + battle.durationSeconds;
        console.log(`[battle-resolver] Activating royal rumble ${battle.id} (${participants.length}/${battle.maxParticipants ?? '?'} fighters)`);

        const ok = await updateBattles(battle.id, {
          status: 'active',
          startTime,
          endTime,
        });

        if (ok) {
          console.log(`[battle-resolver] Rumble ${battle.id} activated — ends at ${new Date(endTime * 1000).toISOString()}`);
        } else {
          console.warn(`[battle-resolver] Failed to activate rumble ${battle.id}`);
        }
      }
    } catch (err) {
      console.error(`[battle-resolver] Error processing rumble ${battle.id}:`, err);
    }
  }
}

// ─── Phase 1: Activate pending head-to-head battles ───────────────────────────

async function activatePendingBattles(
  battles: BattlesResponse[],
  allParticipants: BattleParticipantsResponse[],
): Promise<void> {
  const pendingBattles = battles.filter((b) => b.status === 'pending' && b.type !== 'royalrumble');

  if (pendingBattles.length === 0) {
    console.log('[battle-resolver] No pending head-to-head battles to check');
    return;
  }

  console.log(`[battle-resolver] Checking ${pendingBattles.length} pending battle(s)`);

  for (const battle of pendingBattles) {
    try {
      const participants = allParticipants.filter((p) => p.battleId === battle.id);
      if (participants.length < 2) continue;

      const challengerJoined = participants.some((p) => p.wallet === battle.challenger);
      const opponentParticipant = participants.find((p) => p.wallet !== battle.challenger);

      if (!challengerJoined || !opponentParticipant) continue;

      const now = Math.floor(Date.now() / 1000);
      const startTime = now;
      const endTime = now + battle.durationSeconds;

      // Determine opponent wallet (may not be set on the battle record yet for open challenges)
      const opponentWallet = opponentParticipant.wallet;

      console.log(`[battle-resolver] Activating battle ${battle.id} (opponent: ${opponentWallet.slice(0, 8)}…)`);

      const ok = await updateBattles(battle.id, {
        status: 'active',
        startTime,
        endTime,
        // Set opponent on battle record if it was an open challenge
        ...(battle.opponent ? {} : { opponent: Address.publicKey(opponentWallet) }),
        ...(battle.opponentXHandle ? {} : {
          opponentXHandle: opponentParticipant.xHandle ?? undefined,
        }),
      });

      if (ok) {
        console.log(`[battle-resolver] Battle ${battle.id} activated — ends at ${new Date(endTime * 1000).toISOString()}`);
      } else {
        console.warn(`[battle-resolver] Failed to activate battle ${battle.id}`);
      }
    } catch (err) {
      console.error(`[battle-resolver] Error activating battle ${battle.id}:`, err);
    }
  }
}

// ─── Phase 2: Resolve ended head-to-head battles ──────────────────────────────

async function resolveEndedBattles(
  battles: BattlesResponse[],
  allParticipants: BattleParticipantsResponse[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiredBattles = battles.filter(
    (b) => b.status === 'active' && b.type !== 'royalrumble' && b.endTime > 0 && b.endTime <= now,
  );

  if (expiredBattles.length === 0) {
    console.log('[battle-resolver] No active head-to-head battles past end time');
    return;
  }

  console.log(`[battle-resolver] Resolving ${expiredBattles.length} expired battle(s)`);

  for (const battle of expiredBattles) {
    try {
      await resolveBattle(battle, allParticipants, now);
    } catch (err) {
      console.error(`[battle-resolver] Error resolving battle ${battle.id}:`, err);
    }
  }
}

async function resolveBattle(
  battle: BattlesResponse,
  allParticipants: BattleParticipantsResponse[],
  now: number,
): Promise<void> {
  const participants = allParticipants.filter((p) => p.battleId === battle.id);
  if (participants.length < 2) {
    console.warn(`[battle-resolver] Battle ${battle.id} has <2 participants — skipping`);
    return;
  }

  const challengerParticipant = participants.find((p) => p.wallet === battle.challenger);
  const opponentParticipant = participants.find((p) => p.wallet === battle.opponent);

  if (!challengerParticipant || !opponentParticipant) {
    console.warn(`[battle-resolver] Battle ${battle.id} missing participant data`);
    return;
  }

  console.log(`[battle-resolver] Fetching Phoenix equity for battle ${battle.id}`);

  // Fetch current portfolio values
  const [challengerCurrentMicro, opponentCurrentMicro] = await Promise.all([
    fetchPhoenixPortfolioMicro(challengerParticipant.wallet),
    fetchPhoenixPortfolioMicro(opponentParticipant.wallet),
  ]);

  // Compute PnL %
  const challengerPnlPct = challengerParticipant.equityAtStartMicro > 0 && challengerCurrentMicro !== null
    ? (challengerCurrentMicro - challengerParticipant.equityAtStartMicro) / challengerParticipant.equityAtStartMicro
    : null;

  const opponentPnlPct = opponentParticipant.equityAtStartMicro > 0 && opponentCurrentMicro !== null
    ? (opponentCurrentMicro - opponentParticipant.equityAtStartMicro) / opponentParticipant.equityAtStartMicro
    : null;

  // Determine winner — challenger wins on tie or if equity data unavailable for both
  let winnerWallet = challengerParticipant.wallet;
  if (challengerPnlPct !== null && opponentPnlPct !== null) {
    winnerWallet = opponentPnlPct > challengerPnlPct
      ? opponentParticipant.wallet
      : challengerParticipant.wallet;
  } else if (challengerPnlPct === null && opponentPnlPct !== null) {
    // Only opponent data available — opponent wins
    winnerWallet = opponentParticipant.wallet;
  }
  // else: challenger wins (default)

  console.log(
    `[battle-resolver] Battle ${battle.id}: challenger PnL=${challengerPnlPct?.toFixed(4) ?? 'N/A'}% ` +
    `opponent PnL=${opponentPnlPct?.toFixed(4) ?? 'N/A'}% → winner=${winnerWallet.slice(0, 8)}…`,
  );

  // Mark battle ended with winner
  const endOk = await updateBattles(battle.id, {
    status: 'ended',
    winner: Address.publicKey(winnerWallet),
  });

  if (!endOk) {
    console.warn(`[battle-resolver] Failed to mark battle ${battle.id} as ended`);
    return;
  }

  // Create battleClaims record → triggers on-chain payout to winner
  const claimOk = await setBattleClaims(battle.id, {
    battleId: battle.id,
    winner: Address.publicKey(winnerWallet),
    betAmountMicro: battle.betAmountMicro,
    claimedAt: now,
  });

  if (!claimOk) {
    console.warn(`[battle-resolver] Failed to create claim for battle ${battle.id} — payout not sent`);
    return;
  }

  // Mark battle as claimed
  const claimedOk = await updateBattles(battle.id, { status: 'claimed' });
  if (!claimedOk) {
    console.warn(`[battle-resolver] Failed to mark battle ${battle.id} as claimed (claim was created — payout sent)`);
  }

  console.log(`[battle-resolver] Battle ${battle.id} resolved and claimed for winner ${winnerWallet.slice(0, 8)}…`);
}

// ─── Phase 3: Resolve ended Royal Rumbles ─────────────────────────────────────

async function resolveEndedRumbles(
  battles: BattlesResponse[],
  allParticipants: BattleParticipantsResponse[],
  allContributions: PotContributionsResponse[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiredRumbles = battles.filter(
    (b) => b.type === 'royalrumble' && b.status === 'active' && b.endTime > 0 && b.endTime <= now,
  );

  if (expiredRumbles.length === 0) {
    console.log('[battle-resolver] No active royal rumbles past end time');
    return;
  }

  console.log(`[battle-resolver] Resolving ${expiredRumbles.length} expired rumble(s)`);

  for (const battle of expiredRumbles) {
    try {
      await resolveRumble(battle, allParticipants, allContributions, now);
    } catch (err) {
      console.error(`[battle-resolver] Error resolving rumble ${battle.id}:`, err);
    }
  }
}

async function resolveRumble(
  battle: BattlesResponse,
  allParticipants: BattleParticipantsResponse[],
  allContributions: PotContributionsResponse[],
  now: number,
): Promise<void> {
  const participants = allParticipants.filter((p) => p.battleId === battle.id);

  if (participants.length < 3) {
    console.warn(`[battle-resolver] Rumble ${battle.id} has <3 participants — cancelling with refunds`);
    for (const p of participants) {
      const refundId = `${battle.id}_${p.wallet}`;
      await setBattleRefunds(refundId, {
        battleId: battle.id,
        wallet: Address.publicKey(p.wallet),
        amountMicro: p.betAmountMicro,
        refundedAt: now,
      });
    }
    await updateBattles(battle.id, { status: 'cancelled' });
    return;
  }

  console.log(`[battle-resolver] Fetching Phoenix equity for rumble ${battle.id} (${participants.length} fighters)`);

  // Fetch current portfolio for each participant and compute PnL%
  const results = await Promise.all(
    participants.map(async (p) => {
      const currentMicro = await fetchPhoenixPortfolioMicro(p.wallet);
      const pnlPct = p.equityAtStartMicro > 0 && currentMicro !== null
        ? (currentMicro - p.equityAtStartMicro) / p.equityAtStartMicro
        : null;
      return { participant: p, currentMicro, pnlPct };
    }),
  );

  // Sort by PnL% descending, filtering out nulls at the end
  const valid = results
    .filter((r) => r.pnlPct !== null)
    .sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));

  const invalid = results.filter((r) => r.pnlPct === null);

  // Need at least 3 valid results; if not enough, append invalids arbitrarily
  const ranked = [...valid, ...invalid];

  if (ranked.length < 3) {
    console.warn(`[battle-resolver] Rumble ${battle.id} has <3 ranked participants — cancelling with refunds`);
    for (const p of participants) {
      const refundId = `${battle.id}_${p.wallet}`;
      await setBattleRefunds(refundId, {
        battleId: battle.id,
        wallet: Address.publicKey(p.wallet),
        amountMicro: p.betAmountMicro,
        refundedAt: now,
      });
    }
    await updateBattles(battle.id, { status: 'cancelled' });
    return;
  }

  const winner1 = ranked[0].participant;
  const winner2 = ranked[1].participant;
  const winner3 = ranked[2].participant;

  // Compute total pot
  const participantBetSum = participants.reduce((sum, p) => sum + p.betAmountMicro, 0);
  const contributionSum = allContributions
    .filter((c) => c.battleId === battle.id)
    .reduce((sum, c) => sum + c.amountMicro, 0);
  const totalPotMicro = participantBetSum + contributionSum;

  console.log(
    `[battle-resolver] Rumble ${battle.id}: 1st=${winner1.wallet.slice(0, 8)}… PnL=${(ranked[0].pnlPct ?? 0).toFixed(4)}% ` +
    `2nd=${winner2.wallet.slice(0, 8)}… PnL=${(ranked[1].pnlPct ?? 0).toFixed(4)}% ` +
    `3rd=${winner3.wallet.slice(0, 8)}… PnL=${(ranked[2].pnlPct ?? 0).toFixed(4)}% ` +
    `pot=$${(totalPotMicro / 1_000_000).toFixed(2)}`,
  );

  // Mark battle ended
  const endOk = await updateBattles(battle.id, {
    status: 'ended',
    winner: Address.publicKey(winner1.wallet),
  });
  if (!endOk) {
    console.warn(`[battle-resolver] Failed to mark rumble ${battle.id} as ended`);
    return;
  }

  // Create rumbleClaims record → triggers on-chain payout split
  const claimOk = await setRumbleClaims(battle.id, {
    battleId: battle.id,
    winner1: Address.publicKey(winner1.wallet),
    winner2: Address.publicKey(winner2.wallet),
    winner3: Address.publicKey(winner3.wallet),
    totalPotMicro,
    claimedAt: now,
  });

  if (!claimOk) {
    console.warn(`[battle-resolver] Failed to create rumble claim for ${battle.id} — payout not sent`);
    return;
  }

  // Mark battle as claimed
  const claimedOk = await updateBattles(battle.id, { status: 'claimed' });
  if (!claimedOk) {
    console.warn(`[battle-resolver] Failed to mark rumble ${battle.id} as claimed (claim was created — payout sent)`);
  }

  console.log(`[battle-resolver] Rumble ${battle.id} resolved and claimed`);
}

// ─── Main exported handler ────────────────────────────────────────────────────

export async function battleResolver(): Promise<void> {
  console.log('[battle-resolver] Starting…');

  // Fetch all battles + participants + contributions in parallel
  const [battles, allParticipants, allContributions] = await Promise.all([
    getManyBattles(),
    getManyBattleParticipants(),
    getManyPotContributions(),
  ]);

  console.log(`[battle-resolver] Loaded ${battles.length} battles, ${allParticipants.length} participants, ${allContributions.length} contributions`);

  // Phases run sequentially
  await activateRoyalRumbles(battles, allParticipants);
  await activatePendingBattles(battles, allParticipants);
  await resolveEndedBattles(battles, allParticipants);
  await resolveEndedRumbles(battles, allParticipants, allContributions);

  console.log('[battle-resolver] Done');
}
