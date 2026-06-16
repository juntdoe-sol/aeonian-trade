import { useAuth, getIdToken } from '@pooflabs/web';
import { CheckCircle2, ChevronDown, ExternalLink, Trophy, Twitter, Zap, Clock, HelpCircle, Share2, Link2, XCircle, CheckCircle, Trash2, Loader2 } from 'lucide-react';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import React, { useState, useEffect, useRef } from 'react';
import { usePersistedCollapse } from '@/hooks/use-persisted-collapse';
import { toast } from 'sonner';
import { AppHeader } from './AppHeader';
import { BottomTabNav } from './BottomTabNav';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeUserPoints, type UserPointsResponse, deleteUserPoints } from '@/lib/collections/userPoints';
import { subscribeSocialClaims, type SocialClaimsResponse, deleteSocialClaims } from '@/lib/collections/socialClaims';
import { subscribePendingSocialClaims, type PendingSocialClaimsResponse, deletePendingSocialClaims } from '@/lib/collections/pendingSocialClaims';
import { subscribeManyPromotionClaims, subscribePromotionClaims, type PromotionClaimsResponse, getManyPromotionClaims, deletePromotionClaims } from '@/lib/collections/promotionClaims';
import { subscribeManyPointsActivity, type PointsActivityResponse, getManyPointsActivity, deletePointsActivity } from '@/lib/collections/pointsActivity';
import { subscribeManyUserPoints } from '@/lib/collections/userPoints';
import { createAuthenticatedApiClient } from '@/lib/api-client';
import { truncateAddress } from '@/utils/format-address';
import { ADMIN_ADDRESS } from '@/lib/constants';
import HowPointsWorkModal from '@/components/rewards/HowPointsWorkModal';
import PromoShareModal from '@/components/rewards/PromoShareModal';
import SubmitPromotionModal from '@/components/rewards/SubmitPromotionModal';
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function activityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    trade: 'Trade',
    battle_win: 'Battle Win',
    follow_twitter: 'X Follow',
    join_telegram: 'X group chat join',
    deposit: 'Deposit',
    social: 'Social',
  };
  return map[type] ?? type;
}

function statusBadge(status: string) {
  if (status === 'approved') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}>
        <CheckCircle size={10} />
        Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}>
        <XCircle size={10} />
        Rejected
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(183,148,246,0.12)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.25)' }}>
      <Clock size={10} />
      Pending
    </span>
  );
}

// ─── Mobile collapsible section wrapper ───────────────────────────────────────
// On mobile: collapsed by default, tap title to expand.
// On desktop (md+): always renders children expanded.

