import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';
import { ArrowDownToLine, Loader2 } from 'lucide-react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyPhoenixSubaccount,
  type PhoenixSubaccountResponse,
} from '@/lib/collections/phoenixSubaccount';
import {
  setPhoenixIsolatedSweep,
  getPhoenixIsolatedSweep,
} from '@/lib/collections/phoenixIsolatedSweep';
import { api } from '@/lib/api-client';
import { toNumber, type RisePosition, type TokenAmount } from '@/utils/phoenix-mappers';
import { formatUsd } from './types';

/**
 * "Sweep to Cross" card.
 *
 * After an isolated position is closed, collateral normally returns to the main
 * (cross-margin) account automatically. In edge cases a small amount of free
 * collateral can be left sitting on an isolated subaccount with no open position.
 * This card detects that leftover balance and lets the user move it back to their
 * main trading balance in one tap.
 *
 * Visibility: rendered ONLY when an isolated subaccount (index > 0) has free
 * collateral > 0 AND no open position (an open position blocks the sweep on-chain).
 */

/** Raw subaccount-state shape returned by /api/phoenix/trader/:authority/subaccount/:index. */
interface SubaccountState {
  collateralBalance?: TokenAmount;
  effectiveCollateral?: TokenAmount;
  crossInitialMargin?: TokenAmount;
  positions?: RisePosition[];
  [key: string]: unknown;
}

interface SweepCandidate {
  index: number;
  freeCollateral: number;
}

function computeSubaccountFree(data: SubaccountState | null | undefined): number {
  if (!data) return 0;
  const collateral = toNumber(data.collateralBalance);
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const im = data.crossInitialMargin
    ? toNumber(data.crossInitialMargin)
    : positions.reduce((s, p) => s + toNumber(p.initialMargin), 0);
  return Math.max(0, collateral - im);
}

function hasOpenPosition(data: SubaccountState | null | undefined): boolean {
  if (!data) return false;
  const positions = Array.isArray(data.positions) ? data.positions : [];
  return positions.some((p) => Math.abs(toNumber(p.positionSize)) > 0);
}

export function IsolatedSweepCard({
  walletAddress,
  onSwept,
}: {
  walletAddress: string;
  /** Called after a successful sweep so the parent can refresh balances. */
  onSwept?: () => void;
}) {
  // The user's isolated subaccount metadata (index > 0). Drives which indices we probe.
  const { data: subaccounts } = useRealtimeData<PhoenixSubaccountResponse[]>(
    subscribeManyPhoenixSubaccount,
    !!walletAddress,
    `where wallet = '${walletAddress}'`,
  );

  const [candidate, setCandidate] = useState<SweepCandidate | null>(null);
  const [sweeping, setSweeping] = useState(false);

  // Probe each isolated subaccount for leftover free collateral with no open position.
  const refreshCandidate = useCallback(async () => {
    if (!walletAddress) {
      setCandidate(null);
      return;
    }
    const indices = (subaccounts ?? [])
      .filter((s) => s.wallet === walletAddress && typeof s.index === 'number' && s.index > 0)
      .map((s) => s.index);
    // Always include the standard isolated index (1) even if no metadata record exists.
    if (!indices.includes(1)) indices.push(1);

    let best: SweepCandidate | null = null;
    for (const index of indices) {
      try {
        const state = await api.get<SubaccountState>(
          `/api/phoenix/trader/${walletAddress}/subaccount/${index}`,
        );
        if (hasOpenPosition(state)) continue;
        const free = computeSubaccountFree(state);
        // Ignore dust below 1 cent.
        if (free > 0.01 && (!best || free > best.freeCollateral)) {
          best = { index, freeCollateral: free };
        }
      } catch {
        // 404 / not-found for an unfunded subaccount is expected — skip it.
      }
    }
    setCandidate(best);
  }, [walletAddress, subaccounts]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshCandidate();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCandidate]);

  const handleSweep = useCallback(async () => {
    if (!candidate || sweeping) return;
    setSweeping(true);
    const toastId = toast.loading('Moving funds to your main account — approve in your wallet…');
    try {
      const sweepId = crypto.randomUUID();
      const succeeded = await setPhoenixIsolatedSweep(sweepId, {
        subaccountIndex: candidate.index,
      });

      if (!succeeded) {
        toast.dismiss(toastId);
        errorToast(
          "We couldn't move the funds. If you still have an open position here, close it first.",
        );
        return;
      }

      // Read back the resulting passthrough doc to surface the on-chain tx hash
      // (best-effort — the sweep already succeeded above).
      await getPhoenixIsolatedSweep(sweepId);
      toast.dismiss(toastId);
      toast.success('Funds moved back to your main account.');

      setCandidate(null);
      onSwept?.();
      // Re-probe shortly after so the card disappears once funds have moved.
      setTimeout(() => {
        void refreshCandidate();
      }, 1500);
    } catch (err) {
      toast.dismiss(toastId);
      console.error('[ISO SWEEP] failed:', err);
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('position') || msg.includes('open')) {
        errorToast('Close your open position here before moving the funds.');
      } else {
        errorToast("We couldn't move the funds. Please try again.");
      }
    } finally {
      setSweeping(false);
    }
  }, [candidate, sweeping, onSwept, refreshCandidate]);

  if (!candidate) return null;

  return (
    <div
      className='glass-card rounded-xl p-4 flex items-center justify-between gap-3 animate-fade-in'
      style={{ border: '1px solid rgba(74,222,128,0.25)' }}
    >
      <div className='min-w-0'>
        <div className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
          Idle balance
        </div>
        <div className='mt-1 flex items-baseline gap-1.5'>
          <span className='font-bold tabular-nums text-lg' style={{ color: '#4ADE80' }}>
            {formatUsd(candidate.freeCollateral)}
          </span>
          <span className='text-[11px]' style={{ color: '#8A8A8A' }}>
            left from a closed position
          </span>
        </div>
        <div className='text-[11px] mt-0.5' style={{ color: '#666' }}>
          Move it back to your main trading balance.
        </div>
      </div>
      <button
        onClick={handleSweep}
        disabled={sweeping}
        className='shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold transition-all'
        style={{
          background: sweeping ? 'rgba(74,222,128,0.15)' : 'rgba(74,222,128,0.2)',
          color: '#4ADE80',
          border: '1px solid rgba(74,222,128,0.4)',
          opacity: sweeping ? 0.7 : 1,
          cursor: sweeping ? 'wait' : 'pointer',
        }}
      >
        {sweeping ? (
          <>
            <Loader2 size={14} className='animate-spin' />
            Moving…
          </>
        ) : (
          <>
            <ArrowDownToLine size={14} />
            Move to main
          </>
        )}
      </button>
    </div>
  );
}
