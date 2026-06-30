import { useAuth } from '@pooflabs/web';
import { AlertCircle, AtSign, CheckCircle, Clock, Eye, Loader2, Share2, Swords, Trophy, UserCheck, X } from 'lucide-react';
import { Torch } from './arena/Torch';
import { truncateAddress } from '@/utils/format-address';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { PositionsTable } from './trading/PositionsTable';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeBattles, updateBattles, type BattlesResponse } from '@/lib/collections/battles';
import { subscribeManyBattleParticipants, setBattleParticipants, type BattleParticipantsResponse } from '@/lib/collections/battleParticipants';
import { subscribeBattleClaims, type BattleClaimsResponse } from '@/lib/collections/battleClaims';
import { getPhoenixTrader } from '@/lib/collections/phoenixTrader';
import { PHOENIX_API_BASE, phoenixRegisterTrader } from '@/utils/phoenix-client';
import { Address } from '@/lib/db-client';
import type { TraderData, RisePosition } from '@/utils/phoenix-mappers';
import { toNumber, mapPosition } from '@/utils/phoenix-mappers';
import type { TraderPosition } from './trading/types';
import CircularCountdown from './CircularCountdown';
import BattleStandings from './BattleStandings';
import TrashTalkSection from './TrashTalkSection';
import BattleResultShareModal from './BattleResultShareModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveTraderData {
  portfolioMicro: number;
  positions: TraderPosition[];
  loading: boolean;
  error: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsdcMicro(micro: number): string {
  return `$${(micro / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPnlPct(currentMicro: number, startMicro: number): number {
  if (!startMicro) return 0;
  return ((currentMicro - startMicro) / startMicro) * 100;
}

function truncateWallet(addr: string): string {
  return truncateAddress(addr);
}

function displayHandle(xHandle?: string, wallet?: string): string {
  if (xHandle) return `@${xHandle}`;
  if (wallet) return truncateWallet(wallet);
  return '—';
}

function useCountdown(endTime: number): string {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceRender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Math.floor(Date.now() / 1000);
  const diff = endTime - now;
  if (diff <= 0) return 'Ended';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Live data hook ───────────────────────────────────────────────────────────

function useLiveTraderData(wallet: string | undefined, active: boolean): LiveTraderData {
  const [data, setData] = useState<LiveTraderData>({ portfolioMicro: 0, positions: [], loading: true, error: false });

  const fetchData = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${PHOENIX_API_BASE}/trader/${encodeURIComponent(wallet)}/state`);
      if (!res.ok) {
        setData((prev) => ({ ...prev, loading: false, error: true }));
        return;
      }
      const body = await res.json() as { traders?: TraderData[] };
      const trader = Array.isArray(body.traders) && body.traders.length > 0 ? body.traders[0] : null;
      if (!trader) {
        setData({ portfolioMicro: 0, positions: [], loading: false, error: false });
        return;
      }
      const portfolioMicro = Math.round(toNumber(trader.portfolioValue) * 1_000_000);
      const positions = (trader.positions ?? []).map((p: RisePosition) => mapPosition(p));
      setData({ portfolioMicro, positions, loading: false, error: false });
    } catch {
      setData((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    fetchData();
    if (!active) return;
    const id = setInterval(fetchData, 7000);
    return () => clearInterval(id);
  }, [wallet, active, fetchData]);

  return data;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    pending: { bg: 'rgba(183,148,246,0.15)', color: '#b794f6' },
    active: { bg: 'rgba(74,222,128,0.15)', color: '#4ADE80' },
    ended: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A' },
    claimed: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A' },
    cancelled: { bg: 'rgba(255,82,82,0.15)', color: '#FF5252' },
  };
  const c = cfg[status] ?? cfg.pending;
  return (
    <span
      className='text-xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider'
      style={{ background: c.bg, color: c.color }}
    >
      {status}
    </span>
  );
}

// ─── Trader Column ────────────────────────────────────────────────────────────

interface TraderColumnProps {
  label: 'Challenger' | 'Opponent';
  xHandle?: string;
  wallet?: string;
  equityAtStartMicro: number;
  liveData: LiveTraderData;
  isWinner: boolean;
  battleStatus: string;
}

