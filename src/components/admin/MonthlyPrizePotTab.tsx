import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trophy, Coins, Plus, Loader2, AlertTriangle, CheckCircle2, XCircle, Search } from 'lucide-react';
import { useAuth, getIdToken } from '@pooflabs/web';
import { createAuthenticatedApiClient, api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TokenLogo } from '@/components/TokenLogo';
import { WithdrawFromPotSection } from '@/components/admin/WithdrawFromPotSection';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { Time, Address } from '@/lib/db-client';
import {
  setMonthlyRewardDeposit,
  subscribeManyMonthlyRewardDeposit,
  MonthlyRewardDepositResponse,
} from '@/lib/collections/monthlyRewardDeposit';
import {
  KNOWN_TOKENS,
  currentMonthKeyUTC,
  potAccountIdForMonth,
  monthLabel,
  symbolForMint,
} from '@/utils/monthly-reward-tokens';
import { useTokenMetadata } from '@/utils/use-token-metadata';
import { SOL } from '@/lib/constants';
import { errorToast, successToast } from '@/utils/toast-helpers';

const MAX_TOKENS = 5;

// Solana address pattern for quick client-side validation before hitting the backend.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Result returned by GET /api/token/lookup */
interface TokenLookupResult {
  mint: string;
  decimals: number;
  symbol: string | null;
  name: string | null;
  logoUri: string | null;
}

type LookupState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'valid'; token: TokenLookupResult }
  | { status: 'invalid'; message: string };

/**
 * Admin-only section to deposit one or more tokens into the CURRENT calendar
 * month's prize pot. Each deposit is its own immutable on-chain record; multiple
 * deposits (same or different mints) accumulate in the same pot PDA.
 */
