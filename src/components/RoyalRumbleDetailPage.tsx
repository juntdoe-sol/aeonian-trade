import { useAuth } from '@pooflabs/web';
import {
  AlertCircle, Crown, Eye, Flame, Loader2, Plus, Share2, Swords, Trophy, Users, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import CircularCountdown from './CircularCountdown';
import TrashTalkSection from './TrashTalkSection';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeBattles, type BattlesResponse } from '@/lib/collections/battles';
import {
  subscribeManyBattleParticipants,
  setBattleParticipants,
  type BattleParticipantsResponse,
} from '@/lib/collections/battleParticipants';
import { subscribeManyPotContributions, setPotContributions, type PotContributionsResponse } from '@/lib/collections/potContributions';
import { subscribeManyBattleSpectators, setBattleSpectators, type BattleSpectatorsResponse } from '@/lib/collections/battleSpectators';
import { subscribeRumbleClaims, type RumbleClaimsResponse } from '@/lib/collections/rumbleClaims';
import { getPhoenixTrader } from '@/lib/collections/phoenixTrader';
import { PHOENIX_API_BASE, phoenixRegisterTrader } from '@/utils/phoenix-client';
import { Address } from '@/lib/db-client';
import type { TraderData } from '@/utils/phoenix-mappers';
import { toNumber } from '@/utils/phoenix-mappers';
import { truncateAddress } from '@/utils/format-address';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUsdcMicro(micro: number): string {
  return `$${(micro / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncateWallet(addr: string | undefined): string {
  if (!addr) return '—';
  return truncateAddress(addr);
}

function formatDuration(seconds: number): string {
  if (seconds >= 86400 * 7) return `${Math.round(seconds / (86400 * 7))}w`;
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 60)}m`;
}

async function fetchPhoenixEquityMicro(walletAddress: string): Promise<number> {
  try {
    const res = await fetch(`${PHOENIX_API_BASE}/trader/${encodeURIComponent(walletAddress)}/state`);
    if (!res.ok) return 0;
    const body = await res.json() as { traders?: TraderData[] };
    const trader = Array.isArray(body.traders) && body.traders.length > 0 ? body.traders[0] : null;
    if (!trader) return 0;
    return Math.round(toNumber(trader.portfolioValue) * 1_000_000);
  } catch {
    return 0;
  }
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: 'rgba(183,148,246,0.15)', color: '#b794f6', label: 'Pending' },
    active: { bg: 'rgba(74,222,128,0.15)', color: '#4ADE80', label: 'Active' },
    ended: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A', label: 'Ended' },
    claimed: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A', label: 'Claimed' },
    cancelled: { bg: 'rgba(255,82,82,0.15)', color: '#FF5252', label: 'Cancelled' },
  };
  const c = cfg[status] ?? cfg.pending;
  return (
    <span
      className='text-xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider'
      style={{ background: c.bg, color: c.color }}
    >
      {c.label}
    </span>
  );
}

// ─── Leaderboard Row ──────────────────────────────────────────────────────────

interface LeaderboardRowProps {
  rank: number;
  wallet: string;
  pnlPct: number | null;
  prizeMicro: number | null;
}