function MobileCollapsibleSection({
  title,
  children,
  defaultOpen = false,
  storageKey,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  storageKey: string;
}) {
  const [open, setOpen] = usePersistedCollapse(storageKey, defaultOpen);

  return (
    <>
      {/* Mobile collapsible */}
      <div className='md:hidden'>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className='w-full flex items-center justify-between mb-1.5 text-left'>
            <h2 className='text-xs font-semibold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
              {title}
            </h2>
            <ChevronDown
              size={13}
              style={{
                color: '#b794f6',
                transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                flexShrink: 0,
              }}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {children}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Desktop: always expanded */}
      <div className='hidden md:block'>
        <h2 className='text-xs font-semibold uppercase tracking-wider mb-1.5' style={{ color: '#8A8A8A' }}>
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function YourPointsCard({
  points,
  socialClaimsData,
  onHowItWorks,
}: {
  points: UserPointsResponse | null;
  socialClaimsData: SocialClaimsResponse | null;
  onHowItWorks: () => void;
}) {
  const claimedCount =
    (socialClaimsData?.twitterFollowClaimed ? 1 : 0) +
    (socialClaimsData?.telegramJoinClaimed ? 1 : 0);
  const derivedSocialPoints = claimedCount * 500;

  const tradingPts = points?.tradingPoints ?? 0;
  const battlePts = points?.battlePoints ?? 0;
  const socialPts = Math.max(points?.socialPoints ?? 0, derivedSocialPoints);
  const total = points?.totalPoints ?? (tradingPts + battlePts + socialPts);

  return (
    <div className='glass-card rounded-xl p-3 space-y-3'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <Trophy size={14} style={{ color: '#F59E0B' }} />
          <h3 className='text-xs font-semibold uppercase tracking-wider' style={{ color: '#8A8A8A' }}>
            Your Points
          </h3>
        </div>
        <button
          onClick={onHowItWorks}
          className='flex items-center gap-1 text-[11px] font-medium transition-colors hover:opacity-80'
          style={{ color: '#8A8A8A' }}
        >
          <HelpCircle size={11} />
          How it works
        </button>
      </div>

      <div className='flex items-end gap-2'>
        <span className='text-3xl font-bold tabular-nums' style={{ color: '#F59E0B' }}>
          {total.toLocaleString()}
        </span>
        <span className='text-sm mb-0.5' style={{ color: '#8A8A8A' }}>pts</span>
      </div>

      <div className='grid grid-cols-3 gap-2'>
        <PointPill label='Trading' value={tradingPts} color='#b794f6' />
        <PointPill label='Battle' value={battlePts} color='#A855F7' />
        <PointPill label='Social' value={socialPts} color='#10B981' />
      </div>
    </div>
  );
}

function PointPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className='glass-inner rounded-lg p-2.5 text-center'>
      <div className='text-[11px] mb-1' style={{ color: '#8A8A8A' }}>{label}</div>
      <div className='font-bold text-sm tabular-nums' style={{ color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function SocialRewardCard({
  title,
  description,
  icon,
  linkLabel,
  linkHref,
  claimed,
  pending,
  onClaim,
  claiming,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  linkLabel: string;
  linkHref: string;
  claimed: boolean;
  pending: boolean;
  onClaim: () => void;
  claiming: boolean;
}) {
  return (
    <div
      className='glass-card rounded-xl p-3 space-y-2.5'
      style={{ borderColor: claimed ? 'rgba(74,222,128,0.2)' : undefined }}
    >
      <div className='flex items-start gap-3'>
        <div className='glass-inner w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0'>
          {icon}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='font-semibold text-sm' style={{ color: '#E5E5E5' }}>{title}</div>
          <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>{description}</div>
        </div>
        <div className='text-sm font-bold tabular-nums flex-shrink-0' style={{ color: '#F59E0B' }}>
          +500 pts
        </div>
      </div>

      <div className='flex gap-2'>
        <a
          href={linkHref}
          target='_blank'
          rel='noopener noreferrer'
          className='glass-button flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors'
          style={{ color: '#E5E5E5' }}
        >
          {linkLabel}
          <ExternalLink size={11} />
        </a>

        {claimed ? (
          <div
            className='flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold'
            style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', border: '1px solid rgba(16,185,129,0.2)' }}
          >
            <CheckCircle2 size={13} />
            Claimed
          </div>
        ) : pending ? (
          <div
            className='flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold'
            style={{ background: 'rgba(183,148,246,0.1)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.2)' }}
          >
            <Clock size={13} />
            Pending Review
          </div>
        ) : (
          <button
            onClick={onClaim}
            disabled={claiming}
            className='flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50'
            style={{ background: 'rgba(183,148,246,0.18)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
          >
            {claiming ? 'Claiming...' : 'Claim Reward'}
          </button>
        )}
      </div>
    </div>
  );
}

function ActivityItem({ item }: { item: PointsActivityResponse }) {
  return (
    <div className='flex items-center gap-3 py-2' style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className='glass-inner w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0'>
        <Zap size={13} style={{ color: '#F59E0B' }} />
      </div>
      <div className='flex-1 min-w-0'>
        <div className='text-sm font-medium' style={{ color: '#E5E5E5' }}>
          {activityTypeLabel(item.activityType)}
        </div>
        {item.description && (
          <div className='text-xs mt-0.5 truncate' style={{ color: '#8A8A8A' }}>{item.description}</div>
        )}
      </div>
      <div className='text-right flex-shrink-0'>
        <div className='text-sm font-bold tabular-nums' style={{ color: '#F59E0B' }}>
          +{item.points}
        </div>
        <div className='text-[10px] flex items-center gap-0.5 justify-end mt-0.5' style={{ color: '#555' }}>
          <Clock size={9} />
          {formatTime(item.createdAt)}
        </div>
      </div>
    </div>
  );
}

function LeaderboardRow({
  rank,
  entry,
  isCurrentUser,
  isAdmin,
  onDelete,
  xProfile,
}: {
  rank: number;
  entry: UserPointsResponse;
  isCurrentUser: boolean;
  isAdmin?: boolean;
  onDelete?: (address: string) => Promise<void>;
  xProfile?: { username: string; avatar?: string; displayName?: string } | null;
}) {
  const rankColor = rank === 1 ? '#F59E0B' : rank === 2 ? '#A0A0B0' : rank === 3 ? '#CD7F32' : '#8A8A8A';
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(entry.address);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${isCurrentUser ? 'glass-card' : ''}`}
      style={{
        background: isCurrentUser ? 'rgba(183,148,246,0.08)' : 'transparent',
        borderColor: isCurrentUser ? 'rgba(183,148,246,0.25)' : 'transparent',
      }}
    >
      <div className='w-6 text-center font-bold text-sm flex-shrink-0' style={{ color: rankColor }}>
        {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
      </div>
      {/* Avatar — only shown when X is linked */}
      {xProfile ? (
        xProfile.avatar ? (
          <img
            src={xProfile.avatar}
            alt={xProfile.username}
            className='w-7 h-7 rounded-full flex-shrink-0 object-cover'
            style={{ border: '1.5px solid rgba(183,148,246,0.35)' }}
          />
        ) : (
          <div className='w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold' style={{ background: 'rgba(183,148,246,0.2)', border: '1.5px solid rgba(183,148,246,0.35)', color: '#b794f6' }}>
            {(xProfile.displayName ?? xProfile.username)[0].toUpperCase()}
          </div>
        )
      ) : null}
      <div className='flex-1 min-w-0'>
        {xProfile ? (
          <div>
            <span className='text-sm font-semibold' style={{ color: isCurrentUser ? '#b794f6' : '#E5E5E5' }}>
              @{xProfile.username}
            </span>
            {isCurrentUser && (
              <span className='ml-1.5 text-[10px] font-semibold px-1 py-0.5 rounded' style={{ background: 'rgba(183,148,246,0.2)', color: '#b794f6' }}>
                You
              </span>
            )}
          </div>
        ) : (
          <div>
            <span className='font-mono text-sm' style={{ color: isCurrentUser ? '#b794f6' : '#E5E5E5' }}>
              {truncateAddress(entry.address)}
            </span>
            {isCurrentUser && (
              <span className='ml-1.5 text-[10px] font-semibold px-1 py-0.5 rounded' style={{ background: 'rgba(183,148,246,0.2)', color: '#b794f6' }}>
                You
              </span>
            )}
          </div>
        )}
      </div>
      <div className='font-bold tabular-nums text-sm flex-shrink-0' style={{ color: '#F59E0B' }}>
        {(entry.totalPoints ?? 0).toLocaleString()}
      </div>
      {isAdmin && onDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              disabled={deleting}
              className='flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors disabled:opacity-50'
              style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.22)' }}
              title='Delete user reward data'
            >
              {deleting ? <Loader2 size={11} className='animate-spin' /> : <Trash2 size={11} />}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Reward Data?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently wipe all reward data for <span className='font-mono font-semibold'>{entry.address}</span>. Their points, social claims, pending claims, promotion claims, and activity history will all be deleted. This cannot be undone.
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
      )}
    </div>
  );
}

const PROMOTION_COOLDOWN_SECS = 24 * 3600;

/**
 * Returns the reference timestamp (Unix seconds) that the SERVER measures the
 * 24h cooldown against: the platform field `tarobase_updated_at`. The generated
 * SDK type doesn't surface this field, so we read it off the object and fall
 * back to `tarobase_created_at`/`updatedAt`/`createdAt` only if it's missing.
 */
export function getClaimLastWriteSec(claim: PromotionClaimsResponse | null | undefined): number {
  if (!claim) return 0;
  const meta = claim as unknown as { tarobase_updated_at?: number; tarobase_created_at?: number };
  return (
    meta.tarobase_updated_at ||
    meta.tarobase_created_at ||
    claim.updatedAt ||
    claim.createdAt ||
    0
  );
}

/** Seconds remaining on the 24h cooldown for ANY status. 0 means eligible. */
export function getPromotionCooldownSecondsLeft(claim: PromotionClaimsResponse | null | undefined): number {
  if (!claim) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.max(0, PROMOTION_COOLDOWN_SECS - (nowSec - getClaimLastWriteSec(claim)));
}

function formatCooldownRemaining(secondsLeft: number): string {
  if (secondsLeft <= 0) return '';
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PromoteCooldownBadge({ claim }: { claim: PromotionClaimsResponse | null }) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => getPromotionCooldownSecondsLeft(claim));

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWriteSec = getClaimLastWriteSec(claim);

  useEffect(() => {
    const initial = getPromotionCooldownSecondsLeft(claim);
    setSecondsLeft(initial);
    if (initial <= 0) return;

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // Re-run when the underlying claim's last-write time changes.
  }, [lastWriteSec]);

  if (!claim || secondsLeft <= 0) return null;

  // Single rule for ANY status: blocked until 24h since last write elapses.
  const label =
    claim.status === 'pending'
      ? 'Under review — next submission in'
      : 'Next submission available in';

  return (
    <div className='flex items-center gap-1.5 text-[11px] font-medium mt-1' style={{ color: '#b794f6' }}>
      <Clock size={11} style={{ flexShrink: 0 }} />
      {label}{' '}
      <span style={{ color: '#b794f6', fontVariantNumeric: 'tabular-nums' }}>
        {formatCooldownRemaining(secondsLeft)}
      </span>
    </div>
  );
}

function PromoteAeonianCard({
  walletAddress,
  onGenerateCard,
  onSubmitLink,
}: {
  walletAddress: string | undefined;
  onGenerateCard: () => void;
  onSubmitLink: () => void;
}) {
  const { data: myClaim, loading: claimLoading } = useRealtimeData<PromotionClaimsResponse | null>(
    subscribePromotionClaims,
    !!walletAddress,
    walletAddress ?? ''
  );

  const claim = myClaim ?? null;

  // Re-derive every second so the disabled state flips the moment the cooldown
  // expires (in lockstep with the live countdown badge below).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!claim) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [getClaimLastWriteSec(claim)]);

  // Gate the submit action while the claim subscription is still resolving so a
  // user with an existing recent claim can't click through during the loading
  // window before their cooldown is known.
  const claimResolved = !walletAddress || !claimLoading;

  // Single rule for ANY status: blocked while 24h since last write hasn't elapsed.
  const isSubmitBlocked = !claimResolved || getPromotionCooldownSecondsLeft(claim) > 0;

  return (
    <div className='glass-card rounded-xl p-3 space-y-2.5'>
      <div className='flex items-start gap-3'>
        <div className='glass-inner w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0'>
          <Share2 size={14} style={{ color: '#a855f7' }} />
        </div>
        <div className='flex-1 min-w-0'>
          <div className='font-semibold text-sm' style={{ color: '#E5E5E5' }}>Earn 1000 Points</div>
          <div className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>
            Generate a branded card, share it on X, and submit the link to earn 1000 points.
          </div>
        </div>
        <div className='text-sm font-bold tabular-nums flex-shrink-0' style={{ color: '#F59E0B' }}>
          +1000 pts
        </div>
      </div>

      <div className='flex gap-2'>
        <button
          onClick={onGenerateCard}
          className='flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50'
          style={{ background: 'rgba(183,148,246,0.18)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
        >
          <Share2 size={13} />
          Generate Share Card
        </button>
        <button
          onClick={onSubmitLink}
          disabled={isSubmitBlocked}
          className='flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          style={{ background: 'rgba(183,148,246,0.12)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.25)' }}
        >
          <Link2 size={13} />
          Submit Promotion Link
        </button>
      </div>

      {/* Live cooldown / under-review indicator */}
      {walletAddress && <PromoteCooldownBadge claim={claim} />}
    </div>
  );
}

function MyPromotionsSection({ walletAddress }: { walletAddress: string }) {
  const { data: myClaims } = useRealtimeData<PromotionClaimsResponse[]>(
    subscribeManyPromotionClaims,
    !!walletAddress,
    `userAddress = "${walletAddress}"`
  );

  const claims = myClaims ?? [];

  return (
    <div>
      <div className='glass-card rounded-xl overflow-hidden'>
        {claims.length === 0 ? (
          <p className='py-4 text-center text-xs' style={{ color: '#8A8A8A' }}>
            No promotions submitted yet.
          </p>
        ) : (
          <div className='px-2.5 py-1.5 space-y-0.5'>
            {claims.map((claim) => (
              <div
                key={claim.id}
                className='flex items-center gap-3 px-2.5 py-2 rounded-lg'
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className='flex-1 min-w-0'>
                  <a
                    href={claim.link}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-xs font-medium truncate block hover:underline'
                    style={{ color: '#b794f6' }}
                    title={claim.link}
                  >
                    {claim.link.length > 45 ? claim.link.slice(0, 45) + '...' : claim.link}
                  </a>
                  <div className='text-[10px] mt-0.5' style={{ color: '#555' }}>
                    {formatTime(claim.createdAt)}
                  </div>
                </div>
                <div className='flex items-center gap-2 flex-shrink-0'>
                  <span className='text-xs font-bold tabular-nums' style={{ color: '#F59E0B' }}>
                    +{claim.pointsAwarded}
                  </span>
                  {statusBadge(claim.status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function RewardsPage() {
  const { user } = useAuth();
  const [claimingTwitter, setClaimingTwitter] = useState(false);
  const [claimingTelegram, setClaimingTelegram] = useState(false);
  const [howModalOpen, setHowModalOpen] = useState(false);
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);

  // User's points
  const { data: userPoints } = useRealtimeData<UserPointsResponse | null>(
    subscribeUserPoints,
    !!user?.address,
    user?.address ?? ''
  );

  // User's social claims
  const { data: socialClaims } = useRealtimeData<SocialClaimsResponse | null>(
    subscribeSocialClaims,
    !!user?.address,
    user?.address ?? ''
  );

  // User's pending social claims
  const { data: pendingSocialClaims } = useRealtimeData<PendingSocialClaimsResponse | null>(
    subscribePendingSocialClaims,
    !!user?.address,
    user?.address ?? ''
  );

  // User's recent activity (top 10)
  const { data: allActivity } = useRealtimeData<PointsActivityResponse[]>(
    subscribeManyPointsActivity,
    !!user?.address,
    `userAddress = "${user?.address ?? ''}"`
  );
  const recentActivity = (allActivity ?? [])
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);

  // Leaderboard: top 20 by totalPoints
  const { data: allUserPoints } = useRealtimeData<UserPointsResponse[]>(
    subscribeManyUserPoints,
    true
  );
  const leaderboard = (allUserPoints ?? [])
    .sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0))
    .slice(0, 20);

  // X/Twitter social links — batch subscription for leaderboard avatars
  // subscribeAllSocialLinks gets all docs in the socialLinks collection (public read)
  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true
  );
  // Build wallet → parsed X profile map for O(1) leaderboard lookups
  const xProfileMap = React.useMemo(() => {
    const map = new Map<string, { username: string; avatar?: string; displayName?: string }>();
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet) {
        try {
          const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
          if (parsed?.username) {
            map.set(link.wallet, {
              username: parsed.username,
              avatar: parsed.avatar,
              displayName: parsed.displayName,
            });
          }
        } catch {
          // ignore malformed profile
        }
      }
    }
    return map;
  }, [allSocialLinks]);

  const isAdmin = !!user?.address && user.address === ADMIN_ADDRESS;

  // ── Admin: delete all reward data for a user ────────────────────────────────

  async function handleDeleteUserRewardData(targetAddress: string) {
    let anyError = false;

    // 1. userPoints/$userAddress — direct delete
    try {
      await deleteUserPoints(targetAddress);
    } catch {
      anyError = true;
    }

    // 2. socialClaims/$userAddress — direct delete
    try {
      await deleteSocialClaims(targetAddress);
    } catch {
      anyError = true;
    }

    // 3. pendingSocialClaims/$userAddress — direct delete
    try {
      await deletePendingSocialClaims(targetAddress);
    } catch {
      anyError = true;
    }

    // 4. promotionClaims — query then delete each
    try {
      const promos = await getManyPromotionClaims(`userAddress = "${targetAddress}"`);
      for (const promo of promos) {
        try {
          await deletePromotionClaims(promo.id);
        } catch {
          anyError = true;
        }
      }
    } catch {
      anyError = true;
    }

    // 5. pointsActivity — query then delete each
    try {
      const activities = await getManyPointsActivity(`userAddress = "${targetAddress}"`);
      for (const act of activities) {
        try {
          await deletePointsActivity(act.id);
        } catch {
          anyError = true;
        }
      }
    } catch {
      anyError = true;
    }

    if (anyError) {
      toast.error('Some data could not be deleted');
    } else {
      toast.success('User removed');
    }
  }

  // ── Claim handlers ───────────────────────────────────────────────────────────

  async function claimTwitterFollow() {
    const address = user?.address;
    if (!address) { toast.error('Connect your wallet first'); return; }
    setClaimingTwitter(true);
    try {
      const token = await getIdToken();
      if (!token) { toast.error('Auth token missing'); return; }
      const authApi = createAuthenticatedApiClient(token, address);
      await authApi.post('/api/social/claim/twitter');
      toast.success('Claim submitted for review!');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit claim.');
    } finally {
      setClaimingTwitter(false);
    }
  }

  async function claimTelegramJoin() {
    const address = user?.address;
    if (!address) { toast.error('Connect your wallet first'); return; }
    setClaimingTelegram(true);
    try {
      const token = await getIdToken();
      if (!token) { toast.error('Auth token missing'); return; }
      const authApi = createAuthenticatedApiClient(token, address);
      await authApi.post('/api/social/claim/telegram');
      toast.success('Claim submitted for review!');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit claim.');
    } finally {
      setClaimingTelegram(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className='min-h-screen pb-24 text-white'>
      <AppHeader />

      {/* Page sub-header */}
      <div className='px-4 pt-2 pb-2' style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className='flex items-center gap-2'>
          <Trophy size={14} style={{ color: '#F59E0B' }} />
          <h1 className='font-bold text-base'>Rewards</h1>
        </div>
        <p className='text-xs mt-0.5' style={{ color: '#8A8A8A' }}>
          Earn points by trading, winning in the Arena, and engaging socially.
        </p>
      </div>

      <div className='px-4 pt-2 space-y-2.5'>

        {/* ── Your Points ────────────────────────────────────────────────── */}
        {user ? (
          <YourPointsCard
            points={userPoints ?? null}
            socialClaimsData={socialClaims ?? null}
            onHowItWorks={() => setHowModalOpen(true)}
          />
        ) : (
          <div className='glass-card rounded-xl p-3 text-center space-y-1.5'>
            <Trophy size={18} style={{ color: '#F59E0B', margin: '0 auto' }} />
            <p className='text-sm' style={{ color: '#8A8A8A' }}>Connect your wallet to see your points.</p>
          </div>
        )}

        {/* ── Leaderboard ───────────────────────────────────────────────── */}
        <div>
          <h2 className='text-xs font-semibold uppercase tracking-wider mb-1.5' style={{ color: '#8A8A8A' }}>
            Leaderboard
          </h2>
          <div className='glass-card rounded-xl overflow-hidden'>
            {leaderboard.length === 0 ? (
              <p className='py-4 text-center text-xs' style={{ color: '#8A8A8A' }}>
                No data yet. Be the first on the leaderboard!
              </p>
            ) : (
              <div className='px-1.5 py-1.5 space-y-0 overflow-y-auto' style={{ maxHeight: '360px' }}>
                {leaderboard.map((entry, idx) => (
                  <LeaderboardRow
                    key={entry.id ?? entry.address}
                    rank={idx + 1}
                    entry={entry}
                    isCurrentUser={!!user?.address && user.address === entry.address}
                    isAdmin={isAdmin}
                    onDelete={isAdmin ? handleDeleteUserRewardData : undefined}
                    xProfile={xProfileMap.get(entry.address) ?? null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Social Rewards — collapsible on mobile ────────────────────── */}
        <MobileCollapsibleSection title='Social Rewards' storageKey='aeonian:cardCollapsed:rewards:socialRewards'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
            <SocialRewardCard
              title='Follow AEONIAN on X'
              description='Follow @Aeonian_Arena to earn one-time social points.'
              icon={<Twitter size={16} style={{ color: '#1D9BF0' }} />}
              linkLabel='Follow on X'
              linkHref='https://x.com/Aeonian_Arena'
              claimed={socialClaims?.twitterFollowClaimed ?? false}
              pending={pendingSocialClaims?.twitterFollowPending ?? false}
              onClaim={claimTwitterFollow}
              claiming={claimingTwitter}
            />
            <SocialRewardCard
              title='Join our Group Chat'
              description='Join the AEONIAN community on X for one-time social points.'
              icon={<Twitter size={16} style={{ color: '#1D9BF0' }} />}
              linkLabel='Join on X'
              linkHref='https://x.com/i/chat/group_join/g2057103803988742289/2e12MZk4OZ'
              claimed={socialClaims?.telegramJoinClaimed ?? false}
              pending={pendingSocialClaims?.telegramJoinPending ?? false}
              onClaim={claimTelegramJoin}
              claiming={claimingTelegram}
            />
          </div>
        </MobileCollapsibleSection>

        {/* ── Promote AEONIAN — collapsible on mobile ───────────────────── */}
        <MobileCollapsibleSection title='Promote AEONIAN' storageKey='aeonian:cardCollapsed:rewards:promoteAeonian'>
          <PromoteAeonianCard
            walletAddress={user?.address}
            onGenerateCard={() => setPromoModalOpen(true)}
            onSubmitLink={() => setSubmitModalOpen(true)}
          />
        </MobileCollapsibleSection>

        {/* ── My Promotions — collapsible on mobile ─────────────────────── */}
        {user && (
          <MobileCollapsibleSection title='My Promotions' storageKey='aeonian:cardCollapsed:rewards:myPromotions'>
            <MyPromotionsSection walletAddress={user.address} />
          </MobileCollapsibleSection>
        )}

        {/* ── Recent Activity — collapsible on mobile ───────────────────── */}
        {user && (
          <MobileCollapsibleSection title='Recent Activity' storageKey='aeonian:cardCollapsed:rewards:recentActivity'>
            <div className='glass-card rounded-xl px-3 py-0.5'>
              {recentActivity.length === 0 ? (
                <p className='py-4 text-center text-xs' style={{ color: '#8A8A8A' }}>
                  No activity yet. Start trading to earn points!
                </p>
              ) : (
                recentActivity.map((item) => (
                  <ActivityItem key={item.id} item={item} />
                ))
              )}
            </div>
          </MobileCollapsibleSection>
        )}

      </div>

      <BottomTabNav />

      {/* Modals */}
      <HowPointsWorkModal
        open={howModalOpen}
        onClose={() => setHowModalOpen(false)}
      />
      <PromoShareModal open={promoModalOpen} onClose={() => setPromoModalOpen(false)} />
      <SubmitPromotionModal open={submitModalOpen} onClose={() => setSubmitModalOpen(false)} walletAddress={user?.address} />
    </div>
  );
}

export default RewardsPage;
