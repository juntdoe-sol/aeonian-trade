/**
 * HyperliquidOrderTicket — Mobile-first Phoenix perps order entry panel
 * Matches the Hyperliquid-style layout with all existing order logic preserved.
 */
import { useAuth } from '@pooflabs/web';
import {
  AlertTriangle,
  ArrowLeftRight,
  Lock,
  Pencil,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { errorToast } from '@/utils/toast-helpers';
import {
  setPhoenixSubaccount,
  subscribeManyPhoenixSubaccount,
  type PhoenixSubaccountResponse,
} from '@/lib/collections/phoenixSubaccount';
import { setPhoenixDeposit } from '@/lib/collections/phoenixDeposit';
import { Address, Time } from '@/lib/db-client';
import { placeOrderViaFlight, placeIsolatedOrderViaFlight, Side } from '@/utils/phoenix-flight';
import { phoenixRegisterTrader } from '@/utils/phoenix-client';
import { recordFlightTrade } from '@/utils/record-trade';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { api } from '@/lib/api-client';
import type { RisePosition, TraderData } from '@/utils/phoenix-mappers';
import { toNumber, computeSubaccountUnrealizedPnls } from '@/utils/phoenix-mappers';
import { getMarketPubkey, toBaseLots } from '@/utils/phoenix-markets';
import { captureConsoleErrorDuring, buildIsoErrorMessage } from '@/utils/iso-error-diagnostic';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(p: number | undefined): string {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatUsd(v: number | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function baseSymbol(sym: string): string {
  return sym.endsWith('-PERP') ? sym.slice(0, -5) : sym;
}

/**
 * Compute main-wallet free collateral from a TraderData object.
 * Mirrors the in-component derivation (collateralBalance − crossInitialMargin,
 * with crossIM falling back to summing cross-margin position initial margins).
 * Used to read FRESH free collateral at isolated-open time instead of the
 * possibly-stale `traderData` prop.
 */
function computeFreeCollateral(data: TraderData | null | undefined): number {
  if (!data) return 0;
  const collateral = toNumber(data.collateralBalance);
  const rawPositions = Array.isArray(data.positions) ? (data.positions as RisePosition[]) : [];
  const crossIM = data.crossInitialMargin
    ? toNumber(data.crossInitialMargin)
    : rawPositions
        .filter((p) => !p.subaccountIndex || (p.subaccountIndex as number) === 0)
        .reduce((s, p) => s + toNumber(p.initialMargin), 0);
  return Math.max(0, collateral - crossIM);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  padding: '8px 10px',
  backdropFilter: 'blur(12px)',
};

const MUTED: React.CSSProperties = { color: '#666' };
const GREEN = '#22c55e';
const RED = '#ef4444';
const AMBER = '#b794f6';

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: React.ReactNode;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className='flex items-center justify-between py-0.5'>
      <span className='text-xs' style={MUTED}>{label}</span>
      <span className='text-xs font-medium tabular-nums' style={valueStyle}>{value}</span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className='flex items-center justify-between py-0.5'>
      <span className='text-xs' style={MUTED}>{label}</span>
      <div className='flex items-center gap-1.5 text-xs font-medium tabular-nums'>
        {extra}
        <span>{value}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Generate sensible quick-select leverage stops up to maxLev
function leverageStops(maxLev: number): number[] {
  if (maxLev <= 1) return [1];
  if (maxLev <= 2) return [1, 2];
  if (maxLev <= 5) return [1, 2, maxLev];
  if (maxLev <= 10) return [1, 3, 5, maxLev];
  if (maxLev <= 15) return [1, 3, 5, 10, maxLev];
  if (maxLev <= 20) return [1, 5, 10, 15, maxLev];
  if (maxLev <= 25) return [1, 5, 10, 15, maxLev];
  // fallback for unusual caps
  const step = Math.ceil(maxLev / 4);
  return [1, step, step * 2, step * 3, maxLev].filter((v, i, a) => a.indexOf(v) === i && v <= maxLev);
}

interface Props {
  symbol: string;
  markPrice: number | undefined;
  isBlocked: boolean;
  traderData: TraderData | null;
  loading?: boolean; // true while trader data is being fetched (first load)
  maxLeverage?: number; // per-market cap from backend (leverageTiers[0].maxLeverage floored)
  isolatedOnly?: boolean; // if true, cross margin is not allowed for this market
  /**
   * MOBILE ONLY collapsible mode. When `collapsible` is true the ticket can render in a
   * compact "collapsed" form (just the Long/Short buttons). When false/undefined the full
   * order-entry form always renders (desktop behavior — unchanged).
   */
  collapsible?: boolean;
  /** Whether the collapsible ticket is currently expanded. Ignored unless `collapsible`. */
  expanded?: boolean;
  /** Called when the user taps Long/Short in the collapsed form — the parent expands it. */
  onExpand?: () => void;
}

export function HyperliquidOrderTicket({ symbol, markPrice, isBlocked, traderData, loading, maxLeverage, isolatedOnly, collapsible, expanded, onExpand }: Props) {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  // Effective market max leverage (falls back to 20 if not yet loaded)
  const effectiveMaxLev = maxLeverage != null && maxLeverage >= 1 ? maxLeverage : 20;
  const stops = leverageStops(effectiveMaxLev);

  // Order state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [size, setSize] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState(() => Math.min(5, effectiveMaxLev));
  const [submitting, setSubmitting] = useState(false);

  // UI toggles
  const [showLeverageEditor, setShowLeverageEditor] = useState(false);
  const [sizeInUsd, setSizeInUsd] = useState(false); // toggle base token ↔ USD
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [showTpSl, setShowTpSl] = useState(false);
  const [slippageEditMode, setSlippageEditMode] = useState(false);
  const [slippage, setSlippage] = useState('0.1');

  // Clamp leverage down when market max changes (e.g. user switches from 20x market to 5x market)
  useEffect(() => {
    setLeverage((prev) => Math.min(prev, effectiveMaxLev));
  }, [effectiveMaxLev]);

  // Force isolated margin mode for isolatedOnly markets
  useEffect(() => {
    if (isolatedOnly) setMarginMode('isolated');
  }, [isolatedOnly]);

  // Margin mode & isolated subaccounts
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross');
  const [selectedSubaccountIndex, setSelectedSubaccountIndex] = useState<number | null>(null);

  // One-click isolated setup: 'idle' | 'setting-up' | 'placing'
  const [setupStatus, setSetupStatus] = useState<'idle' | 'setting-up' | 'placing'>('idle');

  const { data: subaccounts } = useRealtimeData<PhoenixSubaccountResponse[]>(
    subscribeManyPhoenixSubaccount,
    !!user?.address,
    `where wallet = '${user?.address ?? ''}'`
  );

  const userSubaccounts = (subaccounts ?? []).filter((s) => s.wallet === user?.address);
  // In isolated mode, prefer the explicitly selected subaccount; fall back to the first existing one.
  const selectedSubaccount = userSubaccounts.find((s) => s.index === selectedSubaccountIndex) ?? userSubaccounts[0] ?? null;

  // TP/SL state
  const [tpPrice, setTpPrice] = useState('');
  const [tpGainPct, setTpGainPct] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [slLossPct, setSlLossPct] = useState('');

  // Sync TP price ↔ gain %
  const syncTp = useCallback((field: 'price' | 'pct', val: string) => {
    const entry = markPrice ?? 0;
    if (!entry) { if (field === 'price') setTpPrice(val); else setTpGainPct(val); return; }
    if (field === 'price') {
      setTpPrice(val);
      const p = parseFloat(val);
      if (p > 0) setTpGainPct(((p - entry) / entry * 100).toFixed(2));
      else setTpGainPct('');
    } else {
      setTpGainPct(val);
      const pct = parseFloat(val);
      if (!isNaN(pct)) setTpPrice((entry * (1 + pct / 100)).toFixed(4));
      else setTpPrice('');
    }
  }, [markPrice]);

  // Sync SL price ↔ loss %
  const syncSl = useCallback((field: 'price' | 'pct', val: string) => {
    const entry = markPrice ?? 0;
    if (!entry) { if (field === 'price') setSlPrice(val); else setSlLossPct(val); return; }
    if (field === 'price') {
      setSlPrice(val);
      const p = parseFloat(val);
      if (p > 0) setSlLossPct((Math.abs((p - entry) / entry) * 100).toFixed(2));
      else setSlLossPct('');
    } else {
      setSlLossPct(val);
      const pct = parseFloat(val);
      if (!isNaN(pct)) setSlPrice((entry * (1 - pct / 100)).toFixed(4));
      else setSlPrice('');
    }
  }, [markPrice]);

  // ─── Derived values ────────────────────────────────────────────────────────

  const baseToken = baseSymbol(symbol);

  // Parse size
  const sizeNum = parseFloat(size) || 0;
  const sizeBase = sizeInUsd && markPrice
    ? sizeNum / markPrice
    : sizeNum;
  const sizeUsd = sizeInUsd
    ? sizeNum
    : sizeNum * (markPrice ?? 0);

  // Available to trade from trader data
  const rawPositions = Array.isArray(traderData?.positions)
    ? (traderData!.positions as RisePosition[])
    : [];
  const subaccountPnls = computeSubaccountUnrealizedPnls(rawPositions);
  const activeSubaccountForPnl = selectedSubaccountIndex ?? userSubaccounts[0]?.index ?? null;
  const selectedSubaccountPnl = activeSubaccountForPnl != null
    ? (subaccountPnls.get(activeSubaccountForPnl) ?? 0)
    : 0;

  // Effective isolation: true for both manual toggle AND markets that are isolated-only (forced).
  // We cannot rely solely on marginMode because isolated-only markets are forced into isolated
  // via useEffect (which fires after the first render), so on first render marginMode is still
  // 'cross' even though the market is isolated-only. Using `isolatedOnly` directly covers that
  // window. This is the canonical gate for the balance-source decision.
  const effectiveIsolated = marginMode === 'isolated' || !!isolatedOnly;

  const collateral = toNumber(traderData?.collateralBalance);
  // crossIM: only count cross-margin positions (subaccountIndex === 0 or absent).
  // Isolated sub-account positions carry their own ring-fenced margin and must not reduce
  // the main-wallet free collateral. The Phoenix API's crossInitialMargin field correctly
  // excludes isolated margins; the fallback sum must match by filtering on subaccountIndex.
  const crossIM = traderData?.crossInitialMargin
    ? toNumber(traderData.crossInitialMargin)
    : rawPositions
        .filter((p) => !p.subaccountIndex || (p.subaccountIndex as number) === 0)
        .reduce((s, p) => s + toNumber(p.initialMargin), 0);
  // Available to trade: always main-wallet free collateral, for both isolated and cross modes.
  // In isolated mode (manual or forced by isolatedOnly), collateral is auto-transferred into
  // the subaccount at Place Order time — the sub-account's .collateral balance is empty until
  // that transfer fires, so selectedSubaccount.collateral must NOT be used as the balance source.
  // effectiveIsolated makes this explicit and ensures isolated-only markets (forced via useEffect
  // on first render when marginMode is still 'cross') use the same main-wallet logic as manual toggle.
  const freeCollateral = Math.max(0, collateral - crossIM);
  // maxPositionUsd drives both the slider range and the MAX button — reads freeCollateral (main wallet)
  // for all modes including effective-isolated so the slider is usable on isolated-only markets.
  //
  // MAX SAFETY HAIRCUT: a naive `freeCollateral * leverage` consumes 100% of free
  // collateral as initial margin, leaving ZERO headroom for (a) Phoenix's un-floored
  // true initial-margin requirement and (b) the taker fee, which the on-chain isolated
  // place leg charges from the same subaccount. At MAX the iso transfer's fee buffer
  // (isoFeeBuffer below) then gets clamped right back down by the Math.min() against
  // free collateral — discarding the buffer — and the place instruction reverts.
  //
  // Fix: size MAX against an EFFECTIVE collateral that already reserves the taker fee
  // plus a small margin pad out of the free balance, so that after the MAX button
  // `marginRequired + isoFeeBuffer <= freeCollateral` holds with headroom and the fee
  // buffer survives the clamp. We mirror the same fee math used at place time:
  //   isoFeeBuffer = estFee*2 + 0.05, estFee = orderValue*0.0005, orderValue≈max notional.
  // Reserving that buffer plus a ~3% haircut on margin keeps the un-floored IM covered too.
  // At max notional N = effColl*leverage, the fee reserve ≈ N*0.001 + 0.05, so we solve
  // for the effective collateral that leaves that reserve untouched.
  const maxFeeReserveFactor = 0.0005 * 2; // estFee*2 as a fraction of notional
  // effColl * leverage = N ; reserve = N*maxFeeReserveFactor + 0.05 must come out of freeCollateral.
  // freeCollateral = effColl + reserve = effColl + (effColl*leverage*maxFeeReserveFactor) + 0.05
  // => effColl = (freeCollateral - 0.05) / (1 + leverage*maxFeeReserveFactor)
  const maxEffectiveCollateral = leverage > 0
    ? Math.max(0, (freeCollateral - 0.05) / (1 + leverage * maxFeeReserveFactor))
    : 0;
  // Extra 3% haircut covers Phoenix's un-floored (fractional) initial-margin requirement
  // that the backend's floored tier maxLeverage over-promises against.
  const maxPositionUsd = maxEffectiveCollateral * leverage * 0.97;

  // Current position for this symbol
  const symbolPos = rawPositions.find((p) => p.symbol === symbol);
  const currentSize = symbolPos ? Math.abs(toNumber(symbolPos.positionSize)) : 0;
  const newSize = currentSize + sizeBase;
  const posSide = symbolPos
    ? (toNumber(symbolPos.positionSize) >= 0 ? 'long' : 'short')
    : null;

  // Order summary computations
  const entryPrice = orderType === 'limit' && limitPrice
    ? parseFloat(limitPrice)
    : (markPrice ?? 0);
  const orderValue = sizeBase * entryPrice;
  const marginRequired = leverage > 0 ? orderValue / leverage : 0;

  // Rough liquidation estimate (simplified: entry ± (margin/orderValue) * entry)
  const liqPriceLong = entryPrice > 0 && leverage > 0
    ? entryPrice * (1 - 1 / leverage * 0.9)
    : null;
  const liqPriceShort = entryPrice > 0 && leverage > 0
    ? entryPrice * (1 + 1 / leverage * 0.9)
    : null;
  const liqPrice = side === 'buy' ? liqPriceLong : liqPriceShort;

  const slippagePct = parseFloat(slippage) / 100;
  const worstPrice = side === 'buy'
    ? entryPrice * (1 + slippagePct)
    : entryPrice * (1 - slippagePct);

  // Est. taker fee at ~0.05%
  const estFee = orderValue * 0.0005;


  // ─── Order placement ───────────────────────────────────────────────────────

  async function handlePlaceOrder() {
    if (!size || isNaN(sizeBase) || sizeBase <= 0) {
      errorToast('Enter a valid size.');
      return;
    }
    if (!user?.address) {
      errorToast('Log in to trade.');
      return;
    }

    const marketPubkey = getMarketPubkey(symbol);
    if (!marketPubkey) {
      errorToast(`This market isn't available right now: ${symbol}.`);
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading('Placing order…');

    try {
      // Trader registration:
      //  - CROSS: the placeOrderViaFlight Flight call requires a pre-existing
      //    registered Phoenix Trader; cross registration is handled separately by
      //    the onboarding / ActiveAccountFlow path (phoenixTrader collection), so we
      //    do not re-register here — a missing-trader failure surfaces in the catch.
      //  - ISOLATED: the placeIsolatedOrderViaFlight Flight HTTP endpoint ALSO
      //    requires a pre-existing registered Trader (it returns
      //    "Source account not found: Trader <wallet> not found." otherwise) and the
      //    Flight path BYPASSES the phoenixIsoTrade collection, so nothing registers
      //    the trader on the iso rail. We therefore register the parent trader
      //    explicitly via phoenixRegisterTrader (the SAME idempotent
      //    @PhoenixPerpsPlugin.registerTrader the cross/onboarding flow uses) just
      //    before the isolated open below.

      if (sizeBase <= 0) {
        toast.dismiss(toastId);
        errorToast('That size is too small for this market.');
        setSubmitting(false);
        return;
      }

      // ─── Determine active subaccount index for this trade ────────────────
      // effectiveIsolated covers both manual toggle and markets forced into isolated mode.
      let activeSubaccountIndex = 0;
      // Fresh main-wallet free collateral for the isolated transfer, populated below
      // from a live /api/phoenix/trader read. Defaults to the (possibly stale) prop.
      let isoFreshFreeCollateral = freeCollateral;

      if (effectiveIsolated) {
        // ── Ensure the parent Phoenix Trader is registered (idempotent) ─────
        // The Flight isolated HTTP endpoint (placeIsolatedMarketOrder /
        // placeIsolatedLimitOrder) requires a PRE-EXISTING registered Phoenix Trader
        // account and does NOT register one itself — an unregistered wallet gets
        // "Source account not found: Trader <wallet> not found." (404). The Flight
        // path bypasses the phoenixIsoTrade collection, so nothing else registers
        // the trader on this rail. Register it here, BEFORE the deposit pre-check —
        // depositFunds also targets the trader's margin account, so a fresh wallet
        // must be registered first. Uses the SAME idempotent mechanism the
        // cross/onboarding flow uses (phoenixTrader collection →
        // @PhoenixPerpsPlugin.registerTrader); re-registering an already-registered
        // wallet is a safe no-op, so re-trading is unaffected. Throws on a hard
        // failure (e.g. a zero-SOL wallet that can't cover the registration rent —
        // a separate Gas-Sponsorship concern), surfaced clearly rather than swallowed.
        // Registration now waits for the trader to be on-chain-confirmed and
        // indexed (existence check → session-aware write retry → confirmation
        // poll). On a fresh Privy/social wallet this can take ~10s, so surface a
        // dedicated loading toast/status rather than leaving "Placing order…"
        // looking frozen during the wait.
        toast.dismiss(toastId);
        const setupToastId = toast.loading('Setting up your trading account…');
        setSetupStatus('setting-up');
        try {
          await phoenixRegisterTrader(user.address);
          toast.dismiss(setupToastId);
        } catch (regErr) {
          toast.dismiss(setupToastId);
          errorToast(
            "We couldn't set up your trading account. Please try again.",
            { duration: 8000 },
          );
          setSubmitting(false);
          setSetupStatus('idle');
          return;
        }

        const existingSubaccount = selectedSubaccountIndex != null
          ? userSubaccounts.find((s) => s.index === selectedSubaccountIndex)
          : userSubaccounts[0] ?? null;

        // Determine the isolated subaccount index to use (or create metadata for a new one).
        if (!existingSubaccount) {
          // First isolated trade — create subaccount metadata record.
          const nextIndex = (() => {
            const existingIndices = new Set(userSubaccounts.map((s) => s.index));
            let idx = 1;
            while (existingIndices.has(idx)) idx++;
            return idx;
          })();

          const subaccountId = crypto.randomUUID();
          const metaCreated = await setPhoenixSubaccount(subaccountId, {
            wallet: Address.publicKey(user.address),
            index: nextIndex,
            name: 'Isolated',
            collateral: 0,
            createdAt: Time.Now,
          });

          if (!metaCreated) {
            toast.dismiss(toastId);
            errorToast("We couldn't set up your isolated margin account. Please try again.");
            setSubmitting(false);
            setSetupStatus('idle');
            return;
          }

          activeSubaccountIndex = nextIndex;
          setSelectedSubaccountIndex(nextIndex);
        } else {
          activeSubaccountIndex = existingSubaccount.index;
        }

        // FRESH free-collateral read (isolated path only). The removed pre-flight
        // /api/phoenix/trader refresh meant we were reading freeCollateral from the
        // stale `traderData` prop — a stale/zero value made the transferToIsolated
        // leg of the atomic CPI revert (taking the whole open down). Re-fetch the
        // user's current free collateral here, immediately before constructing the
        // transfer, so the transfer amount reflects real on-chain collateral.
        // Best-effort: if the (flaky) upstream fails, fall back to the prop value
        // rather than blocking the open.
        try {
          const freshTrader = await api.get<TraderData>(`/api/phoenix/trader/${user.address}`);
          isoFreshFreeCollateral = computeFreeCollateral(freshTrader);
        } catch {
          // Upstream hiccup — keep the last-known prop-derived value.
          isoFreshFreeCollateral = freeCollateral;
        }

        // Deposit pre-check: the atomic hook's transferToIsolated moves PhUSD from cross-margin
        // into the isolated subaccount. If cross-margin has insufficient free collateral, deposit first.
        //
        // The transfer must cover MORE than the bare initial margin: the on-chain place leg
        // charges Phoenix's taker fee from the SAME subaccount collateral. At the market's max
        // leverage, notional/leverage equals Phoenix's minimum required margin exactly, leaving
        // zero headroom for the fee → InsufficientFunds at instruction index 3. Add a taker-fee
        // buffer (2x the estimated fee) plus a tiny fixed pad so rounding/funding can't re-trigger
        // the shortfall.
        const isoFeeBuffer = estFee * 2 + 0.05;
        const collateralToTransferUsd = Math.max(marginRequired, 1) + isoFeeBuffer;
        const collateralToTransferMicro = Math.round(collateralToTransferUsd * 1_000_000);
        const freeCollateralMicro = Math.floor(isoFreshFreeCollateral * 1_000_000);

        if (freeCollateralMicro < collateralToTransferMicro) {
          // Cross-margin has too little to fund the transfer — top it up first.
          toast.dismiss(toastId);
          const depositToastId = toast.loading('Adding funds…');
          setSetupStatus('setting-up');

          const depositId = crypto.randomUUID();
          const deposited = await setPhoenixDeposit(depositId, {
            amt: collateralToTransferMicro,
          });

          toast.dismiss(depositToastId);
          if (!deposited) {
            toast.error(
              `Not enough balance. You need ${formatUsd(collateralToTransferUsd)} but have ${formatUsd(isoFreshFreeCollateral)}. Add funds and try again.`,
              { action: { label: 'Add funds', onClick: () => navigate('/portfolio') } },
            );
            setSubmitting(false);
            setSetupStatus('idle');
            return;
          }
          // Deposit succeeded — the just-deposited amount is now available, so the
          // fresh free collateral covers the transfer.
          isoFreshFreeCollateral = Math.max(isoFreshFreeCollateral, collateralToTransferUsd);
        }
      }

      // ─── Place the order ────────────────────────────────────────────────
      // Isolated path: register the parent Trader (idempotent, separate step —
      // see below), then a Flight tx (sync + transfer + place).
      // Cross-margin path: Flight tx (parent Trader registered via onboarding).
      toast.dismiss(toastId);
      setSetupStatus('placing');
      const placingToastId = toast.loading('Placing your order — approve in your wallet…');

      const orderSide = side === 'buy' ? 'long' : 'short';
      const parsedLimitPrice = limitPrice && !isNaN(parseFloat(limitPrice)) ? parseFloat(limitPrice) : null;
      const parsedTpPrice = tpPrice && !isNaN(parseFloat(tpPrice)) ? parseFloat(tpPrice) : undefined;
      const sizeBaseLots = toBaseLots(symbol, sizeBase);

      if (effectiveIsolated) {
        // ── Isolated: Flight transfer + place ─────────────────────────────
        // Transfer bare initial margin PLUS a taker-fee buffer (+small pad). The
        // on-chain place leg charges Phoenix's taker fee from the subaccount's own
        // collateral, so transferring only notional/leverage leaves nothing for the
        // fee at max leverage → InsufficientFunds. Mirror the pre-check buffer.
        const isoFeeBuffer = estFee * 2 + 0.05;
        const collateralToTransferUsd = Math.max(marginRequired, 1) + isoFeeBuffer;
        // Clamp the transfer to the freshly-fetched free collateral. The
        // transferToIsolated leg of the atomic CPI reverts (taking the whole
        // open down) if it tries to move more than the cross-margin account
        // actually holds — which is precisely what happened when this read was
        // stale. floor() to micro-USDC so rounding can never round UP past the
        // available balance. The clamp targets the user's real free balance only —
        // it must NOT clamp the fee buffer back down to bare margin.
        const freshFreeMicro = Math.floor(isoFreshFreeCollateral * 1_000_000);
        const desiredTransferMicro = Math.round(collateralToTransferUsd * 1_000_000);
        const collateralToTransferMicro = Math.min(desiredTransferMicro, freshFreeMicro);

        // If the fresh balance can't even cover the required margin, fail with a
        // clear reason instead of letting the CPI revert into a generic failure.
        if (collateralToTransferMicro < desiredTransferMicro) {
          toast.dismiss(placingToastId);
          toast.error(
            `Not enough balance. You need ${formatUsd(collateralToTransferUsd)} but have ${formatUsd(isoFreshFreeCollateral)}. Add funds and try again.`,
            { action: { label: 'Add funds', onClick: () => navigate('/portfolio') } },
          );
          setSubmitting(false);
          setSetupStatus('idle');
          return;
        }

        // ── Isolated OPEN via Flight SDK (collects the builder fee) ─────────
        // Route the isolated open through the Rise/Flight SDK so the app earns the
        // Phoenix builder fee (cross already did; this brings isolated onto the same
        // rail). The Flight HTTP endpoint returns an array of instructions
        // (sync + transfer + place) but requires the parent Trader to already exist —
        // which is why we register it explicitly above. Flight bypasses the
        // phoenixIsoTrade collection, so its offchain CREATE hook (which awarded
        // points + wrote the queryable phoenixTradeRecord) no longer fires — we
        // re-create both via /api/phoenix/record-trade on success.
        //
        // SIZE UNITS: placeIsolatedOrderViaFlight expects HUMAN-READABLE base size
        // (sizeBase), NOT base lots — the API converts to lots server-side.
        // TEMPORARY DIAGNOSTIC: capture any swallowed console.error so a Phoenix/Solana
        // revert reason still surfaces verbatim, matching the prior iso diagnostics.
        let isoTxSignature: string;
        const { result: isoResult, capturedError } = await captureConsoleErrorDuring(async () => {
          try {
            return await placeIsolatedOrderViaFlight({
              walletAddress: user.address,
              symbol,
              side: orderSide === 'long' ? Side.Bid : Side.Ask,
              sizeBase, // human-readable base units — API converts to lots
              limitPriceUsd: parsedLimitPrice,
              transferAmount: collateralToTransferMicro,
              // App-side isolated slot for metadata only. The Flight endpoint
              // resolves the on-chain isolated subaccount server-side and places
              // against the registered parent Trader PDA (pdaIndex=0).
              subaccountIndex: activeSubaccountIndex,
              isReduceOnly: false,
            });
          } catch (isoErr) {
            return { error: isoErr } as const;
          }
        });

        toast.dismiss(placingToastId);

        if (!isoResult || 'error' in isoResult) {
          // TEMPORARY DIAGNOSTIC: show the verbatim revert reason (message + program
          // logs + tx signature if any) so it can be read/screenshotted on mobile.
          const isoErr = isoResult && 'error' in isoResult ? isoResult.error : undefined;
          console.error('[ISO OPEN] raw failure:', { capturedError, isoErr, diagnostic: buildIsoErrorMessage({ err: isoErr, capturedError }) });
          errorToast("We couldn't place your order. Please try again.");
          setSubmitting(false);
          setSetupStatus('idle');
          return;
        }

        isoTxSignature = isoResult.txSignature;

        // Flight bypassed the phoenixIsoTrade hook — re-create points + the queryable
        // phoenixTradeRecord via record-trade. Best-effort: the on-chain order already
        // succeeded, so a failed record only skips points/leaderboard.
        await recordFlightTrade(
          {
            txSignature: isoTxSignature,
            trader: user.address,
            market: marketPubkey,
            symbol,
            side: orderSide,
            sizeBaseLots, // base lots (integer) — record-trade expects lots
            leverage,
            orderType: orderType === 'limit' ? 'limit' : 'market',
            limitPrice: parsedLimitPrice ?? undefined,
            takeProfit: parsedTpPrice,
            stopLoss: slPrice && !isNaN(parseFloat(slPrice)) ? parseFloat(slPrice) : undefined,
            subaccountIndex: activeSubaccountIndex,
            sizeUsd: Math.floor(sizeUsd),
          },
          login,
        );
      } else {
        // ── Cross-margin: Flight SDK (collects the builder fee) ─────────────
        // Cross-margin orders route through the Rise/Flight SDK so the app earns
        // the Phoenix builder fee. Flight bypasses the phoenixOrder collection, so
        // the collection's offchain create hook (which awarded points + wrote the
        // queryable phoenixTradeRecord) no longer fires — we re-create both via the
        // /api/phoenix/record-trade POST below on success.
        //
        // SIZE UNITS: placeOrderViaFlight expects HUMAN-READABLE base size (sizeBase),
        // NOT base lots — the Rise SDK converts to lots internally. Passing lots here
        // would double-convert and produce a ~100x oversized order.
        const slPriceNum = slPrice && !isNaN(parseFloat(slPrice)) ? parseFloat(slPrice) : undefined;
        let txSignature: string;
        try {
          const result = await placeOrderViaFlight({
            walletAddress: user.address,
            symbol,
            side: orderSide === 'long' ? Side.Bid : Side.Ask,
            sizeBase, // human-readable base units — SDK converts to lots internally
            limitPriceUsd: parsedLimitPrice,
            traderSubaccountIndex: 0, // 0 = cross margin
          });
          txSignature = result.txSignature;
        } catch (flightErr) {
          toast.dismiss(placingToastId);
          console.error('[ORDER] cross flight failure:', flightErr);
          errorToast("We couldn't place your order. Please try again.");
          setSubmitting(false);
          setSetupStatus('idle');
          return;
        }

        toast.dismiss(placingToastId);

        // Record the trade to preserve trading points + the PnL-leaderboard record.
        // Best-effort: the on-chain order already succeeded, so a failed record
        // does not block the success flow (it only skips points/leaderboard).
        await recordFlightTrade(
          {
            txSignature,
            trader: user.address,
            market: marketPubkey,
            symbol,
            side: orderSide,
            sizeBaseLots, // base lots (integer) — record-trade expects lots
            leverage,
            orderType: orderType === 'limit' ? 'limit' : 'market',
            limitPrice: parsedLimitPrice ?? undefined,
            takeProfit: parsedTpPrice,
            stopLoss: slPriceNum,
            subaccountIndex: 0,
            sizeUsd: Math.floor(sizeUsd),
          },
          login,
        );
      }

      toast.success(`${orderSide === 'long' ? 'Long' : 'Short'} order placed.`, {
        action: { label: 'View positions', onClick: () => navigate('/portfolio') },
      });
      setSize('');
      setLimitPrice('');
      setTpPrice('');
      setTpGainPct('');
      setSlPrice('');
      setSlLossPct('');
    } catch (err) {
      // TEMPORARY DIAGNOSTIC: surface the verbatim error (message + program logs +
      // tx signature if present) so an isolated-margin revert is readable/screenshottable.
      console.error('[ORDER] raw thrown error:', err, buildIsoErrorMessage({ err }));
      errorToast("We couldn't place your order. Please try again.");
    } finally {
      setSubmitting(false);
      setSetupStatus('idle');
    }
  }

  // ─── Colors ────────────────────────────────────────────────────────────────

  const sideColor = side === 'buy' ? GREEN : RED;
  const sideColorBg = side === 'buy'
    ? 'rgba(34,197,94,0.12)'
    : 'rgba(239,68,68,0.12)';

  // ─── Unauthenticated state ─────────────────────────────────────────────────

  if (!user) {
    return (
      <div className='space-y-2 p-4 rounded-xl text-center' style={CARD_STYLE}>
        <p className='text-sm mb-3' style={MUTED}>Log in to trade</p>
        <button
          onClick={login}
          className='w-full py-3.5 rounded-xl font-bold text-sm'
          style={{ background: AMBER, color: '#fff' }}
        >
          Log In
        </button>
      </div>
    );
  }

  // ─── Geo-blocked state ─────────────────────────────────────────────────────

  const geoBlockedBanner = isBlocked && (
    <div className='glass-card flex items-center gap-3 p-3 rounded-xl' style={{ background: 'rgba(183,148,246,0.05)', borderColor: 'rgba(183,148,246,0.2)' }}>
      <AlertTriangle size={18} style={{ color: AMBER, flexShrink: 0 }} />
      <p className='text-xs' style={{ color: '#d4b8fa' }}>
        Phoenix Perps trading is not available in your jurisdiction (US).
      </p>
    </div>
  );

  // ─── Collapsed form (MOBILE ONLY) ──────────────────────────────────────────
  // When the ticket is collapsible and not expanded, show ONLY the Long/Short
  // buttons. Tapping either sets the side AND calls onExpand() so the parent can
  // minimize the chart/orderbook and expand the full form (mutually exclusive).
  if (collapsible && !expanded) {
    return (
      <div className='space-y-1.5'>
        {geoBlockedBanner}
        <div className='grid grid-cols-2 gap-1'>
          <button
            onClick={() => { setSide('buy'); onExpand?.(); }}
            disabled={isBlocked}
            className='py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed'
            style={{
              background: GREEN,
              color: '#000',
              border: `1px solid ${GREEN}`,
            }}
          >
            Long / Buy
          </button>
          <button
            onClick={() => { setSide('sell'); onExpand?.(); }}
            disabled={isBlocked}
            className='py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed'
            style={{
              background: RED,
              color: '#fff',
              border: `1px solid ${RED}`,
            }}
          >
            Short / Sell
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className='space-y-1.5'>
      {geoBlockedBanner}

      {/* 1. Cross / Isolated margin detail rows (the toggle itself now lives
          beside the Market/Limit toggle in section 3 below) */}
      <div className='space-y-1'>
        {marginMode === 'isolated' && (
          <div className='flex items-center justify-between px-1 py-0.5'>
            {userSubaccounts.length > 0 ? (
              <span className='text-xs' style={{ color: '#888' }}>
                Subaccount: <span style={{ color: AMBER }}>{userSubaccounts[0].name}</span>
                {' · '}
                <span style={{ color: '#ccc' }}>{formatUsd(userSubaccounts[0].collateral)}</span>
                {selectedSubaccountPnl !== 0 && (
                  <span style={{ color: selectedSubaccountPnl >= 0 ? '#4ADE80' : '#FF5252', marginLeft: 4 }}>
                    {selectedSubaccountPnl >= 0 ? '+' : ''}{formatUsd(selectedSubaccountPnl)}
                  </span>
                )}
              </span>
            ) : (
              <span className='text-[10px]' style={{ color: '#666' }}>
                Subaccount will be created automatically on first trade
              </span>
            )}
            <span className='text-xs font-bold tabular-nums' style={{ color: AMBER }}>{leverage}x</span>
          </div>
        )}

        {marginMode === 'cross' && (
          <div className='flex items-center justify-center gap-1.5 text-xs' style={{ color: '#666' }}>
            <Lock size={11} style={{ color: AMBER }} />
            <span>Cross Margin</span>
            <span style={MUTED}>·</span>
            <span style={{ color: AMBER }}>{leverage}x</span>
          </div>
        )}
      </div>

      {/* 2. Long / Short side tabs */}
      <div className='grid grid-cols-2 gap-1'>
        <button
          onClick={() => setSide('buy')}
          className='py-2 rounded-lg font-bold text-sm transition-all'
          style={{
            background: side === 'buy' ? GREEN : 'rgba(255,255,255,0.04)',
            color: side === 'buy' ? '#000' : '#666',
            border: `1px solid ${side === 'buy' ? GREEN : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          Long / Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className='py-2 rounded-lg font-bold text-sm transition-all'
          style={{
            background: side === 'sell' ? RED : 'rgba(255,255,255,0.04)',
            color: side === 'sell' ? '#fff' : '#666',
            border: `1px solid ${side === 'sell' ? RED : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          Short / Sell
        </button>
      </div>

      {/* 3. Market/Limit + Cross/Isolated toggles + price row */}
      <div className='flex items-center gap-2 flex-wrap'>
        {/* Market / Limit segmented control */}
        <div className='flex rounded-lg overflow-hidden glass-card'>
          {(['market', 'limit'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className='px-2.5 py-1.5 text-xs font-medium capitalize transition-colors'
              style={{
                background: orderType === type ? sideColorBg : 'transparent',
                color: orderType === type ? sideColor : '#666',
                border: orderType === type ? `1px solid ${sideColor}` : '1px solid transparent',
                borderRadius: '5px',
                margin: '2px',
              }}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Cross / Isolated segmented control — identical segmented-pill style to
            Market/Limit; active = purple accent (AMBER). Logic unchanged: Cross
            resets the selected subaccount, Isolated switches margin mode. Cross is
            disabled when the market is isolated-only. */}
        <div className='flex rounded-lg overflow-hidden glass-card'>
          {(['cross', 'isolated'] as const).map((mode) => {
            const active = marginMode === mode;
            const disabled = mode === 'cross' && isolatedOnly;
            return (
              <button
                key={mode}
                onClick={() => {
                  if (mode === 'cross') {
                    if (!isolatedOnly) { setMarginMode('cross'); setSelectedSubaccountIndex(null); }
                  } else {
                    setMarginMode('isolated');
                  }
                }}
                disabled={disabled}
                className='px-2.5 py-1.5 text-xs font-medium capitalize transition-colors'
                style={{
                  background: active ? `${AMBER}22` : 'transparent',
                  color: disabled ? '#444' : active ? AMBER : '#666',
                  border: active ? `1px solid ${AMBER}` : '1px solid transparent',
                  borderRadius: '5px',
                  margin: '2px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {mode}
              </button>
            );
          })}
        </div>

        {/* Mid price badge */}
        <div className='flex-1 flex items-center justify-end gap-1.5 min-w-[80px]'>
          <span
            className='text-xs px-1.5 py-0.5 rounded font-mono font-bold'
            style={{ background: '#1A1A1A', color: '#888', fontSize: '9px', letterSpacing: '0.05em' }}
          >
            MID
          </span>
          <span className='text-sm font-bold tabular-nums font-mono'>
            {markPrice != null ? `$${formatPrice(markPrice)}` : '—'}
          </span>
        </div>
      </div>

      {/* Limit price input (only for limit orders) */}
      {orderType === 'limit' && (
        <div>
          <label className='text-xs block mb-0.5' style={MUTED}>Limit Price (USD)</label>
          <input
            type='number'
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder={markPrice ? formatPrice(markPrice) : '0.00'}
            className='glass-input w-full px-3 py-2 rounded-lg text-sm tabular-nums outline-none font-mono' style={{ borderColor: limitPrice ? sideColor : undefined }}
          />
        </div>
      )}

      {/* 4. Info rows */}
      <div style={{ padding: '2px 2px' }}>
        <InfoRow
          label='Available to Trade'
          value={
            loading
              ? <Skeleton className='inline-block h-3.5 w-16 rounded' />
              : !user
              ? '—'
              : formatUsd(freeCollateral)
          }
          valueStyle={{ color: '#fff' }}
        />
        {currentSize > 0 && posSide && (
          <InfoRow
            label='Position'
            value={
              <span>
                <span style={{ color: '#888' }}>{currentSize.toFixed(4)}</span>
                {sizeBase > 0 && (
                  <>
                    <span style={{ color: '#555', margin: '0 4px' }}>→</span>
                    <span style={{ color: sideColor }}>{newSize.toFixed(4)}</span>
                  </>
                )}
                {' '}
                <span style={{ color: '#555' }}>{baseToken}</span>
              </span>
            }
          />
        )}
      </div>

      {/* 5. Order Size card */}
      <div style={CARD_STYLE}>
        <div className='flex items-start justify-between mb-1.5'>
          <span className='text-xs font-semibold' style={{ color: '#aaa' }}>Order Size</span>
          <input
            type='number'
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder='0.00'
            className='text-right text-xl font-bold tabular-nums outline-none bg-transparent font-mono w-32'
            style={{ color: '#fff', caretColor: sideColor }}
          />
        </div>

        {/* Token selector + USD equiv */}
        <div className='flex items-center justify-between mb-1.5'>
          <button
            onClick={() => setSizeInUsd(!sizeInUsd)}
            className='flex items-center gap-1.5 text-sm font-semibold transition-colors'
            style={{ color: '#ccc' }}
          >
            {sizeInUsd ? 'USD' : baseToken}
            <ArrowLeftRight size={13} style={{ color: '#555' }} />
          </button>
          <span className='text-xs tabular-nums font-mono' style={MUTED}>
            {sizeInUsd
              ? `${sizeBase > 0 ? sizeBase.toFixed(4) : '0.0000'} ${baseToken}`
              : `$${sizeUsd > 0 ? sizeUsd.toFixed(2) : '0.00'}`}
          </span>
        </div>

        {/* Slider + MAX button */}
        <div className='flex items-center gap-2'>
          <div className='flex-1 relative'>
            <input
              type='range'
              min='0'
              max='100'
              step='1'
              value={maxPositionUsd > 0 && sizeUsd > 0
                ? Math.min(100, (sizeUsd / maxPositionUsd) * 100)
                : 0}
              onChange={(e) => {
                const pct = parseFloat(e.target.value) / 100;
                const maxUsd = maxPositionUsd;
                const targetUsd = maxUsd * pct;
                if (sizeInUsd) {
                  setSize(targetUsd.toFixed(2));
                } else {
                  const p = markPrice ?? 1;
                  setSize((targetUsd / p).toFixed(4));
                }
              }}
              className='w-full h-1.5 rounded-full appearance-none cursor-pointer'
              style={{
                background: `linear-gradient(to right, ${AMBER} ${
                  maxPositionUsd > 0 && sizeUsd > 0
                    ? Math.min(100, (sizeUsd / maxPositionUsd) * 100)
                    : 0
                }%, #222 0%)`,
                accentColor: AMBER,
              }}
            />
          </div>
          <button
            onClick={() => {
              const maxUsd = maxPositionUsd;
              if (sizeInUsd) {
                setSize(maxUsd.toFixed(2));
              } else {
                const p = markPrice ?? 1;
                setSize((maxUsd / p).toFixed(4));
              }
            }}
            className='glass-button flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-colors'
            style={{ color: '#888' }}
          >
            MAX <Lock size={10} style={{ color: AMBER }} />
          </button>
        </div>
      </div>

      {/* 6. Position Leverage card */}
      <div
        className='glass-card flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors'
        onClick={() => setShowLeverageEditor(!showLeverageEditor)}
      >
        <span className='text-xs font-semibold' style={{ color: '#aaa' }}>Position Leverage</span>
        <span className='text-sm font-bold tabular-nums' style={{ color: AMBER }}>{leverage}x</span>
      </div>

      {showLeverageEditor && (
        <div style={{ ...CARD_STYLE, paddingTop: '6px' }}>
          {/* Dynamic scale labels: show stops as tick marks */}
          <div className='flex justify-between text-xs mb-1.5' style={MUTED}>
            {stops.map((s) => <span key={s}>{s}x</span>)}
          </div>
          <input
            type='range'
            min='1'
            max={effectiveMaxLev}
            step='1'
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
            className='w-full h-1.5 rounded-full appearance-none cursor-pointer'
            style={{ accentColor: AMBER }}
          />
          {/* Max leverage indicator */}
          <div className='text-right text-xs mt-0.5' style={{ color: '#555' }}>
            Max {effectiveMaxLev}x
            {isolatedOnly && (
              <span className='ml-2 text-[9px] font-bold px-1 py-0.5 rounded' style={{ background: 'rgba(99,102,241,0.18)', color: '#818cf8' }}>
                ISO only
              </span>
            )}
          </div>
          <div className='flex gap-1.5 mt-1.5'>
            {stops.map((lev) => (
              <button
                key={lev}
                onClick={() => setLeverage(lev)}
                className='flex-1 py-1 rounded-lg text-xs font-bold transition-colors'
                style={{
                  background: leverage === lev ? AMBER : 'rgba(255,255,255,0.06)',
                  color: leverage === lev ? '#fff' : '#666',
                  border: `1px solid ${leverage === lev ? AMBER : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 7. Checkboxes row */}
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1.5'>
        <label className='flex items-center gap-1.5 cursor-pointer'>
          <input
            type='checkbox'
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
            className='w-3.5 h-3.5 rounded cursor-pointer'
            style={{ accentColor: AMBER }}
          />
          <span className='text-xs' style={{ color: reduceOnly ? '#fff' : '#666' }}>Reduce Only</span>
        </label>
        <label
          className='flex items-center gap-1.5'
          style={{ opacity: orderType === 'limit' ? 1 : 0.4, cursor: orderType === 'limit' ? 'pointer' : 'not-allowed' }}
        >
          <input
            type='checkbox'
            checked={postOnly}
            onChange={(e) => orderType === 'limit' && setPostOnly(e.target.checked)}
            disabled={orderType !== 'limit'}
            className='w-3.5 h-3.5 rounded cursor-pointer'
            style={{ accentColor: AMBER }}
          />
          <span className='text-xs' style={{ color: postOnly ? '#fff' : '#666' }}>Post Only</span>
        </label>
        <label className='flex items-center gap-1.5 cursor-pointer'>
          <input
            type='checkbox'
            checked={showTpSl}
            onChange={(e) => setShowTpSl(e.target.checked)}
            className='w-3.5 h-3.5 rounded'
            style={{ accentColor: AMBER }}
          />
          <span
            className='text-xs font-medium'
            style={{ color: showTpSl ? AMBER : '#666' }}
          >
            Take Profit / Stop Loss
          </span>
        </label>
      </div>

      {/* 8. TP/SL grid */}
      {showTpSl && (
        <div style={{ ...CARD_STYLE }}>
          <div className='grid grid-cols-2 gap-2'>
            {/* TP Price */}
            <div>
              <label className='text-xs block mb-1' style={{ color: GREEN }}>TP Price</label>
              <input
                type='number'
                value={tpPrice}
                onChange={(e) => syncTp('price', e.target.value)}
                placeholder={markPrice ? formatPrice(markPrice * 1.1) : '0.00'}
                className='glass-input w-full px-2 py-2 rounded-lg text-xs tabular-nums outline-none font-mono'
                style={{ borderColor: tpPrice ? GREEN : undefined }}
              />
            </div>
            {/* TP Gain % */}
            <div>
              <label className='text-xs block mb-1 flex items-center gap-1' style={{ color: GREEN }}>
                Gain %
                <ArrowLeftRight size={10} style={{ color: '#555' }} />
              </label>
              <input
                type='number'
                value={tpGainPct}
                onChange={(e) => syncTp('pct', e.target.value)}
                placeholder='+10.00'
                className='glass-input w-full px-2 py-2 rounded-lg text-xs tabular-nums outline-none font-mono'
                style={{ borderColor: tpGainPct ? GREEN : undefined }}
              />
            </div>
            {/* SL Price */}
            <div>
              <label className='text-xs block mb-1' style={{ color: RED }}>SL Price</label>
              <input
                type='number'
                value={slPrice}
                onChange={(e) => syncSl('price', e.target.value)}
                placeholder={markPrice ? formatPrice(markPrice * 0.9) : '0.00'}
                className='glass-input w-full px-2 py-2 rounded-lg text-xs tabular-nums outline-none font-mono'
                style={{ borderColor: slPrice ? RED : undefined }}
              />
            </div>
            {/* SL Loss % */}
            <div>
              <label className='text-xs block mb-1 flex items-center gap-1' style={{ color: RED }}>
                Loss %
                <ArrowLeftRight size={10} style={{ color: '#555' }} />
              </label>
              <input
                type='number'
                value={slLossPct}
                onChange={(e) => syncSl('pct', e.target.value)}
                placeholder='-10.00'
                className='glass-input w-full px-2 py-2 rounded-lg text-xs tabular-nums outline-none font-mono'
                style={{ borderColor: slLossPct ? RED : undefined }}
              />
            </div>
          </div>
          <p className='text-xs mt-2' style={{ color: '#555' }}>
            Note: SL orders are stored as target prices only.
          </p>
        </div>
      )}

      {/* 9. Place Order button */}
      <button
        onClick={handlePlaceOrder}
        disabled={submitting || isBlocked}
        className='w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed'
        style={{
          background: isBlocked
            ? 'rgba(255,255,255,0.08)'
            : side === 'buy'
              ? GREEN
              : RED,
          color: side === 'buy' && !isBlocked ? '#000' : '#fff',
          letterSpacing: '0.02em',
        }}
      >
        {setupStatus === 'setting-up'
          ? 'Depositing collateral…'
          : setupStatus === 'placing'
            ? 'Placing order…'
            : submitting
              ? 'Sending…'
              : isBlocked
                ? 'Trading Restricted'
                : side === 'buy'
                  ? `Long ${baseToken}`
                  : `Short ${baseToken}`}
      </button>

      {/* 10. Order Summary card */}
      {(sizeBase > 0 || sizeUsd > 0) && (
        <div style={CARD_STYLE}>
          <div className='space-y-0.5'>
            <SummaryRow
              label='Expected Price'
              value={entryPrice > 0 ? `$${formatPrice(entryPrice)}` : '—'}
            />
            <SummaryRow
              label='Est. Liquidation Price'
              value={liqPrice != null && liqPrice > 0 ? `$${formatPrice(liqPrice)}` : '—'}
              extra={
                <span className='text-xs px-1 py-0.5 rounded' style={{ background: 'rgba(239,68,68,0.12)', color: RED, fontSize: '9px' }}>
                  EST
                </span>
              }
            />
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
            <SummaryRow
              label='Order Value'
              value={orderValue > 0 ? formatUsd(orderValue) : '—'}
            />
            <SummaryRow
              label='Margin Required'
              value={marginRequired > 0 ? formatUsd(marginRequired) : '—'}
              extra={
                marginRequired > 0 && marginRequired > freeCollateral ? (
                  <span className='text-[10px] px-1 py-0.5 rounded' style={{ background: 'rgba(239,68,68,0.12)', color: RED }}>
                    Insufficient
                  </span>
                ) : undefined
              }
            />
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
            {/* Slippage row */}
            <div className='flex items-center justify-between py-0.5'>
              <div className='flex items-center gap-1.5'>
                <span className='text-xs' style={MUTED}>Slippage</span>
                <button
                  onClick={() => setSlippageEditMode(!slippageEditMode)}
                  className='p-0.5 rounded transition-colors'
                  style={{ color: '#555' }}
                >
                  <Pencil size={11} />
                </button>
              </div>
              <div className='flex items-center gap-2 text-xs tabular-nums'>
                {slippageEditMode ? (
                  <input
                    type='number'
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    onBlur={() => setSlippageEditMode(false)}
                    autoFocus
                    className='w-16 text-right px-1.5 py-0.5 rounded outline-none text-xs font-mono'
                    style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${AMBER}`, color: AMBER }}
                    step='0.01'
                    min='0.01'
                    max='5'
                  />
                ) : (
                  <>
                    <span style={{ color: '#555' }}>Est</span>
                    <span style={{ color: '#aaa' }}>{slippage}%</span>
                    <span style={{ color: '#555' }}>/</span>
                    <span style={{ color: '#555' }}>Max</span>
                    <span style={{ color: AMBER }}>{(parseFloat(slippage) * 2).toFixed(2)}%</span>
                  </>
                )}
              </div>
            </div>
            <SummaryRow
              label='Est. Fees (0.05%)'
              value={estFee > 0 ? formatUsd(estFee) : '—'}
            />
            {marginMode === 'isolated' && selectedSubaccountIndex != null && (
              <SummaryRow
                label='Subaccount'
                value={`Idx ${selectedSubaccountIndex}`}
              />
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default HyperliquidOrderTicket;
