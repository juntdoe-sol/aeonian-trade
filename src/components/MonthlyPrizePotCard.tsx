/**
 * MonthlyPrizePotCard — shows the CURRENT calendar month's live prize pot
 * composition (per-token amounts + symbols) above the PnL leaderboard.
 *
 * Hidden entirely when the month has no deposits yet, so it never shows an
 * empty/placeholder pot.
 */

import { useMemo } from 'react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeManyMonthlyRewardDeposit,
  type MonthlyRewardDepositResponse,
} from '@/lib/collections/monthlyRewardDeposit';
import { TokenLogo } from '@/components/TokenLogo';
import {
  currentMonthKeyUTC,
  potAccountIdForMonth,
  monthLabel,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { SOL } from '@/lib/constants';

/** Format a base-unit amount using resolved decimals and symbol. */
function formatAmount(baseUnits: number, decimals: number, symbol: string): string {
  const human = decimals > 0 ? baseUnits / Math.pow(10, decimals) : baseUnits;
  const maxFrac = Math.min(decimals, 6);
  const str = human.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return `${str} $${symbol}`;
}

export function MonthlyPrizePotCard() {
  const monthKey = useMemo(() => currentMonthKeyUTC(), []);
  const potAccountId = useMemo(() => potAccountIdForMonth(monthKey), [monthKey]);

  const { data: deposits } = useRealtimeData<MonthlyRewardDepositResponse[]>(
    subscribeManyMonthlyRewardDeposit,
    true,
    `where potAccountId = '${potAccountId}'`,
  );

  const composition = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of deposits ?? []) {
      if (!d.mint) continue;
      const amt = Number(d.amount) || 0;
      if (amt <= 0) continue;
      totals.set(d.mint, (totals.get(d.mint) ?? 0) + amt);
    }
    return Array.from(totals.entries())
      .map(([mint, total]) => ({ mint, total }))
      .sort((a, b) => {
        if (a.mint === SOL && b.mint !== SOL) return -1;
        if (b.mint === SOL && a.mint !== SOL) return 1;
        return a.mint < b.mint ? -1 : 1;
      });
  }, [deposits]);

  // Resolve symbol + decimals for every mint in the pot (known mints resolve
  // instantly from cache; unknown mints are fetched via /api/token/lookup).
  const allMints = useMemo(() => composition.map((c) => c.mint), [composition]);
  const tokenMeta = useTokenMetadata(allMints);

  // Hide entirely when there are no deposits.
  if (composition.length === 0) return null;

  return (
    <div
      className='glass-card rounded-xl mb-3 overflow-hidden animate-fade-in'
      style={{ border: '1px solid rgba(255,215,0,0.25)' }}
    >
      <div
        className='flex items-center gap-2 px-4 py-2.5'
        style={{ background: 'rgba(255,215,0,0.06)', borderBottom: '1px solid rgba(255,215,0,0.15)' }}
      >
        <span className='text-xs font-bold uppercase tracking-wider' style={{ color: '#E8C547' }}>
          {monthLabel(monthKey)} Prize Pot
        </span>
        <span className='ml-auto text-[10px] font-medium' style={{ color: '#8A8A8A' }}>
          Top 3 share it
        </span>
      </div>

      <div className='px-4 py-3 flex flex-wrap gap-x-5 gap-y-2'>
        {composition.map(({ mint, total }) => {
          const meta = tokenMeta.get(mint);
          const symbol = meta?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
          const decimals = meta?.decimals ?? 0;
          return (
            <div key={mint} className='flex items-center gap-2'>
              <TokenLogo symbol={symbol} size={26} />
              <div className='leading-tight'>
                <div className='text-sm font-black tabular-nums' style={{ color: '#fff' }}>
                  {formatAmount(total, decimals, symbol)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className='px-4 pb-2.5 -mt-0.5'>
        <span className='text-[10px]' style={{ color: '#6A6A6A' }}>
          1st 50% · 2nd 35% · 3rd 15% of each token
        </span>
      </div>
    </div>
  );
}
