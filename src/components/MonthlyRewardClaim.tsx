/**
 * MonthlyRewardClaim — surfaces a prominent "Claim your monthly prize" card for
 * the logged-in user when they have an UNCLAIMED monthly reward allotment.
 *
 * The claim is ONE wallet approval: it updates the allotment doc (claimed
 * false->true) while preserving every baked field. The on-chain hook charges the
 * flat claim fee and transfers all token slots from the pot PDA to the winner in
 * the same transaction.
 */

import { useMemo, useState } from 'react';
import { Trophy, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '@pooflabs/web';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { TokenLogo } from '@/components/TokenLogo';
import { Address } from '@/lib/db-client';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyMonthlyRewardAllotment,
  updateMonthlyRewardAllotment,
  type MonthlyRewardAllotmentResponse,
} from '@/lib/collections/monthlyRewardAllotment';
import {
  symbolForMint,
  monthLabel,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { MONTHLY_REWARD_CLAIM_FEE_LAMPORTS } from '@/lib/constants';
import { errorToast, successToast } from '@/utils/toast-helpers';
import {
  MonthlyWinnerShareModal,
  type MonthlyWinnerSnapshot,
} from './trading/MonthlyWinnerShareModal';

const RANK_LABEL: Record<number, string> = { 1: '1st place', 2: '2nd place', 3: '3rd place' };

const FEE_SOL = (Number(MONTHLY_REWARD_CLAIM_FEE_LAMPORTS) || 0) / 1e9;

interface TokenLine {
  mint: string;
  amount: number;
}

/** Format a base-unit amount using resolved metadata (decimals + symbol). */
function formatWithMeta(
  baseUnits: number,
  mint: string,
  tokenMeta: Map<string, { symbol: string; decimals: number }>,
): string {
  const meta = tokenMeta.get(mint);
  const decimals = meta?.decimals ?? 0;
  const symbol = meta?.symbol ?? symbolForMint(mint);
  const human = decimals > 0 ? baseUnits / Math.pow(10, decimals) : baseUnits;
  const maxFrac = Math.min(decimals, 6);
  const str = human.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return `${str} $${symbol}`;
}

/** Extract the populated (amt > 0) token slots from an allotment doc. */
function tokenLines(a: MonthlyRewardAllotmentResponse): TokenLine[] {
  const lines: TokenLine[] = [];
  const slots: Array<[string | undefined, number | undefined]> = [
    [a.mint1, a.amt1],
    [a.mint2, a.amt2],
    [a.mint3, a.amt3],
    [a.mint4, a.amt4],
    [a.mint5, a.amt5],
  ];
  for (const [mint, amt] of slots) {
    const n = Number(amt) || 0;
    if (mint && n > 0) lines.push({ mint, amount: n });
  }
  return lines;
}

export function MonthlyRewardClaim() {
  const { user } = useAuth();

  const { data: allotments } = useRealtimeData<MonthlyRewardAllotmentResponse[]>(
    subscribeManyMonthlyRewardAllotment,
    !!user?.address,
    user?.address ? `where winner = '${user.address}'` : '',
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [shareWinner, setShareWinner] = useState<MonthlyWinnerSnapshot | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // The unclaimed allotment for the current user (most recent month first).
  const unclaimed = useMemo(() => {
    const mine = (allotments ?? []).filter(
      (a) => a.winner === user?.address && a.claimed === false,
    );
    // newest month first by monthKey string ("YYYY_MM" sorts lexically)
    mine.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));
    return mine[0] ?? null;
  }, [allotments, user?.address]);

  // Derive token lines before early return so hooks run unconditionally.
  const lines = useMemo(() => (unclaimed ? tokenLines(unclaimed) : []), [unclaimed]);
  const allMints = useMemo(() => lines.map((l) => l.mint), [lines]);
  // Resolve decimals + symbol for every mint in the allotment (incl. unknown SPL tokens).
  const tokenMeta = useTokenMetadata(allMints);

  if (!user || !unclaimed) return null;

  const handleClaim = async () => {
    setClaiming(true);
    try {
      // Re-send the full doc unchanged (only claimed flips false->true). Address
      // fields come back from the response as plain strings, so re-wrap them.
      const ok = await updateMonthlyRewardAllotment(unclaimed.id, {
        monthKey: unclaimed.monthKey,
        potAccountId: unclaimed.potAccountId,
        rank: unclaimed.rank,
        winner: Address.publicKey(unclaimed.winner),
        claimed: true,
        mint1: unclaimed.mint1 ? Address.publicKey(unclaimed.mint1) : undefined,
        amt1: unclaimed.amt1,
        mint2: unclaimed.mint2 ? Address.publicKey(unclaimed.mint2) : undefined,
        amt2: unclaimed.amt2,
        mint3: unclaimed.mint3 ? Address.publicKey(unclaimed.mint3) : undefined,
        amt3: unclaimed.amt3,
        mint4: unclaimed.mint4 ? Address.publicKey(unclaimed.mint4) : undefined,
        amt4: unclaimed.amt4,
        mint5: unclaimed.mint5 ? Address.publicKey(unclaimed.mint5) : undefined,
        amt5: unclaimed.amt5,
      });

      if (ok) {
        successToast('Prize claimed. Your tokens are on the way.');
        setConfirmOpen(false);
        // Open the winner share card with a snapshot of what was won.
        setShareWinner({
          rank: unclaimed.rank,
          monthLabel: monthLabel(unclaimed.monthKey),
          tokens: lines.map((l) => {
            const meta = tokenMeta.get(l.mint);
            const sym = meta?.symbol ?? symbolForMint(l.mint);
            const formatted = formatWithMeta(l.amount, l.mint, tokenMeta);
            return {
              symbol: sym,
              amount: formatted.replace(` $${sym}`, ''),
            };
          }),
        });
        setShareOpen(true);
      } else {
        errorToast('Claim was rejected. It may already be claimed, or you are not the winner.');
      }
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Claim failed.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <>
      {/* Prominent claim card */}
      <div
        className='glass-card rounded-2xl mb-4 overflow-hidden animate-fade-in'
        style={{ border: '1px solid rgba(255,215,0,0.45)', boxShadow: '0 0 40px rgba(255,215,0,0.12)' }}
      >
        <div
          className='flex items-center gap-2 px-5 py-3'
          style={{ background: 'rgba(255,215,0,0.10)', borderBottom: '1px solid rgba(255,215,0,0.2)' }}
        >
          <Trophy size={18} style={{ color: '#FFD700' }} />
          <span className='text-sm font-black uppercase tracking-wider' style={{ color: '#E8C547' }}>
            You won {monthLabel(unclaimed.monthKey)}
          </span>
          <span
            className='ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-full'
            style={{ background: 'rgba(255,215,0,0.15)', color: '#E8C547', border: '1px solid rgba(255,215,0,0.3)' }}
          >
            {RANK_LABEL[unclaimed.rank] ?? `#${unclaimed.rank}`}
          </span>
        </div>

        <div className='px-5 py-4'>
          <p className='text-xs mb-3' style={{ color: '#9A9A9A' }}>
            Claim your monthly prize. You'll approve a single transaction that pays the prize tokens
            directly to your wallet.
          </p>

          <div className='flex flex-wrap gap-x-5 gap-y-2 mb-4'>
            {lines.map((l) => {
              const sym = tokenMeta.get(l.mint)?.symbol ?? symbolForMint(l.mint);
              return (
                <div key={l.mint} className='flex items-center gap-2'>
                  <TokenLogo symbol={sym} size={28} />
                  <span className='text-base font-black tabular-nums' style={{ color: '#fff' }}>
                    {formatWithMeta(l.amount, l.mint, tokenMeta)}
                  </span>
                </div>
              );
            })}
          </div>

          <Button
            onClick={() => setConfirmOpen(true)}
            className='w-full gap-2 font-bold'
            style={{ background: '#FFD700', color: '#1a1a1a' }}
          >
            <Sparkles className='h-4 w-4' />
            Claim your prize
          </Button>
        </div>
      </div>

      {/* Pre-claim confirmation */}
      <Dialog open={confirmOpen} onOpenChange={(v) => !claiming && setConfirmOpen(v)}>
        <DialogContent className='glass-dialog max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2 text-base'>
              <Trophy className='h-4 w-4 text-primary' />
              Confirm your claim
            </DialogTitle>
          </DialogHeader>

          <div className='space-y-3 py-1'>
            <p className='text-sm text-muted-foreground'>
              You'll pay a {FEE_SOL} SOL claim fee and receive:
            </p>
            <div className='space-y-2'>
              {lines.map((l) => {
                const sym = tokenMeta.get(l.mint)?.symbol ?? symbolForMint(l.mint);
                return (
                  <div
                    key={l.mint}
                    className='flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2'
                  >
                    <TokenLogo symbol={sym} size={26} />
                    <span className='text-sm font-bold tabular-nums'>{formatWithMeta(l.amount, l.mint, tokenMeta)}</span>
                  </div>
                );
              })}
            </div>
            <p className='text-[11px] text-muted-foreground'>
              Everything happens in one wallet approval — the fee and all prize tokens settle together.
            </p>
          </div>

          <DialogFooter className='gap-2'>
            <Button variant='outline' onClick={() => setConfirmOpen(false)} disabled={claiming} className='glass-button'>
              Cancel
            </Button>
            <Button onClick={handleClaim} disabled={claiming} className='gap-2'>
              {claiming ? (
                <>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Claiming…
                </>
              ) : (
                <>
                  <Sparkles className='h-4 w-4' />
                  Confirm claim
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Winner share card */}
      <MonthlyWinnerShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        winner={shareWinner}
      />
    </>
  );
}
