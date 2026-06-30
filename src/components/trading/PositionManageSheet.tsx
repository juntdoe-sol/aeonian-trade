import { useEffect, useState, useCallback } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TokenLogo } from '@/components/TokenLogo';
import { errorToast } from '@/utils/toast-helpers';
import { toast } from 'sonner';
import { useAuth } from '@pooflabs/web';
import { useIsMobile } from '@/hooks/use-mobile';
import { setPhoenixIsolatedTransfer } from '@/lib/collections/phoenixIsolatedTransfer';
import { setPhoenixIsolatedSweep } from '@/lib/collections/phoenixIsolatedSweep';
import {
  placeConditionalOrdersViaFlight,
  clearConditionalOrdersViaFlight,
  readActiveConditionalTriggers,
  type ActiveConditionalTriggers,
} from '@/utils/phoenix-flight';
import { formatPrice, formatUsd, getLiqRisk, type TraderPosition } from './types';

interface PositionManageSheetProps {
  open: boolean;
  onClose: () => void;
  position: TraderPosition | null;
  /** Live mark price for this symbol, if available. */
  liveMark?: number;
  /** Called after a successful margin transfer so the parent can refresh balances. */
  onMarginChanged?: () => void;
  /** Opens the share card for this position. */
  onShare?: () => void;
  /** Closes (exits) the position. */
  onClosePosition?: () => void;
  /** Whether the close button should be disabled (e.g. geo-blocked). */
  closeDisabled?: boolean;
}

/** Small labelled metric cell used in the details grid. */
function DetailCell({
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
      className='rounded-xl p-3'
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className='text-[11px]' style={{ color: '#8A8A8A' }}>{label}</div>
      <div className='tabular-nums font-bold text-sm mt-0.5' style={{ color: valueColor ?? '#FFFFFF' }}>
        {value}
      </div>
    </div>
  );
}

