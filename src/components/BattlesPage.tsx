import { useAuth } from '@pooflabs/web';
import {
  AtSign, ChevronDown, Clock, Crown, Eye, Flame, HelpCircle, Plus, Swords,
  Users, Trash2, Shield, TrendingUp, Trophy, Activity,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
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
import { MonthlyPrizePotCard } from './MonthlyPrizePotCard';
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

// ─── Scroll-reveal wrapper ────────────────────────────────────────────────────
function RevealSection({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(28px)',
        transition: `opacity 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ─── Arena Section Header ─────────────────────────────────────────────────────

function ArenaSectionHeader({
  icon: Icon,
  label,
  count,
  iconColor = '#C8962A',
}: {
  icon: React.ElementType;
  label: string;
  count?: number;
  iconColor?: string;
}) {
  return (
    <div className='flex items-center gap-2 mb-3'>
      <Icon size={15} style={{ color: iconColor }} />
      <h2 className='text-sm font-bold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
        {label}
      </h2>
      {count !== undefined && count > 0 && (
        <span
          className='text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums'
          style={{ background: 'rgba(200,150,42,0.15)', color: '#C8962A' }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, rumble = false }: { status: string; rumble?: boolean }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: 'rgba(183,148,246,0.15)', color: '#b794f6', label: 'Pending' },
    active: { bg: 'rgba(74,222,128,0.15)', color: '#4ADE80', label: 'Combat in Progress' },
    ended: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A', label: 'The Fallen' },
    claimed: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A', label: 'The Fallen' },
    cancelled: { bg: 'rgba(255,82,82,0.15)', color: '#FF5252', label: 'Cancelled' },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span
      className='text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider'
      style={{ background: rumble ? 'rgba(200,150,42,0.15)' : s.bg, color: rumble ? '#E0B341' : s.color }}
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
      className='arena-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06] relative overflow-hidden'
      onClick={() => navigate(`/battles/${battle.id}`)}
    >
      {/* Arch watermark */}
      <div className='arena-watermark'>
        <svg width='100%' height='100%' viewBox='0 0 200 80' preserveAspectRatio='xMidYMid slice'>
          <path d='M20 80 L20 40 Q50 10 80 40 L80 80' stroke='rgba(200,150,42,1)' strokeWidth='2' fill='none' />
          <path d='M120 80 L120 40 Q150 10 180 40 L180 80' stroke='rgba(200,150,42,1)' strokeWidth='2' fill='none' />
        </svg>
      </div>

      <div className='relative z-10'>
        <div className='flex items-center justify-between mb-3'>
          <div className='flex items-center gap-2 flex-1'>
            <div
              className='w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold'
              style={{ background: 'rgba(200,150,42,0.15)', color: '#C8962A', border: '1px solid rgba(200,150,42,0.3)' }}
            >
              <Shield size={14} />
            </div>
            <div>
              <div className='text-sm font-semibold'>{displayHandle(battle.challengerXHandle, battle.challenger)}</div>
              <div className='text-xs' style={{ color: '#8A8A8A' }}>Challenger</div>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            {isAdmin && <AdminDeleteButton battleId={battle.id} />}
            <div className='text-right'>
              <div className='text-lg font-bold tabular-nums' style={{ color: '#E0B341' }}>
                {formatUsdcMicro(battle.betAmountMicro)}
              </div>
              <div className='text-xs' style={{ color: '#8A8A8A' }}>each side</div>
            </div>
          </div>
        </div>

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
                style={{ background: 'rgba(200,150,42,0.15)', color: '#E0B341', border: '1px solid rgba(200,150,42,0.35)' }}
                onClick={(e) => { e.stopPropagation(); navigate(`/battles/${battle.id}`); }}
              >
                Accept
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Active Battle Card ───────────────────────────────────────────────────────

function ActiveBattleCard({ battle, isAdmin }: { battle: BattlesResponse; isAdmin: boolean }) {
  const navigate = useNavigate();
  const countdown = useCountdown(battle.endTime);

  const challengerInitial = (battle.challengerXHandle ?? battle.challenger).charAt(0).toUpperCase();
  const opponentInitial = (battle.opponentXHandle ?? battle.opponent ?? '?').charAt(0).toUpperCase();

  return (
    <div
      className='arena-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06] relative overflow-hidden'
      style={{ borderColor: 'rgba(74,222,128,0.2)' }}
      onClick={() => navigate(`/battles/${battle.id}`)}
    >
      {/* Stone arch watermark */}
      <div className='arena-watermark'>
        <svg width='100%' height='100%' viewBox='0 0 200 60' preserveAspectRatio='xMidYMid slice'>
          <path d='M0 60 L0 30 Q30 5 60 30 L60 60' stroke='rgba(200,150,42,1)' strokeWidth='1.5' fill='none' />
          <path d='M140 60 L140 30 Q170 5 200 30 L200 60' stroke='rgba(200,150,42,1)' strokeWidth='1.5' fill='none' />
        </svg>
      </div>

      <div className='relative z-10'>
        <div className='flex items-center justify-between mb-3'>
          <StatusBadge status='active' />
          <div className='flex items-center gap-2'>
            {isAdmin && <AdminDeleteButton battleId={battle.id} />}
            <div className='flex items-center gap-1.5' style={{ color: '#E0B341' }}>
              <Clock size={12} />
              <span className='text-xs font-bold tabular-nums'>{countdown}</span>
            </div>
          </div>
        </div>

        {/* VS layout with sand divider */}
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 flex-1 min-w-0'>
            <div
              className='w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0'
              style={{ background: 'rgba(74,222,128,0.12)', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.25)' }}
            >
              {challengerInitial}
            </div>
            <span className='text-sm font-medium truncate'>{displayHandle(battle.challengerXHandle, battle.challenger)}</span>
          </div>

          {/* VS divider */}
          <div className='arena-vs-divider'>
            <div className='arena-vs-line' />
            <span className='arena-vs-text'>VS</span>
            <div className='arena-vs-line' />
          </div>

          <div className='flex items-center gap-2 flex-1 min-w-0 justify-end'>
            <span className='text-sm font-medium truncate'>{displayHandle(battle.opponentXHandle, battle.opponent)}</span>
            <div
              className='w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0'
              style={{ background: 'rgba(255,82,82,0.12)', color: '#FF5252', border: '1px solid rgba(255,82,82,0.25)' }}
            >
              {opponentInitial}
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between mt-3 pt-3' style={{ borderTop: '1px solid rgba(200,150,42,0.1)' }}>
          <span className='text-xs' style={{ color: '#8A8A8A' }}>Victory Treasury</span>
          <div className='flex items-center gap-2'>
            <span className='text-sm font-bold tabular-nums' style={{ color: '#4ADE80' }}>
              {formatUsdcMicro(battle.betAmountMicro * 2)}
            </span>
            <button
              className='text-xs font-bold px-2.5 py-1 rounded-lg transition-all hover:brightness-110'
              style={{ background: 'rgba(200,150,42,0.12)', color: '#E0B341', border: '1px solid rgba(200,150,42,0.28)' }}
              onClick={(e) => { e.stopPropagation(); navigate(`/battles/${battle.id}`); }}
            >
              Watch Live
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Completed Battle Card ────────────────────────────────────────────────────

function CompletedBattleCard({ battle, isAdmin }: { battle: BattlesResponse; isAdmin: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const winnerHandle = battle.winner === battle.challenger
    ? displayHandle(battle.challengerXHandle, battle.challenger)
    : displayHandle(battle.opponentXHandle, battle.opponent);

  const isViewer = user?.address;
  const viewerWon = isViewer && battle.winner === isViewer;
  const viewerLost = isViewer && !viewerWon && (isViewer === battle.challenger || isViewer === battle.opponent);

  const bannerClass = viewerWon
    ? 'arena-victory-banner arena-victory-banner--win'
    : viewerLost
    ? 'arena-victory-banner arena-victory-banner--loss'
    : '';

  return (
    <div
      className='relative rounded-xl cursor-pointer transition-all hover:bg-white/[0.04]'
      style={{ border: viewerWon ? '1px solid rgba(200,150,42,0.35)' : viewerLost ? '1px solid rgba(100,100,110,0.2)' : '1px solid rgba(255,255,255,0.07)' }}
      onClick={() => navigate(`/battles/${battle.id}`)}
    >
      {/* Victory / defeat overlay */}
      {bannerClass && <div className={bannerClass} />}

      <div className='relative z-10 p-4'>
        <div className='flex items-center justify-between mb-2'>
          <div className='flex items-center gap-2'>
            <StatusBadge status={battle.status} />
            {viewerWon && (
              <span className='text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded'
                style={{ background: 'rgba(200,150,42,0.2)', color: '#E0B341' }}>
                Victory
              </span>
            )}
            {viewerLost && (
              <span className='text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded'
                style={{ background: 'rgba(80,80,90,0.3)', color: '#6A6A7A' }}>
                Defeated
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {isAdmin && <AdminDeleteButton battleId={battle.id} />}
            {battle.winner && (
              <div className='flex items-center gap-1.5'>
                <Crown size={12} style={{ color: '#E0B341' }} />
                <span className='text-xs font-bold' style={{ color: '#E0B341' }}>{winnerHandle}</span>
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
  const isActive = battle.status === 'active';

  return (
    <div
      className={`arena-card rounded-xl p-4 cursor-pointer transition-all hover:bg-white/[0.06] relative overflow-hidden ${isActive ? 'rumble-fire-ring' : ''}`}
      onClick={() => navigate(`/rumble/${battle.id}`)}
    >
      {/* Arch watermark for rumble */}
      <div className='arena-watermark'>
        <svg width='100%' height='100%' viewBox='0 0 220 90' preserveAspectRatio='xMidYMid slice'>
          <path d='M10 90 L10 45 Q45 5 80 45 L80 90' stroke='rgba(224,179,65,1)' strokeWidth='2' fill='none' />
          <path d='M140 90 L140 45 Q175 5 210 45 L210 90' stroke='rgba(224,179,65,1)' strokeWidth='2' fill='none' />
        </svg>
      </div>

      <div className='relative z-10'>
        <div className='flex items-center justify-between mb-3'>
          <StatusBadge status={battle.status} rumble />
          <div className='flex items-center gap-2'>
            {isAdmin && <AdminDeleteButton battleId={battle.id} />}
            {isActive && (
              <div className='flex items-center gap-1.5'>
                <span className='relative flex h-2 w-2'>
                  <span className='animate-ping absolute inline-flex h-full w-full rounded-full opacity-75' style={{ background: '#FF5252' }} />
                  <span className='relative inline-flex rounded-full h-2 w-2 bg-red-500' />
                </span>
                <span className='text-xs font-bold' style={{ color: '#FF5252' }}>LIVE</span>
              </div>
            )}
          </div>
        </div>

        <div className='flex items-center gap-3 mb-3'>
          <div
            className='w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0'
            style={{ background: 'rgba(200,150,42,0.15)', border: '1.5px solid rgba(200,150,42,0.35)' }}
          >
            <Crown size={20} style={{ color: '#E0B341' }} />
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
            <div className='text-xs' style={{ color: '#8A8A8A' }}>Victory Treasury</div>
            <div className='text-xl font-black tabular-nums arena-gold-text'>
              {formatUsdcMicro(potMicro)}
            </div>
          </div>
          <div className='text-right'>
            <div className='text-xs' style={{ color: '#8A8A8A' }}>Fighters</div>
            <div className='text-sm font-bold tabular-nums'>
              <Flame size={12} className='inline mr-1' style={{ color: '#C8962A' }} />
              {participantCount}/{maxFighters}
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between pt-3' style={{ borderTop: '1px solid rgba(200,150,42,0.12)' }}>
          <div className='flex items-center gap-1.5' style={{ color: '#8A8A8A' }}>
            {battle.status === 'pending' && (
              <>
                <Users size={12} />
                <span className='text-xs'>Starts at {battle.minParticipants ?? 5}+ fighters</span>
              </>
            )}
            {isActive && (
              <>
                <Clock size={12} style={{ color: '#E0B341' }} />
                <span className='text-xs font-bold tabular-nums' style={{ color: '#E0B341' }}>{countdown}</span>
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
              style={{ background: 'rgba(200,150,42,0.18)', color: '#E0B341', border: '1px solid rgba(200,150,42,0.4)' }}
              onClick={(e) => { e.stopPropagation(); navigate(`/rumble/${battle.id}`); }}
            >
              Join Battle
            </button>
          ) : isActive ? (
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
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptySection({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className='glass-section rounded-xl p-8 text-center' style={{ borderStyle: 'dashed', borderColor: 'rgba(200,150,42,0.12)' }}>
      <Icon size={28} className='mx-auto mb-2' style={{ color: 'rgba(200,150,42,0.2)' }} />
      <p className='text-sm' style={{ color: '#5A5A5A' }}>{message}</p>
    </div>
  );
}

// ─── Arena Lightning Effect ───────────────────────────────────────────────────
// Pure SVG + CSS animation — no canvas, no WebGL → 100% Safari iOS compatible.
// Opacity-only animations avoid compositing issues on iOS Safari.
// prefers-reduced-motion is handled via CSS (.arena-lightning-reduced hides the layer).

const LIGHTNING_BOLTS: Array<{
  points: [number, number][];
  branchPoints?: [number, number][];
  x: number;
  y: number;
  scale: number;
  boltOpacity: number;
  boltIndex: number;
}> = [
  // Bolt 0 — left-side, tall, with branch
  {
    points: [[50,0],[44,12],[58,18],[38,32],[52,40],[34,55],[48,62],[30,78],[50,85],[42,100]],
    branchPoints: [[38,32],[20,48],[8,58]],
    x: 12, y: 0, scale: 0.7, boltOpacity: 0.55, boltIndex: 0,
  },
  // Bolt 1 — right side
  {
    points: [[50,0],[62,10],[40,22],[64,36],[44,50],[66,62],[48,72],[56,88],[50,100]],
    x: 78, y: 0, scale: 0.65, boltOpacity: 0.45, boltIndex: 1,
  },
  // Bolt 2 — center, background, with branch
  {
    points: [[50,0],[56,8],[43,18],[60,30],[45,44],[62,56],[50,68],[58,80],[52,95]],
    branchPoints: [[60,30],[75,42],[82,52]],
    x: 42, y: 0, scale: 0.9, boltOpacity: 0.30, boltIndex: 2,
  },
  // Bolt 3 — upper-left, short
  {
    points: [[50,0],[40,15],[58,25],[36,40],[52,55],[44,72]],
    x: 22, y: 0, scale: 0.5, boltOpacity: 0.40, boltIndex: 3,
  },
  // Bolt 4 — upper-right, thin
  {
    points: [[50,0],[62,12],[42,24],[60,38],[46,52],[58,68]],
    x: 60, y: 0, scale: 0.45, boltOpacity: 0.35, boltIndex: 4,
  },
  // Bolt 5 — wide background, diffuse
  {
    points: [[50,0],[36,14],[64,28],[30,46],[70,58],[40,76],[56,90]],
    x: 30, y: 0, scale: 1.1, boltOpacity: 0.22, boltIndex: 5,
  },
];

function LightningBoltSVG({
  points,
  branchPoints,
  x,
  y,
  scale,
  boltOpacity,
  boltIndex,
}: (typeof LIGHTNING_BOLTS)[number]) {
  const filterId = `arena-lglow-${boltIndex}`;
  const branchLine = branchPoints ? branchPoints.map(([px, py]) => `${px},${py}`).join(' ') : null;
  const mainLine = points.map(([px, py]) => `${px},${py}`).join(' ');

  return (
    <div
      className={`arena-lightning-bolt arena-lightning-bolt-${boltIndex}`}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        width: `${scale * 120}px`,
        height: `${scale * 360}px`,
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        willChange: 'opacity',
      }}
      aria-hidden='true'
    >
      <svg
        viewBox='0 0 100 100'
        preserveAspectRatio='none'
        width='100%'
        height='100%'
        style={{ overflow: 'visible', display: 'block' }}
      >
        <defs>
          <filter id={filterId} x='-80%' y='-20%' width='260%' height='140%' colorInterpolationFilters='sRGB'>
            {/* Outer diffuse purple glow */}
            <feGaussianBlur in='SourceGraphic' stdDeviation='3.5' result='blurOuter' />
            <feColorMatrix
              in='blurOuter' type='matrix'
              values='0.5 0 1.1 0 0  0.2 0 0.4 0 0  1.4 0 1.9 0 0  0 0 0 7 -2'
              result='glowOuter'
            />
            {/* Tight bright core */}
            <feGaussianBlur in='SourceGraphic' stdDeviation='1.0' result='blurCore' />
            <feColorMatrix
              in='blurCore' type='matrix'
              values='0.7 0 0.9 0 0.05  0.3 0 0.5 0 0  1.6 0 2.0 0 0.05  0 0 0 10 -4'
              result='glowCore'
            />
            <feMerge>
              <feMergeNode in='glowOuter' />
              <feMergeNode in='glowCore' />
              <feMergeNode in='SourceGraphic' />
            </feMerge>
          </filter>
        </defs>
        <g filter={`url(#${filterId})`} opacity={boltOpacity}>
          {/* Outer amethyst halo */}
          <polyline points={mainLine} fill='none' stroke='#B09AD9' strokeWidth='2.8'
            strokeLinecap='round' strokeLinejoin='round' opacity='0.45' />
          {/* Bright orchid/white core */}
          <polyline points={mainLine} fill='none' stroke='#ede0ff' strokeWidth='0.9'
            strokeLinecap='round' strokeLinejoin='round' />
          {/* Branch if present */}
          {branchLine && (
            <>
              <polyline points={branchLine} fill='none' stroke='#B09AD9' strokeWidth='1.8'
                strokeLinecap='round' strokeLinejoin='round' opacity='0.35' />
              <polyline points={branchLine} fill='none' stroke='#d4bfff' strokeWidth='0.6'
                strokeLinecap='round' strokeLinejoin='round' opacity='0.7' />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

function LightningBackground({ reduced }: { reduced: boolean }) {
  return (
    <div
      className={`arena-lightning-layer${reduced ? ' arena-lightning-reduced' : ''}`}
      aria-hidden='true'
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
      }}
    >
      {/* Ambient purple sky-glow that pulses with each strike */}
      <div className='arena-lightning-skyflash' />
      {LIGHTNING_BOLTS.map((bolt) => (
        <LightningBoltSVG key={bolt.boltIndex} {...bolt} />
      ))}
    </div>
  );
}

// ─── Colosseum Image Background ──────────────────────────────────────────────

const ARENA_BG_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3c144365ed135dbf0b54e9';

function ArenaArchBackground() {
  const [bgLoaded, setBgLoaded] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // Scroll progress drives a subtle vertical drift on the background image.
  // The outer div is fixed; we translate the inner contents so the image
  // appears to move slightly slower than the page — classic parallax depth.
  const { scrollYProgress } = useScroll();
  // Maps 0→1 scroll progress to 0→-45px translateY (image drifts upward slowly).
  // Range is intentionally small to add depth without distraction.
  const bgY = useTransform(scrollYProgress, [0, 1], ['0px', '-45px']);

  return (
    <div
      className='pointer-events-none fixed inset-0 z-0 overflow-hidden'
      aria-hidden='true'
    >
      {/* Parallax wrapper — GPU-composited transform only. Disabled for reduced-motion. */}
      <motion.div
        style={{
          position: 'absolute',
          inset: '-50px -0px',   // extra bleed so drift never shows a gap at edges
          y: prefersReducedMotion ? 0 : bgY,
          willChange: 'transform',
        }}
      >
        {/* Stone wall photograph — portrait, anchored top-center, covers full viewport.
            Fully opaque so it blocks the app's purple mesh background entirely. */}
        <img
          src={ARENA_BG_URL}
          alt=''
          fetchPriority='high'
          decoding='async'
          onLoad={() => setBgLoaded(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top center',
            opacity: bgLoaded ? 1 : 0,
            transition: 'opacity 0.35s ease',
          }}
          draggable={false}
        />
      </motion.div>

      {/* Scrim — enough contrast for card text over the bright archway light */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Mobile-only extra darkening overlay (~40% deeper) */}
      <div className='arena-mobile-dark-overlay' aria-hidden='true' />

      {/* Storm shadow — drifting dark cloud blobs; above the mobile dark overlay
          so clouds are visible on both mobile and desktop. Mobile opacity halved
          via CSS to avoid double-darkening on already-dimmed mobile bg. */}
      <div className='arena-storm-shadows' aria-hidden='true'>
        <div className='arena-storm-cloud' />
        <div className='arena-storm-cloud' />
        <div className='arena-storm-cloud' />
        <div className='arena-storm-cloud' />
      </div>

      {/* Lightning — atmospheric purple bolts, above storm shadows, below glitch overlay.
          Pure SVG/CSS — no canvas, safe on iOS Safari. Reduced-motion suppressed via CSS. */}
      <LightningBackground reduced={!!prefersReducedMotion} />

      {/* Glitch effect overlay — both mobile and desktop */}
      <div className='arena-glitch-overlay' aria-hidden='true' />

      {/* Scanline sweep — third glitch layer, slow periodic pass */}
      <div className='arena-scanline-overlay' aria-hidden='true' />
    </div>
  );
}

const ARENA_BANNER_URL =
  'https://tarobase-app-storage-public-v2-prod.s3.amazonaws.com/tarobase-app-storage-6a0c94282a336f1644283829/6a3c14497f45fccc2a855d9b';

function ArenaBannerImage({ desktopLarge = false }: { desktopLarge?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingBottom: '0.5rem' }}>
      <img
        src={ARENA_BANNER_URL}
        alt='The Arena'
        fetchPriority='high'
        decoding='async'
        onLoad={() => setLoaded(true)}
        style={{
          /* Mobile: 85vw wide, capped at 420px. Desktop large hero: up to 760px. Desktop normal: up to 560px. */
          width: desktopLarge ? 'min(70vw, 760px)' : 'min(85vw, 420px)',
          height: 'auto',
          display: 'block',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.35s ease',
          /* No border-radius — transparent PNG wordmark, no box needed */
        }}
        className={desktopLarge ? '' : 'md:!w-[min(65vw,560px)]'}
        draggable={false}
      />
    </div>
  );
}

// ─── My Battles Section ───────────────────────────────────────────────────────

function MyBattlesSection({
  battles,
  participants,
  userAddress,
  isAdmin,
  getRumbleParticipantCount,
  getRumblePotMicro,
}: {
  battles: BattlesResponse[];
  participants: BattleParticipantsResponse[];
  userAddress: string;
  isAdmin: boolean;
  getRumbleParticipantCount: (id: string) => number;
  getRumblePotMicro: (id: string, betAmountMicro: number) => number;
}) {
  const navigate = useNavigate();

  // User's 1v1 battles: challenger or opponent
  const my1v1 = useMemo(
    () => battles.filter(
      (b) => b.type !== 'royalrumble' &&
        (b.challenger === userAddress || b.opponent === userAddress)
    ),
    [battles, userAddress],
  );

  // User's Rumble battles: has a participant record with user's wallet
  const myRumbleIds = useMemo(
    () => new Set(
      participants
        .filter((p) => p.wallet === userAddress)
        .map((p) => p.battleId)
    ),
    [participants, userAddress],
  );

  const myRumbles = useMemo(
    () => battles.filter((b) => b.type === 'royalrumble' && myRumbleIds.has(b.id)),
    [battles, myRumbleIds],
  );

  const myAllBattles = useMemo(
    () => [...my1v1, ...myRumbles].sort((a, b) => b.createdAt - a.createdAt),
    [my1v1, myRumbles],
  );

  // Win/loss/ongoing/upcoming from completed 1v1s
  const completed1v1 = my1v1.filter(
    (b) => b.status === 'ended' || b.status === 'claimed',
  );
  const wins1v1 = completed1v1.filter((b) => b.winner === userAddress).length;
  const losses1v1 = completed1v1.filter(
    (b) => b.winner && b.winner !== userAddress,
  ).length;

  // Rumble wins: top 3 positions are stored in the collection's winner field
  // (backend sets winner to the #1 address). Count as a win if user was the winner.
  const completedRumbles = myRumbles.filter(
    (b) => b.status === 'ended' || b.status === 'claimed',
  );
  const winsRumble = completedRumbles.filter(
    (b) => b.winner === userAddress,
  ).length;

  const totalWins = wins1v1 + winsRumble;
  const totalLosses = losses1v1;
  const totalFinished = completed1v1.length + completedRumbles.length;
  const winRate = totalFinished > 0
    ? Math.round((totalWins / totalFinished) * 100)
    : null;

  // Active battles (currently running)
  const activeMyBattles = myAllBattles.filter((b) => b.status === 'active');
  // Upcoming = pending battles I created OR accepted into
  const upcomingMyBattles = myAllBattles.filter(
    (b) => b.status === 'pending',
  );
  // Past = ended/claimed/cancelled
  const pastMyBattles = myAllBattles
    .filter((b) => b.status === 'ended' || b.status === 'claimed' || b.status === 'cancelled')
    .slice(0, 15);

  if (myAllBattles.length === 0) {
    return (
      <div className='space-y-5'>
        {/* Stats row — all zeros, still show so layout is clear */}
        <div className='grid grid-cols-3 gap-3'>
          {[
            { label: 'Wins', value: '0', icon: Trophy, color: '#E0B341' },
            { label: 'Losses', value: '0', icon: Activity, color: '#FF5252' },
            { label: 'Win Rate', value: '—', icon: TrendingUp, color: '#4ADE80' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className='arena-card rounded-xl px-4 py-4 text-center'
            >
              <Icon size={16} className='mx-auto mb-1.5' style={{ color }} />
              <div className='text-xl font-black tabular-nums' style={{ color }}>{value}</div>
              <div className='text-xs font-medium mt-0.5' style={{ color: '#6A6A6A' }}>{label}</div>
            </div>
          ))}
        </div>
        <div
          className='rounded-xl p-8 text-center'
          style={{ border: '1px dashed rgba(200,150,42,0.15)', background: 'rgba(200,150,42,0.03)' }}
        >
          <Swords size={28} className='mx-auto mb-2' style={{ color: 'rgba(200,150,42,0.2)' }} />
          <p className='text-sm' style={{ color: '#5A5A5A' }}>You have not entered any battles yet.</p>
          <button
            className='mt-4 text-xs font-bold px-4 py-2 rounded-lg transition-all hover:brightness-110'
            style={{ background: 'rgba(200,150,42,0.12)', color: '#E0B341', border: '1px solid rgba(200,150,42,0.28)' }}
            onClick={() => navigate('/battles/new')}
          >
            Issue a Challenge
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-5'>
      {/* Stats row */}
      <div className='grid grid-cols-3 gap-3'>
        {[
          { label: 'Wins', value: String(totalWins), icon: Trophy, color: '#E0B341' },
          { label: 'Losses', value: String(totalLosses), icon: Activity, color: '#FF5252' },
          {
            label: 'Win Rate',
            value: winRate !== null ? `${winRate}%` : '—',
            icon: TrendingUp,
            color: winRate !== null && winRate >= 50 ? '#4ADE80' : '#FF5252',
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className='arena-card rounded-xl px-4 py-4 text-center'
          >
            <Icon size={16} className='mx-auto mb-1.5' style={{ color }} />
            <div className='text-xl font-black tabular-nums' style={{ color }}>{value}</div>
            <div className='text-xs font-medium mt-0.5' style={{ color: '#6A6A6A' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Active battles */}
      {activeMyBattles.length > 0 && (
        <section>
          <ArenaSectionHeader icon={Flame} label='Active' count={activeMyBattles.length} iconColor='#4ADE80' />
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
            {activeMyBattles.map((b) =>
              b.type === 'royalrumble'
                ? <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={true} isAdmin={isAdmin} />
                : <ActiveBattleCard key={b.id} battle={b} isAdmin={isAdmin} />
            )}
          </div>
        </section>
      )}

      {/* Upcoming battles */}
      {upcomingMyBattles.length > 0 && (
        <section>
          <ArenaSectionHeader icon={Clock} label='Upcoming' count={upcomingMyBattles.length} />
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
            {upcomingMyBattles.map((b) =>
              b.type === 'royalrumble'
                ? <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={myRumbleIds.has(b.id)} isAdmin={isAdmin} />
                : <OpenChallengeCard key={b.id} battle={b} isAdmin={isAdmin} />
            )}
          </div>
        </section>
      )}

      {/* Past battles */}
      {pastMyBattles.length > 0 && (
        <section>
          <ArenaSectionHeader icon={Shield} label='History' />
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
            {pastMyBattles.map((b) =>
              b.type === 'royalrumble'
                ? <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={myRumbleIds.has(b.id)} isAdmin={isAdmin} />
                : <CompletedBattleCard key={b.id} battle={b} isAdmin={isAdmin} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Desktop Battles Tab Content (extracted so desktop sub-tab row stays visible across all tabs) ──

function DesktopBattlesTabContent({
  tab,
  openChallenges,
  activeH2h,
  completedH2h,
  pendingRumbles,
  activeRumbles,
  completedRumbles,
  isAdmin,
  getRumbleParticipantCount,
  getRumblePotMicro,
  isJoinedRumble,
  howOpen,
  setHowOpen,
  howRumbleOpen,
  setHowRumbleOpen,
}: {
  tab: '1v1' | 'rumble';
  openChallenges: BattlesResponse[];
  activeH2h: BattlesResponse[];
  completedH2h: BattlesResponse[];
  pendingRumbles: BattlesResponse[];
  activeRumbles: BattlesResponse[];
  completedRumbles: BattlesResponse[];
  isAdmin: boolean;
  getRumbleParticipantCount: (id: string) => number;
  getRumblePotMicro: (id: string, betAmountMicro: number) => number;
  isJoinedRumble: (id: string) => boolean;
  howOpen: boolean;
  setHowOpen: React.Dispatch<React.SetStateAction<boolean>>;
  howRumbleOpen: boolean;
  setHowRumbleOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <div className='space-y-5'>
      {/* 1v1 content */}
      {tab === '1v1' && (
        <div className='space-y-5'>
          <div className='arena-card rounded-xl overflow-hidden'>
            <button className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]' onClick={() => setHowOpen((v) => !v)}>
              <div className='flex items-center gap-2'>
                <HelpCircle size={15} style={{ color: '#C8962A' }} />
                <span className='text-sm font-bold' style={{ color: '#C8962A' }}>How Battles Work</span>
              </div>
              <ChevronDown size={15} style={{ color: '#C8962A', transition: 'transform 0.2s', transform: howOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>
            {howOpen && (
              <ol className='space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-2.5 lg:space-y-0 px-4 pb-4'>
                {[
                  { step: '1', title: 'Issue a Challenge', desc: 'Set a USDC wager and a battle duration. Target a specific @handle or leave it open for anyone to accept.' },
                  { step: '2', title: 'Opponent Accepts', desc: 'The challenged trader matches the exact bet amount in USDC to lock in the battle.' },
                  { step: '3', title: 'Trade to Win', desc: "Both traders open positions on Phoenix Perps. The battle tracks each side's unrealized PnL %." },
                  { step: '4', title: 'Highest PnL% Wins', desc: 'When the timer expires, the trader with the greater gain wins the full pot.' },
                  { step: '5', title: 'Claim Your Winnings', desc: 'The winner visits the battle detail page and claims their USDC payout.' },
                ].map(({ step, title, desc }) => (
                  <li key={step} className='flex gap-3'>
                    <div className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black' style={{ background: 'rgba(200,150,42,0.15)', color: '#C8962A', marginTop: '1px' }}>{step}</div>
                    <div>
                      <div className='text-sm font-semibold leading-snug'>{title}</div>
                      <div className='text-xs mt-0.5 leading-relaxed' style={{ color: '#8A8A8A' }}>{desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <section>
            <ArenaSectionHeader icon={Swords} label='Challengers Await' count={openChallenges.length} />
            {openChallenges.length === 0 ? <EmptySection icon={Swords} message='No open challenges right now' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {openChallenges.map((b) => <OpenChallengeCard key={b.id} battle={b} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Clock} label='Combat in Progress' count={activeH2h.length} iconColor='#4ADE80' />
            {activeH2h.length === 0 ? <EmptySection icon={Users} message='No active matches in the Arena' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {activeH2h.map((b) => <ActiveBattleCard key={b.id} battle={b} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Shield} label='The Fallen' />
            {completedH2h.length === 0 ? <EmptySection icon={Swords} message='No completed Arena matches yet' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {completedH2h.map((b) => <CompletedBattleCard key={b.id} battle={b} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Rumble content */}
      {tab === 'rumble' && (
        <div className='space-y-5'>
          <div className='arena-card rounded-xl overflow-hidden' style={{ borderColor: 'rgba(200,150,42,0.2)' }}>
            <button className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]' onClick={() => setHowRumbleOpen((v) => !v)}>
              <div className='flex items-center gap-2'>
                <Crown size={15} style={{ color: '#E0B341' }} />
                <span className='text-sm font-bold' style={{ color: '#E0B341' }}>How Royal Rumble Works</span>
              </div>
              <ChevronDown size={15} style={{ color: '#E0B341', transition: 'transform 0.2s', transform: howRumbleOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>
            {howRumbleOpen && (
              <ol className='space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-2.5 lg:space-y-0 px-4 pb-4'>
                {[
                  { step: '1', title: 'Join the Rumble', desc: 'Pay the entry fee to lock your seat. Everyone trades on Phoenix Perps simultaneously.' },
                  { step: '2', title: 'Battle Begins', desc: 'Once the minimum fighter count is reached, the timer starts. Trade to build the highest PnL%.' },
                  { step: '3', title: 'Top 3 Win', desc: 'When time expires, the top 3 traders by PnL% split the entire prize pot: 49.5% / 34.65% / 14.85%.' },
                  { step: '4', title: 'Boost the Pot', desc: 'Spectators can add USDC to the prize pool to make the rumble even more exciting.' },
                ].map(({ step, title, desc }) => (
                  <li key={step} className='flex gap-3'>
                    <div className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black' style={{ background: 'rgba(200,150,42,0.18)', color: '#E0B341', marginTop: '1px' }}>{step}</div>
                    <div>
                      <div className='text-sm font-semibold leading-snug'>{title}</div>
                      <div className='text-xs mt-0.5 leading-relaxed' style={{ color: '#8A8A8A' }}>{desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <section>
            <ArenaSectionHeader icon={Flame} label='Active Rumbles' count={activeRumbles.length} iconColor='#FF5252' />
            {activeRumbles.length === 0 ? <EmptySection icon={Flame} message='No active royal rumbles' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {activeRumbles.map((b) => <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={isJoinedRumble(b.id)} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Users} label='Pending Rumbles' count={pendingRumbles.length} />
            {pendingRumbles.length === 0 ? <EmptySection icon={Users} message='No pending rumbles right now' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {pendingRumbles.map((b) => <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={isJoinedRumble(b.id)} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Shield} label='The Fallen' />
            {completedRumbles.length === 0 ? <EmptySection icon={Crown} message='No completed rumbles yet' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {completedRumbles.map((b) => <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={isJoinedRumble(b.id)} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ─── Desktop Battles Section (desktop-only, last section, scroll-fade) ────────

function DesktopBattlesSection({
  desktopBattlesOpen,
  tab,
  mainTab,
  setTab,
  setMainTab,
  user,
  navigate,
  openChallenges,
  activeH2h,
  completedH2h,
  pendingRumbles,
  activeRumbles,
  completedRumbles,
  isAdmin,
  getRumbleParticipantCount,
  getRumblePotMicro,
  isJoinedRumble,
  howOpen,
  setHowOpen,
  howRumbleOpen,
  setHowRumbleOpen,
  battles,
  participants,
  battlesSectionRef,
}: {
  desktopBattlesOpen: boolean;
  tab: '1v1' | 'rumble';
  mainTab: 'battles' | 'my';
  setTab: React.Dispatch<React.SetStateAction<'1v1' | 'rumble'>>;
  setMainTab: React.Dispatch<React.SetStateAction<'battles' | 'my'>>;
  user: { address: string } | null | undefined;
  navigate: NavigateFunction;
  openChallenges: BattlesResponse[];
  activeH2h: BattlesResponse[];
  completedH2h: BattlesResponse[];
  pendingRumbles: BattlesResponse[];
  activeRumbles: BattlesResponse[];
  completedRumbles: BattlesResponse[];
  isAdmin: boolean;
  getRumbleParticipantCount: (id: string) => number;
  getRumblePotMicro: (id: string, betAmountMicro: number) => number;
  isJoinedRumble: (id: string) => boolean;
  howOpen: boolean;
  setHowOpen: React.Dispatch<React.SetStateAction<boolean>>;
  howRumbleOpen: boolean;
  setHowRumbleOpen: React.Dispatch<React.SetStateAction<boolean>>;
  battles: BattlesResponse[];
  participants: BattleParticipantsResponse[];
  battlesSectionRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (!desktopBattlesOpen) return null;

  return (
    <div className='hidden md:block max-w-7xl mx-auto px-4 lg:px-6 mt-10 pb-10'>
      <div className='space-y-5'>
        {/* Section header divider */}
        <div className='flex items-center gap-3 mb-2'>
          <Swords size={16} style={{ color: '#C8962A' }} />
          <h2 className='text-base font-black uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
            Trading Battles
          </h2>
          <div className='flex-1 h-px' style={{ background: 'rgba(200,150,42,0.15)' }} />
        </div>

        {/* Sub-tab row: 1v1 | Royal Rumble | My Battles | Issue a Challenge (right) */}
        <div className='flex items-center gap-2'>
          <button
            onClick={() => { setTab('1v1'); setMainTab('battles'); }}
            className='px-4 py-2.5 rounded-xl text-sm font-semibold transition-all'
            style={{
              background: mainTab === 'battles' && tab === '1v1' ? 'rgba(200,150,42,0.14)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${mainTab === 'battles' && tab === '1v1' ? 'rgba(200,150,42,0.50)' : 'rgba(200,150,42,0.12)'}`,
              color: mainTab === 'battles' && tab === '1v1' ? '#E0B341' : '#6A6A6A',
            }}
          >
            <Swords size={14} className='inline mr-1.5' />
            1v1 Battles
          </button>
          <button
            onClick={() => { setTab('rumble'); setMainTab('battles'); }}
            className='px-4 py-2.5 rounded-xl text-sm font-semibold transition-all'
            style={{
              background: mainTab === 'battles' && tab === 'rumble' ? 'rgba(200,150,42,0.14)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${mainTab === 'battles' && tab === 'rumble' ? 'rgba(200,150,42,0.50)' : 'rgba(200,150,42,0.12)'}`,
              color: mainTab === 'battles' && tab === 'rumble' ? '#E0B341' : '#6A6A6A',
            }}
          >
            <Crown size={14} className='inline mr-1.5' />
            Royal Rumble
          </button>
          {user && (
            <button
              onClick={() => setMainTab('my')}
              className='flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all'
              style={{
                background: mainTab === 'my' ? 'rgba(200,150,42,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${mainTab === 'my' ? 'rgba(200,150,42,0.50)' : 'rgba(200,150,42,0.12)'}`,
                color: mainTab === 'my' ? '#E0B341' : '#6A6A6A',
              }}
            >
              <Shield size={14} />
              My Battles
            </button>
          )}
          {/* Issue a Challenge — right-aligned */}
          <button
            onClick={() => navigate('/battles/new')}
            className='ml-auto flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-110'
            style={{ background: 'rgba(200,150,42,0.13)', color: '#E0B341', border: '1px solid rgba(200,150,42,0.28)' }}
          >
            <Plus size={15} />
            Issue a Challenge
          </button>
        </div>

        {/* Tab content */}
        {mainTab === 'battles' && (
          <DesktopBattlesTabContent
            tab={tab}
            openChallenges={openChallenges}
            activeH2h={activeH2h}
            completedH2h={completedH2h}
            pendingRumbles={pendingRumbles}
            activeRumbles={activeRumbles}
            completedRumbles={completedRumbles}
            isAdmin={isAdmin}
            getRumbleParticipantCount={getRumbleParticipantCount}
            getRumblePotMicro={getRumblePotMicro}
            isJoinedRumble={isJoinedRumble}
            howOpen={howOpen}
            setHowOpen={setHowOpen}
            howRumbleOpen={howRumbleOpen}
            setHowRumbleOpen={setHowRumbleOpen}
          />
        )}
        {mainTab === 'my' && user && (
          <MyBattlesSection
            battles={battles}
            participants={participants}
            userAddress={user.address}
            isAdmin={isAdmin}
            getRumbleParticipantCount={getRumbleParticipantCount}
            getRumblePotMicro={getRumblePotMicro}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BattlesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.address === ADMIN_ADDRESS;
  const [battlesOpen, setBattlesOpen] = useState(false);
  const [desktopBattlesOpen, setDesktopBattlesOpen] = useState(false);
  const [scrolledPast, setScrolledPast] = useState(false);
  const battlesSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = document.getElementById('app-main') ?? window;
    function onScroll() {
      const y = scroller === window
        ? window.scrollY
        : (scroller as HTMLElement).scrollTop;
      setScrolledPast(y > 80);
    }
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const [tab, setTab] = useState<'1v1' | 'rumble'>('1v1');
  const [mainTab, setMainTab] = useState<'battles' | 'my'>('battles');
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

  const openChallenges = h2hBattles.filter((b) => b.status === 'pending' && !b.opponent);
  const activeH2h = h2hBattles.filter((b) => b.status === 'active');
  const completedH2h = h2hBattles
    .filter((b) => b.status === 'ended' || b.status === 'claimed')
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, 20);

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

  function scrollToBattles() {
    battlesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Mobile battles content (mobile only) ─────────────────────────────────
  const BattlesContent = (
    <div className='space-y-5'>
      {/* Sub-tab row + Issue Challenge */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex gap-2'>
          <button
            onClick={() => setTab('1v1')}
            className='px-4 py-2.5 rounded-xl text-sm font-semibold transition-all'
            style={{
              background: tab === '1v1' ? 'rgba(200,150,42,0.14)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${tab === '1v1' ? 'rgba(200,150,42,0.50)' : 'rgba(200,150,42,0.12)'}`,
              color: tab === '1v1' ? '#E0B341' : '#6A6A6A',
            }}
          >
            <Swords size={14} className='inline mr-1.5' />
            1v1 Battles
          </button>
          <button
            onClick={() => setTab('rumble')}
            className='px-4 py-2.5 rounded-xl text-sm font-semibold transition-all'
            style={{
              background: tab === 'rumble' ? 'rgba(200,150,42,0.14)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${tab === 'rumble' ? 'rgba(200,150,42,0.50)' : 'rgba(200,150,42,0.12)'}`,
              color: tab === 'rumble' ? '#E0B341' : '#6A6A6A',
            }}
          >
            <Crown size={14} className='inline mr-1.5' />
            Royal Rumble
          </button>
        </div>
        {/* Issue a Challenge — mobile only */}
        <button
          onClick={() => navigate('/battles/new')}
          className='flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-110'
          style={{ background: 'rgba(200,150,42,0.15)', color: '#E0B341', border: '1px solid rgba(200,150,42,0.3)' }}
        >
          <Plus size={16} />
          Issue a Challenge
        </button>
      </div>

      {/* 1v1 content */}
      {tab === '1v1' && (
        <div className='space-y-5'>
          <div className='arena-card rounded-xl overflow-hidden'>
            <button className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]' onClick={() => setHowOpen((v) => !v)}>
              <div className='flex items-center gap-2'>
                <HelpCircle size={15} style={{ color: '#C8962A' }} />
                <span className='text-sm font-bold' style={{ color: '#C8962A' }}>How Battles Work</span>
              </div>
              <ChevronDown size={15} style={{ color: '#C8962A', transition: 'transform 0.2s', transform: howOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>
            {howOpen && (
              <ol className='space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-2.5 lg:space-y-0 px-4 pb-4'>
                {[
                  { step: '1', title: 'Issue a Challenge', desc: 'Set a USDC wager and a battle duration. Target a specific @handle or leave it open for anyone to accept.' },
                  { step: '2', title: 'Opponent Accepts', desc: 'The challenged trader matches the exact bet amount in USDC to lock in the battle.' },
                  { step: '3', title: 'Trade to Win', desc: "Both traders open positions on Phoenix Perps. The battle tracks each side's unrealized PnL %." },
                  { step: '4', title: 'Highest PnL% Wins', desc: 'When the timer expires, the trader with the greater gain wins the full pot.' },
                  { step: '5', title: 'Claim Your Winnings', desc: 'The winner visits the battle detail page and claims their USDC payout.' },
                ].map(({ step, title, desc }) => (
                  <li key={step} className='flex gap-3'>
                    <div className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black' style={{ background: 'rgba(200,150,42,0.15)', color: '#C8962A', marginTop: '1px' }}>{step}</div>
                    <div>
                      <div className='text-sm font-semibold leading-snug'>{title}</div>
                      <div className='text-xs mt-0.5 leading-relaxed' style={{ color: '#8A8A8A' }}>{desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <section>
            <ArenaSectionHeader icon={Swords} label='Challengers Await' count={openChallenges.length} />
            {openChallenges.length === 0 ? <EmptySection icon={Swords} message='No open challenges right now' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {openChallenges.map((b) => <OpenChallengeCard key={b.id} battle={b} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Clock} label='Combat in Progress' count={activeH2h.length} iconColor='#4ADE80' />
            {activeH2h.length === 0 ? <EmptySection icon={Users} message='No active matches in the Arena' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {activeH2h.map((b) => <ActiveBattleCard key={b.id} battle={b} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Shield} label='The Fallen' />
            {completedH2h.length === 0 ? <EmptySection icon={Swords} message='No completed Arena matches yet' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {completedH2h.map((b) => <CompletedBattleCard key={b.id} battle={b} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Rumble content */}
      {tab === 'rumble' && (
        <div className='space-y-5'>
          <div className='arena-card rounded-xl overflow-hidden' style={{ borderColor: 'rgba(200,150,42,0.2)' }}>
            <button className='w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]' onClick={() => setHowRumbleOpen((v) => !v)}>
              <div className='flex items-center gap-2'>
                <Crown size={15} style={{ color: '#E0B341' }} />
                <span className='text-sm font-bold' style={{ color: '#E0B341' }}>How Royal Rumble Works</span>
              </div>
              <ChevronDown size={15} style={{ color: '#E0B341', transition: 'transform 0.2s', transform: howRumbleOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>
            {howRumbleOpen && (
              <ol className='space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-2.5 lg:space-y-0 px-4 pb-4'>
                {[
                  { step: '1', title: 'Join the Rumble', desc: 'Pay the entry fee to lock your seat. Everyone trades on Phoenix Perps simultaneously.' },
                  { step: '2', title: 'Battle Begins', desc: 'Once the minimum fighter count is reached, the timer starts. Trade to build the highest PnL%.' },
                  { step: '3', title: 'Top 3 Win', desc: 'When time expires, the top 3 traders by PnL% split the entire prize pot: 49.5% / 34.65% / 14.85%.' },
                  { step: '4', title: 'Boost the Pot', desc: 'Spectators can add USDC to the prize pool to make the rumble even more exciting.' },
                ].map(({ step, title, desc }) => (
                  <li key={step} className='flex gap-3'>
                    <div className='flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black' style={{ background: 'rgba(200,150,42,0.18)', color: '#E0B341', marginTop: '1px' }}>{step}</div>
                    <div>
                      <div className='text-sm font-semibold leading-snug'>{title}</div>
                      <div className='text-xs mt-0.5 leading-relaxed' style={{ color: '#8A8A8A' }}>{desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <section>
            <ArenaSectionHeader icon={Flame} label='Active Rumbles' count={activeRumbles.length} iconColor='#FF5252' />
            {activeRumbles.length === 0 ? <EmptySection icon={Flame} message='No active royal rumbles' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {activeRumbles.map((b) => <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={isJoinedRumble(b.id)} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Users} label='Pending Rumbles' count={pendingRumbles.length} />
            {pendingRumbles.length === 0 ? <EmptySection icon={Users} message='No pending rumbles right now' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {pendingRumbles.map((b) => <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={isJoinedRumble(b.id)} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
          <section>
            <ArenaSectionHeader icon={Shield} label='The Fallen' />
            {completedRumbles.length === 0 ? <EmptySection icon={Crown} message='No completed rumbles yet' /> : (
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-3'>
                {completedRumbles.map((b) => <RoyalRumbleCard key={b.id} battle={b} participantCount={getRumbleParticipantCount(b.id)} potMicro={getRumblePotMicro(b.id, b.betAmountMicro)} isJoined={isJoinedRumble(b.id)} isAdmin={isAdmin} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );

  return (
    <div className='min-h-screen text-white relative' style={{ paddingBottom: 120 }}>
      <ArenaArchBackground />
      {/* Desktop-only: additional black gradient over the photo background */}
      <div className='arena-desktop-scrim hidden md:block' aria-hidden='true' />
      <AppHeader />

      {/* ── Unified page content — full-width single column ── */}
      <div className='relative z-10'>

        {/* ── DESKTOP above-fold hero section ───────────────────────────────────
            Fills exactly one viewport height minus the sticky header (~60px).
            Contains: banner (bigger) + Victory Treasury + Top-3 Podium.
            Everything below starts off-screen and requires scrolling.
        ── */}
        <div className='hidden md:flex flex-col items-center justify-center max-w-7xl mx-auto px-6 gap-6'
          style={{ minHeight: 'calc(100vh - 60px)', paddingTop: '4rem', paddingBottom: '3rem' }}
        >
          {/* Banner — bigger on desktop */}
          <motion.div
            className='flex justify-center w-full'
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          >
            <ArenaBannerImage desktopLarge />
          </motion.div>

          {/* Victory Treasury — bigger desktop display; board auto-scales to fit (no clipping) */}
          <motion.div
            className='w-full max-w-4xl mx-auto'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.28 }}
          >
            <MonthlyPrizePotCard desktopHero />
          </motion.div>

          {/* Scroll indicator — desktop only, fades out once scrolled */}
          <div
            className='flex flex-col items-center gap-1.5 mt-3'
            style={{
              opacity: scrolledPast ? 0 : 1,
              transition: 'opacity 0.4s ease',
              pointerEvents: 'none',
            }}
            aria-hidden='true'
          >
            <span
              className='text-xs font-semibold uppercase tracking-widest'
              style={{ color: 'rgba(200,150,42,0.55)', letterSpacing: '0.18em' }}
            >
              Scroll to see GOAT traders
            </span>
            {/* Spear-tip chevron stack */}
            <div className='arena-scroll-indicator flex flex-col items-center gap-0'>
              <svg width='22' height='14' viewBox='0 0 22 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M1 1L11 12L21 1' stroke='#C8962A' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
              <svg width='16' height='10' viewBox='0 0 16 10' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M1 1L8 9L15 1' stroke='rgba(200,150,42,0.45)' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
            </div>
          </div>
        </div>

        {/* ── MOBILE: Banner + Victory Treasury — fills viewport on entry ── */}
        <div
          className='md:hidden flex flex-col items-center justify-center px-4 gap-4'
          style={{ minHeight: 'calc(100vh - 60px - 80px)', paddingTop: '3rem', paddingBottom: '2rem' }}
        >
          <motion.div
            className='w-full max-w-7xl'
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
          >
            <ArenaBannerImage />
          </motion.div>
          <motion.div
            className='w-full max-w-7xl overflow-hidden'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          >
            <MonthlyPrizePotCard />
          </motion.div>

          {/* Scroll indicator — mobile, same chevron bob as desktop, fades out once scrolled */}
          <div
            className='flex flex-col items-center gap-1.5 mt-2'
            style={{
              opacity: scrolledPast ? 0 : 1,
              transition: 'opacity 0.4s ease',
              pointerEvents: 'none',
            }}
            aria-hidden='true'
          >
            <span
              className='text-xs font-semibold uppercase tracking-widest'
              style={{ color: 'rgba(200,150,42,0.55)', letterSpacing: '0.18em' }}
            >
              Scroll to see GOAT traders
            </span>
            <div className='arena-scroll-indicator flex flex-col items-center gap-0'>
              <svg width='22' height='14' viewBox='0 0 22 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M1 1L11 12L21 1' stroke='#C8962A' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
              <svg width='16' height='10' viewBox='0 0 16 10' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M1 1L8 9L15 1' stroke='rgba(200,150,42,0.45)' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
            </div>
          </div>
        </div>

        {/* ── MOBILE: Battles toggle button moved inline with PnL Leaderboard title (see below) ── */}

        {/* ── DESKTOP: Floating "Battles" button — fixed right, Duolingo 3D style ── */}
        <button
          className='arena-battles-fab hidden md:flex items-center gap-3.5 rounded-xl font-black'
          style={{
            position: 'fixed',
            top: '120px',
            right: '1.5rem',
            zIndex: 40,
            padding: '14px 22px',
            fontSize: '1rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            background: desktopBattlesOpen ? '#9b84e8' : '#B09AD9',
            color: '#120427',
            cursor: 'pointer',
            border: 'none',
            boxShadow: '0 5px 0 #401368',
            transform: 'translateY(0)',
            transition: 'transform 0.08s ease, box-shadow 0.08s ease',
          }}
          onMouseDown={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.transform = 'translateY(5px)';
            btn.style.boxShadow = '0 0 0 #401368';
          }}
          onMouseUp={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 5px 0 #401368';
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 5px 0 #401368';
          }}
          onClick={() => {
            if (!desktopBattlesOpen) {
              setDesktopBattlesOpen(true);
              setMainTab('battles');
              // Wait a tick for the section to mount before scrolling
              setTimeout(() => scrollToBattles(), 80);
            } else {
              scrollToBattles();
            }
          }}
        >
          <Swords size={20} />
          <span>Battles</span>
          <ChevronDown
            size={18}
            style={{
              transition: 'transform 0.22s ease',
              transform: desktopBattlesOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>

        {/* ── DESKTOP Section 1: PnL Leaderboard — full width, single column ── */}
        <RevealSection className='hidden md:block max-w-7xl mx-auto px-4 lg:px-6 mt-8'>
          <MonthlyRewardClaim />
          <div className='mt-6 min-w-0 overflow-hidden'>
            <div className='flex items-center gap-2 mb-5'>
              <Crown size={16} style={{ color: '#C8962A' }} />
              <h2 className='text-base font-black uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                PnL Leaderboard
              </h2>
            </div>
            <div className='min-w-0' style={{ minHeight: '520px' }}>
              <PnlLeaderboard desktopLarge />
            </div>
          </div>
        </RevealSection>

        {/* ── MOBILE: PnL Leaderboard (same section, with Battles toggle inline) ── */}
        <div className='md:hidden max-w-7xl mx-auto px-4 mt-8'>
          <MonthlyRewardClaim />
          <div className='mt-6 min-w-0 overflow-hidden'>
            <div className='flex items-center justify-between gap-2 mb-5'>
              {/* Title — left side */}
              <div className='flex items-center gap-2'>
                <Crown size={16} style={{ color: '#C8962A' }} />
                <h2 className='text-base font-black uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
                  PnL Leaderboard
                </h2>
              </div>
              {/* Battles toggle — mobile only, right side */}
              <button
                onClick={() => setBattlesOpen((v) => !v)}
                className='flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 flex-shrink-0'
                style={{
                  background: battlesOpen ? 'rgba(200,150,42,0.18)' : 'rgba(200,150,42,0.08)',
                  border: `1.5px solid ${battlesOpen ? 'rgba(200,150,42,0.55)' : 'rgba(200,150,42,0.22)'}`,
                  color: battlesOpen ? '#E0B341' : '#A07830',
                  minHeight: '36px',
                }}
              >
                <Swords size={14} />
                Battles
                <ChevronDown
                  size={13}
                  style={{
                    transition: 'transform 0.22s ease',
                    transform: battlesOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    color: battlesOpen ? '#E0B341' : '#A07830',
                  }}
                />
              </button>
            </div>
            {/* Mobile: Battles expandable section — appears below title row when toggled */}
            {battlesOpen && (
              <motion.div
                className='mb-6'
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                {BattlesContent}
              </motion.div>
            )}
            <div className='min-w-0' style={{ minHeight: '520px' }}>
              <PnlLeaderboard />
            </div>
          </div>
        </div>

        {/* ── DESKTOP Section 2: Hall of Fame — full width, single column ── */}
        <RevealSection className='hidden md:block max-w-7xl mx-auto px-4 lg:px-6 mt-10'>
          <MonthlyHallOfFame />
        </RevealSection>

        {/* ── MOBILE: Hall of Fame — full width below leaderboard ── */}
        <div className='md:hidden max-w-7xl mx-auto px-4 mt-8'>
          <MonthlyHallOfFame />
        </div>

        {/* ── DESKTOP Section 3: Battles — last section, full width ── */}
        {/* Shared scroll anchor — now points at the battles section at the bottom */}
        <div id='battles-section' ref={battlesSectionRef} style={{ scrollMarginTop: '80px' }} className='hidden md:block' />

        <DesktopBattlesSection
          desktopBattlesOpen={desktopBattlesOpen}
          tab={tab}
          mainTab={mainTab}
          setTab={setTab}
          setMainTab={setMainTab}
          user={user}
          navigate={navigate}
          openChallenges={openChallenges}
          activeH2h={activeH2h}
          completedH2h={completedH2h}
          pendingRumbles={pendingRumbles}
          activeRumbles={activeRumbles}
          completedRumbles={completedRumbles}
          isAdmin={isAdmin}
          getRumbleParticipantCount={getRumbleParticipantCount}
          getRumblePotMicro={getRumblePotMicro}
          isJoinedRumble={isJoinedRumble}
          howOpen={howOpen}
          setHowOpen={setHowOpen}
          howRumbleOpen={howRumbleOpen}
          setHowRumbleOpen={setHowRumbleOpen}
          battles={battles}
          participants={participants}
          battlesSectionRef={battlesSectionRef}
        />
      </div>

      <BottomTabNav />
    </div>
  );
}
