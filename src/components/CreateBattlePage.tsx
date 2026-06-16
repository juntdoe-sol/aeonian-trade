import { useAuth } from '@pooflabs/web';
import { AlertCircle, ChevronDown, Clock, Crown, Loader2, Share2, Swords, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { setBattles } from '@/lib/collections/battles';
import { setBattleParticipants } from '@/lib/collections/battleParticipants';
import { getPhoenixTrader } from '@/lib/collections/phoenixTrader';
import { PHOENIX_API_BASE } from '@/utils/phoenix-client';
import { phoenixRegisterTrader } from '@/utils/phoenix-client';
import { Address } from '@/lib/db-client';
import type { TraderData } from '@/utils/phoenix-mappers';
import { toNumber } from '@/utils/phoenix-mappers';
import { ADMIN_ADDRESS } from '@/lib/constants';

const APP_NAME = 'Trading Battles';

function validateXHandle(handle: string): boolean {
  return /^[A-Za-z0-9_]{1,15}$/.test(handle);
}

function buildShareTweetUrl(opponentHandle: string, betAmount: number, durationLabel: string, battleUrl: string): string {
  const text = `I'm challenging @${opponentHandle} to a Trading Battle on ${APP_NAME} — ${betAmount} USDC, ${durationLabel}. Accept here: ${battleUrl} 🎯⚔️`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

// ─── Duration options ─────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '4 hours', value: 14400 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
];

// ─── Fetch equity helper ──────────────────────────────────────────────────────

async function fetchPhoenixEquityMicro(walletAddress: string): Promise<number> {
  try {
    const res = await fetch(`${PHOENIX_API_BASE}/trader/${encodeURIComponent(walletAddress)}/state`);
    if (!res.ok) return 0;
    const body = await res.json() as { traders?: TraderData[] };
    const trader = Array.isArray(body.traders) && body.traders.length > 0 ? body.traders[0] : null;
    if (!trader) return 0;
    const portfolioUsd = toNumber(trader.portfolioValue);
    return Math.round(portfolioUsd * 1_000_000);
  } catch {
    return 0;
  }
}

// ─── Input component ──────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <label className='text-xs font-semibold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreateBattlePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.address === ADMIN_ADDRESS;

  const [mode, setMode] = useState<'h2h' | 'rumble'>('h2h');

  // H2H state
  const [battleType, setBattleType] = useState<'open' | 'specific'>('open');
  const [opponentXHandle, setOpponentXHandle] = useState('');
  const [betAmount, setBetAmount] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(3600);
  const [xHandle, setXHandle] = useState('');

  // Rumble state
  const [rumbleBetAmount, setRumbleBetAmount] = useState('');
  const [rumbleDuration, setRumbleDuration] = useState(3600);
  const [minParticipants, setMinParticipants] = useState(5);
  const [maxParticipants, setMaxParticipants] = useState(20);

  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  const [createdBattleId, setCreatedBattleId] = useState<string | null>(null);
  const [createdOpponentHandle, setCreatedOpponentHandle] = useState<string | null>(null);

  // Pre-fill from rematch query params
  useEffect(() => {
    const opponentParam = searchParams.get('opponent');
    const betParam = searchParams.get('bet');
    const durationParam = searchParams.get('duration');

    if (opponentParam) {
      setBattleType('specific');
      setOpponentXHandle(opponentParam);
    }
    if (betParam) {
      const betUsdc = parseFloat(betParam) / 1_000_000;
      if (betUsdc > 0) {
        setBetAmount(betUsdc.toString());
        setRumbleBetAmount(betUsdc.toString());
      }
    }
    if (durationParam) {
      const d = parseInt(durationParam, 10);
      if (!isNaN(d) && d > 0) {
        setDurationSeconds(d);
        setRumbleDuration(d);
      }
    }
  }, [searchParams]);

  async function handleRegister() {
    if (!user?.address) return;
    setRegistering(true);
    try {
      await phoenixRegisterTrader(user.address);
      setNotRegistered(false);
      toast.success('Registered on Phoenix! You can now create a battle.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  }

  async function handleSubmitH2H(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.address) {
      toast.error('Connect your wallet first');
      return;
    }

    const bet = parseFloat(betAmount);
    if (!bet || bet < 1) {
      toast.error('Minimum bet is 1 USDC');
      return;
    }

    const cleanOpponentHandle = opponentXHandle.replace(/^@/, '').trim();
    if (battleType === 'specific') {
      if (!cleanOpponentHandle) {
        toast.error('Enter the opponent X username');
        return;
      }
      if (!validateXHandle(cleanOpponentHandle)) {
        toast.error('Invalid X username — use 1-15 alphanumeric characters or underscores');
        return;
      }
    }

    setLoading(true);
    try {
      const trader = await getPhoenixTrader(user.address);
      if (!trader) {
        setNotRegistered(true);
        setLoading(false);
        return;
      }

      const equityMicro = await fetchPhoenixEquityMicro(user.address);
      const betAmountMicro = Math.round(bet * 1_000_000);
      const battleId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      const battleOk = await setBattles(battleId, {
        challenger: Address.publicKey(user.address),
        betAmountMicro,
        durationSeconds,
        status: 'pending',
        startTime: 0,
        endTime: 0,
        challengerXHandle: xHandle.replace(/^@/, '').trim() || undefined,
        opponentXHandle: battleType === 'specific' ? cleanOpponentHandle : undefined,
        createdAt: now,
        type: 'headtohead',
      });

      if (!battleOk) {
        toast.error('Failed to create battle. Check your wallet connection.');
        return;
      }

      const participantId = `${battleId}_${user.address}`;
      const joinOk = await setBattleParticipants(participantId, {
        battleId,
        wallet: Address.publicKey(user.address),
        xHandle: xHandle.replace(/^@/, '').trim() || undefined,
        betAmountMicro,
        equityAtStartMicro: equityMicro,
        joinedAt: now,
      });

      if (!joinOk) {
        toast.error('Battle created but USDC deposit failed. Check your balance.');
        navigate(`/battles/${battleId}`);
        return;
      }

      if (battleType === 'specific' && cleanOpponentHandle) {
        setCreatedBattleId(battleId);
        setCreatedOpponentHandle(cleanOpponentHandle);
        toast.success('Battle created! Share the challenge on X.');
      } else {
        toast.success('Battle created! Waiting for an opponent…');
        navigate(`/battles/${battleId}`);
      }
    } catch (err) {
      console.error(err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitRumble(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.address) {
      toast.error('Connect your wallet first');
      return;
    }

    const bet = parseFloat(rumbleBetAmount);
    if (!bet || bet < 1) {
      toast.error('Minimum entry fee is 1 USDC');
      return;
    }

    if (minParticipants < 3 || minParticipants > 10) {
      toast.error('Min fighters must be between 3 and 10');
      return;
    }

    if (maxParticipants < 5 || maxParticipants > 50) {
      toast.error('Max fighters must be between 5 and 50');
      return;
    }

    if (maxParticipants < minParticipants) {
      toast.error('Max fighters must be greater than or equal to min fighters');
      return;
    }

    setLoading(true);
    try {
      const trader = await getPhoenixTrader(user.address);
      if (!trader) {
        setNotRegistered(true);
        setLoading(false);
        return;
      }

      const equityMicro = await fetchPhoenixEquityMicro(user.address);
      const betAmountMicro = Math.round(bet * 1_000_000);
      const battleId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      const battleOk = await setBattles(battleId, {
        challenger: Address.publicKey(user.address),
        betAmountMicro,
        durationSeconds: rumbleDuration,
        status: 'pending',
        startTime: 0,
        endTime: 0,
        createdAt: now,
        type: 'royalrumble',
        minParticipants,
        maxParticipants,
      });

      if (!battleOk) {
        toast.error('Failed to create rumble. Check your wallet connection.');
        return;
      }

      const participantId = `${battleId}_${user.address}`;
      const joinOk = await setBattleParticipants(participantId, {
        battleId,
        wallet: Address.publicKey(user.address),
        betAmountMicro,
        equityAtStartMicro: equityMicro,
        joinedAt: now,
      });

      if (!joinOk) {
        toast.error('Rumble created but USDC deposit failed. Check your balance.');
        navigate(`/rumble/${battleId}`);
        return;
      }

      toast.success('Royal Rumble created!');
      navigate(`/rumble/${battleId}`);
    } catch (err) {
      console.error(err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <div className='min-h-screen flex flex-col text-white'>
        <AppHeader />
        <div className='flex-1 flex items-center justify-center'>
          <p style={{ color: '#8A8A8A' }}>Connect your wallet to create a battle.</p>
        </div>
        <BottomTabNav />
      </div>
    );
  }

  // Post-creation share screen for directed challenges
  if (createdBattleId && createdOpponentHandle) {
    const bet = parseFloat(betAmount);
    const durationLabel = DURATION_OPTIONS.find((o) => o.value === durationSeconds)?.label ?? `${durationSeconds}s`;
    const battleUrl = `${window.location.origin}/battles/${createdBattleId}`;
    const tweetUrl = buildShareTweetUrl(createdOpponentHandle, bet, durationLabel, battleUrl);

    return (
      <div className='min-h-screen flex flex-col text-white' style={{ paddingBottom: 120 }}>
        <AppHeader />
        <div className='flex-1 flex items-center justify-center px-4'>
          <div
            className='glass-card-strong w-full max-w-md rounded-2xl p-6 space-y-5'
          >
            <div className='text-center space-y-2'>
              <div
                className='w-14 h-14 rounded-2xl flex items-center justify-center mx-auto text-2xl'
                style={{ background: 'rgba(183,148,246,0.15)' }}
              >
                ⚔️
              </div>
              <h2 className='text-xl font-bold'>Challenge Created!</h2>
              <p className='text-sm' style={{ color: '#8A8A8A' }}>
                Share the call-out on X to reach{' '}
                <span className='font-bold' style={{ color: '#fff' }}>@{createdOpponentHandle}</span>
                . Anyone who clicks through can accept.
              </p>
            </div>

            <div
              className='glass-inner rounded-xl p-4 text-sm space-y-1'
            >
              <div className='flex justify-between'>
                <span style={{ color: '#8A8A8A' }}>Challenger</span>
                <span className='font-semibold'>You</span>
              </div>
              <div className='flex justify-between'>
                <span style={{ color: '#8A8A8A' }}>Tagged opponent</span>
                <span className='font-semibold' style={{ color: '#1DA1F2' }}>@{createdOpponentHandle}</span>
              </div>
              <div className='flex justify-between'>
                <span style={{ color: '#8A8A8A' }}>Bet</span>
                <span className='font-bold tabular-nums' style={{ color: '#b794f6' }}>
                  ${bet.toFixed(2)} USDC each
                </span>
              </div>
              <div className='flex justify-between'>
                <span style={{ color: '#8A8A8A' }}>Duration</span>
                <span className='font-semibold'>{durationLabel}</span>
              </div>
            </div>

            <a
              href={tweetUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center justify-center gap-2.5 w-full py-4 rounded-xl font-bold text-base transition-all hover:brightness-110'
              style={{ background: '#1DA1F2', color: '#fff' }}
            >
              <Share2 size={18} />
              Share on X — Call out @{createdOpponentHandle}
            </a>

            <button
              onClick={() => navigate(`/battles/${createdBattleId}`)}
              className='w-full py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110'
              style={{ background: '#141414', color: '#8A8A8A', border: '1px solid #2A2A2A' }}
            >
              View Battle →
            </button>
          </div>
        </div>
        <BottomTabNav />
      </div>
    );
  }

  return (
    <div className='min-h-screen text-white' style={{ paddingBottom: 120 }}>
      <AppHeader />

      <div className='max-w-lg mx-auto px-4 pt-4'>
        {/* Header */}
        <button
          onClick={() => navigate('/battles')}
          className='text-sm mb-4 flex items-center gap-1 transition-colors hover:text-white'
          style={{ color: '#8A8A8A' }}
        >
          ← Back
        </button>

        <h1 className='text-xl font-bold mb-1' style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
          New Battle
        </h1>
        <p className='text-xs mb-6' style={{ color: '#8A8A8A' }}>
          Create a head-to-head challenge or a Royal Rumble
        </p>

        {/* Mode selector */}
        <div className='grid grid-cols-2 gap-2 mb-6'>
          <button
            type='button'
            onClick={() => setMode('h2h')}
            className={`px-4 py-3 rounded-xl text-sm font-semibold transition-all ${mode === 'h2h' ? 'glass-card-strong' : 'glass-card'}`}
            style={{
              background: mode === 'h2h' ? 'rgba(183,148,246,0.12)' : undefined,
              borderColor: mode === 'h2h' ? 'rgba(183,148,246,0.5)' : undefined,
              color: mode === 'h2h' ? '#b794f6' : '#8A8A8A',
            }}
          >
            <Swords size={14} className='inline mr-1.5' />
            1v1 Challenge
          </button>
          <button
            type='button'
            onClick={() => setMode('rumble')}
            className={`px-4 py-3 rounded-xl text-sm font-semibold transition-all ${mode === 'rumble' ? 'glass-card-strong' : 'glass-card'}`}
            style={{
              background: mode === 'rumble' ? 'rgba(255,215,0,0.12)' : undefined,
              borderColor: mode === 'rumble' ? 'rgba(255,215,0,0.5)' : undefined,
              color: mode === 'rumble' ? '#FFD700' : '#8A8A8A',
            }}
          >
            <Crown size={14} className='inline mr-1.5' />
            Royal Rumble
          </button>
        </div>

        {/* Not registered warning */}
        {notRegistered && (
          <div
            className='glass-card rounded-xl p-4 mb-4 flex items-start gap-3'
            style={{ background: 'rgba(183,148,246,0.06)', borderColor: 'rgba(183,148,246,0.3)' }}
          >
            <AlertCircle size={18} style={{ color: '#b794f6', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p className='text-sm font-semibold mb-1' style={{ color: '#b794f6' }}>
                Phoenix account required
              </p>
              <p className='text-xs mb-3' style={{ color: '#8A8A8A' }}>
                You need to register a Phoenix trading account before joining battles.
              </p>
              <button
                onClick={handleRegister}
                disabled={registering}
                className='flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50'
                style={{ background: '#b794f6', color: '#fff' }}
              >
                {registering ? (
                  <><Loader2 size={14} className='animate-spin' /> Registering…</>
                ) : (
                  <><UserCheck size={14} /> Register on Phoenix</>
                )}
              </button>
            </div>
          </div>
        )}

        {mode === 'h2h' && (
          <form onSubmit={handleSubmitH2H} className='space-y-5'>
            {/* Battle type */}
            <FormField label='Challenge Type'>
              <div className='grid grid-cols-2 gap-2'>
                {(['open', 'specific'] as const).map((type) => (
                  <button
                    key={type}
                    type='button'
                    onClick={() => setBattleType(type)}
                    className={`px-4 py-3 rounded-xl text-sm font-semibold transition-all ${battleType === type ? 'glass-card-strong' : 'glass-card'}`}
                    style={{
                      background: battleType === type ? 'rgba(183,148,246,0.12)' : undefined,
                      borderColor: battleType === type ? 'rgba(183,148,246,0.5)' : undefined,
                      color: battleType === type ? '#b794f6' : '#8A8A8A',
                    }}
                  >
                    {type === 'open' ? 'Open Challenge' : 'Specific Opponent'}
                  </button>
                ))}
              </div>
            </FormField>

            {/* Opponent X username */}
            {battleType === 'specific' && (
              <FormField label='Opponent X Username'>
                <div className='relative'>
                  <span
                    className='absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold pointer-events-none'
                    style={{ color: '#8A8A8A' }}
                  >
                    @
                  </span>
                  <input
                    type='text'
                    value={opponentXHandle}
                    onChange={(e) => setOpponentXHandle(e.target.value.replace(/^@/, ''))}
                    placeholder='e.g. elonmusk'
                    maxLength={15}
                    className='glass-input w-full pl-8 pr-4 py-3 rounded-xl text-sm outline-none transition-all'
                    style={{
                      borderColor: opponentXHandle && !validateXHandle(opponentXHandle)
                        ? 'rgba(255,82,82,0.5)'
                        : undefined,
                    }}
                  />
                </div>
                {opponentXHandle && !validateXHandle(opponentXHandle) && (
                  <p className='text-xs mt-1' style={{ color: '#FF5252' }}>
                    1–15 characters, letters, numbers, or underscores only
                  </p>
                )}
                <p className='text-xs mt-1' style={{ color: '#5A5A5A' }}>
                  After creating, you'll get a pre-filled tweet to call them out on X
                </p>
              </FormField>
            )}

            {/* Bet amount */}
            <FormField label='Bet Amount (USDC)'>
              <div className='relative'>
                <input
                  type='number'
                  min='1'
                  step='0.01'
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  placeholder='10'
                  className='glass-input w-full px-4 py-3 rounded-xl text-sm outline-none transition-all tabular-nums'
                />
                <span
                  className='absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold'
                  style={{ color: '#8A8A8A' }}
                >
                  USDC
                </span>
              </div>
              {betAmount && parseFloat(betAmount) >= 1 && (
                <p className='text-xs mt-1' style={{ color: '#8A8A8A' }}>
                  Total pot: <span className='font-bold' style={{ color: '#4ADE80' }}>
                    ${(parseFloat(betAmount) * 2).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </p>
              )}
            </FormField>

            {/* Duration */}
            <FormField label='Duration'>
              <div className='relative'>
                <select
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  className='glass-input w-full appearance-none px-4 py-3 rounded-xl text-sm outline-none transition-all'
                >
                  {DURATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className='absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none'
                  style={{ color: '#8A8A8A' }}
                />
              </div>
            </FormField>

            {/* X Handle */}
            <FormField label='Your X/Twitter Handle (optional)'>
              <div className='relative'>
                <span
                  className='absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold'
                  style={{ color: '#8A8A8A' }}
                >
                  @
                </span>
                <input
                  type='text'
                  value={xHandle}
                  onChange={(e) => setXHandle(e.target.value.replace(/^@/, ''))}
                  placeholder='yourhandle'
                  className='glass-input w-full pl-8 pr-4 py-3 rounded-xl text-sm outline-none transition-all'
                />
              </div>
            </FormField>

            {/* Summary */}
            {betAmount && parseFloat(betAmount) >= 1 && (
              <div
                className='glass-inner rounded-xl p-4 space-y-2'
              >
                <p className='text-xs font-bold uppercase tracking-wider mb-2' style={{ color: '#8A8A8A' }}>
                  Summary
                </p>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Your deposit</span>
                  <span className='font-bold tabular-nums' style={{ color: '#b794f6' }}>
                    ${parseFloat(betAmount).toFixed(2)} USDC
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Duration</span>
                  <span className='font-bold' style={{ color: '#fff' }}>
                    {DURATION_OPTIONS.find((o) => o.value === durationSeconds)?.label}
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Winner takes</span>
                  <span className='font-bold tabular-nums' style={{ color: '#4ADE80' }}>
                    ${(parseFloat(betAmount) * 2).toFixed(2)} USDC
                  </span>
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              type='submit'
              disabled={loading || registering || !betAmount || parseFloat(betAmount) < 1}
              className='w-full py-4 rounded-xl font-bold text-base transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
              style={{ background: '#b794f6', color: '#fff' }}
            >
              {loading ? (
                <><Loader2 size={18} className='animate-spin' /> Creating Battle…</>
              ) : (
                <><Clock size={18} /> Create Battle</>
              )}
            </button>
          </form>
        )}

        {mode === 'rumble' && !isAdmin && (
          <div className='glass-card rounded-xl p-8 text-center space-y-3'>
            <Crown size={32} className='mx-auto' style={{ color: '#FFD700' }} />
            <h3 className='text-base font-bold' style={{ color: '#FFD700' }}>Royal Rumble</h3>
            <p className='text-sm' style={{ color: '#8A8A8A' }}>
              Royal Rumble battles are created by the AEONIAN team.
            </p>
          </div>
        )}

        {mode === 'rumble' && isAdmin && (
          <form onSubmit={handleSubmitRumble} className='space-y-5'>
            <FormField label='Entry Fee per Fighter (USDC)'>
              <div className='relative'>
                <input
                  type='number'
                  min='1'
                  step='0.01'
                  value={rumbleBetAmount}
                  onChange={(e) => setRumbleBetAmount(e.target.value)}
                  placeholder='10'
                  className='glass-input w-full px-4 py-3 rounded-xl text-sm outline-none transition-all tabular-nums'
                />
                <span
                  className='absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold'
                  style={{ color: '#8A8A8A' }}
                >
                  USDC
                </span>
              </div>
            </FormField>

            <FormField label='Duration'>
              <div className='relative'>
                <select
                  value={rumbleDuration}
                  onChange={(e) => setRumbleDuration(Number(e.target.value))}
                  className='glass-input w-full appearance-none px-4 py-3 rounded-xl text-sm outline-none transition-all'
                >
                  {DURATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className='absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none'
                  style={{ color: '#8A8A8A' }}
                />
              </div>
            </FormField>

            <FormField label='Min Fighters to Start'>
              <div className='flex items-center gap-3'>
                <input
                  type='range'
                  min={3}
                  max={10}
                  value={minParticipants}
                  onChange={(e) => setMinParticipants(Number(e.target.value))}
                  className='flex-1 accent-violet-400'
                />
                <span className='text-sm font-bold tabular-nums w-6' style={{ color: '#FFD700' }}>
                  {minParticipants}
                </span>
              </div>
            </FormField>

            <FormField label='Max Fighters'>
              <div className='flex items-center gap-3'>
                <input
                  type='range'
                  min={5}
                  max={50}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className='flex-1 accent-violet-400'
                />
                <span className='text-sm font-bold tabular-nums w-6' style={{ color: '#FFD700' }}>
                  {maxParticipants}
                </span>
              </div>
            </FormField>

            {rumbleBetAmount && parseFloat(rumbleBetAmount) >= 1 && (
              <div className='glass-inner rounded-xl p-4 space-y-2'>
                <p className='text-xs font-bold uppercase tracking-wider mb-2' style={{ color: '#8A8A8A' }}>
                  Summary
                </p>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Entry fee</span>
                  <span className='font-bold tabular-nums' style={{ color: '#FFD700' }}>
                    ${parseFloat(rumbleBetAmount).toFixed(2)} USDC
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Duration</span>
                  <span className='font-bold' style={{ color: '#fff' }}>
                    {DURATION_OPTIONS.find((o) => o.value === rumbleDuration)?.label}
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Fighters</span>
                  <span className='font-bold' style={{ color: '#fff' }}>
                    {minParticipants} – {maxParticipants}
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span style={{ color: '#8A8A8A' }}>Your deposit</span>
                  <span className='font-bold tabular-nums' style={{ color: '#b794f6' }}>
                    ${parseFloat(rumbleBetAmount).toFixed(2)} USDC
                  </span>
                </div>
              </div>
            )}

            <button
              type='submit'
              disabled={loading || registering || !rumbleBetAmount || parseFloat(rumbleBetAmount) < 1}
              className='w-full py-4 rounded-xl font-bold text-base transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
              style={{ background: '#FFD700', color: '#000' }}
            >
              {loading ? (
                <><Loader2 size={18} className='animate-spin' /> Creating Rumble…</>
              ) : (
                <><Crown size={18} /> Create Royal Rumble</>
              )}
            </button>
          </form>
        )}
      </div>

      <BottomTabNav />
    </div>
  );
}
