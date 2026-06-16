import { useAuth } from '@pooflabs/web';
import {
  AtSign, ChevronDown, Clock, Crown, Eye, Flame, HelpCircle, Plus, Swords,
  Users, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyBattles, type BattlesResponse } from '@/lib/collections/battles';
import { deleteBattleWithRelated } from '@/utils/delete-battle';
import { subscribeManyBattleParticipants, type BattleParticipantsResponse } from '@/lib/collections/battleParticipants';
import { subscribeManyPotContributions, type PotContributionsResponse } from '@/lib/collections/potContributions';
import { truncateAddress } from '@/utils/format-address';
import { ADMIN_ADDRESS } from '@/lib/constants';
import { PnlLeaderboard } from './PnlLeaderboard';
import { MonthlyRewardClaim } from './MonthlyRewardClaim';
import { MonthlyHallOfFame } from './MonthlyHallOfFame';
import { WinsTicker } from './WinsTicker';
import { BigWinPopup } from './BigWinPopup';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUsdcMicro(micro: number): string {
  return `$${(micro / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 86400 * 7) return `${Math.round(seconds / (86400 * 7))}w`;
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 60)}m`;
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
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function truncateWallet(addr: string | undefined): string {
  if (!addr) return '—';
  return truncateAddress(addr);
}

function displayHandle(xHandle?: string, wallet?: string): string {
  if (xHandle) return `@${xHandle}`;
  return truncateWallet(wallet);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, rumble = false }: { status: string; rumble?: boolean }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: 'rgba(183,148,246,0.15)', color: '#b794f6', label: 'Pending' },
    active: { bg: 'rgba(74,222,128,0.15)', color: '#4ADE80', label: 'Active' },
    ended: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A', label: 'Ended' },
    claimed: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A', label: 'Claimed' },
    cancelled: { bg: 'rgba(255,82,82,0.15)', color: '#FF5252', label: 'Cancelled' },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span
      className='text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider'
      style={{ background: rumble ? 'rgba(255,215,0,0.15)' : s.bg, color: rumble ? '#FFD700' : s.color }}
    >
      {rumble ? 'ROYAL RUMBLE' : s.label}
    </span>
  );
}

// ─── Admin Delete Button ──────────────────────────────────────────────────────