function LeaderboardRow({ rank, wallet, pnlPct, prizeMicro }: LeaderboardRowProps) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  const positive = pnlPct !== null && pnlPct >= 0;

  return (
    <div
      className='flex items-center justify-between py-2.5 px-3 rounded-lg'
      style={{
        background: rank <= 3 ? 'rgba(255,215,0,0.05)' : undefined,
        border: rank <= 3 ? '1px solid rgba(255,215,0,0.1)' : undefined,
      }}
    >
      <div className='flex items-center gap-3'>
        <span className='text-sm font-black w-8 text-center' style={{ color: rank <= 3 ? '#FFD700' : '#8A8A8A' }}>
          {medal}
        </span>
        <span className='text-sm font-mono' style={{ color: '#ccc' }}>
          {truncateWallet(wallet)}
        </span>
      </div>
      <div className='text-right'>
        {pnlPct !== null ? (
          <div className='text-sm font-bold tabular-nums' style={{ color: positive ? '#4ADE80' : '#FF5252' }}>
            {positive ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        ) : (
          <div className='text-sm font-bold' style={{ color: '#8A8A8A' }}>—</div>
        )}
        {prizeMicro !== null && prizeMicro > 0 && (
          <div className='text-[10px] font-semibold tabular-nums' style={{ color: '#FFD700' }}>
            {formatUsdcMicro(prizeMicro)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Boost Modal ──────────────────────────────────────────────────────────────

function BoostModal({
  open,
  onClose,
  battleId,
}: {
  open: boolean;
  onClose: () => void;
  battleId: string;
}) {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleBoost() {
    if (!user?.address || !amount) return;
    const usdc = parseFloat(amount);
    if (!usdc || usdc < 1) {
      toast.error('Minimum boost is 1 USDC');
      return;
    }
    setLoading(true);
    try {
      const contributionId = `${battleId}_${user.address}_${Date.now()}`;
      const ok = await setPotContributions(contributionId, {
        battleId,
        contributorAddress: Address.publicKey(user.address),
        amountMicro: Math.round(usdc * 1_000_000),
        createdAt: Math.floor(Date.now() / 1000),
      });
      if (ok) {
        toast.success(`Boosted pot by ${usdc} USDC!`);
        setAmount('');
        onClose();
      } else {
        toast.error('Boost failed. Check your USDC balance.');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4' style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className='glass-card-strong rounded-2xl p-5 w-full max-w-sm space-y-4'>
        <div className='flex items-center justify-between'>
          <h3 className='text-base font-bold flex items-center gap-2'>
            <Crown size={16} style={{ color: '#FFD700' }} />
            Boost the Pot
          </h3>
          <button onClick={onClose} className='p-1 rounded-md hover:bg-white/10'>
            <X size={16} style={{ color: '#8A8A8A' }} />
          </button>
        </div>
        <p className='text-xs' style={{ color: '#8A8A8A' }}>
          Add USDC to the prize pool. Your contribution goes directly into the battle vault.
        </p>
        <div className='relative'>
          <input
            type='number'
            min='1'
            step='0.01'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='10'
            className='glass-input w-full px-4 py-3 rounded-xl text-sm outline-none transition-all tabular-nums'
          />
          <span className='absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold' style={{ color: '#8A8A8A' }}>
            USDC
          </span>
        </div>
        <button
          onClick={handleBoost}
          disabled={loading || !amount || parseFloat(amount) < 1}
          className='w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2'
          style={{ background: '#FFD700', color: '#000' }}
        >
          {loading ? (
            <><Loader2 size={16} className='animate-spin' /> Processing…</>
          ) : (
            <><Plus size={16} /> Boost Pot</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Share Result Card (inline) ───────────────────────────────────────────────

function RumbleResultCard({
  battle,
  claims,
}: {
  battle: BattlesResponse;
  claims: RumbleClaimsResponse | null;
}) {
  if (!claims) return null;

  const winners = [claims.winner1, claims.winner2, claims.winner3];
  const medals = ['🥇', '🥈', '🥉'];
  const colors = ['#FFD700', '#C0C0C0', '#CD7F32'];
  const prizeShares = [
    Math.floor(claims.totalPotMicro * 4950 / 10000),
    Math.floor(claims.totalPotMicro * 3465 / 10000),
    Math.floor(claims.totalPotMicro * 1485 / 10000),
  ];

  const shareText = encodeURIComponent(
    `Royal Rumble results on AEONIAN! Top 3 traders split ${formatUsdcMicro(claims.totalPotMicro)}. Check it out 🔥👑`
  );

  return (
    <div
      className='glass-card rounded-xl p-5 space-y-3'
      style={{ borderColor: 'rgba(255,215,0,0.2)' }}
    >
      <div className='flex items-center gap-2 mb-1'>
        <Trophy size={16} style={{ color: '#FFD700' }} />
        <h3 className='text-sm font-bold' style={{ color: '#FFD700' }}>Final Results</h3>
      </div>

      <div className='space-y-2'>
        {winners.map((w, i) => (
          <div
            key={w}
            className='flex items-center justify-between py-2 px-3 rounded-lg'
            style={{ background: `${colors[i]}11`, border: `1px solid ${colors[i]}33` }}
          >
            <div className='flex items-center gap-2'>
              <span className='text-lg'>{medals[i]}</span>
              <span className='text-sm font-semibold font-mono' style={{ color: colors[i] }}>
                {truncateWallet(w)}
              </span>
            </div>
            <span className='text-xs font-bold tabular-nums' style={{ color: colors[i] }}>
              {formatUsdcMicro(prizeShares[i])}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          const url = `https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(`${window.location.origin}/rumble/${battle.id}`)}`;
          window.open(url, '_blank');
        }}
        className='w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 flex items-center justify-center gap-2'
        style={{ background: 'rgba(255,215,0,0.10)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)' }}
      >
        <Share2 size={14} />
        Share on X
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RoyalRumbleDetailPage() {
  const { battleId } = useParams<{ battleId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: battle } = useRealtimeData<BattlesResponse | null>(
    subscribeBattles,
    !!battleId,
    battleId ?? '',
  );

  const { data: allParticipants } = useRealtimeData<BattleParticipantsResponse[]>(
    subscribeManyBattleParticipants,
    true,
  );

  const { data: allContributions } = useRealtimeData<PotContributionsResponse[]>(
    subscribeManyPotContributions,
    true,
  );

  const { data: allSpectators } = useRealtimeData<BattleSpectatorsResponse[]>(
    subscribeManyBattleSpectators,
    true,
  );

  const { data: claim } = useRealtimeData<RumbleClaimsResponse | null>(
    subscribeRumbleClaims,
    !!battleId,
    battleId ?? '',
  );

  const participants = useMemo(
    () => (allParticipants ?? []).filter((p) => p.battleId === battleId),
    [allParticipants, battleId],
  );

  const contributions = useMemo(
    () => (allContributions ?? []).filter((c) => c.battleId === battleId),
    [allContributions, battleId],
  );

  const spectators = useMemo(
    () => (allSpectators ?? []).filter((s) => s.battleId === battleId),
    [allSpectators, battleId],
  );

  const potMicro = useMemo(() => {
    const betSum = participants.reduce((sum, p) => sum + p.betAmountMicro, 0);
    const contribSum = contributions.reduce((sum, c) => sum + c.amountMicro, 0);
    return betSum + contribSum;
  }, [participants, contributions]);

  const isJoined = useMemo(() => {
    if (!user?.address) return false;
    return participants.some((p) => p.wallet === user.address);
  }, [participants, user?.address]);

  const isSpectator = useMemo(() => {
    if (!user?.address) return false;
    return spectators.some((s) => s.walletAddress === user.address);
  }, [spectators, user?.address]);

  const [boostOpen, setBoostOpen] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<Map<string, number | null>>(new Map());
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const isActive = battle?.status === 'active';
  const isPending = battle?.status === 'pending';
  const isEnded = battle?.status === 'ended' || battle?.status === 'claimed';

  // Poll Phoenix API every 30s when active
  const refreshLeaderboard = useCallback(async () => {
    if (!battleId || participants.length === 0) return;
    setLeaderboardLoading(true);
    const map = new Map<string, number | null>();
    await Promise.all(
      participants.map(async (p) => {
        const current = await fetchPhoenixEquityMicro(p.wallet);
        const pct = p.equityAtStartMicro > 0 && current > 0
          ? ((current - p.equityAtStartMicro) / p.equityAtStartMicro) * 100
          : null;
        map.set(p.wallet, pct);
      }),
    );
    setLeaderboardData(map);
    setLeaderboardLoading(false);
  }, [battleId, participants]);

  useEffect(() => {
    refreshLeaderboard();
    if (!isActive) return;
    const id = setInterval(refreshLeaderboard, 30_000);
    return () => clearInterval(id);
  }, [isActive, refreshLeaderboard]);

  async function handleJoin() {
    if (!user?.address || !battle || !battleId) return;
    setJoinLoading(true);
    try {
      const trader = await getPhoenixTrader(user.address);
      if (!trader) {
        setNotRegistered(true);
        setJoinLoading(false);
        return;
      }

      const equityMicro = await fetchPhoenixEquityMicro(user.address);
      const now = Math.floor(Date.now() / 1000);
      const participantId = `${battleId}_${user.address}`;

      const ok = await setBattleParticipants(participantId, {
        battleId,
        wallet: Address.publicKey(user.address),
        betAmountMicro: battle.betAmountMicro,
        equityAtStartMicro: equityMicro,
        joinedAt: now,
      });

      if (ok) {
        toast.success('You joined the Royal Rumble!');
      } else {
        toast.error('Join failed. Check your USDC balance.');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setJoinLoading(false);
    }
  }

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

  async function handleSpectate() {
    if (!user?.address || !battleId) return;
    const spectatorId = `${battleId}_${user.address}`;
    const ok = await setBattleSpectators(spectatorId, {
      battleId,
      walletAddress: Address.publicKey(user.address),
      joinedAt: Math.floor(Date.now() / 1000),
    });
    if (ok) {
      toast.success('You are now spectating!');
    } else {
      toast.error('Failed to register as spectator');
    }
  }

  // Compute prize amounts for top 3 if active/ended
  const prizeAmounts = useMemo(() => {
    if (!potMicro) return [null, null, null];
    return [
      Math.floor(potMicro * 4950 / 10000),
      Math.floor(potMicro * 3465 / 10000),
      Math.floor(potMicro * 1485 / 10000),
    ];
  }, [potMicro]);

  // Ranked participants
  const ranked = useMemo(() => {
    const arr = participants.map((p) => ({
      ...p,
      pnlPct: leaderboardData.get(p.wallet) ?? null,
    }));
    const valid = arr.filter((a) => a.pnlPct !== null).sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
    const invalid = arr.filter((a) => a.pnlPct === null);
    return [...valid, ...invalid];
  }, [participants, leaderboardData]);

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

        {/* Header */}
        <div className='glass-card rounded-xl p-5' style={{ borderColor: 'rgba(255,215,0,0.15)' }}>
          <div className='flex items-center justify-between mb-4'>
            <div className='flex items-center gap-2'>
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
            {isActive && battle.startTime > 0 && (
              <CircularCountdown
                startTime={battle.startTime}
                endTime={battle.endTime}
                size={64}
                strokeWidth={4}
                color='#FFD700'
                bgColor='rgba(255,215,0,0.15)'
              />
            )}
          </div>

          <div className='flex items-center gap-3 mb-4'>
            <div
              className='w-12 h-12 rounded-full flex items-center justify-center text-xl'
              style={{ background: 'rgba(255,215,0,0.12)', color: '#FFD700' }}
            >
              <Crown size={24} />
            </div>
            <div>
              <h1 className='text-lg font-bold'>Royal Rumble</h1>
              <p className='text-xs' style={{ color: '#8A8A8A' }}>
                {formatDuration(battle.durationSeconds)} battle • {battle.minParticipants ?? 5} min fighters
              </p>
            </div>
          </div>

          <div className='grid grid-cols-3 gap-3 text-center'>
            <div>
              <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Prize Pot</div>
              <div className='text-lg font-black tabular-nums' style={{ color: '#FFD700' }}>
                {formatUsdcMicro(potMicro)}
              </div>
            </div>
            <div>
              <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Fighters</div>
              <div className='text-lg font-black tabular-nums'>
                {participants.length}/{battle.maxParticipants ?? 20}
              </div>
            </div>
            <div>
              <div className='text-xs mb-0.5' style={{ color: '#8A8A8A' }}>Entry Fee</div>
              <div className='text-lg font-black tabular-nums' style={{ color: '#b794f6' }}>
                {formatUsdcMicro(battle.betAmountMicro)}
              </div>
            </div>
          </div>
        </div>

        {/* Live Leaderboard */}
        <div className='glass-card rounded-xl p-4 space-y-3'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Flame size={14} style={{ color: '#FFD700' }} />
              <h2 className='text-sm font-bold' style={{ color: '#FFD700' }}>Live Leaderboard</h2>
              {isActive && (
                <span className='relative flex h-2 w-2'>
                  <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75' />
                  <span className='relative inline-flex rounded-full h-2 w-2 bg-red-500' />
                </span>
              )}
            </div>
            {leaderboardLoading && <Loader2 size={14} className='animate-spin' style={{ color: '#8A8A8A' }} />}
          </div>

          {ranked.length === 0 ? (
            <p className='text-xs text-center py-4' style={{ color: '#5A5A5A' }}>No fighters yet</p>
          ) : (
            <div className='space-y-1'>
              {ranked.map((p, i) => (
                <LeaderboardRow
                  key={p.wallet}
                  rank={i + 1}
                  wallet={p.wallet}
                  pnlPct={p.pnlPct}
                  prizeMicro={isActive || isEnded ? prizeAmounts[i] ?? null : null}
                />
              ))}
            </div>
          )}
        </div>

        {/* Join Section */}
        {isPending && !isJoined && user && (
          <div className='glass-card rounded-xl p-4 space-y-3' style={{ borderColor: 'rgba(255,215,0,0.2)' }}>
            <div className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-bold'>Join this Royal Rumble</div>
                <div className='text-xs' style={{ color: '#8A8A8A' }}>
                  Entry fee: {formatUsdcMicro(battle.betAmountMicro)}
                </div>
              </div>
              <div
                className='w-10 h-10 rounded-full flex items-center justify-center'
                style={{ background: 'rgba(255,215,0,0.12)', color: '#FFD700' }}
              >
                <Swords size={18} />
              </div>
            </div>

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
                    onClick={handleRegister}
                    disabled={registering}
                    className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:brightness-110 disabled:opacity-50'
                    style={{ background: '#b794f6', color: '#fff' }}
                  >
                    {registering ? <Loader2 size={12} className='animate-spin' /> : <Users size={12} />}
                    {registering ? 'Registering…' : 'Register on Phoenix'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleJoin}
              disabled={joinLoading}
              className='w-full py-3.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2'
              style={{ background: '#FFD700', color: '#000' }}
            >
              {joinLoading ? (
                <><Loader2 size={16} className='animate-spin' /> Joining…</>
              ) : (
                <><Crown size={16} /> Join Battle — {formatUsdcMicro(battle.betAmountMicro)}</>
              )}
            </button>
          </div>
        )}

        {isPending && isJoined && (
          <div className='glass-card rounded-xl p-4 text-center' style={{ borderColor: 'rgba(74,222,128,0.2)' }}>
            <div className='flex items-center justify-center gap-2'>
              <Flame size={14} style={{ color: '#4ADE80' }} />
              <span className='text-sm font-bold' style={{ color: '#4ADE80' }}>You are locked in!</span>
            </div>
            <p className='text-xs mt-1' style={{ color: '#8A8A8A' }}>
              Waiting for more fighters… ({participants.length}/{battle.minParticipants ?? 5} needed)
            </p>
          </div>
        )}

        {/* Boost the Pot */}
        <div className='glass-card rounded-xl p-4'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm font-bold flex items-center gap-2'>
                <Plus size={14} style={{ color: '#FFD700' }} />
                Boost the Pot
              </div>
              <div className='text-xs' style={{ color: '#8A8A8A' }}>
                Current Prize Pool: <span className='font-bold' style={{ color: '#FFD700' }}>{formatUsdcMicro(potMicro)}</span>
              </div>
            </div>
            <button
              onClick={() => setBoostOpen(true)}
              className='w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:brightness-110'
              style={{ background: 'rgba(255,215,0,0.15)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)' }}
            >
              <Plus size={16} />
            </button>
          </div>

          {contributions.length > 0 && (
            <div className='mt-3 pt-3 space-y-1.5' style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div className='text-[10px] font-bold uppercase tracking-wider' style={{ color: '#5A5A5A' }}>Recent Sponsors</div>
              {contributions.slice(0, 5).map((c) => (
                <div key={c.id} className='flex items-center justify-between text-xs'>
                  <span className='font-mono' style={{ color: '#8A8A8A' }}>{truncateWallet(c.contributorAddress)}</span>
                  <span className='font-bold tabular-nums' style={{ color: '#FFD700' }}>+{formatUsdcMicro(c.amountMicro)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spectators */}
        <div className='glass-card rounded-xl p-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Eye size={14} style={{ color: '#8A8A8A' }} />
              <span className='text-sm font-bold' style={{ color: '#8A8A8A' }}>
                {spectators.length} Watching
              </span>
            </div>
            {user && !isSpectator && (
              <button
                onClick={handleSpectate}
                className='text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110'
                style={{ background: 'rgba(138,138,138,0.12)', color: '#8A8A8A', border: '1px solid rgba(138,138,138,0.25)' }}
              >
                Watch Live
              </button>
            )}
            {user && isSpectator && (
              <span className='text-xs font-bold px-3 py-1.5 rounded-lg' style={{ color: '#4ADE80' }}>
                Watching
              </span>
            )}
          </div>
        </div>

        {/* Trash Talk */}
        <TrashTalkSection battleId={battle.id} />

        {/* Share Result */}
        {isEnded && claim && (
          <RumbleResultCard battle={battle} claims={claim} />
        )}
      </div>

      <BoostModal open={boostOpen} onClose={() => setBoostOpen(false)} battleId={battle.id} />
      <BottomTabNav />
    </div>
  );
}
