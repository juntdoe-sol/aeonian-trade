import { api } from '@/lib/api-client';
import { TAROBASE_CONFIG } from '@/lib/config';
import { useGeoBlocked } from '@/hooks/use-geo-blocked';
import { useAppLogo } from '@/hooks/use-app-logo';
import { phoenixDeposit, phoenixWithdraw } from '@/utils/phoenix-client';
import { useAuth } from '@pooflabs/web';
import { truncateAddress } from '@/utils/format-address';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowDownUp, Check, ChevronDown, Copy, Eye, Heart, Loader2, RefreshCw, Send, Settings, Wallet, X } from 'lucide-react';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useOAuth } from '@/contexts/OAuthContext';
import { setSolTransfer } from '@/lib/collections/solTransfer';
import { runSolBalanceQueryForCommonQueries } from '@/lib/collections/commonQueries';
import { getLeaderboardPrivacy, updateLeaderboardPrivacy } from '@/lib/collections/leaderboardPrivacy';
import { Address, Time } from '@/lib/db-client';
import { Switch } from '@/components/ui/switch';
import { QRCodeSVG } from 'qrcode.react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistedCollapse } from '@/hooks/use-persisted-collapse';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';
import {
  fetchJupiterQuote,
  executeJupiterSwap,
  feeAtaExistsOnChain,
  USDC_MINT,
  SOL_MINT,
  type SwapDirection,
  type SwapQuote,
} from '@/utils/jupiter-swap';
import { Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { AppHeader } from './AppHeader';
import { TokenLogo } from './TokenLogo';
import { BottomTabNav } from './BottomTabNav';
import { ActiveAccountFlow } from './ActiveAccountFlow';
import { UserActivityPanel } from './trading/UserActivityPanel';
import { UserProfilePopup } from './UserProfilePopup';
import { IsolatedSweepCard } from './trading/IsolatedSweepCard';
import { formatPrice, formatUsd } from './trading/types';
import type { TraderPosition, TradeFill, TraderFundingEntry } from './trading/types';
import { computeClosedTrades } from '@/utils/trade-computations';
import {
  type TraderData,
  type RisePosition,
  toNumber,
  mapPosition,
  computeTotalExposure,
  computeTotalUnrealizedPnl,
  computePortfolioBreakdown,
} from '@/utils/phoenix-mappers';
import { setPhoenixIsolatedSweep } from '@/lib/collections/phoenixIsolatedSweep';
import { getMarketPubkey, toBaseLots } from '@/utils/phoenix-markets';
import { captureConsoleErrorDuring, buildIsoErrorMessage } from '@/utils/iso-error-diagnostic';
import { placeOrderViaFlight, placeIsolatedOrderViaFlight, Side } from '@/utils/phoenix-flight';
import { recordFlightTrade } from '@/utils/record-trade';

// ─── Swap Tab ─────────────────────────────────────────────────────────────────

function SwapTab({ walletAddress }: { walletAddress: string }) {
  const [direction, setDirection] = useState<SwapDirection>('SOL_TO_USDC');
  const [inputAmount, setInputAmount] = useState('');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-check whether the platform fee ATA exists on-chain for each possible output mint.
  // This result is shared between fetchJupiterQuote (includeFee) and executeJupiterSwap
  // (withFee) so the quote and swap always agree on whether platformFeeBps is included.
  const [feeEnabledByMint, setFeeEnabledByMint] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const outputMints = [USDC_MINT, SOL_MINT];
    Promise.all(
      outputMints.map(async (mint) => {
        const exists = await feeAtaExistsOnChain(mint);
        return [mint, exists] as const;
      }),
    ).then((results) => {
      setFeeEnabledByMint(Object.fromEntries(results));
    });
  }, []);

  // Wallet balances
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  const inputToken = direction === 'SOL_TO_USDC' ? 'SOL' : 'USDC';
  const outputToken = direction === 'SOL_TO_USDC' ? 'USDC' : 'SOL';

  const fetchWalletBalances = useCallback(async () => {
    if (!walletAddress || !TAROBASE_CONFIG.rpcUrl) return;
    setBalancesLoading(true);
    try {
      // Fetch SOL balance
      const solRes = await fetch(TAROBASE_CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [walletAddress] }),
      });
      const solData = await solRes.json();
      if (!solData.error) setSolBalance(solData.result.value / 1_000_000_000);

      // Fetch USDC balance via getTokenAccountsByOwner
      const usdcRes = await fetch(TAROBASE_CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
          params: [
            walletAddress,
            { mint: USDC_MINT },
            { encoding: 'jsonParsed' },
          ],
        }),
      });
      const usdcData = await usdcRes.json();
      if (!usdcData.error && usdcData.result?.value?.length > 0) {
        const uiAmount = usdcData.result.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
        setUsdcBalance(uiAmount ?? 0);
      } else if (!usdcData.error) {
        setUsdcBalance(0);
      }
    } catch {
      // silently fail — show nothing
    } finally {
      setBalancesLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchWalletBalances();
  }, [fetchWalletBalances]);

  // Re-fetch quote whenever input amount, direction, or fee-ATA status changes (debounced).
  // includeFee is derived from feeEnabledByMint so the quote always matches what executeJupiterSwap will do.
  const outputMint = direction === 'SOL_TO_USDC' ? USDC_MINT : SOL_MINT;
  const includeFee = feeEnabledByMint[outputMint] ?? false;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const parsed = parseFloat(inputAmount);
    if (!parsed || parsed <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const result = await fetchJupiterQuote(direction, parsed, 50, includeFee);
        setQuote(result);
      } catch (err) {
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : 'Failed to fetch quote');
      } finally {
        setQuoteLoading(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputAmount, direction, includeFee]);

  function handleFlip() {
    setDirection((d) => (d === 'SOL_TO_USDC' ? 'USDC_TO_SOL' : 'SOL_TO_USDC'));
    setInputAmount('');
    setQuote(null);
    setQuoteError(null);
  }

  async function handleSwap() {
    if (!quote) return;
    setSwapping(true);
    try {
      // Pass the same includeFee flag used during the quote so the swap and quote
      // always agree on whether platformFeeBps / feeAccount are present.
      const sig = await executeJupiterSwap(quote.quoteResponse, walletAddress, includeFee);
      toast.success('Swap complete.');
      setInputAmount('');
      setQuote(null);
      // Refetch balances after successful swap
      setTimeout(() => fetchWalletBalances(), 2000);
    } catch (err) {
      console.error('[SWAP] failed:', err);
      errorToast("Your swap didn't go through. Please try again.");
    } finally {
      setSwapping(false);
    }
  }

  const parsed = parseFloat(inputAmount);
  const hasValidInput = !!parsed && parsed > 0;
  const canSwap = hasValidInput && !!quote && !quoteLoading && !swapping;

  // Price impact formatting
  const impactNum = quote ? parseFloat(quote.priceImpactPct) : 0;
  const impactColor = impactNum > 5 ? '#ef4444' : impactNum > 2 ? '#f59e0b' : '#4ADE80';

  // Balance display helpers
  const inputBalance = direction === 'SOL_TO_USDC' ? solBalance : usdcBalance;
  const inputBalanceFormatted = inputBalance !== null
    ? inputBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: direction === 'SOL_TO_USDC' ? 4 : 2 })
    : null;

  function handleMax() {
    if (inputBalance === null) return;
    if (direction === 'SOL_TO_USDC') {
      // Leave ~0.01 SOL buffer for fees
      const maxSol = Math.max(inputBalance - 0.01, 0);
      setInputAmount(maxSol > 0 ? maxSol.toFixed(4) : '0');
    } else {
      setInputAmount(inputBalance.toFixed(2));
    }
  }

  // Estimated USD value of output
  let outputUsdValue: number | null = null;
  if (quote) {
    if (outputToken === 'USDC') {
      outputUsdValue = quote.outAmountHuman;
    } else {
      // outputToken is SOL — derive SOL price from the quote
      // quote: inputAmount SOL → quote.outAmountHuman USDC (or vice versa)
      // When direction is USDC_TO_SOL: input=USDC, output=SOL
      // sol price ≈ inputAmount(USDC) / outAmount(SOL)
      const parsedIn = parseFloat(inputAmount);
      if (parsedIn > 0 && quote.outAmountHuman > 0) {
        const solPrice = parsedIn / quote.outAmountHuman;
        outputUsdValue = quote.outAmountHuman * solPrice;
      }
    }
  }

  return (
    <div className='space-y-3'>
      {/* Input row */}
      <div
        className='rounded-xl p-3 space-y-1'
        style={{ background: 'rgba(183,148,246,0.07)', border: '1px solid rgba(183,148,246,0.14)' }}
      >
        <div className='flex items-center justify-between mb-1'>
          <span className='text-[10px] font-semibold uppercase tracking-wide' style={{ color: '#8A8A8A' }}>You pay</span>
          <span
            className='flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded'
            style={{
              background: direction === 'SOL_TO_USDC' ? 'rgba(183,148,246,0.18)' : 'rgba(74,222,128,0.13)',
              color: direction === 'SOL_TO_USDC' ? '#b794f6' : '#4ADE80',
            }}
          >
            <TokenLogo symbol={inputToken} size={16} />
            {inputToken}
          </span>
        </div>
        <input
          type='number'
          min='0'
          step='any'
          value={inputAmount}
          onChange={(e) => setInputAmount(e.target.value)}
          placeholder='0.00'
          className='w-full bg-transparent text-lg font-bold font-mono tabular-nums outline-none'
          style={{ color: '#e2d8f5' }}
        />
        {/* Balance + Max button */}
        <div className='flex items-center justify-between mt-1.5'>
          <span className='text-[10px]' style={{ color: '#8A8A8A' }}>
            {balancesLoading ? (
              <span style={{ color: '#555' }}>Loading…</span>
            ) : inputBalanceFormatted !== null ? (
              <>Balance: <span style={{ color: '#a0a0b0' }}>{inputBalanceFormatted} {inputToken}</span></>
            ) : null}
          </span>
          {inputBalanceFormatted !== null && !balancesLoading && (
            <button
              onClick={handleMax}
              disabled={swapping}
              className='text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors disabled:opacity-50'
              style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.27)' }}
            >
              MAX
            </button>
          )}
        </div>
      </div>

      {/* Flip direction button */}
      <div className='flex justify-center'>
        <button
          onClick={handleFlip}
          disabled={swapping}
          className='flex items-center justify-center w-8 h-8 rounded-full transition-all hover:scale-110 active:scale-95 disabled:opacity-50'
          style={{
            background: 'rgba(183,148,246,0.15)',
            border: '1px solid rgba(183,148,246,0.30)',
            color: '#b794f6',
          }}
          title='Flip swap direction'
        >
          <ArrowDownUp size={14} />
        </button>
      </div>

      {/* Output row */}
      <div
        className='rounded-xl p-3'
        style={{ background: 'rgba(183,148,246,0.04)', border: '1px solid rgba(183,148,246,0.10)' }}
      >
        <div className='flex items-center justify-between mb-1'>
          <span className='text-[10px] font-semibold uppercase tracking-wide' style={{ color: '#8A8A8A' }}>You receive</span>
          <span
            className='flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded'
            style={{
              background: direction === 'SOL_TO_USDC' ? 'rgba(74,222,128,0.13)' : 'rgba(183,148,246,0.18)',
              color: direction === 'SOL_TO_USDC' ? '#4ADE80' : '#b794f6',
            }}
          >
            <TokenLogo symbol={outputToken} size={16} />
            {outputToken}
          </span>
        </div>
        <div className='flex items-center gap-2 min-h-[28px]'>
          {quoteLoading ? (
            <div className='flex items-center gap-1.5'>
              <Loader2 size={14} className='animate-spin' style={{ color: '#b794f6' }} />
              <span className='text-xs' style={{ color: '#8A8A8A' }}>Fetching quote…</span>
            </div>
          ) : quote ? (
            <span className='text-lg font-bold font-mono tabular-nums' style={{ color: '#e2d8f5' }}>
              {quote.outAmountHuman.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: outputToken === 'USDC' ? 2 : 6 })}
            </span>
          ) : (
            <span className='text-lg font-bold font-mono tabular-nums' style={{ color: '#555' }}>—</span>
          )}
        </div>
        {/* Estimated USD value */}
        {outputUsdValue !== null && (
          <div className='mt-0.5'>
            <span className='text-[10px] font-mono' style={{ color: '#8A8A8A' }}>
              ≈ ${outputUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>

      {/* Quote details */}
      {quote && (
        <div
          className='rounded-lg px-3 py-2 space-y-1'
          style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(183,148,246,0.08)' }}
        >
          <div className='flex justify-between items-center'>
            <span className='text-[10px]' style={{ color: '#8A8A8A' }}>Price impact</span>
            <span className='text-[10px] font-semibold font-mono' style={{ color: impactColor }}>
              {impactNum < 0.01 ? '< 0.01%' : `${impactNum.toFixed(2)}%`}
            </span>
          </div>
          <div className='flex justify-between items-center'>
            <span className='text-[10px]' style={{ color: '#8A8A8A' }}>Slippage</span>
            <span className='text-[10px] font-semibold font-mono' style={{ color: '#a0a0b0' }}>0.5%</span>
          </div>
          <div className='flex justify-between items-center'>
            <span className='text-[10px]' style={{ color: '#8A8A8A' }}>Route</span>
            <div className='flex items-center gap-1'>
              <span className='text-[10px] font-semibold font-mono' style={{ color: '#a0a0b0' }}>Jupiter</span>
              <RefreshCw size={9} style={{ color: '#555' }} />
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {quoteError && (
        <div
          className='rounded-lg px-3 py-2 flex items-center gap-2 text-[11px]'
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)', color: '#f87171' }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          {quoteError}
        </div>
      )}

      {/* Swap button */}
      <button
        onClick={handleSwap}
        disabled={!canSwap}
        className='w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed'
        style={{ background: canSwap ? '#b794f6' : 'rgba(183,148,246,0.25)', color: '#fff' }}
      >
        {swapping ? (
          <>
            <Loader2 size={15} className='animate-spin' />
            Swapping…
          </>
        ) : !hasValidInput ? (
          'Enter an amount'
        ) : quoteLoading ? (
          <>
            <Loader2 size={15} className='animate-spin' />
            Getting quote…
          </>
        ) : !quote ? (
          'No route found'
        ) : (
          <>
            <ArrowDownUp size={14} />
            <span className='flex items-center gap-1.5'>
              Swap
              <TokenLogo symbol={inputToken} size={16} />
              →
              <TokenLogo symbol={outputToken} size={16} />
            </span>
          </>
        )}
      </button>

      <p className='text-[10px] text-center' style={{ color: '#555' }}>
        Powered by Jupiter. Best-route aggregation across Solana DEXes.
      </p>
    </div>
  );
}

// ─── Send SOL Tab (inline form — same logic as WithdrawSolDialog) ─────────────

const FEE_RESERVE_SOL = 0.002;
const SOL_TO_LAMPORTS = 1_000_000_000;

function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function isValidSolanaAddress(addr: string): boolean {
  const trimmed = addr.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function SendSolTab({ walletAddress }: { walletAddress: string }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!walletAddress) return;
    setBalanceLoading(true);
    const queryId = `sol-bal-fundcard-${walletAddress}`;
    (async () => {
      try {
        const lamports = await runSolBalanceQueryForCommonQueries(queryId, { walletAddress });
        if (lamports >= 0) {
          setSolBalance(lamports / SOL_TO_LAMPORTS);
        }
      } catch {
        // Balance unavailable — don't block submit
      } finally {
        setBalanceLoading(false);
      }
    })();
  }, [walletAddress]);

  const maxSol = solBalance !== null ? Math.max(solBalance - FEE_RESERVE_SOL, 0) : null;
  const recipientTrimmed = recipient.trim();
  const recipientInvalid = recipientTrimmed.length > 0 && !isValidSolanaAddress(recipientTrimmed);
  const parsedAmount = parseFloat(amount);
  const amountInvalid = amount.length > 0 && (isNaN(parsedAmount) || parsedAmount <= 0);
  const amountTooHigh = maxSol !== null && !isNaN(parsedAmount) && parsedAmount > maxSol;
  const insufficientSol = maxSol !== null && maxSol <= 0;

  const canSubmit =
    !submitting &&
    isValidSolanaAddress(recipientTrimmed) &&
    !isNaN(parsedAmount) &&
    parsedAmount > 0 &&
    !amountInvalid &&
    !amountTooHigh &&
    !insufficientSol;

  async function handleSend() {
    if (!canSubmit) return;
    const lamports = Math.floor(parsedAmount * SOL_TO_LAMPORTS);
    setSubmitting(true);
    try {
      const transferId = crypto.randomUUID();
      const success = await setSolTransfer(transferId, {
        recipient: Address.publicKey(recipientTrimmed),
        amt: lamports,
      });
      if (success) {
        toast.success(`Sent ${parsedAmount.toFixed(parsedAmount < 0.001 ? 6 : 4)} SOL`);
        setRecipient('');
        setAmount('');
        // Refresh balance
        const lamportsNew = await runSolBalanceQueryForCommonQueries(`sol-bal-fundcard-${walletAddress}-r`, { walletAddress }).catch(() => null);
        if (lamportsNew != null && lamportsNew >= 0) setSolBalance(lamportsNew / SOL_TO_LAMPORTS);
      } else {
        errorToast("We couldn't send your SOL. Check your balance and try again.");
      }
    } catch (err) {
      console.error('[SEND SOL] failed:', err);
      errorToast("We couldn't send your SOL. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className='space-y-3'>
      {/* Source wallet callout */}
      <div
        className='flex items-center gap-2.5 rounded-xl px-3 py-2'
        style={{ background: 'rgba(183,148,246,0.09)', border: '1px solid rgba(183,148,246,0.22)' }}
      >
        <Wallet size={12} style={{ color: '#b794f6', flexShrink: 0 }} />
        <div className='flex flex-col gap-0.5 min-w-0'>
          <span className='text-[10px] font-semibold uppercase tracking-wide' style={{ color: '#b794f6' }}>
            From: Your connected wallet
          </span>
          <span className='text-[10px] font-mono tabular-nums truncate' style={{ color: '#a0a0b0' }}>
            {walletAddress ? shortAddress(walletAddress) : '—'}
          </span>
        </div>
        <div className='ml-auto text-right flex-shrink-0'>
          {balanceLoading ? (
            <span className='text-[10px]' style={{ color: '#555' }}>Loading…</span>
          ) : solBalance !== null ? (
            <>
              <div className='text-xs font-bold tabular-nums font-mono' style={{ color: '#b794f6' }}>
                {solBalance.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })} SOL
              </div>
              {maxSol !== null && (
                <div className='text-[10px]' style={{ color: '#555' }}>
                  max {maxSol <= 0 ? '0' : maxSol.toFixed(5)} sendable
                </div>
              )}
            </>
          ) : (
            <span className='text-[10px]' style={{ color: '#555' }}>Balance unavailable</span>
          )}
        </div>
      </div>

      {/* Insufficient SOL warning */}
      {insufficientSol && (
        <div
          className='flex items-center gap-2 p-2.5 rounded-xl text-[11px]'
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)', color: '#f87171' }}
        >
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          Insufficient SOL. You need more than 0.002 SOL to cover fees.
        </div>
      )}

      {/* Recipient */}
      <div>
        <label className='text-[11px] block mb-1' style={{ color: '#8A8A8A' }}>
          Send to (recipient address)
        </label>
        <input
          type='text'
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder='Solana wallet address'
          spellCheck={false}
          autoComplete='off'
          className='glass-input w-full px-3 py-2.5 rounded-lg text-[11px] font-mono tabular-nums outline-none break-all'
          style={{ borderColor: recipientInvalid ? 'rgba(239,68,68,0.40)' : undefined }}
        />
        {recipientInvalid && (
          <p className='text-[10px] mt-1' style={{ color: '#f87171' }}>
            Invalid Solana address (base58, 32–44 chars)
          </p>
        )}
      </div>

      {/* Amount */}
      <div>
        <div className='flex items-center justify-between mb-1'>
          <label className='text-[11px]' style={{ color: '#8A8A8A' }}>Amount (SOL)</label>
          {!balanceLoading && maxSol !== null && maxSol > 0 && (
            <button
              onClick={() => setAmount(maxSol.toFixed(6))}
              disabled={submitting}
              className='text-[11px] font-bold px-2 py-0.5 rounded-md transition-colors disabled:opacity-50'
              style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.27)' }}
            >
              MAX
            </button>
          )}
        </div>
        <input
          type='number'
          min='0'
          step='any'
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder='0.000000'
          className='glass-input w-full px-3 py-2.5 rounded-lg text-sm tabular-nums outline-none font-mono'
          style={{ borderColor: (amountInvalid || amountTooHigh) ? 'rgba(239,68,68,0.40)' : undefined }}
        />
        {amountTooHigh && (
          <p className='text-[10px] mt-1' style={{ color: '#f87171' }}>
            Exceeds max sendable ({maxSol?.toFixed(6)} SOL)
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={handleSend}
        disabled={!canSubmit}
        className='w-full py-2.5 rounded-xl font-bold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
        style={{ background: canSubmit ? '#b794f6' : 'rgba(183,148,246,0.25)', color: '#fff' }}
      >
        <Send size={12} />
        {submitting ? 'Sending…' : insufficientSol ? 'Insufficient SOL' : 'Send SOL'}
      </button>

      <p className='text-[10px] text-center' style={{ color: '#555' }}>
        Sent from your connected wallet — not your trading account. 0.002 SOL reserved for fees.
      </p>
    </div>
  );
}

