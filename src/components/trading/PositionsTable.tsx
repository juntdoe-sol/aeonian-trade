import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { TokenLogo } from '@/components/TokenLogo';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyPhoenixSubaccount, type PhoenixSubaccountResponse } from '@/lib/collections/phoenixSubaccount';
import { useAuth } from '@pooflabs/web';
import { formatPrice, formatUsd, getLiqRisk, type LiqRisk, type TraderPosition } from './types';
import { OpenPositionShareModal } from './OpenPositionShareModal';
import { PositionManageSheet } from './PositionManageSheet';

interface PositionsTableProps {
  positions: TraderPosition[];
  loading?: boolean;
  /** Called when user clicks Close on a position row */
  onClose?: (pos: TraderPosition) => void;
  /** Whether the close button should be disabled (e.g. geo-blocked) */
  closeDisabled?: boolean;
  /** Which position is currently submitting a close (keyed by symbol+side) */
  closingKey?: string | null;
  /**
   * Live mark prices keyed by normalised symbol (e.g. "SOL-PERP").
   * Used as a fallback in the share card when the position snapshot lacks a mark price.
   */
  liveMarkBySymbol?: Map<string, number>;
}

function posKey(pos: TraderPosition): string {
  return `${pos.symbol ?? ''}:${pos.side ?? ''}`;
}