function TraderColumn({ label, xHandle, wallet, equityAtStartMicro, liveData, isWinner, battleStatus }: TraderColumnProps) {
  const pnlPct = equityAtStartMicro > 0 ? formatPnlPct(liveData.portfolioMicro, equityAtStartMicro) : 0;
  const pnlPositive = pnlPct >= 0;
  const isActive = battleStatus === 'active';

  return (
    <div className='flex-1 min-w-0'>
      {/* Trader identity */}
      <div className='flex flex-col items-center text-center mb-4'>
        <div className='relative mb-2'>
          <div
            className='w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold'
            style={{
              background: label === 'Challenger' ? 'rgba(74,222,128,0.15)' : 'rgba(255,82,82,0.15)',
              color: label === 'Challenger' ? '#4ADE80' : '#FF5252',
              border: isWinner ? '2px solid #E0B341' : 'none',
              boxShadow: isWinner ? '0 0 12px rgba(200,150,42,0.4)' : 'none',
            }}
          >
            {(xHandle ?? wallet ?? '?').charAt(0).toUpperCase()}
          </div>
          {isWinner && (
            <Trophy
              size={14}
              className='absolute -top-1 -right-1'
              style={{ color: '#E0B341', filter: 'drop-shadow(0 0 4px rgba(200,150,42,0.6))' }}
            />
          )}
        </div>
        <div className='text-sm font-semibold truncate max-w-full'>
          {displayHandle(xHandle, wallet)}
        </div>
        <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>{label}</div>
      </div>

      {/* Portfolio value */}
      <div
        className='glass-inner rounded-xl p-3 mb-3 text-center'
      >
        {liveData.error ? (
          <p className='text-xs' style={{ color: '#8A8A8A' }}>Equity unavailable</p>
        ) : liveData.loading ? (
          <div className='h-8 animate-pulse rounded glass-inner' />
        ) : (
          <>
            <div className='text-sm font-bold tabular-nums'>
              {formatUsdcMicro(liveData.portfolioMicro)}
            </div>
            <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>Portfolio</div>
          </>
        )}
      </div>

      {/* PnL % — big number */}
      {(isActive || battleStatus === 'ended' || battleStatus === 'claimed') && equityAtStartMicro > 0 && (
        <div className='text-center mb-4'>
          {liveData.loading ? (
            <div className='h-10 animate-pulse rounded glass-card' />
          ) : liveData.error ? (
            <span className='text-2xl font-bold' style={{ color: '#8A8A8A' }}>—%</span>
          ) : (
            <>
              <span
                className='text-3xl font-black tabular-nums'
                style={{ color: pnlPositive ? '#4ADE80' : '#FF5252' }}
              >
                {pnlPositive ? '+' : ''}{pnlPct.toFixed(2)}%
              </span>
              <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>PnL since start</div>
            </>
          )}
        </div>
      )}

      {/* Positions */}
      {wallet && (
        <div>
          <div className='text-xs font-semibold uppercase tracking-wider mb-2' style={{ color: '#8A8A8A' }}>
            Positions
          </div>
          <PositionsTable
            positions={liveData.positions}
            loading={liveData.loading}
          />
        </div>
      )}
    </div>
  );
}

// ─── Action Area ──────────────────────────────────────────────────────────────

interface ActionAreaProps {
  battle: BattlesResponse;
  userAddress: string | undefined;
  onAccept: () => void;
  onCancel: () => void;
  onRematch: () => void;
  claim: BattleClaimsResponse | null;
  actionLoading: boolean;
  registering: boolean;
  notRegistered: boolean;
  onRegister: () => void;
  isSpectator: boolean;
}

