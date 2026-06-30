import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@pooflabs/web';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TokenLogo } from '@/components/TokenLogo';
import { Time, Address } from '@/lib/db-client';
import {
  setMonthlyRewardWithdrawal,
  runGetPotTokenBalanceQueryForMonthlyRewardWithdrawal,
} from '@/lib/collections/monthlyRewardWithdrawal';
import {
  monthLabel,
  symbolForMint,
  decimalsForMint,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { errorToast, successToast } from '@/utils/toast-helpers';

interface WithdrawFromPotSectionProps {
  monthKey: string;
  potAccountId: string;
  /** Distinct mints currently in the pot (from deposit composition). */
  mints: string[];
}

/**
 * Admin-only section to WITHDRAW a token back OUT of the CURRENT, not-yet-finalized
 * month's prize pot — to fix a wrong-amount or wrong-token deposit. One token per
 * row, one wallet approval per withdraw. Live withdrawable balance comes from the
 * on-chain pot PDA (deposits minus prior withdrawals), never from summing records.
 */
export function WithdrawFromPotSection({ monthKey, potAccountId, mints }: WithdrawFromPotSectionProps) {
  // Resolve real symbol + decimals for every mint in the pot.
  // Known mints (SOL, USDC) resolve instantly from cache; unknown mints are fetched
  // via /api/token/lookup. Mirrors the same pattern used by PnlLeaderboard.
  const tokenMeta = useTokenMetadata(mints);

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ArrowDownToLine className="h-4 w-4 text-primary" />
          Withdraw from the Pot
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {mints.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">
            Nothing to withdraw yet. Tokens you deposit into this month's pot will appear here.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              Pull a token back out of the {monthLabel(monthKey)} pot. Only works while the month is
              still open — once winners are finalized, withdrawals are locked. Each withdrawal is one
              wallet approval.
            </p>
            <div className="space-y-2">
              {mints.map((mint) => {
                const meta = tokenMeta.get(mint);
                return (
                  <WithdrawTokenRow
                    key={mint}
                    monthKey={monthKey}
                    potAccountId={potAccountId}
                    mint={mint}
                    resolvedSymbol={meta?.symbol}
                    resolvedDecimals={meta?.decimals}
                  />
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface WithdrawTokenRowProps {
  monthKey: string;
  potAccountId: string;
  mint: string;
  /** Resolved symbol from useTokenMetadata — undefined while still loading. Falls back to symbolForMint. */
  resolvedSymbol?: string;
  /** Resolved decimals from useTokenMetadata — undefined while still loading. Falls back to decimalsForMint. */
  resolvedDecimals?: number;
}

function WithdrawTokenRow({ monthKey, potAccountId, mint, resolvedSymbol, resolvedDecimals }: WithdrawTokenRowProps) {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null); // base units; null = loading
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Use resolved metadata when available; fall back to legacy helpers while loading.
  // decimalsForMint returns 9 for SOL, 6 for USDC, and 0 for unknown mints.
  const symbol = resolvedSymbol ?? symbolForMint(mint);
  const decimals = resolvedDecimals ?? decimalsForMint(mint);

  // Inline base-unit ↔ human conversions using resolved decimals.
  // These replace the mint-keyed helpers so arbitrary tokens (e.g. SKR with 6 decimals)
  // convert correctly once metadata resolves.
  const baseToHuman = (base: number): number =>
    decimals > 0 ? base / Math.pow(10, decimals) : base;
  const humanToBase = (human: number): number =>
    Math.round(human * Math.pow(10, decimals));
  const formatResolved = (base: number): string => {
    const human = baseToHuman(base);
    const maxFrac = Math.min(decimals, 6);
    const str = human.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFrac,
    });
    return `${str} ${symbol}`;
  };

  const refreshBalance = useCallback(async () => {
    try {
      // Probe doc id only — runQuery does not write; it reads the pot PDA balance.
      const probeId = `${potAccountId}_balprobe`;
      const live = await runGetPotTokenBalanceQueryForMonthlyRewardWithdrawal(probeId, {
        potAccountId,
        mint,
      });
      setBalance(Math.max(0, Math.floor(Number(live) || 0)));
    } catch (err) {
      console.warn('[WithdrawTokenRow] balance fetch failed:', err);
      // Leave whatever we had; if we never loaded, show 0 rather than a misleading dash.
      setBalance((prev) => (prev === null ? 0 : prev));
    }
  }, [potAccountId, mint]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const balanceBaseUnits = balance ?? 0;
  const humanBalance = baseToHuman(balanceBaseUnits);

  const parsed = parseFloat(amount);
  const requestedBaseUnits =
    isFinite(parsed) && parsed > 0 ? humanToBase(parsed) : 0;

  const exceedsBalance = requestedBaseUnits > balanceBaseUnits;
  const canWithdraw =
    !submitting &&
    balance !== null &&
    balanceBaseUnits > 0 &&
    requestedBaseUnits > 0 &&
    !exceedsBalance;

  const handleMax = () => {
    if (balanceBaseUnits <= 0) return;
    // Show the full human balance, trimmed to the token's precision.
    setAmount(String(humanBalance));
  };

  const handleWithdraw = async () => {
    if (!user) {
      errorToast('Please log in as the admin wallet first.');
      return;
    }
    if (requestedBaseUnits <= 0) {
      errorToast('Enter an amount greater than zero.');
      return;
    }
    if (exceedsBalance) {
      errorToast(`That exceeds the pot's ${symbol} balance of ${formatResolved(balanceBaseUnits)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const withdrawalId = `${potAccountId}_${Math.floor(Date.now() / 1000)}`;
      const rank1AllotmentId = `${potAccountId}_1`;
      const ok = await setMonthlyRewardWithdrawal(withdrawalId, {
        monthKey,
        potAccountId,
        mint: Address.publicKey(mint),
        amount: requestedBaseUnits,
        rank1AllotmentId,
        createdAt: Time.Now,
      });

      if (ok) {
        successToast(
          `Withdrew ${formatResolved(requestedBaseUnits)} from the ${monthLabel(monthKey)} prize pot.`,
        );
        setAmount('');
        await refreshBalance();
      } else {
        errorToast(
          "This month's pot is finalized and can no longer be withdrawn, or you are not signed in as the admin wallet.",
        );
      }
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Withdrawal failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isEmpty = balanceBaseUnits <= 0;

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <TokenLogo symbol={symbol} size={28} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">{symbol}</div>
          <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
            <span>In pot: {formatResolved(balanceBaseUnits)}</span>
            <button
              type="button"
              onClick={() => void refreshBalance()}
              className="opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Refresh balance"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            disabled={submitting || isEmpty}
            onChange={(e) => setAmount(e.target.value)}
            className="pr-14"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={submitting || isEmpty}
            onClick={handleMax}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-[11px] font-semibold"
          >
            Max
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!canWithdraw}
          onClick={handleWithdraw}
          className="shrink-0"
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Withdrawing
            </>
          ) : (
            'Withdraw'
          )}
        </Button>
      </div>

      {exceedsBalance && requestedBaseUnits > 0 && (
        <p className="mt-1.5 text-[10px] text-amber-300">
          Amount exceeds the pot's {symbol} balance.
        </p>
      )}
    </div>
  );
}
