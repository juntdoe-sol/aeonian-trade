import { deleteBattles } from '@/lib/collections/battles';
import { getManyBattleParticipants, deleteBattleParticipants } from '@/lib/collections/battleParticipants';
import { getManyBattleMessages, deleteBattleMessages } from '@/lib/collections/battleMessages';
import { getManyBattleSpectators, deleteBattleSpectators } from '@/lib/collections/battleSpectators';

export interface DeleteBattleResult {
  success: boolean;
  /** True if the battle record itself was deleted (false = permission denied). */
  battleDeleted: boolean;
  /** Any error that occurred while deleting related records. */
  relatedError?: string;
}

/**
 * Cascade-delete a battle and all of its related records:
 *   - battleParticipants where battleId == id
 *   - battleMessages where battleId == id
 *   - battleSpectators where battleId == id
 *
 * Deleting a battleParticipants record only removes the offchain tracking row;
 * it does NOT refund any escrowed USDC from the on-chain PDA vault.
 *
 * Returns a result object indicating success. Callers should surface toasts
 * based on the result rather than catching here.
 */
export async function deleteBattleWithRelated(battleId: string): Promise<DeleteBattleResult> {
  // 1. Delete the battle record first (most critical operation)
  const battleDeleted = await deleteBattles(battleId);
  if (!battleDeleted) {
    return { success: false, battleDeleted: false };
  }

  // 2. Fetch and delete related records in parallel
  const [participants, messages, spectators] = await Promise.all([
    getManyBattleParticipants(`where battleId == "${battleId}"`),
    getManyBattleMessages(`where battleId == "${battleId}"`),
    getManyBattleSpectators(`where battleId == "${battleId}"`),
  ]);

  const deleteOps: Promise<boolean>[] = [
    ...participants.map((p) => deleteBattleParticipants(p.id)),
    ...messages.map((m) => deleteBattleMessages(m.id)),
    ...spectators.map((s) => deleteBattleSpectators(s.id)),
  ];

  if (deleteOps.length === 0) {
    return { success: true, battleDeleted: true };
  }

  const results = await Promise.allSettled(deleteOps);
  const failures = results.filter(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)
  );

  if (failures.length > 0) {
    return {
      success: true,
      battleDeleted: true,
      relatedError: `${failures.length} related record(s) could not be deleted`,
    };
  }

  return { success: true, battleDeleted: true };
}