// ─── Fund Your Wallet Card ────────────────────────────────────────────────────
// Mobile: collapsed by default, tap header to expand. Desktop: always expanded.

function FundWalletCard({ walletAddress }: { walletAddress: string }) {
  // Start collapsed on mobile (we detect mobile via a small default),
  // but on md+ breakpoint the content is always shown via CSS.
  // Persisted to localStorage so the user's choice is remembered across visits.
  const [mobileOpen, setMobileOpen] = usePersistedCollapse('aeonian:cardCollapsed:portfolio:fundWallet', false);
  const [addressCopied, setAddressCopied] = useState(false);

  // Wallet balances for the title row display
  const [fundSolBalance, setFundSolBalance] = useState<number | null>(null);
  const [fundUsdcBalance, setFundUsdcBalance] = useState<number | null>(null);
  const [fundBalancesLoading, setFundBalancesLoading] = useState(false);

  useEffect(() => {
    const rpcUrl = TAROBASE_CONFIG.rpcUrl;
    if (!walletAddress || !rpcUrl) return;
    let cancelled = false;
    setFundBalancesLoading(true);
    (async () => {
      try {
        const [solRes, usdcRes] = await Promise.all([
          fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [walletAddress] }),
          }),
          fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
              params: [walletAddress, { mint: USDC_MINT }, { encoding: 'jsonParsed' }],
            }),
          }),
        ]);
        const solData = await solRes.json();
        const usdcData = await usdcRes.json();
        if (cancelled) return;
        if (!solData.error) setFundSolBalance(solData.result.value / 1_000_000_000);
        if (!usdcData.error && usdcData.result?.value?.length > 0) {
          const uiAmount = usdcData.result.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
          setFundUsdcBalance(uiAmount ?? 0);
        } else if (!usdcData.error) {
          setFundUsdcBalance(0);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setFundBalancesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  function handleCopyAddress() {
    navigator.clipboard.writeText(walletAddress).then(() => {
      setAddressCopied(true);
      toast.success('Address copied');
      setTimeout(() => setAddressCopied(false), 2000);
    });
  }

  // Balance display for the title row
  const balanceDisplay = fundBalancesLoading ? (
    <span className='text-[10px] tabular-nums' style={{ color: '#666' }}>…</span>
  ) : (
    <span className='text-[10px] tabular-nums font-mono' style={{ color: '#8A8A8A' }}>
      <span style={{ color: '#b794f6' }}>{fundSolBalance !== null ? fundSolBalance.toFixed(3) : '0.000'}</span>
      <span style={{ color: '#555' }}> SOL</span>
      <span style={{ color: '#444' }}> · </span>
      <span style={{ color: '#4ADE80' }}>{fundUsdcBalance !== null ? fundUsdcBalance.toFixed(2) : '0.00'}</span>
      <span style={{ color: '#555' }}> USDC</span>
    </span>
  );

  const cardTitleRow = (
    <div className='flex items-center justify-between gap-2 min-w-0'>
      <span className='text-xs font-semibold flex-shrink-0' style={{ color: '#e2d8f5' }}>Fund Wallet</span>
      <div className='flex items-center min-w-0'>
        {balanceDisplay}
      </div>
    </div>
  );

  const depositContent = (
    <div className='flex gap-3 items-start'>
      {/* QR code + address below it */}
      <div className='flex flex-col items-center gap-1.5 flex-shrink-0'>
        <div className='rounded-lg p-1.5' style={{ background: '#fff' }}>
          <QRCodeSVG
            value={walletAddress}
            size={72}
            bgColor='#ffffff'
            fgColor='#0d0d14'
            level='M'
          />
        </div>
        {/* Wallet address + copy button below QR */}
        <div className='flex items-center gap-0.5'>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className='text-[10px] font-mono cursor-default select-none'
                  style={{ color: '#A78BFA' }}
                >
                  {truncateAddress(walletAddress, 4, 4)}
                </span>
              </TooltipTrigger>
              <TooltipContent side='bottom' className='font-mono text-xs break-all max-w-xs'>
                {walletAddress}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            onClick={handleCopyAddress}
            className='flex items-center p-0.5 rounded transition-all hover:brightness-125 flex-shrink-0'
            style={{ color: '#777' }}
            title='Copy wallet address'
          >
            {addressCopied ? <Check size={11} style={{ color: '#4ADE80' }} /> : <Copy size={11} />}
          </button>
        </div>
      </div>
      {/* Guidance text */}
      <div className='flex flex-col gap-1 min-w-0'>
        <p className='text-[11px] leading-relaxed' style={{ color: '#8A8A8A' }}>
          Scan this QR code or copy your wallet address to send funds to your fund wallet.
        </p>
        <div className='flex flex-col gap-0.5 mt-1'>
          <div className='flex items-start gap-1.5'>
            <span className='text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0' style={{ background: 'rgba(183,148,246,0.18)', color: '#b794f6' }}>SOL</span>
            <span className='text-[11px]' style={{ color: '#8A8A8A' }}>A small amount to cover network transaction fees.</span>
          </div>
          <div className='flex items-start gap-1.5'>
            <span className='text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0' style={{ background: 'rgba(74,222,128,0.13)', color: '#4ADE80' }}>USDC</span>
            <span className='text-[11px]' style={{ color: '#8A8A8A' }}>Your trading collateral — deposit into your trading account below.</span>
          </div>
        </div>
      </div>
    </div>
  );

  const tabsContent = (
    <Tabs defaultValue='deposit'>
      <TabsList
        className='w-full mb-3 h-8'
        style={{
          background: 'rgba(183,148,246,0.08)',
          border: '1px solid rgba(183,148,246,0.15)',
        }}
      >
        <TabsTrigger
          value='deposit'
          className='flex-1 text-[11px] font-semibold h-6 data-[state=active]:text-white'
          style={{ color: '#8A8A8A' }}
        >
          Deposit
        </TabsTrigger>
        <TabsTrigger
          value='swap'
          className='flex-1 text-[11px] font-semibold h-6 data-[state=active]:text-white'
          style={{ color: '#8A8A8A' }}
        >
          Swap
        </TabsTrigger>
        <TabsTrigger
          value='send-sol'
          className='flex-1 text-[11px] font-semibold h-6 data-[state=active]:text-white'
          style={{ color: '#8A8A8A' }}
        >
          Send SOL
        </TabsTrigger>
      </TabsList>
      <TabsContent value='deposit'>
        {depositContent}
      </TabsContent>
      <TabsContent value='swap'>
        <SwapTab walletAddress={walletAddress} />
      </TabsContent>
      <TabsContent value='send-sol'>
        <SendSolTab walletAddress={walletAddress} />
      </TabsContent>
    </Tabs>
  );

  return (
    <>
      <div
        className='mt-3 rounded-xl overflow-hidden'
        style={{ background: 'rgba(183,148,246,0.06)', border: '1px solid rgba(183,148,246,0.15)' }}
      >
        {/* Mobile: collapsible header */}
        <div className='md:hidden'>
          <Collapsible open={mobileOpen} onOpenChange={setMobileOpen}>
            <CollapsibleTrigger className='w-full flex items-center gap-2 px-3 py-2.5 text-left'>
              <div className='flex-1 min-w-0'>
                {cardTitleRow}
              </div>
              <ChevronDown
                size={14}
                className='flex-shrink-0'
                style={{
                  color: '#b794f6',
                  transform: mobileOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className='px-3 pb-3'>
                <p className='text-[10px] mb-2' style={{ color: '#666' }}>Your fund wallet is your connected wallet.</p>
                {tabsContent}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Desktop: always expanded */}
        <div className='hidden md:block p-3'>
          <div className='mb-1'>{cardTitleRow}</div>
          <p className='text-[10px] mb-2' style={{ color: '#666' }}>Your fund wallet is your connected wallet.</p>
          {tabsContent}
        </div>
      </div>
    </>
  );
}

// ─── Deposit Dialog ───────────────────────────────────────────────────────────

function DepositDialog({
  walletAddress,
  onClose,
  onDone,
}: {
  walletAddress: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { blocked } = useGeoBlocked('phoenix');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  useEffect(() => {
    const rpcUrl = TAROBASE_CONFIG.rpcUrl;
    if (!walletAddress || !rpcUrl) return;
    (async () => {
      try {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
            params: [walletAddress, { mint: USDC_MINT }, { encoding: 'jsonParsed' }],
          }),
        });
        const data = await res.json();
        if (!data.error && data.result?.value?.length > 0) {
          const uiAmount = data.result.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
          setUsdcBalance(uiAmount ?? 0);
        } else if (!data.error) {
          setUsdcBalance(0);
        }
      } catch {
        // silently fail
      }
    })();
  }, [walletAddress]);

  async function handleDeposit() {
    const val = parseFloat(amount);
    if (!val || val <= 0) { errorToast('Enter a valid amount.'); return; }
    setLoading(true);
    try {
      await phoenixDeposit(walletAddress, val);
      toast.success(`Added $${val.toFixed(2)}.`);
      onDone();
    } catch (err) {
      console.error('[DEPOSIT] failed:', err);
      errorToast("We couldn't add your funds. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4' style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className='glass-dialog w-full max-w-sm rounded-2xl p-5 space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <ArrowDownToLine size={18} style={{ color: '#b794f6' }} />
            <h3 className='font-bold text-base'>Deposit USDC</h3>
          </div>
          <button onClick={onClose} className='p-1.5 rounded-lg' style={{ color: '#8A8A8A' }}>
            <X size={16} />
          </button>
        </div>

        {blocked && (
          <div className='flex items-center gap-2 p-3 rounded-xl text-xs' style={{ background: '#1A1208', border: '1px solid #3D2A0A', color: '#FFA06E' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            Phoenix Perps is not available in your jurisdiction (US).
          </div>
        )}

        <div>
          <div className='flex items-center justify-between mb-1'>
            <label className='text-xs' style={{ color: '#8A8A8A' }}>Amount (USDC)</label>
            <div className='flex items-center gap-2'>
              <span className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
                Available: {usdcBalance !== null ? `$${usdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '…'}
              </span>
              {usdcBalance !== null && (
                <button
                  onClick={() => setAmount(usdcBalance.toFixed(2))}
                  className='text-xs font-bold px-2 py-0.5 rounded-md transition-colors'
                  style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.27)' }}
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          <input
            type='number'
            min='0'
            step='1'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='0.00'
            className='glass-input w-full px-3 py-3 rounded-lg text-sm tabular-nums outline-none'
          />
        </div>

        <button
          onClick={handleDeposit}
          disabled={loading || blocked}
          className='w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50'
          style={{ background: '#b794f6', color: '#fff' }}
        >
          {loading ? 'Confirming…' : 'Deposit USDC'}
        </button>
      </div>
    </div>
  );
}

// ─── Withdraw Dialog ──────────────────────────────────────────────────────────

function WithdrawDialog({
  walletAddress,
  maxCollateral,
  onClose,
  onDone,
}: {
  walletAddress: string;
  maxCollateral: number | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { blocked } = useGeoBlocked('phoenix');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleWithdraw() {
    const val = parseFloat(amount);
    if (!val || val <= 0) { errorToast('Enter a valid amount.'); return; }
    setLoading(true);
    try {
      await phoenixWithdraw(walletAddress, val);
      toast.success(`Withdrew $${val.toFixed(2)}.`);
      onDone();
    } catch (err) {
      console.error('[WITHDRAW] failed:', err);
      errorToast("We couldn't process your withdrawal. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4' style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className='glass-dialog w-full max-w-sm rounded-2xl p-5 space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <ArrowUpFromLine size={18} style={{ color: '#b794f6' }} />
            <h3 className='font-bold text-base'>Withdraw USDC</h3>
          </div>
          <button onClick={onClose} className='p-1.5 rounded-lg' style={{ color: '#8A8A8A' }}>
            <X size={16} />
          </button>
        </div>

        {/* Available balance — prominent display */}
        {maxCollateral != null && (
          <div
            className='glass-inner rounded-xl p-3 text-center'
          >
            <div className='text-xs mb-1' style={{ color: '#8A8A8A' }}>Available to Withdraw</div>
            <div className='text-2xl font-bold tabular-nums' style={{ color: '#4ADE80' }}>
              {formatUsd(maxCollateral)}
            </div>
            <div className='text-xs mt-0.5' style={{ color: '#555' }}>USDC free collateral</div>
          </div>
        )}

        {blocked && (
          <div className='flex items-center gap-2 p-3 rounded-xl text-xs glass-inner' style={{ color: '#FFA06E' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            Phoenix Perps is not available in your jurisdiction (US).
          </div>
        )}

        <div>
          <div className='flex items-center justify-between mb-1'>
            <label className='text-xs' style={{ color: '#8A8A8A' }}>Amount (USDC)</label>
            <div className='flex items-center gap-2'>
              <span className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
                Available: {maxCollateral != null ? `$${maxCollateral.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '…'}
              </span>
              {maxCollateral != null && (
                <button
                  onClick={() => setAmount(maxCollateral.toFixed(2))}
                  className='text-xs font-bold px-2 py-0.5 rounded-md transition-colors'
                  style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.27)' }}
                >
                  MAX
                </button>
              )}
            </div>
          </div>
          <input
            type='number'
            min='0'
            step='1'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='0.00'
            className='glass-input w-full px-3 py-3 rounded-lg text-sm tabular-nums outline-none'
          />
        </div>

        <button
          onClick={handleWithdraw}
          disabled={loading}
          className='w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50'
          style={{ background: '#b794f6', color: '#fff' }}
        >
          {loading ? 'Confirming…' : 'Withdraw USDC'}
        </button>
      </div>
    </div>
  );
}

// ─── Summary Tile ─────────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div
      className='glass-inner rounded-xl p-3 flex flex-col gap-1'
    >
      <span className='text-[10px] font-medium uppercase tracking-wider truncate' style={{ color: '#555' }}>
        {label}
      </span>
      <span
        className='text-sm font-bold tabular-nums leading-tight'
        style={{ color: color ?? '#FFF', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
      {sub && (
        <span className='text-[10px] tabular-nums' style={{ color: color ? `${color}99` : '#555' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

// ─── Portfolio Breakdown Tab ──────────────────────────────────────────────────

function BreakdownPanel({ trader }: { trader: TraderData }) {
  const positions = Array.isArray(trader.positions) ? trader.positions : [];
  const breakdown = computePortfolioBreakdown(positions);

  const LONG_COLOR = '#4ADE80';
  const SHORT_COLOR = '#FF5252';

  if (positions.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-12 gap-2'>
        <div className='text-3xl'>📊</div>
        <div className='text-sm font-medium' style={{ color: '#555' }}>No open positions</div>
        <div className='text-xs' style={{ color: '#333' }}>Open a position to see your portfolio breakdown.</div>
      </div>
    );
  }

  const chartData = [
    { name: 'Long', value: breakdown.longTotal, color: LONG_COLOR },
    { name: 'Short', value: breakdown.shortTotal, color: SHORT_COLOR },
  ].filter(d => d.value > 0);

  return (
    <div className='p-3 space-y-4'>
      {/* Donut chart + legend */}
      <div className='flex flex-col sm:flex-row items-center gap-4'>
        {/* Donut */}
        <div className='w-full sm:w-40 flex-shrink-0' style={{ height: 160 }}>
          <ResponsiveContainer width='100%' height='100%'>
            <PieChart>
              <Pie
                data={chartData}
                cx='50%'
                cy='50%'
                innerRadius={52}
                outerRadius={72}
                paddingAngle={2}
                dataKey='value'
                stroke='none'
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    const vb = viewBox as { cx?: number; cy?: number };
                    const cx = vb?.cx ?? 80;
                    const cy = vb?.cy ?? 80;
                    return (
                      <g>
                        <text x={cx} y={cy - 8} textAnchor='middle' fill='#8A8A8A' fontSize={10}>
                          Total
                        </text>
                        <text x={cx} y={cy + 8} textAnchor='middle' fill='#FFF' fontSize={13} fontWeight='bold'>
                          {formatUsd(breakdown.totalExposure)}
                        </text>
                      </g>
                    );
                  }}
                />
              </Pie>
              <RechartsTooltip
                formatter={(value: number) => [formatUsd(value), '']}
                contentStyle={{ background: 'rgba(12,14,26,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, backdropFilter: 'blur(12px)' }}
                labelStyle={{ color: '#8A8A8A' }}
                itemStyle={{ color: '#FFF' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className='flex flex-col gap-2 w-full'>
          {/* Long */}
          {breakdown.longTotal > 0 && (
            <div
              className='flex items-center justify-between rounded-lg px-3 py-2'
              style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)' }}
            >
              <div className='flex items-center gap-2'>
                <div className='w-2.5 h-2.5 rounded-full flex-shrink-0' style={{ background: LONG_COLOR }} />
                <span
                  className='text-[10px] font-bold px-1.5 py-0.5 rounded'
                  style={{ background: 'rgba(74,222,128,0.15)', color: LONG_COLOR }}
                >
                  LONG
                </span>
              </div>
              <div className='text-right'>
                <div className='text-sm font-bold tabular-nums' style={{ color: LONG_COLOR }}>
                  {formatUsd(breakdown.longTotal)}
                </div>
                <div className='text-[10px] tabular-nums' style={{ color: '#4ADE8099' }}>
                  {breakdown.longPct.toFixed(1)}% of total
                </div>
              </div>
            </div>
          )}

          {/* Short */}
          {breakdown.shortTotal > 0 && (
            <div
              className='flex items-center justify-between rounded-lg px-3 py-2'
              style={{ background: 'rgba(255,82,82,0.06)', border: '1px solid rgba(255,82,82,0.15)' }}
            >
              <div className='flex items-center gap-2'>
                <div className='w-2.5 h-2.5 rounded-full flex-shrink-0' style={{ background: SHORT_COLOR }} />
                <span
                  className='text-[10px] font-bold px-1.5 py-0.5 rounded'
                  style={{ background: 'rgba(255,82,82,0.15)', color: SHORT_COLOR }}
                >
                  SHORT
                </span>
              </div>
              <div className='text-right'>
                <div className='text-sm font-bold tabular-nums' style={{ color: SHORT_COLOR }}>
                  {formatUsd(breakdown.shortTotal)}
                </div>
                <div className='text-[10px] tabular-nums' style={{ color: '#FF525299' }}>
                  {breakdown.shortPct.toFixed(1)}% of total
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Per-token breakdown list */}
      {breakdown.slices.length > 0 && (
        <div
          className='glass-inner rounded-xl overflow-hidden'
        >
          <div className='px-3 py-2' style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className='text-[10px] font-semibold uppercase tracking-wider' style={{ color: '#555' }}>
              By Token
            </span>
          </div>
          {breakdown.slices.map((slice, i) => {
            const isLong = slice.side === 'long';
            const dotColor = isLong ? LONG_COLOR : SHORT_COLOR;
            return (
              <div
                key={`${slice.symbol}-${slice.side}-${i}`}
                className='flex items-center justify-between px-3 py-2.5'
                style={{ borderBottom: i < breakdown.slices.length - 1 ? '1px solid rgba(255,255,255,0.06)' : undefined }}
              >
                <div className='flex items-center gap-2.5'>
                  <div className='w-2 h-2 rounded-full flex-shrink-0' style={{ background: dotColor }} />
                  <span className='text-sm font-bold'>{slice.symbol}</span>
                  <span
                    className='text-[10px] font-bold px-1.5 py-0.5 rounded'
                    style={{
                      background: isLong ? 'rgba(74,222,128,0.15)' : 'rgba(255,82,82,0.15)',
                      color: isLong ? LONG_COLOR : SHORT_COLOR,
                    }}
                  >
                    {slice.side.toUpperCase()}
                  </span>
                </div>
                <div className='text-right'>
                  <div className='text-sm font-bold tabular-nums'>{formatUsd(slice.exposure)}</div>
                  <div className='text-[10px] tabular-nums' style={{ color: '#555' }}>
                    {slice.pct.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Computed history stats passed to SummaryPanel ───────────────────────────

export interface HistoryStats {
  /** Sum of fill.fee across all fills (null = fills not yet loaded) */
  totalFees: number | null;
  /** Sum of fill.price × fill.size across all fills (null = not yet loaded) */
  totalVolume: number | null;
  /** Realized PnL derived via FIFO from fills (null = fills not yet loaded) */
  realizedPnl: number | null;
  /** Sum of funding entry payments (null = funding history not yet loaded) */
  totalFunding: number | null;
}

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({
  trader,
  historyStats,
}: {
  trader: TraderData;
  historyStats: HistoryStats;
}) {
  const [activeTab, setActiveTab] = useState<'summary' | 'breakdown'>('summary');
  const positions = Array.isArray(trader.positions) ? trader.positions : [];

  const collateral = toNumber(trader.collateralBalance);

  // Cross Initial Margin: use field if present, else derive from position initialMargin sum
  const crossInitialMargin = trader.crossInitialMargin
    ? toNumber(trader.crossInitialMargin)
    : positions.reduce((s, p) => s + toNumber(p.initialMargin), 0);

  // Cross Maint Margin: use field if present, else derive from position maintenanceMargin sum
  const crossMaintMargin = trader.crossMaintenanceMargin
    ? toNumber(trader.crossMaintenanceMargin)
    : positions.reduce((s, p) => s + (p.maintenanceMargin ? toNumber(p.maintenanceMargin) : 0), 0);

  // Cross margin is always available — either from Phoenix field or derived from positions
  const hasCrossMargin = crossInitialMargin > 0 || crossMaintMargin > 0 || positions.some(p => p.initialMargin);

  // Total Exposure: sum of |positionValue| (uses markPrice via computeTotalExposure)
  const totalExposure = computeTotalExposure(positions);

  // Available Cash = collateralBalance - crossInitialMargin, clamped to 0
  const availableCash = Math.max(0, collateral - crossInitialMargin);

  // Unrealized PnL from open positions
  const unrealizedPnl = computeTotalUnrealizedPnl(positions);
  const unrealizedPct = collateral > 0 ? (unrealizedPnl / collateral) * 100 : 0;

  // History-derived values — null means "history not yet loaded" (show loading dot, not "—")
  const realizedPnl = historyStats.realizedPnl;
  const totalFees = historyStats.totalFees;
  const totalVolume = historyStats.totalVolume;
  const totalFunding = historyStats.totalFunding;

  // Position health: collateral / (crossInitialMargin × 2), capped 0–100%
  const healthPct = crossInitialMargin > 0
    ? Math.min(100, Math.max(0, (collateral / (crossInitialMargin * 2)) * 100))
    : 100;
  const healthColor = healthPct >= 50 ? '#4ADE80' : healthPct >= 20 ? '#FACC15' : '#FF5252';

  return (
    <div className='glass-card rounded-xl overflow-hidden'>
      {/* Tab strip */}
      <div className='flex' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => setActiveTab('summary')}
          className='px-4 py-3 text-xs font-semibold transition-colors'
          style={{
            color: activeTab === 'summary' ? '#b794f6' : '#555',
            borderBottom: activeTab === 'summary' ? '2px solid #b794f6' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          Summary
        </button>
        <button
          onClick={() => setActiveTab('breakdown')}
          className='px-4 py-3 text-xs font-semibold transition-colors'
          style={{
            color: activeTab === 'breakdown' ? '#b794f6' : '#555',
            borderBottom: activeTab === 'breakdown' ? '2px solid #b794f6' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          Portfolio Breakdown
        </button>
      </div>

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <div className='p-3 space-y-2'>
          {/* Row 1: always-available metrics */}
          <div className='grid grid-cols-3 gap-2'>
            <SummaryTile
              label='Total Exposure'
              value={totalExposure > 0 ? formatUsd(totalExposure) : '$0.00'}
            />
            <SummaryTile
              label='Collateral'
              value={formatUsd(collateral)}
            />
            <SummaryTile
              label='Available Cash'
              value={formatUsd(availableCash)}
              color='#4ADE80'
            />
          </div>

          {/* Row 2: Unrealized PnL (always) + history-derived metrics */}
          <div className='grid grid-cols-3 gap-2'>
            <SummaryTile
              label='Unrealized PnL'
              value={formatUsd(unrealizedPnl)}
              color={unrealizedPnl >= 0 ? '#4ADE80' : '#FF5252'}
              sub={collateral > 0
                ? `${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}% of col.`
                : undefined}
            />
            <SummaryTile
              label='Realized PnL'
              value={realizedPnl === null ? '…' : formatUsd(realizedPnl)}
              color={realizedPnl !== null ? (realizedPnl >= 0 ? '#4ADE80' : '#FF5252') : '#555'}
            />
            <SummaryTile
              label='Trading Fees'
              value={totalFees === null ? '…' : formatUsd(totalFees)}
              color={totalFees !== null && totalFees < 0 ? '#FF5252' : undefined}
            />
          </div>

          {/* Row 3: Cross margin (derived from positions — always available) + Total Funding + Total Volume */}
          {hasCrossMargin ? (
            <div className='grid grid-cols-3 gap-2'>
              <SummaryTile
                label='Cross Init. Margin'
                value={formatUsd(crossInitialMargin)}
              />
              <SummaryTile
                label='Cross Maint. Margin'
                value={formatUsd(crossMaintMargin)}
              />
              <SummaryTile
                label='Total Funding'
                value={totalFunding === null ? '…' : formatUsd(totalFunding)}
                color={totalFunding !== null && totalFunding < 0 ? '#FF5252' : undefined}
              />
            </div>
          ) : (
            /* No open positions: show Funding + Volume in a 2-col row */
            <div className='grid grid-cols-2 gap-2'>
              <SummaryTile
                label='Total Funding'
                value={totalFunding === null ? '…' : formatUsd(totalFunding)}
                color={totalFunding !== null && totalFunding < 0 ? '#FF5252' : undefined}
              />
              <SummaryTile
                label='Total Volume'
                value={totalVolume === null ? '…' : formatUsd(totalVolume ?? 0)}
              />
            </div>
          )}

          {/* Total Volume row — only shown alongside cross margin tiles (keeps grid balanced) */}
          {hasCrossMargin && (
            <div className='grid grid-cols-1 gap-2'>
              <SummaryTile
                label='Total Volume Traded'
                value={totalVolume === null ? '…' : formatUsd(totalVolume ?? 0)}
              />
            </div>
          )}

          {/* Position Health */}
          <div className='glass-inner rounded-xl p-3 space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Heart size={13} style={{ color: healthColor }} />
                <span className='text-xs font-semibold' style={{ color: '#8A8A8A' }}>
                  Position Health
                </span>
                <span
                  className='text-[10px] font-bold px-1.5 py-0.5 rounded'
                  style={{ background: `${healthColor}20`, color: healthColor }}
                >
                  Cross
                </span>
              </div>
              <span className='text-xs font-bold tabular-nums' style={{ color: healthColor }}>
                {healthPct.toFixed(1)}%
              </span>
            </div>

            {/* Progress bar */}
            <div className='relative h-2 rounded-full overflow-hidden' style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className='absolute inset-y-0 left-0 rounded-full transition-all duration-500'
                style={{ width: `${healthPct}%`, background: healthColor }}
              />
            </div>
            <div className='flex justify-between text-[10px]' style={{ color: '#333' }}>
              <span>0%</span>
              <span>Liquidation risk</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown Tab */}
      {activeTab === 'breakdown' && (
        <BreakdownPanel trader={trader} />
      )}
    </div>
  );
}

// ─── Profile Settings Sheet ───────────────────────────────────────────────────

function ProfileSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { connect, disconnect, loading } = useOAuth();
  const { user } = useAuth();

  // Subscribe directly to the current user's social link doc (same key pattern used by
  // the leaderboard and share cards). This is the authoritative source — the OAuth context's
  // refreshLinks() can silently skip Privy/social wallets where getIdToken() is null.
  const socialLinkKey = user?.address ? `social:${user.address}:twitter` : '';
  const { data: socialLinkDoc } = useRealtimeData<SocialLinksResponse | null>(
    subscribeSocialLinks,
    open && !!user?.address,
    socialLinkKey,
  );

  // Parse the profile JSON from the collection doc (same pattern as UserProfilePopup / leaderboard)
  const xProfile: { username: string; avatar?: string; displayName?: string } | null = (() => {
    if (!socialLinkDoc?.profile) return null;
    try {
      const parsed = typeof socialLinkDoc.profile === 'string'
        ? JSON.parse(socialLinkDoc.profile)
        : socialLinkDoc.profile;
      return parsed?.username ? parsed : null;
    } catch { return null; }
  })();

  const xLinked = !!xProfile;

  // Privacy toggle state
  const [hidePnl, setHidePnl] = useState(false);
  const [privacyLoaded, setPrivacyLoaded] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);

  // Preview-as-others popup
  const [previewOpen, setPreviewOpen] = useState(false);

  // Load current preference when sheet opens
  useEffect(() => {
    if (!open || !user?.address) return;
    setPrivacyLoaded(false);
    getLeaderboardPrivacy(user.address).then((doc) => {
      setHidePnl(doc?.hidePnl ?? false);
      setPrivacyLoaded(true);
    });
  }, [open, user?.address]);

  const handlePrivacyToggle = async (checked: boolean) => {
    if (!user?.address || privacySaving) return;
    setHidePnl(checked);
    setPrivacySaving(true);
    const success = await updateLeaderboardPrivacy(user.address, {
      hidePnl: checked,
      updatedAt: Time.Now,
    });
    setPrivacySaving(false);
    if (!success) {
      // Revert optimistic update on failure
      setHidePnl(!checked);
      errorToast("We couldn't save your preference. Please try again.");
    }
  };

  const handleConnect = async () => {
    await connect('twitter');
  };

  const handleDisconnect = async () => {
    await disconnect('twitter');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='bottom' className='rounded-t-2xl pb-8' style={{ background: '#0e0e0e', border: '1px solid rgba(255,255,255,0.08)' }}>
        <SheetHeader className='mb-5'>
          <SheetTitle className='text-left text-base font-bold' style={{ color: '#E5E5E5' }}>Settings</SheetTitle>
        </SheetHeader>

        {/* X / Twitter connection */}
        <div className='rounded-xl p-4' style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className='flex items-center gap-2 mb-3'>
            {/* X logo SVG */}
            <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' style={{ color: '#E5E5E5', flexShrink: 0 }}>
              <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.732-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
            </svg>
            <span className='font-semibold text-sm' style={{ color: '#E5E5E5' }}>X / Twitter</span>
          </div>

          {xLinked && xProfile ? (
            <div className='space-y-3'>
              {/* Connected state */}
              <div className='flex items-center gap-3'>
                {xProfile.avatar ? (
                  <img
                    src={xProfile.avatar}
                    alt={xProfile.username}
                    className='w-10 h-10 rounded-full flex-shrink-0 object-cover'
                    style={{ border: '2px solid rgba(183,148,246,0.4)' }}
                  />
                ) : (
                  <div className='w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center' style={{ background: 'rgba(183,148,246,0.2)', border: '2px solid rgba(183,148,246,0.4)' }}>
                    <span className='text-base font-bold' style={{ color: '#b794f6' }}>{(xProfile.displayName ?? xProfile.username ?? '?')[0].toUpperCase()}</span>
                  </div>
                )}
                <div className='flex-1 min-w-0'>
                  {xProfile.displayName && (
                    <div className='font-semibold text-sm truncate' style={{ color: '#E5E5E5' }}>{xProfile.displayName}</div>
                  )}
                  <div className='text-xs truncate' style={{ color: '#8A8A8A' }}>@{xProfile.username}</div>
                </div>
                <div className='flex-shrink-0 flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg' style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.25)' }}>
                  <Check size={10} />
                  Connected
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className='w-full py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 min-h-[44px]'
                style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.22)' }}
              >
                {loading ? <Loader2 size={14} className='animate-spin' /> : <X size={14} />}
                Disconnect X Account
              </button>
            </div>
          ) : (
            <div className='space-y-3'>
              <p className='text-xs' style={{ color: '#8A8A8A' }}>Connect your X account to show your avatar and username on the leaderboard.</p>
              <button
                onClick={handleConnect}
                disabled={loading}
                className='w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 min-h-[44px]'
                style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
              >
                {loading ? (
                  <Loader2 size={14} className='animate-spin' />
                ) : (
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor'>
                    <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.732-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
                  </svg>
                )}
                Connect X Account
              </button>
            </div>
          )}
        </div>

        {/* PnL Privacy toggle */}
        {user && (
          <div className='mt-4 rounded-xl p-4' style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex-1 min-w-0'>
                <div className='font-semibold text-sm' style={{ color: '#E5E5E5' }}>Hide my PnL on the leaderboard</div>
                <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>Your name and rank stay visible; only your PnL value is hidden from others.</div>
              </div>
              <Switch
                checked={privacyLoaded ? hidePnl : false}
                disabled={!privacyLoaded || privacySaving}
                onCheckedChange={handlePrivacyToggle}
              />
            </div>

            {/* Preview how others see your profile */}
            <button
              onClick={() => setPreviewOpen(true)}
              className='mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all min-h-[44px]'
              style={{ background: 'rgba(183,148,246,0.12)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
            >
              <Eye size={14} />
              Preview how others see your profile
            </button>
          </div>
        )}
      </SheetContent>

      {/* Read-only preview of the trader's own profile as other viewers see it
          when PnL is hidden. Reuses the shared leaderboard profile popup. */}
      {user?.address && (
        <UserProfilePopup
          traderAddress={user.address}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          previewAsOther
        />
      )}
    </Sheet>
  );
}

// ─── Main Portfolio Page ──────────────────────────────────────────────────────

export function PortfolioPage() {
  const { user, login, logout, loading: authLoading } = useAuth();
  // True on both live mainnet AND mainnet-preview — both use Phoenix's real production API.
  // VITE_ENV is 'LIVE' on live and 'production' on mainnet-preview (set by vite.config.prod.ts).
  const usesLivePhoenixApi = import.meta.env.VITE_ENV === 'LIVE' || import.meta.env.VITE_ENV === 'production';
  const [trader, setTrader] = useState<TraderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [liveDataUnavailable, setLiveDataUnavailable] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const { blocked } = useGeoBlocked('phoenix');
  const appLogoUrl = useAppLogo();

  // History stats — fetched eagerly alongside trader data for Summary panel computation
  const [historyStats, setHistoryStats] = useState<HistoryStats>({
    totalFees: null,
    totalVolume: null,
    realizedPnl: null,
    totalFunding: null,
  });

  const handleClosePosition = useCallback(async (pos: TraderPosition) => {
    if (!user?.address) { errorToast('Log in to close positions.'); return; }
    const posSymbol = pos.symbol ?? 'SOL-PERP';
    const marketPubkey = getMarketPubkey(posSymbol);
    if (!marketPubkey) { errorToast(`This market isn't available right now: ${posSymbol}.`); return; }
    if (!pos.size || pos.size <= 0) { errorToast("This position can't be closed right now."); return; }
    // Narrowed copy — TS loses the `pos.size` narrowing inside the nested async closure below.
    const closeSizeBase = pos.size;

    const closeSide = pos.side?.toLowerCase() === 'long' ? 'short' : 'long';

    // Determine whether this is an isolated sub-account position (index > 0) or cross (index 0 / unset).
    const isIsolated = typeof pos.subaccountIndex === 'number' && pos.subaccountIndex > 0;
    const subaccountIndex = isIsolated ? (pos.subaccountIndex as number) : 0;

    const key = `${posSymbol}:${pos.side ?? ''}`;
    setClosingKey(key);
    const toastId = toast.loading(`Closing your ${pos.side?.toLowerCase()} ${posSymbol.replace(/-PERP$/, '')} position — approve in your wallet…`);

    try {
      const sizeUsdValue = Math.floor((pos.size ?? 0) * (pos.markPrice ?? 0));
      const sizeBaseLots = toBaseLots(posSymbol, pos.size);

      // Realized PnL as a % of margin (cost basis), for the "big win" flag.
      // margin = notional / leverage, so pnl% of margin = (pnl * leverage) / notional * 100.
      // Use the live notional (size × markPrice) and the position's leverage; omit
      // when either is missing so the backend falls back to the $500-only threshold.
      const notionalUsd = (pos.size ?? 0) * (pos.markPrice ?? 0);
      const closePnlPct =
        pos.pnl != null && pos.leverage != null && pos.leverage > 0 && notionalUsd > 0
          ? (pos.pnl * pos.leverage) / notionalUsd * 100
          : undefined;

      // This handler always closes the FULL position (it submits the entire remaining
      // size, pos.size). isFullClose is therefore true whenever the requested close size
      // equals the full position's base lots. The phoenixIsoClose hook uses this flag to
      // atomically sweep freed collateral back to cross/main in the SAME tx on a full close.
      const fullPositionBaseLots = toBaseLots(posSymbol, pos.size);
      const isFullClose = sizeBaseLots >= fullPositionBaseLots;

      // Place the close order in the opposite direction.
      // Isolated positions (subaccountIndex > 0) MUST go through phoenixIsoClose, whose onchain hook
      // runs syncParentToChild BEFORE the reduce order — phoenixOrder skips that step and reverts on-chain.
      // Cross-margin closes (subaccountIndex 0) continue to use phoenixOrder unchanged.
      if (isIsolated) {
        // Isolated close via the Flight SDK so the builder fee is collected (this
        // brings isolated closes onto the same fee rail as cross). A reduce-only
        // close on an isolated subaccount; on a FULL close let the SDK sweep freed
        // collateral back to the parent atomically (skipTransferToParent:false), on a
        // PARTIAL close keep it on the subaccount (the separate sweep below handles it).
        // Flight bypasses the phoenixIsoClose collection, so we re-create its points +
        // trade-record side-effects via /api/phoenix/record-trade.
        //
        // SIZE UNITS: placeIsolatedOrderViaFlight expects HUMAN-READABLE base size
        // (pos.size), NOT base lots — the API converts to lots server-side.
        // TEMPORARY DIAGNOSTIC: capture any swallowed console.error so a revert reason
        // still surfaces verbatim.
        const { result: closeResult, capturedError } = await captureConsoleErrorDuring(async () => {
          try {
            return await placeIsolatedOrderViaFlight({
              walletAddress: user.address,
              symbol: posSymbol,
              side: closeSide === 'long' ? Side.Bid : Side.Ask,
              sizeBase: closeSizeBase, // human-readable base units
              limitPriceUsd: null, // market close
              subaccountIndex,
              isReduceOnly: true,
              skipTransferToParent: !isFullClose,
            });
          } catch (isoErr) {
            return { error: isoErr } as const;
          }
        });

        toast.dismiss(toastId);

        if (!closeResult || 'error' in closeResult) {
          // TEMPORARY DIAGNOSTIC: show the verbatim revert reason for screenshotting.
          const isoErr = closeResult && 'error' in closeResult ? closeResult.error : undefined;
          console.error('[ISO CLOSE] raw failure:', { capturedError, isoErr, diagnostic: buildIsoErrorMessage({ err: isoErr, capturedError }) });
          errorToast("We couldn't close your position. Please try again.");
          setClosingKey(null);
          return;
        }

        await recordFlightTrade(
          {
            txSignature: closeResult.txSignature,
            trader: user.address,
            market: marketPubkey,
            symbol: posSymbol,
            side: closeSide,
            sizeBaseLots,
            leverage: pos.leverage ?? 1,
            orderType: 'market',
            subaccountIndex,
            sizeUsd: sizeUsdValue,
            isClose: true,
            // The position's unrealized PnL becomes realized on close — surface
            // it to followers (signed cents).
            pnlUsdCents: pos.pnl != null ? Math.round(pos.pnl * 100) : undefined,
            pnlPct: closePnlPct,
          },
          login,
        );
      } else {
        // Cross-margin close: route through the Flight SDK so the builder fee is
        // collected. Flight bypasses the phoenixOrder collection, so we re-create
        // its points + trade-record side-effects via /api/phoenix/record-trade.
        //
        // SIZE UNITS: placeOrderViaFlight expects HUMAN-READABLE base size (pos.size),
        // NOT base lots — the Rise SDK converts to lots internally.
        let txSignature: string;
        try {
          const result = await placeOrderViaFlight({
            walletAddress: user.address,
            symbol: posSymbol,
            side: closeSide === 'long' ? Side.Bid : Side.Ask,
            sizeBase: pos.size, // human-readable base units
            limitPriceUsd: null, // market close
            traderSubaccountIndex: 0, // 0 = cross margin
          });
          txSignature = result.txSignature;
        } catch (flightErr) {
          toast.dismiss(toastId);
          console.error('[CLOSE] cross flight failure:', flightErr);
          errorToast("We couldn't close your position. Please try again.");
          setClosingKey(null);
          return;
        }

        toast.dismiss(toastId);

        await recordFlightTrade(
          {
            txSignature,
            trader: user.address,
            market: marketPubkey,
            symbol: posSymbol,
            side: closeSide,
            sizeBaseLots,
            leverage: pos.leverage ?? 1,
            orderType: 'market',
            subaccountIndex: 0,
            sizeUsd: sizeUsdValue,
            isClose: true,
            // Unrealized PnL becomes realized on close — surface it to followers.
            pnlUsdCents: pos.pnl != null ? Math.round(pos.pnl * 100) : undefined,
            pnlPct: closePnlPct,
          },
          login,
        );
      }

      toast.success('Position closed.');
      fetchTrader();

      // For isolated PARTIAL closes, sweep the freed collateral back to the main wallet
      // in a separate transaction. On a FULL close the phoenixIsoClose hook already swept
      // (transferToCross) atomically inside the same close tx, so firing a second sweep here
      // would be redundant and prompt a pointless second wallet signature — skip it.
      if (isIsolated && !isFullClose) {
        const sweepToastId = toast.loading('Moving funds back to your main account…');
        try {
          const sweepId = crypto.randomUUID();
          const swept = await setPhoenixIsolatedSweep(sweepId, { subaccountIndex });
          toast.dismiss(sweepToastId);
          if (swept) {
            toast.success('Funds moved back to your main account.');
          } else {
            errorToast("Your position closed, but we couldn't move the funds back. You can move them manually from your portfolio.");
          }
        } catch (sweepErr) {
          toast.dismiss(sweepToastId);
          console.error('[CLOSE] sweep failure:', sweepErr);
          errorToast("Your position closed, but we couldn't move the funds back. You can move them manually from your portfolio.");
        }
      }
    } catch (err) {
      toast.dismiss(toastId);
      // TEMPORARY DIAGNOSTIC: surface the verbatim error (message + program logs + tx sig).
      console.error('[CLOSE] raw thrown error:', err, buildIsoErrorMessage({ err }));
      errorToast("We couldn't close your position. Please try again.");
    } finally {
      setClosingKey(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.address]);

  async function fetchTrader() {
    if (!user?.address) return;
    setLoading(true);
    setNotFound(false);
    setLiveDataUnavailable(false);
    setErrorMsg(null);

    try {
      // Phoenix is the source of truth for whether a trader account exists.
      // The Tarobase phoenixTrader doc is supplementary metadata — do NOT use it as a gate.
      // Always call the Phoenix API directly for the connected wallet.
      try {
        const data = await api.get<TraderData>(`/api/phoenix/trader/${user.address}`);
        setTrader(data);

        // Eagerly fetch history to compute Summary panel metrics client-side.
        // Fire both requests in parallel; don't block the main trader render.
        void fetchHistoryStats(user.address);
      } catch (err) {
        if (usesLivePhoenixApi) {
          // On mainnet-preview and live the Phoenix API is reachable.
          // Check if the error is a 404 (account not found on Phoenix).
          const msg = (err instanceof Error ? err.message : '') || '';
          if (msg.includes('404') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('trader not found')) {
            // Phoenix doesn't know this wallet — prompt to register on Phoenix
            setNotFound(true);
            setTrader(null);
          } else {
            // Some other API error — surface it so the user can retry.
            // Preserve the last-known-good trader data so the portfolio balance
            // does NOT glitch to zero on a transient background refresh failure.
            setErrorMsg(msg || 'Could not load trading data');
            // intentionally NOT calling setTrader(null) here
          }
        } else {
          // On Poofnet/draft the Phoenix API is not connected — this is expected.
          // Show the friendly "waiting for mainnet" info card.
          setTrader(null);
          setLiveDataUnavailable(true);
        }
      }
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : '') || 'Could not load portfolio';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistoryStats(address: string) {
    // Reset to null (loading state) before fetching
    setHistoryStats({ totalFees: null, totalVolume: null, realizedPnl: null, totalFunding: null });

    // Fetch trades and funding history in parallel
    const [fillsResult, fundingResult] = await Promise.allSettled([
      api.get<unknown>(`/api/phoenix/trader/${address}/trades-history?limit=500`),
      api.get<unknown>(`/api/phoenix/trader/${address}/funding-history`),
    ]);

    // ── Compute from fills ────────────────────────────────────────────────────
    let totalFees: number | null = null;
    let totalVolume: number | null = null;
    let realizedPnl: number | null = null;

    if (fillsResult.status === 'fulfilled') {
      const raw = fillsResult.value;
      const fills: TradeFill[] = Array.isArray(raw)
        ? (raw as TradeFill[])
        : (((raw as Record<string, unknown>).trades ?? (raw as Record<string, unknown>).fills ?? (raw as Record<string, unknown>).data ?? []) as TradeFill[]);

      // Fees: sum fill.fee where present
      if (fills.some(f => f.fee != null)) {
        totalFees = fills.reduce((s, f) => s + (f.fee != null ? Number(f.fee) : 0), 0);
      } else {
        totalFees = 0; // fills loaded but no fee field — show $0 not "…"
      }

      // Volume: sum price × size where both present
      const hasNotional = fills.some(f => f.price != null && f.size != null);
      if (hasNotional) {
        totalVolume = fills.reduce((s, f) => {
          if (f.price != null && f.size != null) return s + Math.abs(Number(f.price)) * Math.abs(Number(f.size));
          return s;
        }, 0);
      } else {
        totalVolume = 0;
      }

      // Realized PnL: FIFO computation from fill history
      const closedTrades = computeClosedTrades(fills);
      realizedPnl = closedTrades.reduce((s, t) => s + t.realizedPnl, 0);
    }

    // ── Compute from funding history ──────────────────────────────────────────
    let totalFunding: number | null = null;

    if (fundingResult.status === 'fulfilled') {
      const raw = fundingResult.value;
      const entries: TraderFundingEntry[] = Array.isArray(raw)
        ? (raw as TraderFundingEntry[])
        : (((raw as Record<string, unknown>).payments ?? (raw as Record<string, unknown>).data ?? []) as TraderFundingEntry[]);

      if (entries.some(e => e.payment != null)) {
        totalFunding = entries.reduce((s, e) => s + (e.payment != null ? Number(e.payment) : 0), 0);
      } else {
        totalFunding = 0; // loaded, no payment field — show $0
      }
    }

    setHistoryStats({ totalFees, totalVolume, realizedPnl, totalFunding });
  }

  useEffect(() => {
    fetchTrader();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.address]);

  if (authLoading) {
    return (
      <div className='min-h-screen pb-28 text-white'>
        <AppHeader />
        <div className='flex flex-col items-center justify-center gap-3 px-4 pt-20'>
          <div className='w-10 h-10 rounded-full animate-pulse' style={{ background: 'rgba(183,148,246,0.15)' }} />
          <p className='text-sm' style={{ color: '#555' }}>Loading…</p>
        </div>
        <BottomTabNav />
      </div>
    );
  }

  if (!user) {
    return (
      <div className='min-h-screen pb-28 text-white'>
        <AppHeader />
        <div className='flex flex-col items-center justify-center gap-4 px-4 pt-20'>
          {appLogoUrl ? (
            <img
              src={appLogoUrl}
              alt='AEONIAN'
              style={{
                width: 48,
                height: 48,
                objectFit: 'contain',
                borderRadius: 10,
              }}
            />
          ) : null}
          <h2 className='font-bold text-xl'>Log In</h2>
          <p className='text-sm text-center' style={{ color: '#8A8A8A' }}>
            Log in to view your portfolio.
          </p>
          <button onClick={login} className='w-full max-w-xs py-3.5 rounded-xl font-bold text-sm' style={{ background: '#b794f6', color: '#fff' }}>
            Log In
          </button>
        </div>
        <BottomTabNav />
      </div>
    );
  }

  return (
    <div className='min-h-screen pb-28 text-white'>
      {/* Shared app header */}
      <AppHeader />

      {/* Page sub-header */}
      <div className='px-4 pt-4 pb-3' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <h1 className='font-bold text-xl'>Account</h1>
        <div className='flex items-center justify-between mt-1'>
          <button
            onClick={logout}
            className='text-xs font-semibold px-3 py-1.5 rounded-md transition-all hover:brightness-110 min-h-[36px]'
            style={{ background: 'rgba(138,138,138,0.12)', color: '#8A8A8A', border: '1px solid rgba(138,138,138,0.2)' }}
          >
            Disconnect
          </button>
          <button
            onClick={() => setProfileSettingsOpen(true)}
            className='flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all hover:brightness-110 min-h-[36px]'
            style={{ background: 'rgba(183,148,246,0.10)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.22)' }}
          >
            <Settings size={12} />
            Settings
          </button>
        </div>
        <ProfileSettingsSheet open={profileSettingsOpen} onOpenChange={setProfileSettingsOpen} />

        {/* QR code + funding guidance */}
        <FundWalletCard walletAddress={user.address} />
      </div>

      <div className='px-4 pt-4 space-y-4'>
        {loading ? (
          <div className='space-y-3'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className='h-20 rounded-xl animate-pulse glass-card' />
            ))}
          </div>
        ) : errorMsg ? (
          <div
            className='glass-card rounded-xl p-5 text-center space-y-3'
          >
            <AlertTriangle size={28} style={{ color: '#b794f6', margin: '0 auto' }} />
            <h2 className='font-bold text-base'>Could not load portfolio</h2>
            <p className='text-xs' style={{ color: '#8A8A8A' }}>{errorMsg}</p>
            <button
              onClick={fetchTrader}
              className='w-full py-3 rounded-xl font-bold text-sm transition-all'
              style={{ background: '#b794f6', color: '#fff' }}
            >
              Retry
            </button>
          </div>
        ) : notFound ? (
          <div
            className='glass-card rounded-xl p-5 text-center space-y-3'
          >
            <div className='text-3xl'>🔥</div>
            <h2 className='font-bold text-base'>Phoenix Account Not Found</h2>
            <p className='text-sm' style={{ color: '#8A8A8A' }}>
              No Phoenix trading account was found for this wallet. Activate your account to start trading.
            </p>
            <button
              onClick={() => setActivateOpen(true)}
              className='w-full py-3.5 rounded-xl font-bold text-sm transition-all'
              style={{ background: '#b794f6', color: '#fff' }}
            >
              Activate Phoenix Account
            </button>
            <ActiveAccountFlow
              open={activateOpen}
              onOpenChange={(open) => {
                setActivateOpen(open);
                // Refetch trader data after the activation flow closes
                if (!open) fetchTrader();
              }}
            />
          </div>
        ) : liveDataUnavailable ? (
          <div
            className='glass-card rounded-xl overflow-hidden'
          >
            <div className='p-5 space-y-1'>
              <div className='flex items-center gap-2.5'>
                <div className='text-2xl'>🔥</div>
                <div>
                  <h2 className='font-bold text-base'>Account Registered</h2>
                  <p className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>
                    Account registered — live trading data will appear on mainnet.
                  </p>
                </div>
              </div>
            </div>
            {/* Deposit / Withdraw even before live data is available */}
            <div className='flex gap-2 px-3 pb-3'>
              <button
                onClick={() => setShowDeposit(true)}
                className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all'
                style={{ background: '#b794f6', color: '#fff' }}
              >
                <ArrowDownToLine size={13} />
                Deposit
              </button>
              <button
                onClick={() => setShowWithdraw(true)}
                className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all glass-button'
                style={{ color: '#FFF' }}
              >
                <ArrowUpFromLine size={13} />
                Withdraw
              </button>
            </div>
          </div>
        ) : trader ? (
          <>
            {/* ─── PNL Summary Card ─────────────────────────────────────────── */}
            {(() => {
              const collateral = toNumber(trader.collateralBalance);
              const crossIM = trader.crossInitialMargin
                ? toNumber(trader.crossInitialMargin)
                : (Array.isArray(trader.positions) ? trader.positions : []).reduce((s: number, p: RisePosition) => s + toNumber(p.initialMargin), 0);
              const freeCollateral = Math.max(0, collateral - crossIM);
              const unrealizedPnl = toNumber(trader.unrealizedPnl);
              const totalValue = toNumber(trader.portfolioValue) || (collateral + unrealizedPnl);
              const pnlPositive = unrealizedPnl >= 0;
              const pnlPct = collateral > 0 ? (unrealizedPnl / collateral) * 100 : 0;

              return (
                <div
                  className='glass-card rounded-xl overflow-hidden'
                >
                  {/* Top: total portfolio value */}
                  <div className='px-4 pt-4 pb-3' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className='text-xs mb-1' style={{ color: '#8A8A8A' }}>Total Portfolio Value</div>
                    <div className='text-3xl font-bold tabular-nums'>{formatUsd(totalValue)}</div>
                    {/* PNL badge */}
                    <div className='flex items-center gap-2 mt-1.5'>
                      <span
                        className='text-sm font-bold tabular-nums px-2 py-0.5 rounded-md'
                        style={{
                          background: pnlPositive ? 'rgba(74,222,128,0.12)' : 'rgba(255,82,82,0.12)',
                          color: pnlPositive ? '#4ADE80' : '#FF5252',
                        }}
                      >
                        {pnlPositive ? '+' : ''}{formatUsd(unrealizedPnl)}
                      </span>
                      <span
                        className='text-xs tabular-nums font-medium'
                        style={{ color: pnlPositive ? '#4ADE80' : '#FF5252' }}
                      >
                        ({pnlPositive ? '+' : ''}{pnlPct.toFixed(2)}%)
                      </span>
                      <span className='text-xs' style={{ color: '#555' }}>Unrealized PnL</span>
                    </div>
                  </div>

                  {/* Metrics row */}
                  <div className='grid grid-cols-2 divide-x' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className='px-4 py-3'>
                      <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Collateral</div>
                      <div className='font-bold tabular-nums text-sm'>{formatUsd(collateral)}</div>
                    </div>
                    <div className='px-4 py-3'>
                      <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Withdrawable</div>
                      <div className='font-bold tabular-nums text-sm' style={{ color: '#4ADE80' }}>{formatUsd(freeCollateral)}</div>
                    </div>
                  </div>

                  {/* Deposit / Withdraw buttons */}
                  <div className='flex gap-2 p-3'>
                    <button
                      onClick={() => setShowDeposit(true)}
                      className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all'
                      style={{ background: '#b794f6', color: '#fff' }}
                    >
                      <ArrowDownToLine size={13} />
                      Deposit
                    </button>
                    <button
                      onClick={() => setShowWithdraw(true)}
                      className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all glass-button'
                      style={{ color: '#FFF' }}
                    >
                      <ArrowUpFromLine size={13} />
                      Withdraw
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ─── Leftover isolated collateral sweep ──────────────────────── */}
            {/* Shows ONLY when an isolated subaccount has free collateral and no
                open position — lets the user move idle funds back to cross/main. */}
            {user && <IsolatedSweepCard walletAddress={user.address} onSwept={fetchTrader} />}

            {/* ─── Summary metrics panel ────────────────────────────────────── */}
            <SummaryPanel trader={trader} historyStats={historyStats} />

            {/* ─── Per-position PNL breakdown ───────────────────────────────── */}
            {(Array.isArray(trader.positions) ? trader.positions : []).length > 0 && (
              <div className='glass-card rounded-xl overflow-hidden'>
                <div className='px-4 py-3' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <h3 className='text-xs font-medium uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                    Positions &amp; PnL
                  </h3>
                </div>
                <div className='divide-y' style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  {(Array.isArray(trader.positions) ? trader.positions as RisePosition[] : []).map((rawPos, i) => {
                    const pos = mapPosition(rawPos);
                    const isLong = pos.side?.toLowerCase() === 'long';
                    const pnlPos = (pos.pnl ?? 0) >= 0;
                    const pnlPctPos = pos.entryPrice && pos.size
                      ? ((pos.pnl ?? 0) / (pos.entryPrice * pos.size)) * 100
                      : null;
                    return (
                      <div key={i} className='px-4 py-3 flex items-center justify-between'>
                        <div className='flex items-center gap-2.5'>
                          <div>
                            <div className='flex items-center gap-1.5'>
                              <span className='font-bold text-sm'>{pos.symbol?.replace(/-PERP$/i, '')}</span>
                              <span
                                className='text-[10px] font-bold px-1.5 py-0.5 rounded'
                                style={{
                                  background: isLong ? 'rgba(74,222,128,0.15)' : 'rgba(255,82,82,0.15)',
                                  color: isLong ? '#4ADE80' : '#FF5252',
                                }}
                              >
                                {pos.side?.toUpperCase()} {pos.leverage != null ? `${pos.leverage}x` : ''}
                              </span>
                            </div>
                            <div className='text-xs mt-0.5 tabular-nums' style={{ color: '#8A8A8A' }}>
                              {pos.size?.toFixed(4) ?? '—'} @ ${pos.entryPrice != null ? formatPrice(pos.entryPrice) : '—'}
                            </div>
                          </div>
                        </div>
                        <div className='text-right'>
                          <div
                            className='font-bold tabular-nums text-sm'
                            style={{ color: pnlPos ? '#4ADE80' : '#FF5252' }}
                          >
                            {pnlPos ? '+' : ''}{formatUsd(pos.pnl)}
                          </div>
                          {pnlPctPos != null && (
                            <div
                              className='text-xs tabular-nums'
                              style={{ color: pnlPos ? '#4ADE80' : '#FF5252', opacity: 0.8 }}
                            >
                              {pnlPos ? '+' : ''}{pnlPctPos.toFixed(2)}%
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unified activity panel: Positions, Trade History, Order History, Funding History (Orders + Orderbook hidden on portfolio) */}
            <UserActivityPanel
              positions={(Array.isArray(trader.positions) ? trader.positions as RisePosition[] : []).map(mapPosition)}
              parentLoading={loading}
              onClosePosition={handleClosePosition}
              closeDisabled={blocked}
              closingKey={closingKey}
              hideOrdersAndOrderbook
            />
          </>
        ) : null}
      </div>

      {/* Deposit Dialog */}
      {showDeposit && user && (
        <DepositDialog
          walletAddress={user.address}
          onClose={() => setShowDeposit(false)}
          onDone={() => { setShowDeposit(false); fetchTrader(); }}
        />
      )}

      {/* Withdraw Dialog */}
      {showWithdraw && user && (
        <WithdrawDialog
          walletAddress={user.address}
          maxCollateral={trader ? Math.max(0, toNumber(trader.collateralBalance) - (trader.crossInitialMargin ? toNumber(trader.crossInitialMargin) : (Array.isArray(trader.positions) ? trader.positions : []).reduce((s: number, p: RisePosition) => s + toNumber(p.initialMargin), 0))) : undefined}
          onClose={() => setShowWithdraw(false)}
          onDone={() => { setShowWithdraw(false); fetchTrader(); }}
        />
      )}

      <BottomTabNav />
    </div>
  );
}

export default PortfolioPage;