function AdminDeleteButton({ battleId }: { battleId: string }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await deleteBattleWithRelated(battleId);
      if (!result.battleDeleted) {
        toast.error('Failed to delete battle');
      } else if (result.relatedError) {
        toast.success('Battle deleted');
        toast.error(`Related records: ${result.relatedError}`);
      } else {
        toast.success('Battle and related records deleted');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          disabled={deleting}
          className='flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:brightness-110 disabled:opacity-50'
          style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
          title='Delete battle'
        >
          <Trash2 size={13} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Battle?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the battle record and all related participants, messages, and spectators. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            style={{ background: '#EF4444', color: '#fff' }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Open Challenge Card ──────────────────────────────────────────────────────

function OpenChallengeCard({ battle, isAdmin }: { battle: BattlesResponse; isAdmin: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isChallenger = user?.address === battle.challenger;

  return (
    <div
      className='glass-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06]'
      onClick={() => navigate(`/battles/${battle.id}`)}
    >
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2 flex-1'>
          <div
            className='w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold'
            style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6' }}
          >
            {(battle.challengerXHandle ?? battle.challenger).charAt(0).toUpperCase()}
          </div>
          <div>
            <div className='text-sm font-semibold'>{displayHandle(battle.challengerXHandle, battle.challenger)}</div>
            <div className='text-xs' style={{ color: '#8A8A8A' }}>Challenger</div>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          {isAdmin && <AdminDeleteButton battleId={battle.id} />}
          <div className='text-right'>
            <div className='text-lg font-bold tabular-nums' style={{ color: '#b794f6' }}>
              {formatUsdcMicro(battle.betAmountMicro)}
            </div>
            <div className='text-xs' style={{ color: '#8A8A8A' }}>each side</div>
          </div>
        </div>
      </div>

      {/* Directed challenge tag */}
      {battle.opponentXHandle && (
        <div className='flex items-center gap-1.5 mb-2'>
          <AtSign size={11} style={{ color: '#1DA1F2' }} />
          <span className='text-xs font-semibold' style={{ color: '#1DA1F2' }}>
            Targeting @{battle.opponentXHandle}
          </span>
        </div>
      )}

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5' style={{ color: '#8A8A8A' }}>
          <Clock size={12} />
          <span className='text-xs'>{formatDuration(battle.durationSeconds)}</span>
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-xs' style={{ color: '#8A8A8A' }}>
            Pot: <span className='tabular-nums font-bold' style={{ color: '#4ADE80' }}>
              {formatUsdcMicro(battle.betAmountMicro * 2)}
            </span>
          </span>
          {!isChallenger && (
            <button
              className='text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110'
              style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
              onClick={(e) => { e.stopPropagation(); navigate(`/battles/${battle.id}`); }}
            >
              Accept
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Active Battle Card ───────────────────────────────────────────────────────

function ActiveBattleCard({ battle, isAdmin }: { battle: BattlesResponse; isAdmin: boolean }) {
  const navigate = useNavigate();
  const countdown = useCountdown(battle.endTime);

  return (
    <div
      className='glass-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06]'
      style={{ borderColor: 'rgba(74,222,128,0.2)' }}
      onClick={() => navigate(`/battles/${battle.id}`)}
    >
      <div className='flex items-center justify-between mb-3'>
        <StatusBadge status='active' />
        <div className='flex items-center gap-2'>
          {isAdmin && <AdminDeleteButton battleId={battle.id} />}
          <div className='flex items-center gap-1.5' style={{ color: '#b794f6' }}>
            <Clock size={12} />
            <span className='text-xs font-bold tabular-nums'>{countdown}</span>
          </div>
        </div>
      </div>

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <div
            className='w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold'
            style={{ background: '#4ADE8022', color: '#4ADE80' }}
          >
            {(battle.challengerXHandle ?? battle.challenger).charAt(0).toUpperCase()}
          </div>
          <span className='text-sm font-medium'>{displayHandle(battle.challengerXHandle, battle.challenger)}</span>
        </div>

        <div
          className='w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold'
          style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6' }}
        >
          <Swords size={14} />
        </div>

        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>{displayHandle(battle.opponentXHandle, battle.opponent)}</span>
          <div
            className='w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold'
            style={{ background: '#FF525222', color: '#FF5252' }}
          >
            {(battle.opponentXHandle ?? battle.opponent ?? '?').charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      <div className='flex items-center justify-between mt-3 pt-3' style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <span className='text-xs' style={{ color: '#8A8A8A' }}>Pot</span>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-bold tabular-nums' style={{ color: '#4ADE80' }}>
            {formatUsdcMicro(battle.betAmountMicro * 2)}
          </span>
          <button
            className='text-xs font-bold px-2.5 py-1 rounded-lg transition-all hover:brightness-110'
            style={{ background: 'rgba(183,148,246,0.10)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.25)' }}
            onClick={(e) => { e.stopPropagation(); navigate(`/battles/${battle.id}`); }}
          >
            Watch Live →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Completed Battle Card ────────────────────────────────────────────────────

function CompletedBattleCard({ battle, isAdmin }: { battle: BattlesResponse; isAdmin: boolean }) {
  const navigate = useNavigate();
  const winnerHandle = battle.winner === battle.challenger
    ? displayHandle(battle.challengerXHandle, battle.challenger)
    : displayHandle(battle.opponentXHandle, battle.opponent);

  return (
    <div
      className='glass-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06]'
      onClick={() => navigate(`/battles/${battle.id}`)}
    >
      <div className='flex items-center justify-between mb-2'>
        <StatusBadge status={battle.status} />
        <div className='flex items-center gap-2'>
          {isAdmin && <AdminDeleteButton battleId={battle.id} />}
          {battle.winner && (
            <div className='flex items-center gap-1.5'>
              <span className='text-xs font-bold' style={{ color: '#FFD700' }}>{winnerHandle}</span>
            </div>
          )}
        </div>
      </div>
      <div className='flex items-center justify-between mt-1'>
        <span className='text-xs' style={{ color: '#8A8A8A' }}>
          {displayHandle(battle.challengerXHandle, battle.challenger)} vs {displayHandle(battle.opponentXHandle, battle.opponent)}
        </span>
        <span className='text-sm font-bold tabular-nums' style={{ color: '#8A8A8A' }}>
          {formatUsdcMicro(battle.betAmountMicro * 2)}
        </span>
      </div>
    </div>
  );
}

// ─── Royal Rumble Card ────────────────────────────────────────────────────────

function RoyalRumbleCard({
  battle,
  participantCount,
  potMicro,
  isJoined,
  isAdmin,
}: {
  battle: BattlesResponse;
  participantCount: number;
  potMicro: number;
  isJoined: boolean;
  isAdmin: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const countdown = useCountdown(battle.endTime);
  const maxFighters = battle.maxParticipants ?? 20;

  const canJoin = battle.status === 'pending' && user && !isJoined && participantCount < maxFighters;

  return (
    <div
      className='glass-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06]'
      style={{ borderColor: battle.status === 'active' ? 'rgba(255,215,0,0.25)' : undefined }}
      onClick={() => navigate(`/rumble/${battle.id}`)}
    >
      <div className='flex items-center justify-between mb-3'>
        <StatusBadge status={battle.status} rumble />
        <div className='flex items-center gap-2'>
          {isAdmin && <AdminDeleteButton battleId={battle.id} />}
          {battle.status === 'active' && (
            <div className='flex items-center gap-1.5'>
              <span className='relative flex h-2 w-2'>
                <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75' />
                <span className='relative inline-flex rounded-full h-2 w-2 bg-red-500' />
              </span>
              <span className='text-xs font-bold' style={{ color: '#FF5252' }}>LIVE</span>
            </div>
          )}
        </div>
      </div>

      <div className='flex items-center gap-2 mb-3'>
        <div
          className='w-10 h-10 rounded-full flex items-center justify-center text-lg'
          style={{ background: 'rgba(255,215,0,0.12)', color: '#FFD700' }}
        >
          <Crown size={20} />
        </div>
        <div>
          <div className='text-sm font-bold'>Royal Rumble</div>
          <div className='text-xs' style={{ color: '#8A8A8A' }}>
            Entry: {formatUsdcMicro(battle.betAmountMicro)} per fighter
          </div>
        </div>
      </div>

      <div className='flex items-center justify-between mb-3'>
        <div>
          <div className='text-xs' style={{ color: '#8A8A8A' }}>Prize Pot</div>
          <div className='text-xl font-black tabular-nums' style={{ color: '#FFD700' }}>
            {formatUsdcMicro(potMicro)}
          </div>
        </div>
        <div className='text-right'>
          <div className='text-xs' style={{ color: '#8A8A8A' }}>Fighters</div>
          <div className='text-sm font-bold tabular-nums'>
            <Flame size={12} className='inline mr-1' style={{ color: '#b794f6' }} />
            {participantCount}/{maxFighters}
          </div>
        </div>
      </div>

      <div className='flex items-center justify-between pt-3' style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div className='flex items-center gap-1.5' style={{ color: '#8A8A8A' }}>
          {battle.status === 'pending' && (
            <>
              <Users size={12} />
              <span className='text-xs'>Starts at {battle.minParticipants ?? 5}+ fighters</span>
            </>
          )}
          {battle.status === 'active' && (
            <>
              <Clock size={12} style={{ color: '#FFD700' }} />
              <span className='text-xs font-bold tabular-nums' style={{ color: '#FFD700' }}>{countdown}</span>
            </>
          )}
          {(battle.status === 'ended' || battle.status === 'claimed') && (
            <span className='text-xs'>Battle ended</span>
          )}
          {battle.status === 'cancelled' && (
            <span className='text-xs' style={{ color: '#FF5252' }}>Cancelled</span>
          )}
        </div>

        {canJoin ? (
          <button
            className='text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110'
            style={{ background: 'rgba(255,215,0,0.15)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.35)' }}
            onClick={(e) => { e.stopPropagation(); navigate(`/rumble/${battle.id}`); }}
          >
            Join Battle
          </button>
        ) : battle.status === 'active' ? (
          <button
            className='text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110'
            style={{ background: 'rgba(255,82,82,0.12)', color: '#FF5252', border: '1px solid rgba(255,82,82,0.25)' }}
            onClick={(e) => { e.stopPropagation(); navigate(`/rumble/${battle.id}`); }}
          >
            <Eye size={12} className='inline mr-1' />
            Watch Live
          </button>
        ) : (
          <button
            className='text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:brightness-110'
            style={{ background: 'rgba(138,138,138,0.12)', color: '#8A8A8A', border: '1px solid rgba(138,138,138,0.25)' }}
            onClick={(e) => { e.stopPropagation(); navigate(`/rumble/${battle.id}`); }}
          >
            View Results
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptySection({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className='glass-section rounded-xl p-8 text-center' style={{ borderStyle: 'dashed' }}>
      <Icon size={28} className='mx-auto mb-2' style={{ color: '#3A3A3A' }} />
      <p className='text-sm' style={{ color: '#5A5A5A' }}>{message}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BattlesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.address === ADMIN_ADDRESS;
  const [view, setView] = useState<'leaderboard' | 'battles'>('leaderboard');
  const [tab, setTab] = useState<'1v1' | 'rumble'>('1v1');
  const [howOpen, setHowOpen] = useState(false);
  const [howRumbleOpen, setHowRumbleOpen] = useState(false);

  const { data: allBattles } = useRealtimeData<BattlesResponse[]>(
    subscribeManyBattles,
    true,
  );

  const { data: allParticipants } = useRealtimeData<BattleParticipantsResponse[]>(
    subscribeManyBattleParticipants,
    true,
  );

  const { data: allContributions } = useRealtimeData<PotContributionsResponse[]>(
    subscribeManyPotContributions,
    true,
  );

  const battles = allBattles ?? [];
  const participants = allParticipants ?? [];
  const contributions = allContributions ?? [];

  const h2hBattles = battles.filter((b) => b.type !== 'royalrumble');
  const rumbleBattles = battles.filter((b) => b.type === 'royalrumble');

  // 1v1 sections
  const openChallenges = h2hBattles.filter(
    (b) => b.status === 'pending' && !b.opponent,
  );
  const activeH2h = h2hBattles.filter((b) => b.status === 'active');
  const completedH2h = h2hBattles
    .filter((b) => b.status === 'ended' || b.status === 'claimed')
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, 20);

  // Rumble sections
  const pendingRumbles = rumbleBattles.filter((b) => b.status === 'pending');
  const activeRumbles = rumbleBattles.filter((b) => b.status === 'active');
  const completedRumbles = rumbleBattles
    .filter((b) => b.status === 'ended' || b.status === 'claimed' || b.status === 'cancelled')
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, 20);

  function getRumbleParticipantCount(battleId: string): number {
    return participants.filter((p) => p.battleId === battleId).length;
  }

  function getRumblePotMicro(battleId: string, betAmountMicro: number): number {
    const fighterCount = getRumbleParticipantCount(battleId);
    const contributionSum = contributions
      .filter((c) => c.battleId === battleId)
      .reduce((sum, c) => sum + c.amountMicro, 0);
    return fighterCount * betAmountMicro + contributionSum;
  }

  function isJoinedRumble(battleId: string): boolean {
    if (!user?.address) return false;
    return participants.some((p) => p.battleId === battleId && p.wallet === user.address);
  }

  return (
    <div className='min-h-screen text-white' style={{ paddingBottom: 120 }}>
      <AppHeader />

      {/* Real-time celebration popup for new big wins while on the Arena page */}
      <BigWinPopup />

      <div className='max-w-lg mx-auto px-4 pt-4 space-y-6'>
        {/* Live wins ticker — recent profitable closes by other traders */}
        <WinsTicker />

        {/* Header */}
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-xl font-bold tracking-tight' style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
              Arena
            </h1>
            <p className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>
              {view === 'leaderboard' ? 'Top traders by PnL' : 'Head-to-head & Royal Rumble PnL competition'}
            </p>
          </div>
          {view === 'battles' && (
            <button
              onClick={() => navigate('/battles/new')}
              className='flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all hover:brightness-110'
              style={{ background: 'rgba(183,148,246,0.18)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
            >
              <Plus size={16} />
              New Battle
            </button>
          )}
        </div>

        {/* Top-level view toggle */}
        <div className='grid grid-cols-2 gap-2'>
          <button
            onClick={() => setView('leaderboard')}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              view === 'leaderboard' ? 'glass-card-strong' : 'glass-card'
            }`}
            style={{
              background: view === 'leaderboard' ? 'rgba(183,148,246,0.12)' : undefined,
              borderColor: view === 'leaderboard' ? 'rgba(183,148,246,0.5)' : undefined,
              color: view === 'leaderboard' ? '#b794f6' : '#8A8A8A',
            }}
          >
            Leaderboard
          </button>
          <button
            onClick={() => setView('battles')}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              view === 'battles' ? 'glass-card-strong' : 'glass-card'
            }`}
            style={{
              background: view === 'battles' ? 'rgba(183,148,246,0.12)' : undefined,
              borderColor: view === 'battles' ? 'rgba(183,148,246,0.5)' : undefined,
              color: view === 'battles' ? '#b794f6' : '#8A8A8A',
            }}
          >
            <Swords size={14} className='inline mr-1.5' />
            Battles
          </button>
        </div>

        {/* Leaderboard view */}
        {view === 'leaderboard' && (
          <>
            <MonthlyRewardClaim />
            <PnlLeaderboard />
            <MonthlyHallOfFame />
          </>
        )}

        {/* Battle-type tabs (Battles view only) */}
        {view === 'battles' && (
        <div className='grid grid-cols-2 gap-2'>
          <button
            onClick={() => setTab('1v1')}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === '1v1' ? 'glass-card-strong' : 'glass-card'
            }`}
            style={{
              background: tab === '1v1' ? 'rgba(183,148,246,0.12)' : undefined,
              borderColor: tab === '1v1' ? 'rgba(183,148,246,0.5)' : undefined,
              color: tab === '1v1' ? '#b794f6' : '#8A8A8A',
            }}
          >
            <Swords size={14} className='inline mr-1.5' />
            1v1 Battles
          </button>
          <button
            onClick={() => setTab('rumble')}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === 'rumble' ? 'glass-card-strong' : 'glass-card'
            }`}
            style={{
              background: tab === 'rumble' ? 'rgba(255,215,0,0.12)' : undefined,
              borderColor: tab === 'rumble' ? 'rgba(255,215,0,0.5)' : undefined,
              color: tab === 'rumble' ? '#FFD700' : '#8A8A8A',
            }}
          >
            <Crown size={14} className='inline mr-1.5' />
            Royal Rumble
          </button>
        </div>
        )}

        {view === 'battles' && tab === '1v1' && (
          <>
            {/* How it works */}
            <div className='glass-card rounded-xl overflow-hidden'>
              <button
                className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]'
                onClick={() => setHowOpen((v) => !v)}
              >
                <div className='flex items-center gap-2'>
                  <HelpCircle size={15} style={{ color: '#b794f6' }} />
                  <span className='text-sm font-bold' style={{ color: '#b794f6' }}>How Battles Work</span>
                </div>
                <ChevronDown
                  size={15}
                  style={{ color: '#b794f6', transition: 'transform 0.2s', transform: howOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              {howOpen && (
                <ol className='space-y-2.5 px-4 pb-4'>
                  {[
                    { step: '1', title: 'Issue a Challenge', desc: 'Set a USDC wager and a battle duration. You can target a specific @handle or leave it open for anyone to accept.' },
                    { step: '2', title: 'Opponent Accepts', desc: 'The challenged trader matches the exact bet amount in USDC to lock in the battle. Both stakes are held until the battle ends.' },
                    { step: '3', title: 'Trade to Win', desc: "Both traders open positions on Phoenix Perps. The battle tracks each side's unrealized PnL % from the moment it starts." },
                    { step: '4', title: 'Highest PnL% Wins', desc: 'When the timer expires, the trader with the greater percentage gain wins the full pot (both stakes combined).' },
                    { step: '5', title: 'Claim Your Winnings', desc: 'The winner visits the battle detail page and claims their USDC payout directly to their wallet.' },
                  ].map(({ step, title, desc }) => (
                    <li key={step} className='flex gap-3'>
                      <div
                        className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black'
                        style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', marginTop: '1px' }}
                      >
                        {step}
                      </div>
                      <div>
                        <div className='text-sm font-semibold leading-snug'>{title}</div>
                        <div className='text-xs mt-0.5 leading-relaxed' style={{ color: '#8A8A8A' }}>{desc}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Open Challenges */}
            <section>
              <div className='flex items-center gap-2 mb-3'>
                <Swords size={16} style={{ color: '#b794f6' }} />
                <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Open Challenges
                </h2>
                {openChallenges.length > 0 && (
                  <span
                    className='text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums'
                    style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6' }}
                  >
                    {openChallenges.length}
                  </span>
                )}
              </div>
              {openChallenges.length === 0 ? (
                <EmptySection icon={Swords} message='No open challenges right now' />
              ) : (
                <div className='space-y-3'>
                  {openChallenges.map((b) => (
                    <OpenChallengeCard key={b.id} battle={b} isAdmin={isAdmin} />
                  ))}
                </div>
              )}
            </section>

            {/* Active Battles */}
            <section>
              <div className='flex items-center gap-2 mb-3'>
                <Clock size={16} style={{ color: '#4ADE80' }} />
                <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Active
                </h2>
                {activeH2h.length > 0 && (
                  <span
                    className='text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums'
                    style={{ background: '#4ADE8022', color: '#4ADE80' }}
                  >
                    {activeH2h.length}
                  </span>
                )}
              </div>
              {activeH2h.length === 0 ? (
                <EmptySection icon={Users} message='No active matches in the Arena' />
              ) : (
                <div className='space-y-3'>
                  {activeH2h.map((b) => (
                    <ActiveBattleCard key={b.id} battle={b} isAdmin={isAdmin} />
                  ))}
                </div>
              )}
            </section>

            {/* Completed */}
            <section>
              <div className='flex items-center gap-2 mb-3'>
                <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Completed
                </h2>
              </div>
              {completedH2h.length === 0 ? (
                <EmptySection icon={Swords} message='No completed Arena matches yet' />
              ) : (
                <div className='space-y-3'>
                  {completedH2h.map((b) => (
                    <CompletedBattleCard key={b.id} battle={b} isAdmin={isAdmin} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'battles' && tab === 'rumble' && (
          <>
            {/* How Royal Rumble works */}
            <div className='glass-card rounded-xl overflow-hidden' style={{ borderColor: 'rgba(255,215,0,0.15)' }}>
              <button
                className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]'
                onClick={() => setHowRumbleOpen((v) => !v)}
              >
                <div className='flex items-center gap-2'>
                  <Crown size={15} style={{ color: '#FFD700' }} />
                  <span className='text-sm font-bold' style={{ color: '#FFD700' }}>How Royal Rumble Works</span>
                </div>
                <ChevronDown
                  size={15}
                  style={{ color: '#FFD700', transition: 'transform 0.2s', transform: howRumbleOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              {howRumbleOpen && (
                <ol className='space-y-2.5 px-4 pb-4'>
                  {[
                    { step: '1', title: 'Join the Rumble', desc: 'Pay the entry fee to lock your seat. Everyone trades on Phoenix Perps simultaneously.' },
                    { step: '2', title: 'Battle Begins', desc: 'Once the minimum fighter count is reached, the timer starts. Trade to build the highest PnL%.' },
                    { step: '3', title: 'Top 3 Win', desc: 'When time expires, the top 3 traders by PnL% split the entire prize pot: 49.5% / 34.65% / 14.85%.' },
                    { step: '4', title: 'Boost the Pot', desc: 'Spectators can add USDC to the prize pool to make the rumble even more exciting.' },
                  ].map(({ step, title, desc }) => (
                    <li key={step} className='flex gap-3'>
                      <div
                        className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black'
                        style={{ background: 'rgba(255,215,0,0.15)', color: '#FFD700', marginTop: '1px' }}
                      >
                        {step}
                      </div>
                      <div>
                        <div className='text-sm font-semibold leading-snug'>{title}</div>
                        <div className='text-xs mt-0.5 leading-relaxed' style={{ color: '#8A8A8A' }}>{desc}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Active Rumbles */}
            <section>
              <div className='flex items-center gap-2 mb-3'>
                <Flame size={16} style={{ color: '#b794f6' }} />
                <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Active Rumbles
                </h2>
                {activeRumbles.length > 0 && (
                  <span
                    className='text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums'
                    style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6' }}
                  >
                    {activeRumbles.length}
                  </span>
                )}
              </div>
              {activeRumbles.length === 0 ? (
                <EmptySection icon={Flame} message='No active royal rumbles' />
              ) : (
                <div className='space-y-3'>
                  {activeRumbles.map((b) => (
                    <RoyalRumbleCard
                      key={b.id}
                      battle={b}
                      participantCount={getRumbleParticipantCount(b.id)}
                      potMicro={getRumblePotMicro(b.id, b.betAmountMicro)}
                      isJoined={isJoinedRumble(b.id)}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Pending Rumbles */}
            <section>
              <div className='flex items-center gap-2 mb-3'>
                <Users size={16} style={{ color: '#b794f6' }} />
                <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Pending Rumbles
                </h2>
                {pendingRumbles.length > 0 && (
                  <span
                    className='text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums'
                    style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6' }}
                  >
                    {pendingRumbles.length}
                  </span>
                )}
              </div>
              {pendingRumbles.length === 0 ? (
                <EmptySection icon={Users} message='No pending rumbles right now' />
              ) : (
                <div className='space-y-3'>
                  {pendingRumbles.map((b) => (
                    <RoyalRumbleCard
                      key={b.id}
                      battle={b}
                      participantCount={getRumbleParticipantCount(b.id)}
                      potMicro={getRumblePotMicro(b.id, b.betAmountMicro)}
                      isJoined={isJoinedRumble(b.id)}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Completed Rumbles */}
            <section>
              <div className='flex items-center gap-2 mb-3'>
                <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  Completed
                </h2>
              </div>
              {completedRumbles.length === 0 ? (
                <EmptySection icon={Crown} message='No completed rumbles yet' />
              ) : (
                <div className='space-y-3'>
                  {completedRumbles.map((b) => (
                    <RoyalRumbleCard
                      key={b.id}
                      battle={b}
                      participantCount={getRumbleParticipantCount(b.id)}
                      potMicro={getRumblePotMicro(b.id, b.betAmountMicro)}
                      isJoined={isJoinedRumble(b.id)}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <BottomTabNav />
    </div>
  );
}
