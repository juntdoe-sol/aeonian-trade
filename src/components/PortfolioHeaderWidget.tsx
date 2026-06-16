/**
 * PortfolioHeaderWidget
 *
 * Shows total portfolio value in the app header as a pill button.
 * Clicking it opens a Popover with detailed metrics:
 *   - Total Portfolio Value, Withdrawable, Collateral Balance, Unrealized PnL,
 *     Cross Initial Margin, Cross Maint. Margin, Accumulated Funding
 *   - Position Health section with progress bar
 * Also renders Deposit / Withdraw buttons that open the existing dialogs.
 */

import { api } from '@/lib/api-client';
import { TAROBASE_CONFIG } from '@/lib/config';
import { USDC_MINT } from '@/utils/jupiter-swap';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@pooflabs/web';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Gem,
  Send,
  X,
} from 'lucide-react';
import { WithdrawSolDialog } from './WithdrawSolDialog';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';
import { useGeoBlocked } from '@/hooks/use-geo-blocked';
import { phoenixDeposit, phoenixWithdraw } from '@/utils/phoenix-client';
import { formatUsd } from './trading/types';

// ─── Trader data shape from Phoenix /v1/traders/:authority ───────────────────

interface TraderData {
  collateral?: number;
  freeCollateral?: number;
  unrealizedPnl?: number;
  initialMargin?: number;
  maintenanceMargin?: number;
  accumulatedFunding?: number;
  positions?: { symbol?: string; pnl?: number }[];
  health?: number; // 0-100 float from Phoenix
  [key: string]: unknown;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmt(v: number | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtShort(v: number | undefined): string {
  if (v == null) return '$—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function healthColor(pct: number): string {
  if (pct >= 70) return '#4ADE80';
  if (pct >= 40) return '#b794f6';
  return '#FF5252';
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
    <div
      className='fixed inset-0 z-[100] flex items-center justify-center p-4'
      style={{ background: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className='glass-card w-full max-w-sm rounded-2xl p-5 space-y-4'
      >
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
          <div
            className='flex items-center gap-2 p-3 rounded-xl text-xs glass-inner'
            style={{ color: '#FFA06E' }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            Phoenix Perps is not available in your jurisdiction (US).
          </div>
        )}

        <div>
          <div className='flex items-center justify-between mb-1'>
            <label className='text-xs' style={{ color: '#8A8A8A' }}>
              Amount (USDC)
            </label>
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
    <div
      className='fixed inset-0 z-[100] flex items-center justify-center p-4'
      style={{ background: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className='glass-card w-full max-w-sm rounded-2xl p-5 space-y-4'
      >
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
          <div
            className='flex items-center gap-2 p-3 rounded-xl text-xs glass-inner'
            style={{ color: '#FFA06E' }}
          >
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
          disabled={loading || blocked}
          className='w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50'
          style={{ background: '#b794f6', color: '#fff' }}
        >
          {loading ? 'Confirming…' : 'Withdraw USDC'}
        </button>
      </div>
    </div>
  );
}

// ─── Metric box ───────────────────────────────────────────────────────────────

function MetricBox({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      className='glass-inner rounded-xl p-3 flex flex-col gap-1'
    >
      <span className='text-[11px] leading-tight' style={{ color: '#8A8A8A' }}>
        {label}
      </span>
      <span
        className='text-sm font-bold tabular-nums leading-tight'
        style={{ color: valueColor ?? '#FFFFFF' }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export function PortfolioHeaderWidget() {
  const { user } = useAuth();
  const [trader, setTrader] = useState<TraderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showWithdrawSol, setShowWithdrawSol] = useState(false);

  const fetchTrader = useCallback(async () => {
    if (!user?.address) return;
    setLoading(true);
    try {
      const data = await api.get<TraderData>(`/api/phoenix/trader/${user.address}`);
      setTrader(data);
    } catch {
      setTrader(null);
    } finally {
      setLoading(false);
    }
  }, [user?.address]);

  // Fetch on mount + when user changes
  useEffect(() => {
    fetchTrader();
  }, [fetchTrader]);

  // Refresh after deposit/withdraw
  function handleDone() {
    setShowDeposit(false);
    setShowWithdraw(false);
    fetchTrader();
  }

  if (!user) return null;

  // ── Derived values ──────────────────────────────────────────────────────
  // Phoenix's /v1/traders endpoint returns various fields.
  // collateral = total deposited collateral
  // freeCollateral = withdrawable (free / unused by margin)
  // unrealizedPnl = sum of open position PnL
  // initialMargin / maintenanceMargin / accumulatedFunding / health may be present
  const collateral = trader?.collateral ?? 0;
  const freeCollateral = trader?.freeCollateral ?? 0;
  const unrealizedPnl = trader?.unrealizedPnl ?? 0;
  const initialMargin = trader?.initialMargin ?? 0;
  const maintenanceMargin = trader?.maintenanceMargin ?? 0;
  const accumulatedFunding = trader?.accumulatedFunding ?? 0;
  // Total portfolio value = collateral + unrealizedPnl
  const totalPortfolioValue = collateral + unrealizedPnl;
  // Health: use phoenix's health field if present, else compute from margins
  const rawHealth = trader?.health;
  const computedHealth =
    rawHealth != null
      ? rawHealth * 100
      : maintenanceMargin > 0
      ? Math.min(100, Math.max(0, ((collateral - maintenanceMargin) / Math.max(collateral, 1)) * 100))
      : 100;
  const healthPct = Math.round(computedHealth);
  const atRiskPositions = (trader?.positions ?? []).filter(
    (p) => (p.pnl ?? 0) < -50,
  ).length;

  // Display value in pill: only show if we have data
  const pillLabel =
    loading && !trader
      ? '…'
      : trader
      ? fmtShort(totalPortfolioValue)
      : '$—';

  const pnlColor = unrealizedPnl >= 0 ? '#4ADE80' : '#FF5252';
  const fundingColor = accumulatedFunding >= 0 ? '#4ADE80' : '#FF5252';
  const hColor = healthColor(healthPct);

  return (
    <>
      {/* Balance pill — opens popover */}
      <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              className='flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold tabular-nums transition-all active:scale-95 glass-inner'
              style={{
                color: '#FFF',
              }}
            >
              <span>{pillLabel}</span>
              <ChevronDown
                size={11}
                style={{
                  color: '#8A8A8A',
                  transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
          </PopoverTrigger>

          <PopoverContent
            align='end'
            sideOffset={8}
            className='glass-card-strong w-72 p-0 rounded-2xl overflow-hidden'
            style={{
              boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
            }}
          >
            {/* Header */}
            <div
              className='px-4 pt-4 pb-3'
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className='flex items-center justify-between'>
                <span className='text-xs font-semibold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Account
                </span>
                <button
                  onClick={() => setOpen(false)}
                  className='p-1 rounded-md'
                  style={{ color: '#555' }}
                >
                  <X size={13} />
                </button>
              </div>
              <div
                className='mt-1 text-2xl font-bold tabular-nums'
                style={{ color: '#FFFFFF' }}
              >
                {loading && !trader ? (
                  <span style={{ color: '#555' }}>Loading…</span>
                ) : (
                  fmt(totalPortfolioValue)
                )}
              </div>
              <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>
                Total Portfolio Value
              </div>
            </div>

            {trader ? (
              <>
                {/* Metrics grid */}
                <div className='p-3 grid grid-cols-2 gap-2'>
                  <MetricBox
                    label='Withdrawable'
                    value={fmt(freeCollateral)}
                  />
                  <MetricBox
                    label='Collateral Balance'
                    value={fmt(collateral)}
                  />
                  <MetricBox
                    label='Unrealized PnL'
                    value={fmt(unrealizedPnl)}
                    valueColor={pnlColor}
                  />
                  <MetricBox
                    label='Cross Initial Margin'
                    value={fmt(initialMargin)}
                  />
                  <MetricBox
                    label='Cross Maint. Margin'
                    value={fmt(maintenanceMargin)}
                  />
                  <MetricBox
                    label='Accumulated Funding'
                    value={fmt(accumulatedFunding)}
                    valueColor={fundingColor}
                  />
                </div>

                {/* Position Health */}
                <div
                  className='glass-inner mx-3 mb-3 rounded-xl p-3 space-y-2'
                >
                  {/* Label row */}
                  <div className='flex items-center justify-between'>
                    <span className='text-xs font-semibold' style={{ color: '#FFFFFF' }}>
                      Position Health
                    </span>
                    {atRiskPositions > 0 && (
                      <div className='flex items-center gap-1 text-[10px] font-medium' style={{ color: '#b794f6' }}>
                        <AlertTriangle size={11} />
                        <span>{atRiskPositions} position{atRiskPositions > 1 ? 's' : ''} at risk</span>
                      </div>
                    )}
                  </div>

                  {/* Cross row */}
                  <div className='flex items-center gap-2'>
                    <span className='text-[11px] w-10 shrink-0' style={{ color: '#8A8A8A' }}>Cross</span>
                    <div
                      className='flex-1 rounded-full overflow-hidden'
                      style={{ height: 6, background: 'rgba(255,255,255,0.06)' }}
                    >
                      <div
                        className='h-full rounded-full transition-all duration-500'
                        style={{
                          width: `${healthPct}%`,
                          background: hColor,
                          boxShadow: `0 0 6px ${hColor}66`,
                        }}
                      />
                    </div>
                    <div
                      className='flex items-center gap-1 text-xs font-bold tabular-nums'
                      style={{ color: hColor, minWidth: 44, justifyContent: 'flex-end' }}
                    >
                      <Gem size={10} style={{ flexShrink: 0 }} />
                      <span>{healthPct}%</span>
                    </div>
                  </div>
                </div>

                {/* Deposit / Withdraw actions inside popup */}
                <div
                  className='flex gap-2 px-3 pb-3'
                >
                  <button
                    onClick={() => { setOpen(false); setShowDeposit(true); }}
                    className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all'
                    style={{ background: '#b794f6', color: '#fff' }}
                  >
                    <ArrowDownToLine size={12} />
                    Deposit
                  </button>
                  <button
                    onClick={() => { setOpen(false); setShowWithdraw(true); }}
                    className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all glass-button'
                    style={{ color: '#FFF' }}
                  >
                    <ArrowUpFromLine size={12} />
                    Withdraw
                  </button>
                  <button
                    onClick={() => { setOpen(false); setShowWithdrawSol(true); }}
                    className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all glass-button'
                    style={{ color: '#b794f6' }}
                  >
                    <Send size={12} />
                    Send SOL
                  </button>
                </div>
              </>
            ) : !loading ? (
              <div className='px-4 py-6 text-center text-sm' style={{ color: '#8A8A8A' }}>
                No portfolio data found.
              </div>
            ) : (
              <div className='px-4 py-6 text-center text-sm' style={{ color: '#8A8A8A' }}>
                Loading portfolio…
              </div>
            )}
          </PopoverContent>
        </Popover>

      {/* Deposit Dialog */}
      {showDeposit && (
        <DepositDialog
          walletAddress={user.address}
          onClose={() => setShowDeposit(false)}
          onDone={handleDone}
        />
      )}

      {/* Withdraw Dialog */}
      {showWithdraw && (
        <WithdrawDialog
          walletAddress={user.address}
          maxCollateral={trader?.freeCollateral}
          onClose={() => setShowWithdraw(false)}
          onDone={handleDone}
        />
      )}

      {/* Withdraw SOL Dialog */}
      {showWithdrawSol && (
        <WithdrawSolDialog
          walletAddress={user.address}
          zClass='z-[100]'
          onClose={() => setShowWithdrawSol(false)}
          onDone={() => {
            setShowWithdrawSol(false);
            // Refetch balances ~2s later
            setTimeout(() => fetchTrader(), 2000);
          }}
        />
      )}
    </>
  );
}

export default PortfolioHeaderWidget;