function ActionArea({
  battle,
  userAddress,
  onAccept,
  onCancel,
  onRematch,
  claim,
  actionLoading,
  registering,
  notRegistered,
  onRegister,
  isSpectator,
}: ActionAreaProps) {
  const isChallenger = userAddress === battle.challenger;
  const isOpponent = userAddress === battle.opponent;
  const noOpponentYet = !battle.opponent;
  // Any authenticated user (except the challenger) can accept — directed challenges
  // are public call-outs tagged at an X user, not wallet-gated invitations.
  const canAccept =
    battle.status === 'pending' &&
    !isChallenger;

  const canCancel = battle.status === 'pending' && isChallenger && noOpponentYet;
  const isParticipant = isChallenger || isOpponent;
  const isWinner = !!battle.winner && battle.winner === userAddress;
  const canRematch = (battle.status === 'ended' || battle.status === 'claimed') && isParticipant;

  if (battle.status === 'cancelled') {
    return (
      <div className='glass-card flex items-center justify-center gap-2 p-4 rounded-xl'>
        <X size={16} style={{ color: '#FF5252' }} />
        <span className='text-sm' style={{ color: '#8A8A8A' }}>This battle was cancelled</span>
      </div>
    );
  }

  if (battle.status === 'claimed') {
    const winnerHandle = battle.winner === battle.challenger
      ? displayHandle(battle.challengerXHandle, battle.challenger)
      : displayHandle(battle.opponentXHandle, battle.opponent);

    const appName = 'Trading Battles';
    const shareText = isWinner
      ? `Just won a trading battle on ${appName}! 💪 Claimed ${(battle.betAmountMicro * 2 / 1_000_000).toFixed(2)} USDC. The best trader wins.`
      : `${winnerHandle} won a trading battle on ${appName}! Check out head-to-head perps PnL competitions.`;

    return (
      <div className='space-y-3'>
        <div className='glass-card flex items-center justify-center gap-2 p-4 rounded-xl' style={{ borderColor: 'rgba(255,215,0,0.2)' }}>
          <Trophy size={18} style={{ color: '#FFD700' }} />
          <span className='text-sm font-bold'>
            Winner: <span style={{ color: '#FFD700' }}>{winnerHandle}</span>
          </span>
        </div>
        {canRematch && (
          <button
            onClick={onRematch}
            className='w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110 flex items-center justify-center gap-2'
            style={{ background: '#b794f6', color: '#fff' }}
          >
            <Swords size={16} />
            Rematch
          </button>
        )}
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
          target='_blank'
          rel='noopener noreferrer'
          className='glass-button flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-all hover:bg-white/10'
        >
          <Share2 size={16} />
          Share on X
        </a>
      </div>
    );
  }

  if (battle.status === 'ended') {
    return (
      <div className='space-y-3'>
        {isWinner && (
          <div className='glass-card flex items-center justify-center gap-2 p-4 rounded-xl' style={{ background: 'rgba(74,222,128,0.06)', borderColor: 'rgba(74,222,128,0.25)' }}>
            <Clock size={16} style={{ color: '#4ADE80' }} />
            <span className='text-sm' style={{ color: '#4ADE80' }}>Awaiting payout… Prize will be sent shortly.</span>
          </div>
        )}
        {battle.winner && isParticipant && !isWinner && (
          <div className='glass-card flex items-center justify-center gap-2 p-4 rounded-xl'>
            <span className='text-sm' style={{ color: '#8A8A8A' }}>Better luck next time. Payout being processed.</span>
          </div>
        )}
        {canRematch && (
          <button
            onClick={onRematch}
            className='w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110 flex items-center justify-center gap-2'
            style={{ background: '#b794f6', color: '#fff' }}
          >
            <Swords size={16} />
            Rematch
          </button>
        )}
      </div>
    );
  }

  const isDirected = !!battle.opponentXHandle;
  const battleUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/battles/${battle.id}`
    : '';
  const shareTweetText = isDirected && battle.opponentXHandle
    ? `I'm challenging @${battle.opponentXHandle} to a Trading Battle — ${formatUsdcMicro(battle.betAmountMicro)} USDC. Accept here: ${battleUrl} 🎯⚔️`
    : '';
  const shareTweetUrl = shareTweetText
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTweetText)}`
    : '';

  return (
    <div className='space-y-3'>
      {/* Directed challenge badge */}
      {battle.status === 'pending' && isDirected && battle.opponentXHandle && (
        <a
          href={`https://twitter.com/${battle.opponentXHandle}`}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 px-4 py-3 rounded-xl transition-all hover:brightness-110'
          style={{ background: 'rgba(29,161,242,0.1)', border: '1px solid rgba(29,161,242,0.3)', textDecoration: 'none' }}
        >
          <AtSign size={15} style={{ color: '#1DA1F2', flexShrink: 0 }} />
          <span className='text-sm font-semibold flex-1' style={{ color: '#1DA1F2' }}>
            Challenge to @{battle.opponentXHandle}
          </span>
          <span className='text-xs' style={{ color: '#5A5A5A' }}>View on X ↗</span>
        </a>
      )}

      {notRegistered && (
        <div
          className='rounded-xl p-3 flex items-start gap-2'
          style={{ background: 'rgba(183,148,246,0.08)', border: '1px solid rgba(183,148,246,0.2)' }}
        >
          <AlertCircle size={16} style={{ color: '#b794f6', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className='text-xs mb-2' style={{ color: '#8A8A8A' }}>
              Register a Phoenix account first to join battles.
            </p>
            <button
              onClick={onRegister}
              disabled={registering}
              className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:brightness-110 disabled:opacity-50'
              style={{ background: '#b794f6', color: '#fff' }}
            >
              {registering ? <Loader2 size={12} className='animate-spin' /> : <UserCheck size={12} />}
              {registering ? 'Registering…' : 'Register on Phoenix'}
            </button>
          </div>
        </div>
      )}

      {canAccept && !notRegistered && (
        <button
          onClick={onAccept}
          disabled={actionLoading}
          className='w-full py-4 rounded-xl font-bold text-base transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2'
          style={{ background: '#4ADE80', color: '#000' }}
        >
          {actionLoading ? (
            <><Loader2 size={18} className='animate-spin' /> Joining Battle…</>
          ) : (
            <><Swords size={18} /> Accept Battle — {formatUsdcMicro(battle.betAmountMicro)}</>
          )}
        </button>
      )}

      {/* Share on X CTA for pending directed battles */}
      {battle.status === 'pending' && isChallenger && isDirected && shareTweetUrl && (
        <a
          href={shareTweetUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110'
          style={{ background: '#1DA1F2', color: '#fff' }}
        >
          <Share2 size={16} />
          Share call-out on X
        </a>
      )}

      {canCancel && (
        <button
          onClick={onCancel}
          disabled={actionLoading}
          className='w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2'
          style={{ background: 'rgba(255,82,82,0.12)', color: '#FF5252', border: '1px solid rgba(255,82,82,0.25)' }}
        >
          {actionLoading ? <Loader2 size={16} className='animate-spin' /> : <X size={16} />}
          Cancel Battle
        </button>
      )}

      {battle.status === 'pending' && !canAccept && !canCancel && userAddress && !notRegistered && (
        <div className='text-center p-3 text-sm' style={{ color: '#8A8A8A' }}>
          Waiting for opponent to accept…
        </div>
      )}

      {/* Spectator viewing active/ended battle */}
      {isSpectator && battle.status !== 'pending' && (
        <div className='glass-card flex items-center justify-center gap-2 p-4 rounded-xl' style={{ borderStyle: 'dashed' }}>
          <Eye size={16} style={{ color: '#8A8A8A' }} />
          <span className='text-sm' style={{ color: '#8A8A8A' }}>You are spectating this battle</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BattleDetailPage() {
  const { battleId } = useParams<{ battleId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: battle } = useRealtimeData<BattlesResponse | null>(
    subscribeBattles,
    !!battleId,
    battleId ?? '',
  );

  const { data: participants } = useRealtimeData<BattleParticipantsResponse[]>(
    subscribeManyBattleParticipants,
    !!battleId,
  );

  const { data: claim } = useRealtimeData<BattleClaimsResponse | null>(
    subscribeBattleClaims,
    !!battleId,
    battleId ?? '',
  );

  const filteredParticipants = (participants ?? []).filter((p) => p.battleId === battleId);
  const challengerParticipant = filteredParticipants.find((p) => p.wallet === battle?.challenger);
  const opponentParticipant = filteredParticipants.find((p) => p.wallet === battle?.opponent);

  const isActive = battle?.status === 'active';

  const challengerLive = useLiveTraderData(battle?.challenger, isActive);
  const opponentLive = useLiveTraderData(battle?.opponent, isActive);

  const countdown = useCountdown(battle?.endTime ?? 0);

  const [actionLoading, setActionLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  async function handleRegister() {
    if (!user?.address) return;
    setRegistering(true);
    try {
      await phoenixRegisterTrader(user.address);
      setNotRegistered(false);
      toast.success('Registered on Phoenix!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  }

  async function handleAccept() {
    if (!user?.address || !battle || !battleId) return;
    setActionLoading(true);
    try {
      // Check Phoenix registration
      const trader = await getPhoenixTrader(user.address);
      if (!trader) {
        setNotRegistered(true);
        setActionLoading(false);
        return;
      }

      // Fetch equity snapshot
      let equityMicro = 0;
      try {
        const res = await fetch(`${PHOENIX_API_BASE}/trader/${encodeURIComponent(user.address)}/state`);
        if (res.ok) {
          const body = await res.json() as { traders?: TraderData[] };
          const td = Array.isArray(body.traders) && body.traders.length > 0 ? body.traders[0] : null;
          if (td) equityMicro = Math.round(toNumber(td.portfolioValue) * 1_000_000);
        }
      } catch { /* ignore — equity = 0 */ }

      const now = Math.floor(Date.now() / 1000);
      const participantId = `${battleId}_${user.address}`;
      const ok = await setBattleParticipants(participantId, {
        battleId,
        wallet: Address.publicKey(user.address),
        xHandle: undefined,
        betAmountMicro: battle.betAmountMicro,
        equityAtStartMicro: equityMicro,
        joinedAt: now,
      });

      if (!ok) {
        toast.error('Failed to join battle. Check your USDC balance.');
        return;
      }

      toast.success('You joined the battle! USDC deposited.');
    } catch (err) {
      console.error(err);
      toast.error('Something went wrong');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!battleId || !battle) return;
    setActionLoading(true);
    try {
      const ok = await updateBattles(battleId, { status: 'cancelled' });
      if (!ok) {
        toast.error('Could not cancel — policy denied');
        return;
      }
      toast.success('Battle cancelled');
      navigate('/battles');
    } catch {
      toast.error('Something went wrong');
    } finally {
      setActionLoading(false);
    }
  }

  function handleRematch() {
    if (!battle) return;
    const opponent = battle.winner === battle.challenger
      ? (battle.opponentXHandle ?? battle.opponent ?? '')
      : (battle.challengerXHandle ?? battle.challenger ?? '');
    const params = new URLSearchParams();
    if (opponent) params.set('opponent', opponent);
    params.set('bet', String(battle.betAmountMicro));
    params.set('duration', String(battle.durationSeconds));
    navigate(`/battles/new?${params.toString()}`);
  }

  if (!battle) {
    return (
      <div className='min-h-screen text-white'>
        <AppHeader />
        <div className='max-w-lg mx-auto px-4 pt-16 text-center'>
          <div className='space-y-2'>
            {[1, 2, 3].map((i) => (
              <div key={i} className='h-16 rounded-xl animate-pulse glass-card' />
            ))}
          </div>
        </div>
        <BottomTabNav />
      </div>
    );
  }

  const isEnded = battle.status === 'ended' || battle.status === 'claimed';

  const challPnlPct = challengerParticipant?.equityAtStartMicro
    ? formatPnlPct(challengerLive.portfolioMicro, challengerParticipant.equityAtStartMicro)
    : 0;
  const oppPnlPct = opponentParticipant?.equityAtStartMicro
    ? formatPnlPct(opponentLive.portfolioMicro, opponentParticipant.equityAtStartMicro)
    : 0;

  const isSpectator = !user || (user.address !== battle.challenger && user.address !== battle.opponent);

  const showShareResult = isEnded && battle.opponent && challengerParticipant && opponentParticipant;

  return (
    <div className='min-h-screen text-white' style={{ paddingBottom: 120 }}>
      <AppHeader />

      <div className='max-w-lg mx-auto px-4 pt-4 space-y-4'>
        {/* Back */}
        <button
          onClick={() => navigate('/battles')}
          className='text-sm flex items-center gap-1 transition-colors hover:text-white'
          style={{ color: '#8A8A8A' }}
        >
          ← Battles
        </button>

        {/* Header card — arena styled */}
        <div
          className='arena-sand-particles rounded-xl p-4 overflow-hidden relative'
          style={{
            background: 'linear-gradient(135deg, rgba(60,45,15,0.5) 0%, rgba(35,22,5,0.65) 100%)',
            border: '1px solid rgba(200,150,42,0.28)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(200,150,42,0.06) inset',
          }}
        >
          {/* Background arch watermark */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.035, pointerEvents: 'none', overflow: 'hidden' }}>
            <svg width='100%' height='100%' viewBox='0 0 200 100' preserveAspectRatio='xMidYMid slice'>
              <path d='M70 100 L70 50 Q100 15 130 50 L130 100' stroke='rgba(200,150,42,1)' strokeWidth='2.5' fill='none' />
              <line x1='0' y1='95' x2='200' y2='95' stroke='rgba(200,150,42,1)' strokeWidth='1.5' />
            </svg>
          </div>

          <div className='flex items-center justify-between mb-3 relative z-10'>
            <div className='flex items-center gap-2'>
              <Torch size='sm' />
              <StatusBadge status={battle.status} />
              {isSpectator && (
                <span
                  className='text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wider flex items-center gap-1'
                  style={{ background: 'rgba(138,138,138,0.15)', color: '#8A8A8A' }}
                >
                  <Eye size={10} />
                  Spectating
                </span>
              )}
            </div>
            <div className='flex items-center gap-2'>
              {isActive && battle.startTime > 0 && (
                <CircularCountdown
                  startTime={battle.startTime}
                  endTime={battle.endTime}
                  size={72}
                  strokeWidth={5}
                  color='#E0B341'
                  bgColor='rgba(200,150,42,0.15)'
                />
              )}
              {isActive && battle.startTime === 0 && (
                <div className='flex items-center gap-1.5' style={{ color: '#E0B341' }}>
                  <Clock size={13} />
                  <span className='text-sm font-bold tabular-nums'>{countdown}</span>
                </div>
              )}
              <Torch size='sm' flip />
            </div>
          </div>

          <div className='grid grid-cols-3 gap-2 text-center relative z-10'>
            <div>
              <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Bet Each</div>
              <div className='text-base font-bold tabular-nums' style={{ color: '#C8962A' }}>
                {formatUsdcMicro(battle.betAmountMicro)}
              </div>
            </div>
            <div>
              <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Victory Treasury</div>
              <div className='text-base font-bold tabular-nums' style={{ color: '#E0B341', textShadow: '0 0 8px rgba(200,150,42,0.4)' }}>
                {formatUsdcMicro(battle.betAmountMicro * 2)}
              </div>
            </div>
            <div>
              <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Duration</div>
              <div className='text-base font-bold'>
                {battle.durationSeconds >= 86400 * 7
                  ? `${battle.durationSeconds / (86400 * 7)}w`
                  : battle.durationSeconds >= 86400
                  ? `${battle.durationSeconds / 86400}d`
                  : `${battle.durationSeconds / 3600}h`}
              </div>
            </div>
          </div>
        </div>

        {/* Live leaderboard */}
        {(battle.status === 'active' || isEnded) && (
          <BattleStandings
            challengerHandle={displayHandle(battle.challengerXHandle, battle.challenger)}
            opponentHandle={displayHandle(battle.opponentXHandle, battle.opponent)}
            challengerPnlPct={challPnlPct}
            opponentPnlPct={oppPnlPct}
            hasOpponent={!!battle.opponent}
          />
        )}

        {/* Head-to-head */}
        <div className='relative'>
          {/* VS badge — arena gold style */}
          <div
            className='absolute left-1/2 top-8 -translate-x-1/2 w-9 h-9 rounded-full flex items-center justify-center z-10 text-xs font-black'
            style={{
              background: 'linear-gradient(135deg, rgba(200,150,42,0.3) 0%, rgba(140,100,20,0.5) 100%)',
              border: '1.5px solid rgba(200,150,42,0.5)',
              boxShadow: '0 0 12px rgba(200,150,42,0.3)',
              color: '#E0B341',
            }}
          >
            VS
          </div>

          <div className='grid grid-cols-2 gap-2'>
            {/* Challenger */}
            <TraderColumn
              label='Challenger'
              xHandle={battle.challengerXHandle}
              wallet={battle.challenger}
              equityAtStartMicro={challengerParticipant?.equityAtStartMicro ?? 0}
              liveData={challengerLive}
              isWinner={battle.winner === battle.challenger}
              battleStatus={battle.status}
            />

            {/* Opponent */}
            {battle.opponent ? (
              <TraderColumn
                label='Opponent'
                xHandle={battle.opponentXHandle}
                wallet={battle.opponent}
                equityAtStartMicro={opponentParticipant?.equityAtStartMicro ?? 0}
                liveData={opponentLive}
                isWinner={battle.winner === battle.opponent}
                battleStatus={battle.status}
              />
            ) : (
              <div className='glass-section flex-1 flex flex-col items-center justify-center py-8 rounded-xl' style={{ borderStyle: 'dashed' }}>
                <Swords size={24} className='mb-2' style={{ color: '#3A3A3A' }} />
                <p className='text-xs text-center' style={{ color: '#5A5A5A' }}>Waiting for opponent</p>
              </div>
            )}
          </div>
        </div>

        {/* Claim success banner */}
        {battle.status === 'claimed' && claim && (
          <div
            className='rounded-xl p-3 flex items-center gap-2'
            style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}
          >
            <CheckCircle size={16} style={{ color: '#4ADE80' }} />
            <span className='text-sm' style={{ color: '#4ADE80' }}>
              Prize of {formatUsdcMicro(battle.betAmountMicro * 2)} sent to winner
            </span>
          </div>
        )}

        {/* Action area */}
        <ActionArea
          battle={battle}
          userAddress={user?.address}
          onAccept={handleAccept}
          onCancel={handleCancel}
          onRematch={handleRematch}
          claim={claim ?? null}
          actionLoading={actionLoading}
          registering={registering}
          notRegistered={notRegistered}
          onRegister={handleRegister}
          isSpectator={isSpectator}
        />

        {/* Share Result */}
        {showShareResult && (
          <button
            onClick={() => setShareOpen(true)}
            className='w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110 flex items-center justify-center gap-2'
            style={{ background: 'rgba(255,215,0,0.10)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)' }}
          >
            <Share2 size={16} />
            Share Result
          </button>
        )}

        {/* Trash Talk */}
        <TrashTalkSection battleId={battle.id} />

        {/* Participants info */}
        {filteredParticipants.length > 0 && (
          <div className='space-y-2'>
            <div className='text-xs font-semibold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
              Participants ({filteredParticipants.length}/2 joined)
            </div>
            {filteredParticipants.map((p) => (
              <div
                key={p.id}
                className='glass-card flex items-center justify-between rounded-xl px-4 py-3'
              >
                <div className='flex items-center gap-2'>
                  <div
                    className='w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold'
                    style={{ background: 'rgba(74,222,128,0.15)', color: '#4ADE80' }}
                  >
                    <CheckCircle size={12} />
                  </div>
                  <span className='text-sm font-mono' style={{ color: '#8A8A8A' }}>
                    {truncateAddress(p.wallet, 6, 6)}
                  </span>
                </div>
                <span className='text-xs tabular-nums' style={{ color: '#4ADE80' }}>
                  {formatUsdcMicro(p.betAmountMicro)} deposited
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Share modal */}
      {showShareResult && (
        <BattleResultShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          winnerHandle={
            battle.winner === battle.challenger
              ? displayHandle(battle.challengerXHandle, battle.challenger)
              : displayHandle(battle.opponentXHandle, battle.opponent)
          }
          challengerHandle={displayHandle(battle.challengerXHandle, battle.challenger)}
          opponentHandle={displayHandle(battle.opponentXHandle, battle.opponent)}
          challengerPnlPct={challPnlPct}
          opponentPnlPct={oppPnlPct}
          potUsdc={formatUsdcMicro(battle.betAmountMicro * 2)}
          battleUrl={typeof window !== 'undefined' ? `${window.location.origin}/battles/${battle.id}` : ''}
        />
      )}

      <BottomTabNav />
    </div>
  );
}