export function PositionManageSheet({
  open,
  onClose,
  position,
  liveMark,
  onMarginChanged,
  onShare,
  onClosePosition,
  closeDisabled,
}: PositionManageSheetProps) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [marginMode, setMarginMode] = useState<'add' | 'reduce'>('add');
  const [marginAmount, setMarginAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── SL/TP editor state ──────────────────────────────────────────────────
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [triggerSubmitting, setTriggerSubmitting] = useState(false);
  // The live on-chain triggers currently attached to the position. Loaded on
  // open; falls back to the recorded open-time metadata if readback is empty.
  const [activeTriggers, setActiveTriggers] = useState<ActiveConditionalTriggers | null>(null);
  const [loadingTriggers, setLoadingTriggers] = useState(false);

  const symbol = position?.symbol ?? '';
  const sideStr: 'long' | 'short' = position?.side?.toLowerCase() === 'long' ? 'long' : 'short';
  const subaccountIndex = position?.subaccountIndex ?? 0;
  const walletAddress = user?.address ?? '';

  // Load the position's live on-chain SL/TP triggers when the sheet opens.
  const loadTriggers = useCallback(async () => {
    if (!open || !symbol || !walletAddress) return;
    setLoadingTriggers(true);
    try {
      const t = await readActiveConditionalTriggers({
        walletAddress,
        symbol,
        positionSide: sideStr,
        traderSubaccountIndex: subaccountIndex,
      });
      setActiveTriggers(t);
      setSlInput(t.stopLossUsd != null ? String(t.stopLossUsd) : '');
      setTpInput(t.takeProfitUsd != null ? String(t.takeProfitUsd) : '');
    } catch (err) {
      console.error('[POSITION SL/TP] read failed:', err);
      // Leave activeTriggers null → render falls back to recorded metadata.
      setActiveTriggers(null);
    } finally {
      setLoadingTriggers(false);
    }
  }, [open, symbol, walletAddress, sideStr, subaccountIndex]);

  // Reset the form each time the sheet opens for a (potentially new) position.
  useEffect(() => {
    if (open) {
      setMarginMode('add');
      setMarginAmount('');
      setSubmitting(false);
      setTriggerSubmitting(false);
      setActiveTriggers(null);
      setSlInput('');
      setTpInput('');
      void loadTriggers();
    }
  }, [open, position?.symbol, position?.side, loadTriggers]);

  if (!position) return null;

  const isLong = position.side?.toLowerCase() === 'long';
  const pnlPositive = (position.pnl ?? 0) >= 0;
  const isIsolated = position.subaccountIndex != null && position.subaccountIndex > 0;
  const effectiveMark = liveMark ?? position.markPrice;
  const risk = isIsolated ? getLiqRisk({ effectiveMark, liq: position.liquidationPrice }) : null;

  // ── Leverage calculations ────────────────────────────────────────────────
  // Entry leverage: notional at open / initial margin posted.
  // Effective leverage: current notional (live mark × size) / initial margin.
  // Both hidden rather than shown as dashes when the required inputs are missing.
  const margin = position.initialMargin;
  const size = position.size;
  const entryLeverage: number | null =
    margin != null && margin > 0 && size != null && size > 0 && position.entryPrice != null && position.entryPrice > 0
      ? (size * position.entryPrice) / margin
      : null;
  const effectiveLeverage: number | null =
    margin != null && margin > 0 && size != null && size > 0 && effectiveMark != null && effectiveMark > 0
      ? (size * effectiveMark) / margin
      : null;

  // Recorded open-time SL/TP metadata — used only as a display fallback when the
  // live on-chain readback hasn't returned (or returned nothing). Newly-placed
  // triggers always reflect via activeTriggers after a successful submit.
  const recordedSl = position.stopLossPrice;
  const recordedTp = position.takeProfitPrice;

  // Effective levels shown for "currently set": prefer the live on-chain read,
  // fall back to recorded metadata.
  const shownSl = activeTriggers ? activeTriggers.stopLossUsd : (recordedSl ?? null);
  const shownTp = activeTriggers ? activeTriggers.takeProfitUsd : (recordedTp ?? null);
  const hasAnyTrigger = (shownSl != null && shownSl > 0) || (shownTp != null && shownTp > 0);

  async function handleTriggerSubmit() {
    if (!position || triggerSubmitting) return;
    if (!walletAddress) {
      errorToast('Please log in to set Stop-Loss / Take-Profit.');
      return;
    }
    const sl = slInput.trim() === '' ? null : parseFloat(slInput);
    const tp = tpInput.trim() === '' ? null : parseFloat(tpInput);

    if (sl != null && (!isFinite(sl) || sl <= 0)) {
      errorToast('Enter a valid Stop-Loss price.');
      return;
    }
    if (tp != null && (!isFinite(tp) || tp <= 0)) {
      errorToast('Enter a valid Take-Profit price.');
      return;
    }

    // Validate ordering against the mark so triggers can actually fire.
    const mark = effectiveMark;
    if (mark && mark > 0) {
      if (sideStr === 'long') {
        if (tp != null && tp <= mark) {
          errorToast('Take-Profit must be above the current price for a long.');
          return;
        }
        if (sl != null && sl >= mark) {
          errorToast('Stop-Loss must be below the current price for a long.');
          return;
        }
      } else {
        if (tp != null && tp >= mark) {
          errorToast('Take-Profit must be below the current price for a short.');
          return;
        }
        if (sl != null && sl <= mark) {
          errorToast('Stop-Loss must be above the current price for a short.');
          return;
        }
      }
    }

    const clearingBoth = sl == null && tp == null;
    setTriggerSubmitting(true);
    const toastId = toast.loading(
      clearingBoth ? 'Removing triggers — approve in your wallet…' : 'Updating Stop-Loss / Take-Profit — approve in your wallet…',
    );
    try {
      if (clearingBoth) {
        await clearConditionalOrdersViaFlight({
          walletAddress,
          symbol,
          traderSubaccountIndex: subaccountIndex,
        });
      } else {
        await placeConditionalOrdersViaFlight({
          walletAddress,
          symbol,
          positionSide: sideStr,
          triggers: { stopLossUsd: sl, takeProfitUsd: tp },
          traderSubaccountIndex: subaccountIndex,
        });
      }
      toast.dismiss(toastId);
      toast.success(
        clearingBoth ? 'Stop-Loss / Take-Profit cleared.' : 'Stop-Loss / Take-Profit updated.',
      );
      // Optimistically reflect the new state, then re-read from chain.
      setActiveTriggers({ stopLossUsd: sl, takeProfitUsd: tp });
      void loadTriggers();
    } catch (err) {
      toast.dismiss(toastId);
      console.error('[POSITION SL/TP] submit failed:', err);
      const raw = err instanceof Error ? err.message : String(err);
      errorToast(`We couldn't update your triggers. ${raw}`.slice(0, 300));
    } finally {
      setTriggerSubmitting(false);
    }
  }

  async function handleClearTriggers() {
    if (!position || triggerSubmitting || !walletAddress) return;
    setTriggerSubmitting(true);
    const toastId = toast.loading('Removing triggers — approve in your wallet…');
    try {
      await clearConditionalOrdersViaFlight({
        walletAddress,
        symbol,
        traderSubaccountIndex: subaccountIndex,
      });
      toast.dismiss(toastId);
      toast.success('Stop-Loss / Take-Profit cleared.');
      setSlInput('');
      setTpInput('');
      setActiveTriggers({ stopLossUsd: null, takeProfitUsd: null });
      void loadTriggers();
    } catch (err) {
      toast.dismiss(toastId);
      console.error('[POSITION SL/TP] clear failed:', err);
      const raw = err instanceof Error ? err.message : String(err);
      errorToast(`We couldn't clear your triggers. ${raw}`.slice(0, 300));
    } finally {
      setTriggerSubmitting(false);
    }
  }

  async function handleMarginSubmit() {
    if (!position || submitting) return;
    const idx = position.subaccountIndex;
    if (idx == null || idx <= 0) return;
    const val = parseFloat(marginAmount);

    if (marginMode === 'add') {
      if (!val || val <= 0) {
        errorToast('Enter an amount to add.');
        return;
      }
      setSubmitting(true);
      const toastId = toast.loading('Adding margin — approve in your wallet…');
      try {
        // amt is in micro-USDC (6 decimals, integer); move free cross collateral
        // into this isolated subaccount via the existing transfer passthrough.
        const amtMicro = Math.round(val * 1_000_000);
        const ok = await setPhoenixIsolatedTransfer(crypto.randomUUID(), {
          amt: amtMicro,
          subaccountIndex: idx,
        });
        toast.dismiss(toastId);
        if (!ok) {
          errorToast("We couldn't add margin. Check your available balance and try again.");
          return;
        }
        toast.success(`Added ${formatUsd(val)} margin.`);
        setMarginAmount('');
        onMarginChanged?.();
      } catch (err) {
        toast.dismiss(toastId);
        console.error('[POSITION MARGIN] add failed:', err);
        errorToast("We couldn't add margin. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Reduce → sweep idle free collateral on this subaccount back to cross.
    // The sweep moves ALL free (unused) collateral; collateral locked by the
    // open position stays put, and an open position can block the sweep on-chain.
    setSubmitting(true);
    const toastId = toast.loading('Reducing margin — approve in your wallet…');
    try {
      const ok = await setPhoenixIsolatedSweep(crypto.randomUUID(), {
        subaccountIndex: idx,
      });
      toast.dismiss(toastId);
      if (!ok) {
        errorToast("We couldn't reduce margin. Only collateral not in use can be moved back.");
        return;
      }
      toast.success('Moved idle margin back to your main balance.');
      setMarginAmount('');
      onMarginChanged?.();
    } catch (err) {
      toast.dismiss(toastId);
      console.error('[POSITION MARGIN] reduce failed:', err);
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('position') || msg.includes('open')) {
        errorToast('Only collateral not locked by the position can be moved back.');
      } else {
        errorToast("We couldn't reduce margin. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Shared header content (logo + side pill + isolated badge) ─────────────
  const headerInner = (
    <div className='flex items-center gap-2'>
      {position.symbol && <TokenLogo symbol={position.symbol} size={24} />}
      <span className='font-bold text-base' style={{ color: '#FFFFFF' }}>{position.symbol}</span>
      <span
        className='text-xs font-semibold px-2 py-0.5 rounded'
        style={{
          background: isLong ? 'rgba(74,222,128,0.10)' : 'rgba(255,82,82,0.10)',
          color: isLong ? '#4ADE80' : '#FF5252',
          border: `1px solid ${isLong ? 'rgba(74,222,128,0.25)' : 'rgba(255,82,82,0.25)'}`,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {position.side?.toUpperCase()} {position.leverage != null ? `${position.leverage}x` : ''}
      </span>
      {isIsolated && (
        <span
          className='text-[10px] font-bold px-1.5 py-0.5 rounded'
          style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6' }}
        >
          Isolated
        </span>
      )}
    </div>
  );

  // ── Shared body (details + SL/TP editor + margin management) ──────────────
  const body = (
    <>
      {/* ── Full position details ───────────────────────────────────────── */}
      <div className='grid grid-cols-2 gap-2'>
        <DetailCell label='Size' value={position.size?.toFixed(4) ?? '—'} />
        <DetailCell
          label='PnL'
          value={formatUsd(position.pnl)}
          valueColor={pnlPositive ? '#4ADE80' : '#FF5252'}
        />
        <DetailCell label='Entry Price' value={`$${formatPrice(position.entryPrice)}`} />
        <DetailCell label='Mark Price' value={`$${formatPrice(effectiveMark)}`} />
        <DetailCell label='Liq. Price' value={`$${formatPrice(position.liquidationPrice)}`} valueColor='#b794f6' />
        <DetailCell label='Margin' value={formatUsd(position.initialMargin)} />
        {entryLeverage !== null && (
          <DetailCell label='Entry Leverage' value={`${entryLeverage.toFixed(1)}x`} />
        )}
        {effectiveLeverage !== null && (
          <DetailCell
            label='Effective Leverage'
            value={`${effectiveLeverage.toFixed(1)}x`}
            valueColor={
              effectiveLeverage >= 20
                ? '#FF5252'
                : effectiveLeverage >= 10
                  ? '#FBBF24'
                  : '#FFFFFF'
            }
          />
        )}
      </div>

      {risk?.distancePct != null && (
        <div className='mt-2 flex items-center justify-between rounded-xl px-3 py-2 text-xs'
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <span className='flex items-center gap-1.5' style={{ color: '#8A8A8A' }}>
            <ShieldAlert size={13} style={{ color: risk.color }} />
            Liquidation distance
          </span>
          <span className='tabular-nums font-bold' style={{ color: risk.color }}>
            {risk.distancePct.toFixed(1)}%
          </span>
        </div>
      )}

      {/* ── Stop-Loss / Take-Profit (live on-chain trigger orders) ─────────── */}
      <div className='mt-5'>
        <div className='flex items-center justify-between mb-2'>
          <h4 className='text-sm font-bold' style={{ color: '#FFFFFF' }}>Stop-Loss &amp; Take-Profit</h4>
          {loadingTriggers && <Loader2 size={14} className='animate-spin' style={{ color: '#8A8A8A' }} />}
        </div>
        <div
          className='rounded-xl p-3 space-y-3'
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Take-Profit input */}
          <div>
            <label className='flex items-center gap-1.5 text-[11px] mb-1' style={{ color: '#E5E5E5' }}>
              <TrendingUp size={13} style={{ color: '#4ADE80' }} />
              Take-Profit price (USD)
            </label>
            <input
              type='number'
              min='0'
              step='any'
              inputMode='decimal'
              value={tpInput}
              onChange={(e) => setTpInput(e.target.value)}
              disabled={triggerSubmitting}
              placeholder={shownTp != null && shownTp > 0 ? `$${formatPrice(shownTp)}` : 'No take-profit'}
              className='glass-input w-full px-3 py-2.5 rounded-lg text-sm tabular-nums outline-none'
            />
          </div>

          {/* Stop-Loss input */}
          <div>
            <label className='flex items-center gap-1.5 text-[11px] mb-1' style={{ color: '#E5E5E5' }}>
              <TrendingDown size={13} style={{ color: '#FF5252' }} />
              Stop-Loss price (USD)
            </label>
            <input
              type='number'
              min='0'
              step='any'
              inputMode='decimal'
              value={slInput}
              onChange={(e) => setSlInput(e.target.value)}
              disabled={triggerSubmitting}
              placeholder={shownSl != null && shownSl > 0 ? `$${formatPrice(shownSl)}` : 'No stop-loss'}
              className='glass-input w-full px-3 py-2.5 rounded-lg text-sm tabular-nums outline-none'
            />
          </div>

          <p className='text-[11px] leading-relaxed' style={{ color: '#8A8A8A' }}>
            Triggers run on-chain and close your full position at market when the price is reached.
            Leave a field blank to remove that trigger.
          </p>

          <button
            onClick={handleTriggerSubmit}
            disabled={triggerSubmitting || (slInput.trim() === '' && tpInput.trim() === '' && !hasAnyTrigger)}
            className='w-full flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50'
            style={{ background: '#b794f6', color: '#fff' }}
          >
            {triggerSubmitting ? (
              <>
                <Loader2 size={15} className='animate-spin' />
                Confirming…
              </>
            ) : hasAnyTrigger ? (
              'Update triggers'
            ) : (
              'Set triggers'
            )}
          </button>

          {hasAnyTrigger && (
            <button
              onClick={handleClearTriggers}
              disabled={triggerSubmitting}
              className='w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-semibold text-xs transition-all disabled:opacity-50'
              style={{ background: 'rgba(255,82,82,0.1)', color: '#FF5252', border: '1px solid rgba(255,82,82,0.25)' }}
            >
              Remove all triggers
            </button>
          )}
        </div>
      </div>

      {/* ── Isolated margin management (isolated positions only) ─────────── */}
      {isIsolated && (
        <div className='mt-5'>
          <h4 className='text-sm font-bold mb-2' style={{ color: '#FFFFFF' }}>Manage Margin</h4>
          <div
            className='rounded-xl p-3 space-y-3'
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {/* Add / Reduce toggle */}
            <div className='grid grid-cols-2 gap-2'>
              <button
                onClick={() => setMarginMode('add')}
                disabled={submitting}
                className='flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all'
                style={{
                  background: marginMode === 'add' ? 'rgba(183,148,246,0.2)' : 'rgba(255,255,255,0.05)',
                  color: marginMode === 'add' ? '#b794f6' : '#8A8A8A',
                  border: marginMode === 'add' ? '1px solid rgba(183,148,246,0.4)' : '1px solid transparent',
                }}
              >
                <ArrowDownToLine size={13} />
                Add margin
              </button>
              <button
                onClick={() => setMarginMode('reduce')}
                disabled={submitting}
                className='flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all'
                style={{
                  background: marginMode === 'reduce' ? 'rgba(183,148,246,0.2)' : 'rgba(255,255,255,0.05)',
                  color: marginMode === 'reduce' ? '#b794f6' : '#8A8A8A',
                  border: marginMode === 'reduce' ? '1px solid rgba(183,148,246,0.4)' : '1px solid transparent',
                }}
              >
                <ArrowUpFromLine size={13} />
                Reduce margin
              </button>
            </div>

            {marginMode === 'add' ? (
              <>
                <div>
                  <label className='text-[11px]' style={{ color: '#8A8A8A' }}>Amount to add (USDC)</label>
                  <input
                    type='number'
                    min='0'
                    step='1'
                    value={marginAmount}
                    onChange={(e) => setMarginAmount(e.target.value)}
                    placeholder='0.00'
                    className='glass-input w-full px-3 py-3 rounded-lg text-sm tabular-nums outline-none mt-1'
                  />
                </div>
                <p className='text-[11px] leading-relaxed' style={{ color: '#8A8A8A' }}>
                  Moves free collateral from your main balance into this isolated position to lower its liquidation risk.
                </p>
              </>
            ) : (
              <p className='text-[11px] leading-relaxed' style={{ color: '#8A8A8A' }}>
                Moves any collateral not locked by this position back to your main balance.
              </p>
            )}

            <button
              onClick={handleMarginSubmit}
              disabled={submitting || (marginMode === 'add' && (!marginAmount || parseFloat(marginAmount) <= 0))}
              className='w-full flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50'
              style={{ background: '#b794f6', color: '#fff' }}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className='animate-spin' />
                  Confirming…
                </>
              ) : marginMode === 'add' ? (
                'Add margin'
              ) : (
                'Reduce margin'
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Share / Close action row ─────────────────────────────────────── */}
      {(onShare || onClosePosition) && (
        <div className='mt-6 pt-4 flex gap-2' style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {onShare && (
            <button
              onClick={onShare}
              className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all'
              style={{
                background: 'rgba(255,255,255,0.07)',
                color: '#FFFFFF',
                border: '1px solid rgba(255,255,255,0.15)',
                letterSpacing: '0.03em',
              }}
            >
              Share
            </button>
          )}
          {onClosePosition && (
            <button
              onClick={onClosePosition}
              disabled={!!closeDisabled}
              className='flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40'
              style={{
                background: 'rgba(255,255,255,0.07)',
                color: '#FFFFFF',
                border: '1px solid rgba(255,255,255,0.15)',
                letterSpacing: '0.03em',
                cursor: closeDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              Close Position
            </button>
          )}
        </div>
      )}
    </>
  );

  // Mobile → bottom Sheet (primary, touch-tuned). Desktop → centered Dialog.
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent
          side='bottom'
          className='rounded-t-2xl pb-8 max-h-[92vh] overflow-y-auto'
          style={{ background: '#0e0e0e', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <SheetHeader className='mb-4'>
            <SheetTitle className='text-left'>{headerInner}</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className='max-w-md max-h-[90vh] overflow-y-auto'
        style={{ background: '#1a1a1f', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <DialogHeader className='mb-2'>
          <DialogTitle className='text-left'>{headerInner}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
