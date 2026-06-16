/**
 * ActiveAccountFlow — Phoenix Exchange exact 4-step onboarding modal.
 *
 * Steps:
 *   verifyAccess  → single code input "Enter your code" / "Access Phoenix"
 *   signIn        → wallet message signature
 *   setupAccount  → on-chain trader registration (phoenixRegisterTrader)
 *   finishSignIn  → success/completion state
 *
 * Initial silent check: if trader already exists, skip to success and close.
 */

import { api, createAuthenticatedApiClient } from '@/lib/api-client';
import { getPhoenixTrader } from '@/lib/collections/phoenixTrader';
import { phoenixRegisterTrader, type RegisterPhase } from '@/utils/phoenix-client';
import { getIdToken, useAuth } from '@pooflabs/web';
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Step = 'verifyAccess' | 'signIn' | 'setupAccount' | 'finishSignIn';

interface ActiveAccountFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────

const STEP_ORDER: Step[] = ['verifyAccess', 'signIn', 'setupAccount', 'finishSignIn'];

const STEP_LABELS: Record<Step, string> = {
  verifyAccess: 'Verify access',
  signIn: 'Sign in',
  setupAccount: 'Set up account',
  finishSignIn: 'Finish sign-in',
};

function ProgressBar({ currentStep }: { currentStep: Step }) {
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <div className='relative flex items-center justify-between w-full mb-6'>
      {/* Connecting line behind pills */}
      <div
        className='absolute inset-x-0 top-1/2 -translate-y-1/2 h-px'
        style={{ background: 'rgba(255,255,255,0.08)', zIndex: 0 }}
      />

      {STEP_ORDER.map((step, idx) => {
        const isDone = idx < currentIdx;
        const isActive = idx === currentIdx;
        const isFuture = idx > currentIdx;

        return (
          <div
            key={step}
            className='relative flex flex-col items-center gap-1.5'
            style={{ zIndex: 1 }}
          >
            {/* Pill / dot indicator */}
            {isDone ? (
              <div
                className='flex items-center justify-center w-6 h-6 rounded-full'
                style={{ background: 'rgba(183,148,246,0.15)', border: '1px solid rgba(183,148,246,0.4)' }}
              >
                <CheckCircle2 size={12} style={{ color: '#b794f6' }} />
              </div>
            ) : isActive ? (
              <div
                className='flex items-center justify-center px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap'
                style={{ background: '#b794f6', color: '#fff', minWidth: '6px' }}
              >
                {STEP_LABELS[step]}
              </div>
            ) : (
              <div
                className='w-2 h-2 rounded-full'
                style={{ background: '#2A2A2A', border: '1px solid #333' }}
              />
            )}

            {/* Label below (only for done / future — active is in the pill) */}
            {!isActive && (
              <span
                className='text-[9px] font-medium whitespace-nowrap'
                style={{ color: isDone ? '#b794f6' : '#3A3A3A' }}
              >
                {STEP_LABELS[step]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ActiveAccountFlow({ open, onOpenChange }: ActiveAccountFlowProps) {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('verifyAccess');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [submittingCode, setSubmittingCode] = useState(false);

  const [signError, setSignError] = useState('');
  const [signing, setSigning] = useState(false);

  const [registerError, setRegisterError] = useState('');
  const [registerPhase, setRegisterPhase] = useState<RegisterPhase>('registering');

  // Guards to prevent duplicate auto-triggers
  const initialCheckDoneRef = useRef(false);
  const signTriggeredRef = useRef(false);
  const registerTriggeredRef = useRef(false);

  // ── Reset on open/close ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep('verifyAccess');
        setCode('');
        setCodeError('');
        setSubmittingCode(false);
        setSignError('');
        setSigning(false);
        setRegisterError('');
        setRegisterPhase('registering');
        initialCheckDoneRef.current = false;
        signTriggeredRef.current = false;
        registerTriggeredRef.current = false;
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ── Initial silent check: does this wallet already have a trader? ─────────
  useEffect(() => {
    if (!open) return;
    if (!user?.address) return;
    if (initialCheckDoneRef.current) return;
    initialCheckDoneRef.current = true;

    let cancelled = false;
    async function checkTrader() {
      try {
        // Use the backend Phoenix API as source of truth — same pattern as PortfolioPage and AccountPage.
        // getPhoenixTrader (Tarobase) is unreliable: the doc may be missing after a prior session
        // even though the user is fully registered with Phoenix.
        const data = await api.get(`/api/phoenix/trader/${user!.address}`);
        if (cancelled) return;
        if (data) {
          // Phoenix knows this wallet — check whether the Tarobase doc also exists.
          // For social/Privy wallets that onboarded via phoenix.trade directly (not through this
          // app's activation flow), the Tarobase phoenixTrader doc may be missing even though
          // the wallet is fully registered on Phoenix. In that case, proceed through signIn →
          // setupAccount so handleRegister() creates the doc. @PhoenixPerpsPlugin.registerTrader
          // is idempotent for already-registered wallets, so this is safe.
          const tarobaseDoc = await getPhoenixTrader(user!.address);
          if (cancelled) return;
          if (tarobaseDoc) {
            // Both Phoenix and Tarobase confirm registration — close immediately.
            onOpenChange(false);
            toast.success('Your Phoenix account is already active.');
          } else {
            // Phoenix-registered but Tarobase doc is missing (common for social-login wallets
            // that used a prior session or registered on phoenix.trade directly).
            // Skip the invite code step and go straight to signIn to create the Tarobase doc.
            toast.info('Linking your existing Phoenix account…');
            setStep('signIn');
          }
        }
        // null/falsy response — not registered yet, proceed with step 1
      } catch (err) {
        if (cancelled) return;
        const msg = (err instanceof Error ? err.message : '') || '';
        // 404 means not registered on Phoenix — proceed with onboarding
        // Any other error — fall through and let user go through onboarding
        if (!msg.includes('404') && !msg.toLowerCase().includes('not found') && !msg.toLowerCase().includes('trader not found')) {
          // Non-404 error: fall through silently (don't block onboarding on API errors)
        }
      }
    }
    checkTrader();
    return () => { cancelled = true; };
  }, [open, user?.address, onOpenChange]);

  // ── Auto-trigger: sign in step ────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'signIn') {
      signTriggeredRef.current = false;
      return;
    }
    if (signTriggeredRef.current) return;
    signTriggeredRef.current = true;
    handleSign();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Auto-trigger: setup account step ─────────────────────────────────────
  useEffect(() => {
    if (step !== 'setupAccount') {
      registerTriggeredRef.current = false;
      return;
    }
    if (registerTriggeredRef.current) return;
    registerTriggeredRef.current = true;
    handleRegister();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Auto-close on finishSignIn after delay ────────────────────────────────
  useEffect(() => {
    if (step !== 'finishSignIn') return;
    const t = setTimeout(() => {
      onOpenChange(false);
      navigate('/trade');
    }, 1800);
    return () => clearTimeout(t);
  }, [step, onOpenChange, navigate]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.address) {
      await login();
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      setCodeError('Please enter your code.');
      return;
    }
    setCodeError('');
    setSubmittingCode(true);

    try {
      const token = await getIdToken();
      if (!token) throw new Error('Could not retrieve auth token. Please reconnect your wallet.');
      const authApi = createAuthenticatedApiClient(token, user.address);
      await authApi.post('/api/phoenix/invite/activate-code', {
        authority: user.address,
        code: trimmed,
      });
      setStep('signIn');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid code. Please try again.';
      setCodeError(msg);
    } finally {
      setSubmittingCode(false);
    }
  }

  async function handleSign() {
    if (!user?.address) return;
    setSigning(true);
    setSignError('');
    try {
      // login() establishes the Poof auth session (wallet signature under the hood).
      // This is required before the setupAccount step can call set() on the SDK,
      // because the policy rule checks @user.address which is derived from the session token.
      await login();
      setStep('setupAccount');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signature rejected.';
      setSignError(msg);
      signTriggeredRef.current = false; // allow retry
    } finally {
      setSigning(false);
    }
  }

  async function handleRegister() {
    // Guard: if there's no active Poof session, the SDK set() will fail with a
    // policy denial because @user.address resolves to null.
    if (!user?.address) {
      setRegisterError('Wallet not authenticated — please sign in again.');
      registerTriggeredRef.current = false;
      toast.error('Wallet not authenticated — please sign in again.');
      return;
    }
    setRegisterError('');
    setRegisterPhase('registering');
    try {
      // Check whether this wallet is already registered before attempting to
      // create the doc. The policy's update rule is `false` (immutable), so
      // writing to an existing doc is always denied — checking first avoids
      // mistaking a policy denial for a transient session error.
      const existing = await getPhoenixTrader(user.address);
      if (existing) {
        // Already registered — skip the create call and advance directly.
        setStep('finishSignIn');
        return;
      }

      await phoenixRegisterTrader(user.address, ({ phase }) => {
        setRegisterPhase(phase);
      });
      setStep('finishSignIn');
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      const msg = raw ||
        'Registration failed. Please ensure your wallet is connected and try again.';
      setRegisterError(msg);
      registerTriggeredRef.current = false; // allow retry
      toast.error(msg);
    }
  }

  // ── Step renderers ─────────────────────────────────────────────────────────

  function renderVerifyAccess() {
    const isLoggedIn = !!user;

    return (
      <div className='space-y-5'>
        <div>
          <h2 className='text-lg font-bold mb-1' style={{ color: '#FFF' }}>
            Verify access
          </h2>
          <p className='text-sm' style={{ color: '#666' }}>
            Enter your invite code to access Phoenix Exchange.
          </p>
        </div>

        {!isLoggedIn ? (
          <div className='space-y-3'>
            <p className='text-xs' style={{ color: '#888' }}>
              Log in first to continue.
            </p>
            <Button
              onClick={login}
              className='w-full font-bold py-3 text-sm rounded-xl'
              style={{ background: '#b794f6', color: '#fff', border: 'none' }}
            >
              Log In
            </Button>
          </div>
        ) : (
          <form onSubmit={handleCodeSubmit} className='space-y-3'>
            <Input
              placeholder='Enter your code'
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeError(''); }}
              className="glass-input"
              style={{
                border: codeError ? '1px solid #FF5252' : undefined,
                borderRadius: '0.625rem',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '13px',
                letterSpacing: '0.03em',
                height: '44px',
              }}
              autoComplete='off'
              autoCapitalize='none'
              autoFocus
            />

            {codeError && (
              <div className='flex items-center gap-1.5 text-xs' style={{ color: '#FF5252' }}>
                <ShieldAlert size={12} />
                {codeError}
              </div>
            )}

            <Button
              type='submit'
              disabled={submittingCode}
              className='w-full font-bold py-3 text-sm rounded-xl transition-opacity'
              style={{
                background: '#b794f6',
                color: '#000',
                border: 'none',
                opacity: submittingCode ? 0.7 : 1,
                height: '44px',
              }}
            >
              {submittingCode ? (
                <span className='flex items-center justify-center gap-2'>
                  <Loader2 size={14} className='animate-spin' />
                  Verifying…
                </span>
              ) : (
                'Access Phoenix'
              )}
            </Button>
          </form>
        )}
      </div>
    );
  }

  function renderSignIn() {
    return (
      <div className='space-y-5'>
        <div>
          <h2 className='text-lg font-bold mb-1' style={{ color: '#FFF' }}>
            Sign in
          </h2>
          <p className='text-sm' style={{ color: '#666' }}>
            Sign message to continue
          </p>
        </div>

        <div className='flex flex-col items-center gap-4 py-4'>
          {signing && !signError ? (
            <>
              <div
                className='w-14 h-14 rounded-2xl flex items-center justify-center'
                style={{ background: 'rgba(183,148,246,0.1)', border: '1px solid rgba(183,148,246,0.2)' }}
              >
                <Loader2 size={26} className='animate-spin' style={{ color: '#b794f6' }} />
              </div>
              <div className='text-center space-y-1'>
                <p className='text-sm font-semibold' style={{ color: '#FFF' }}>
                  Signing message…
                </p>
                <p className='text-xs' style={{ color: '#888' }}>
                  Approve the signature request in your wallet.
                </p>
              </div>
            </>
          ) : signError ? (
            <>
              <div
                className='w-14 h-14 rounded-2xl flex items-center justify-center'
                style={{ background: 'rgba(255,82,82,0.1)', border: '1px solid rgba(255,82,82,0.2)' }}
              >
                <ShieldAlert size={24} style={{ color: '#FF5252' }} />
              </div>
              <p className='text-sm text-center' style={{ color: '#888' }}>
                {signError}
              </p>
              <Button
                onClick={handleSign}
                className='w-full font-bold py-3 text-sm rounded-xl'
                style={{ background: '#b794f6', color: '#fff', border: 'none', height: '44px' }}
              >
                Sign again
              </Button>
            </>
          ) : (
            <>
              <div
                className='w-14 h-14 rounded-2xl flex items-center justify-center'
                style={{ background: 'rgba(183,148,246,0.1)', border: '1px solid rgba(183,148,246,0.2)' }}
              >
                <Loader2 size={26} className='animate-spin' style={{ color: '#b794f6' }} />
              </div>
              <p className='text-sm text-center' style={{ color: '#888' }}>
                Waiting for wallet…
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderSetupAccount() {
    const phaseLabel =
      registerPhase === 'confirming'
        ? 'Confirming registration…'
        : 'Registering on Phoenix…';

    const phaseSubtext =
      registerPhase === 'confirming'
        ? 'Confirming your session is active — please wait a moment.'
        : 'Approve the transaction in your wallet.';

    return (
      <div className='space-y-5'>
        <div>
          <h2 className='text-lg font-bold mb-1' style={{ color: '#FFF' }}>
            Set up account
          </h2>
          <p className='text-sm' style={{ color: '#666' }}>
            Registering your on-chain trader account.
          </p>
        </div>

        <div className='flex flex-col items-center gap-4 py-4'>
          {registerError ? (
            <>
              <div
                className='w-14 h-14 rounded-2xl flex items-center justify-center'
                style={{ background: 'rgba(255,82,82,0.1)', border: '1px solid rgba(255,82,82,0.2)' }}
              >
                <ShieldAlert size={24} style={{ color: '#FF5252' }} />
              </div>
              <div className='text-center'>
                <p className='text-sm font-semibold mb-1' style={{ color: '#FF5252' }}>
                  Registration failed
                </p>
                <p className='text-xs' style={{ color: '#666' }}>{registerError}</p>
              </div>
              <Button
                onClick={() => {
                  setRegisterError('');
                  registerTriggeredRef.current = false;
                  handleRegister();
                }}
                className='w-full font-bold py-3 text-sm rounded-xl'
                style={{ background: '#b794f6', color: '#fff', border: 'none', height: '44px' }}
              >
                Retry
              </Button>
              <div
                className='w-full rounded-xl p-3 text-center space-y-2'
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <p className='text-xs' style={{ color: '#888' }}>
                  Don't have a Phoenix account yet?
                </p>
                <a
                  href='https://phoenix.trade'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='block w-full text-xs font-bold py-2 px-3 rounded-lg transition-all hover:brightness-110'
                  style={{ background: 'rgba(183,148,246,0.12)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.25)' }}
                >
                  Create account on phoenix.trade →
                </a>
                <p className='text-[10px]' style={{ color: '#555' }}>
                  After activating your account there, come back here to log in and start trading.
                </p>
              </div>
            </>
          ) : (
            <>
              <div
                className='w-14 h-14 rounded-2xl flex items-center justify-center'
                style={{ background: 'rgba(183,148,246,0.1)', border: '1px solid rgba(183,148,246,0.2)' }}
              >
                <Loader2 size={26} className='animate-spin' style={{ color: '#b794f6' }} />
              </div>
              <div className='text-center space-y-1'>
                <p className='text-sm font-semibold' style={{ color: '#FFF' }}>
                  {phaseLabel}
                </p>
                <p className='text-xs' style={{ color: '#888' }}>
                  {phaseSubtext}
                </p>
              </div>
              {registerPhase === 'confirming' && (
                <div
                  className='flex items-center gap-2 px-3 py-2 rounded-lg text-xs'
                  style={{ background: 'rgba(183,148,246,0.07)', border: '1px solid rgba(183,148,246,0.15)', color: '#b794f6' }}
                >
                  <Loader2 size={11} className='animate-spin shrink-0' />
                  Waiting for session to propagate…
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  function renderFinishSignIn() {
    return (
      <div className='space-y-5'>
        <div>
          <h2 className='text-lg font-bold mb-1' style={{ color: '#FFF' }}>
            Finish sign-in
          </h2>
          <p className='text-sm' style={{ color: '#666' }}>
            Your Phoenix account is ready.
          </p>
        </div>

        <div className='flex flex-col items-center gap-4 py-4'>
          <div
            className='w-14 h-14 rounded-2xl flex items-center justify-center'
            style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)' }}
          >
            <CheckCircle2 size={26} style={{ color: '#4ADE80' }} />
          </div>
          <div className='text-center'>
            <p className='text-base font-bold mb-1' style={{ color: '#FFF' }}>
              Account activated
            </p>
            <p className='text-sm' style={{ color: '#666' }}>
              Redirecting you to trade…
            </p>
          </div>

          <Button
            onClick={() => { onOpenChange(false); navigate('/trade'); }}
            className='w-full font-bold py-3 text-sm rounded-xl'
            style={{ background: '#b794f6', color: '#fff', border: 'none', height: '44px' }}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='sm:max-w-sm'
        style={{
          background: '#111',
          border: '1px solid #1E1E1E',
          borderRadius: '1rem',
          color: '#FFF',
          padding: '1.5rem',
        }}
      >
        <DialogHeader className='sr-only'>
          <DialogTitle>Activate Phoenix Account</DialogTitle>
          <DialogDescription>Complete the 4-step Phoenix account activation flow.</DialogDescription>
        </DialogHeader>

        <ProgressBar currentStep={step} />

        <div>
          {step === 'verifyAccess' && renderVerifyAccess()}
          {step === 'signIn' && renderSignIn()}
          {step === 'setupAccount' && renderSetupAccount()}
          {step === 'finishSignIn' && renderFinishSignIn()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ActiveAccountFlow;