export function MonthlyPrizePotTab() {
  const { user } = useAuth();

  const monthKey = useMemo(() => currentMonthKeyUTC(), []);
  const potAccountId = useMemo(() => potAccountIdForMonth(monthKey), [monthKey]);

  // Live deposits for THIS pot.
  const { data: deposits } = useRealtimeData<MonthlyRewardDepositResponse[]>(
    subscribeManyMonthlyRewardDeposit,
    true,
    `where potAccountId = '${potAccountId}'`,
  );

  const safeDeposits = deposits ?? [];

  // Pot composition: sum base units grouped by mint.
  const composition = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of safeDeposits) {
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
  }, [safeDeposits]);

  const distinctMints = composition.length;

  // Resolve symbol + decimals for each mint (unknown mints fetched via lookup API).
  const allMints = useMemo(() => composition.map((c) => c.mint), [composition]);
  const tokenMeta = useTokenMetadata(allMints);

  /** Format a base-unit amount using resolved metadata. */
  const formatCompositionAmount = (baseUnits: number, mint: string): string => {
    const meta = tokenMeta.get(mint);
    const decimals = meta?.decimals ?? 0;
    const symbol = meta?.symbol ?? symbolForMint(mint);
    const human = decimals > 0 ? baseUnits / Math.pow(10, decimals) : baseUnits;
    const maxFrac = Math.min(decimals, 6);
    const str = human.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFrac,
    });
    return `${str} ${symbol}`;
  };

  /** Resolve symbol for display (falls back to truncated mint until resolved). */
  const resolvedSymbol = (mint: string): string =>
    tokenMeta.get(mint)?.symbol ?? symbolForMint(mint);

  // ── Deposit form state ──────────────────────────────────────────────
  // mode 'preset' uses a known token; 'ca' lets you look up any SPL mint by address.
  const [mode, setMode] = useState<'preset' | 'ca'>('preset');
  const [presetMint, setPresetMint] = useState<string>(SOL);
  const [amount, setAmount] = useState('');

  // CA mode state
  const [caInput, setCaInput] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [caAmount, setCaAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Debounce timer ref for CA validation
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolved values for the deposit
  const selectedMint = mode === 'preset' ? presetMint : (lookup.status === 'valid' ? lookup.token.mint : '');

  // Would this deposit introduce a NEW distinct mint beyond the cap?
  const isNewMint = selectedMint ? !composition.some((c) => c.mint === selectedMint) : false;
  const capReached = distinctMints >= MAX_TOKENS && isNewMint;

  // Validate the CA input against the backend whenever it changes (debounced).
  const validateCA = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setLookup({ status: 'idle' });
      return;
    }
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      setLookup({ status: 'invalid', message: 'That does not look like a valid Solana address.' });
      return;
    }
    setLookup({ status: 'validating' });
    try {
      const result = await api.get<TokenLookupResult>(`/api/token/lookup?mint=${encodeURIComponent(trimmed)}`);
      setLookup({ status: 'valid', token: result });
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'That address is not a valid token mint.';
      setLookup({ status: 'invalid', message: msg });
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void validateCA(caInput), 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [caInput, validateCA]);

  // Reset CA state when switching modes
  const handleModeSwitch = (newMode: 'preset' | 'ca') => {
    setMode(newMode);
    if (newMode === 'ca') {
      setCaInput('');
      setLookup({ status: 'idle' });
      setCaAmount('');
    } else {
      setAmount('');
    }
  };

  /**
   * Best-effort announce after a successful deposit. ALWAYS called — the BACKEND
   * decides if this is the pot's first deposit and no-ops otherwise. Fire-and-
   * forget: a null token (social/Privy wallets) or any failure is swallowed
   * (logged only) so it never disrupts the deposit success UX.
   */
  const announcePotOpen = async (wallet: string) => {
    try {
      const token = await getIdToken();
      if (!token) {
        console.warn('[MonthlyPrizePotTab] announce skipped: no auth token.');
        return;
      }
      const authApi = createAuthenticatedApiClient(token, wallet);
      const res = await authApi.post<{ announced: boolean; notified: number }>(
        '/api/monthly-pot/announce',
        { monthKey, potAccountId },
      );
      if (res?.announced && res.notified > 0) {
        successToast('Traders notified the prize pot is live.');
      }
    } catch (err) {
      console.warn('[MonthlyPrizePotTab] pot-open announce failed (non-fatal):', err);
    }
  };

  const handleDeposit = async () => {
    if (!user) {
      errorToast('Please log in as the admin wallet first.');
      return;
    }

    let mint = '';
    let baseUnits = 0;
    let displaySymbol = '';

    if (mode === 'preset') {
      mint = presetMint;
      displaySymbol = symbolForMint(mint);
      const human = parseFloat(amount);
      if (!isFinite(human) || human <= 0) {
        errorToast('Enter a deposit amount greater than zero.');
        return;
      }
      // Use known decimals for preset tokens (SOL=9, USDC=6).
      const decimals = KNOWN_TOKENS.find((t) => t.mint === mint)?.decimals ?? 0;
      baseUnits = Math.round(human * Math.pow(10, decimals));
    } else {
      // CA mode — must be fully validated first.
      if (lookup.status !== 'valid') {
        errorToast('Validate the token address before depositing.');
        return;
      }
      const { token } = lookup;
      mint = token.mint;
      displaySymbol = token.symbol ?? symbolForMint(mint);
      const human = parseFloat(caAmount);
      if (!isFinite(human) || human <= 0) {
        errorToast('Enter a deposit amount greater than zero.');
        return;
      }
      baseUnits = Math.round(human * Math.pow(10, token.decimals));
    }

    if (baseUnits <= 0) {
      errorToast('Amount must be greater than zero.');
      return;
    }

    if (capReached) {
      errorToast(`This month already has ${MAX_TOKENS} distinct tokens. Add to an existing token instead.`);
      return;
    }

    setSubmitting(true);
    try {
      const depositId = `${potAccountId}_${Math.floor(Date.now() / 1000)}`;
      const ok = await setMonthlyRewardDeposit(depositId, {
        monthKey,
        potAccountId,
        mint: Address.publicKey(mint),
        amount: baseUnits,
        depositor: Address.publicKey(user.address),
        createdAt: Time.Now,
      });

      if (ok) {
        // Format display — use local helpers for known tokens, otherwise compute inline.
        const knownToken = KNOWN_TOKENS.find((t) => t.mint === mint);
        const decimals = knownToken?.decimals ?? (lookup.status === 'valid' ? lookup.token.decimals : 0);
        const human = baseUnits / Math.pow(10, decimals);
        const humanStr = human.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) });
        successToast(`Deposited ${humanStr} ${displaySymbol} into the ${monthLabel(monthKey)} prize pot.`);
        setAmount('');
        setCaAmount('');
        setCaInput('');
        setLookup({ status: 'idle' });
        void announcePotOpen(user.address);
      } else {
        // setMonthlyRewardDeposit returned false (policy denial). Since the admin address
        // check is already enforced by the page gate in AdminDashboard, the most likely
        // real cause at this point is insufficient token balance on the wallet.
        errorToast('Deposit failed on-chain — make sure your wallet holds enough of this token.');
      }
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Deposit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Deposit button disabled conditions
  const caValidating = mode === 'ca' && lookup.status === 'validating';
  const caInvalid = mode === 'ca' && lookup.status !== 'valid';
  const depositDisabled = submitting || capReached || caValidating || (mode === 'ca' && caInvalid);

  return (
    <div className="space-y-4">
      {/* Current pot composition */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            {monthLabel(monthKey)} Prize Pot
            <Badge variant="outline" className="ml-auto text-[10px] font-mono">
              {distinctMints}/{MAX_TOKENS} tokens
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {composition.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No deposits yet this month. Add the first token below to start the pot.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {composition.map(({ mint, total }) => (
                <div
                  key={mint}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                >
                  <TokenLogo symbol={resolvedSymbol(mint)} size={28} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight">{formatCompositionAmount(total, mint)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{resolvedSymbol(mint)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Rewards split per token: 1st place 50%, 2nd place 35%, 3rd place 15%. Winners are
            finalized automatically after the month ends.
          </p>
        </CardContent>
      </Card>

      {/* Deposit form */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            Add to the Pot
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'preset' ? 'default' : 'outline'}
              onClick={() => handleModeSwitch('preset')}
              className="flex-1"
            >
              Common tokens
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'ca' ? 'default' : 'outline'}
              onClick={() => handleModeSwitch('ca')}
              className="flex-1"
            >
              Token by contract address
            </Button>
          </div>

          {mode === 'preset' ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs mb-1.5 block">Token</Label>
                <div className="flex gap-2">
                  {KNOWN_TOKENS.map((t) => (
                    <button
                      key={t.mint}
                      type="button"
                      onClick={() => setPresetMint(t.mint)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                        presetMint === t.mint
                          ? 'border-primary bg-primary/10'
                          : 'border-border/50 bg-background/40 hover:border-border'
                      }`}
                    >
                      <TokenLogo symbol={t.symbol} size={22} />
                      <span className="text-sm font-medium">{t.symbol}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="mp-amount" className="text-xs mb-1.5 block">
                  Amount ({symbolForMint(presetMint)})
                </Label>
                <Input
                  id="mp-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* CA input */}
              <div>
                <Label htmlFor="mp-ca" className="text-xs mb-1.5 block">
                  Contract address (SPL mint)
                </Label>
                <div className="relative">
                  <Input
                    id="mp-ca"
                    placeholder="e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                    value={caInput}
                    onChange={(e) => setCaInput(e.target.value)}
                    className="font-mono text-xs pr-8"
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    {lookup.status === 'validating' && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                    {lookup.status === 'valid' && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                    {lookup.status === 'invalid' && (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    {lookup.status === 'idle' && caInput.length > 0 && (
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Validation feedback */}
                {lookup.status === 'invalid' && (
                  <p className="mt-1 text-[11px] text-destructive">{lookup.message}</p>
                )}
                {lookup.status === 'validating' && (
                  <p className="mt-1 text-[11px] text-muted-foreground">Looking up token on-chain…</p>
                )}
              </div>

              {/* Token confirmation card — shown only when valid */}
              {lookup.status === 'valid' && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2.5 space-y-1">
                  <div className="flex items-center gap-2.5">
                    {lookup.token.logoUri ? (
                      <img
                        src={lookup.token.logoUri}
                        alt={lookup.token.symbol ?? 'token'}
                        className="h-6 w-6 rounded-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-border/50 flex items-center justify-center">
                        <Coins className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-tight">
                        {lookup.token.symbol ?? 'Unknown'}
                        {lookup.token.name && lookup.token.name !== lookup.token.symbol && (
                          <span className="ml-1 font-normal text-muted-foreground text-xs">{lookup.token.name}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {lookup.token.mint.slice(0, 8)}…{lookup.token.mint.slice(-8)}
                        <span className="ml-2">{lookup.token.decimals} decimals</span>
                      </div>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto shrink-0" />
                  </div>
                </div>
              )}

              {/* Amount input — only visible once address is confirmed */}
              {lookup.status === 'valid' && (
                <div>
                  <Label htmlFor="mp-ca-amount" className="text-xs mb-1.5 block">
                    Amount ({lookup.token.symbol ?? 'tokens'})
                  </Label>
                  <Input
                    id="mp-ca-amount"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={caAmount}
                    onChange={(e) => setCaAmount(e.target.value)}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Enter a human amount — conversion to on-chain base units is automatic
                    ({lookup.token.decimals} decimal{lookup.token.decimals !== 1 ? 's' : ''}).
                  </p>
                </div>
              )}

              {/* Idle hint */}
              {lookup.status === 'idle' && !caInput && (
                <p className="text-[11px] text-muted-foreground">
                  Paste any SPL token mint address. Decimals are read directly from the chain.
                </p>
              )}
            </div>
          )}

          {capReached && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                This month already holds {MAX_TOKENS} distinct tokens — the maximum payable. Top up an
                existing token instead of adding a new one.
              </span>
            </div>
          )}

          <Button onClick={handleDeposit} disabled={depositDisabled} className="w-full">
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Depositing…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Deposit to {monthLabel(monthKey)} pot
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Withdraw — pull a token back out of the current, not-yet-finalized pot. */}
      <WithdrawFromPotSection
        monthKey={monthKey}
        potAccountId={potAccountId}
        mints={composition.map((c) => c.mint)}
      />
    </div>
  );
}