export function PositionsTable({ positions, loading, onClose, closeDisabled, closingKey, liveMarkBySymbol }: PositionsTableProps) {
  const { user } = useAuth();
  const [sharePosition, setSharePosition] = useState<TraderPosition | null>(null);
  const [managePosition, setManagePosition] = useState<TraderPosition | null>(null);
  const { data: subaccounts } = useRealtimeData<PhoenixSubaccountResponse[]>(
    subscribeManyPhoenixSubaccount,
    !!user?.address,
    `where wallet = '${user?.address ?? ''}'`
  );
  const subaccountMap = new Map((subaccounts ?? []).map((s) => [s.index, s.name]));

  if (loading) {
    return (
      <div className='space-y-2'>
        {[1, 2].map((i) => (
          <div key={i} className='h-24 rounded-xl animate-pulse glass-card' />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className='p-6 text-center'>
        <p className='text-sm' style={{ color: '#8A8A8A' }}>No open positions</p>
      </div>
    );
  }

  return (
    <>
    <div className='space-y-2'>
      {positions.map((pos, i) => {
        const isLong = pos.side?.toLowerCase() === 'long';
        const pnlPositive = (pos.pnl ?? 0) >= 0;
        const key = posKey(pos);
        const isClosing = closingKey === key;

        // Per-position liquidation health, ISOLATED positions only (subaccountIndex > 0).
        // Cross margin (index 0) shares account-level margin, so a per-position
        // distance would be misleading — skip it entirely there.
        const isIsolated = pos.subaccountIndex != null && pos.subaccountIndex > 0;
        const effectiveMark = liveMarkBySymbol?.get(pos.symbol ?? '') ?? pos.markPrice;
        const liq = pos.liquidationPrice;
        // Single source of truth for distance % + tier color (shared with the
        // close-confirm button below). Only isolated positions get a per-position
        // distance — cross margin (index 0) shares account-level margin.
        const risk = isIsolated ? getLiqRisk({ effectiveMark, liq }) : null;
        const distancePct = risk?.distancePct ?? null;
        const hasHealth = isIsolated && distancePct != null;
        const healthColor = risk?.color ?? '#4ADE80';
        // Fill fraction: 0% distance => full bar; >=30% distance => near-empty.
        const fillPct = distancePct != null
          ? Math.max(6, Math.min(100, (1 - Math.min(distancePct, 30) / 30) * 100))
          : 0;
        return (
          <div
            key={i}
            role='button'
            tabIndex={0}
            className='rounded-xl p-4 space-y-2.5 cursor-pointer transition-colors'
            style={{
              background: 'transparent',
              border: 'none',
            }}
            onClick={() => setManagePosition(pos)}
          >
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                {pos.symbol && <TokenLogo symbol={pos.symbol} size={22} />}
                <span className='font-bold text-sm'>{pos.symbol}</span>
                {pos._isMockDraftPosition && (
                  <span
                    className='text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide'
                    style={{
                      background: 'rgba(251,191,36,0.12)',
                      color: '#FBBF24',
                      border: '1px solid rgba(251,191,36,0.25)',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Test — draft only
                  </span>
                )}
              </div>
              <div className='flex items-center gap-2'>
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
                  {pos.side?.toUpperCase()} {pos.leverage != null ? `${pos.leverage}x` : ''}
                </span>
                {pos.subaccountIndex != null && pos.subaccountIndex > 0 && (
                  <span
                    className='text-[10px] font-bold px-1.5 py-0.5 rounded'
                    style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6' }}
                  >
                    {subaccountMap.get(pos.subaccountIndex) ?? `Isolated-${pos.subaccountIndex}`}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setSharePosition(pos); }}
                  className='text-xs font-semibold px-2.5 py-1 rounded-lg transition-all'
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    color: '#FFFFFF',
                    border: '1px solid rgba(255,255,255,0.15)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                  title='Share position'
                >
                  Share
                </button>
                {onClose && (
                  <CloseButton
                    onClose={() => onClose(pos)}
                    disabled={!!closeDisabled}
                    isClosing={isClosing}
                    isIsolated={isIsolated}
                    risk={risk}
                  />
                )}
              </div>
            </div>
            <div className='grid grid-cols-2 gap-x-4 gap-y-2 text-xs'>
              <div>
                <div style={{ color: '#8A8A8A' }}>Size</div>
                <div className='tabular-nums font-medium'>{pos.size?.toFixed(4) ?? '—'}</div>
              </div>
              <div>
                <div style={{ color: '#8A8A8A' }}>PnL</div>
                <div className='tabular-nums font-bold' style={{ color: pnlPositive ? '#4ADE80' : '#FF5252' }}>
                  {formatUsd(pos.pnl)}
                </div>
              </div>
              <div>
                <div style={{ color: '#8A8A8A' }}>Entry Price</div>
                <div className='tabular-nums font-medium'>${formatPrice(pos.entryPrice)}</div>
              </div>
              <div>
                <div style={{ color: '#8A8A8A' }}>Mark Price</div>
                <div className='tabular-nums font-medium'>${formatPrice(
                  // Prefer a live price for this symbol; fall back to the position's
                  // own mark price (which already falls back to entry price upstream).
                  liveMarkBySymbol?.get(pos.symbol ?? '') ?? pos.markPrice
                )}</div>
              </div>
              <div>
                <div style={{ color: '#8A8A8A' }}>Margin</div>
                <div className='tabular-nums font-medium'>{formatUsd(pos.initialMargin)}</div>
              </div>
            </div>
            <div className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
              Liq: <span style={{ color: '#b794f6' }}>${formatPrice(pos.liquidationPrice)}</span>
            </div>
            {hasHealth && distancePct != null && (
              <div className='space-y-1'>
                <div className='flex items-center justify-between text-[11px]'>
                  <span className='flex items-center gap-1' style={{ color: '#8A8A8A' }}>
                    <ShieldAlert size={12} style={{ color: healthColor }} />
                    Liq. distance
                  </span>
                  <span className='tabular-nums font-bold' style={{ color: healthColor }}>
                    {distancePct.toFixed(1)}%
                  </span>
                </div>
                <div
                  className='h-1.5 w-full rounded-full overflow-hidden'
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                >
                  <div
                    className='h-full rounded-full transition-all'
                    style={{ width: `${fillPct}%`, background: healthColor }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>

    <OpenPositionShareModal
      open={!!sharePosition}
      onClose={() => setSharePosition(null)}
      position={sharePosition}
      liveMark={sharePosition?.symbol ? liveMarkBySymbol?.get(sharePosition.symbol) : undefined}
    />

    <PositionManageSheet
      open={!!managePosition}
      onClose={() => setManagePosition(null)}
      position={managePosition}
      liveMark={managePosition?.symbol ? liveMarkBySymbol?.get(managePosition.symbol) : undefined}
      onShare={managePosition ? () => { setManagePosition(null); setSharePosition(managePosition); } : undefined}
      onClosePosition={onClose && managePosition ? () => { setManagePosition(null); onClose(managePosition); } : undefined}
      closeDisabled={closeDisabled}
    />
    </>
  );
}

/** How long the pending "Confirm close" state lingers before auto-resetting. */
const CONFIRM_TIMEOUT_MS = 4000;

interface CloseButtonProps {
  onClose: () => void;
  disabled: boolean;
  isClosing: boolean;
  /** Isolated positions get the two-step risk checkpoint; cross stays one-click. */
  isIsolated: boolean;
  /** Live liq risk for this position (null for cross / no health data). */
  risk: LiqRisk | null;
}

/**
 * Close button with an inline two-step confirmation for ISOLATED positions.
 *
 * First click flips the same button into a confirm state that surfaces the
 * live liquidation-distance % and colors itself by the position's risk tier.
 * A second click within ~4s actually triggers the close. Cross-margin
 * positions keep the original one-click behavior.
 */
function CloseButton({ onClose, disabled, isClosing, isIsolated, risk }: CloseButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Reset the confirm state once a close actually starts, and on unmount.
  useEffect(() => {
    if (isClosing) {
      clearPending();
      setConfirming(false);
    }
  }, [isClosing]);

  useEffect(() => () => clearPending(), []);

  const handleClick = () => {
    if (disabled || isClosing) return;
    // Cross margin → unchanged one-click close.
    if (!isIsolated) {
      onClose();
      return;
    }
    if (!confirming) {
      setConfirming(true);
      clearPending();
      timeoutRef.current = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
      return;
    }
    // Second click → commit.
    clearPending();
    setConfirming(false);
    onClose();
  };

  const hasDistance = confirming && risk?.distancePct != null;

  const label = isClosing
    ? 'Closing…'
    : confirming
      ? hasDistance
        ? `Confirm · ${risk!.distancePct!.toFixed(1)}%`
        : 'Confirm'
      : 'Close';

  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleClick(); }}
      disabled={disabled || isClosing}
      className='text-xs font-semibold px-2.5 py-1 rounded-lg transition-all disabled:opacity-40 tabular-nums'
      style={{
        background: confirming ? `rgba(255,255,255,0.12)` : 'rgba(255,255,255,0.07)',
        color: '#FFFFFF',
        border: confirming ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.15)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      title={confirming ? 'Click again to confirm closing this position' : undefined}
    >
      {label}
    </button>
  );
}
