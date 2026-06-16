import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  subscribeUserPoints,
  type UserPointsResponse,
} from '@/lib/collections/userPoints';
import {
  subscribeManyPointsActivity,
  type PointsActivityResponse,
} from '@/lib/collections/pointsActivity';
import {
  subscribeManyPhoenixTradeRecord,
  type PhoenixTradeRecordResponse,
} from '@/lib/collections/phoenixTradeRecord';
import {
  subscribeSocialClaims,
  type SocialClaimsResponse,
} from '@/lib/collections/socialClaims';
import {
  subscribePendingSocialClaims,
  type PendingSocialClaimsResponse,
} from '@/lib/collections/pendingSocialClaims';
import {
  subscribeManyPromotionClaims,
  type PromotionClaimsResponse,
} from '@/lib/collections/promotionClaims';
import {
  subscribeManyBattleParticipants,
  type BattleParticipantsResponse,
} from '@/lib/collections/battleParticipants';
import {
  subscribeManyBattleClaims,
  type BattleClaimsResponse,
} from '@/lib/collections/battleClaims';
import {
  subscribeManyRumbleClaims,
  type RumbleClaimsResponse,
} from '@/lib/collections/rumbleClaims';
import {
  subscribeManyBattleRefunds,
  type BattleRefundsResponse,
} from '@/lib/collections/battleRefunds';

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Star,
  TrendingUp,
  TrendingDown,
  Activity,
  Twitter,
  MessageSquare,
  Users,
  Swords,
  ArrowDownCircle,
  ArrowUpCircle,
  ExternalLink,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Trophy,
} from 'lucide-react';

// ─── Base58 charset validation ────────────────────────────────────────────────

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidBase58(addr: string): boolean {
  return BASE58_RE.test(addr);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(tsSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - tsSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Points Tiles ─────────────────────────────────────────────────────────────

function PointsTiles({ pts }: { pts: UserPointsResponse }) {
  const tiles = [
    { label: 'Total Points', value: pts.totalPoints, color: '#b794f6', icon: Star },
    { label: 'Trading', value: pts.tradingPoints, color: '#22c55e', icon: TrendingUp },
    { label: 'Battle', value: pts.battlePoints, color: '#f59e0b', icon: Swords },
    { label: 'Social', value: pts.socialPoints, color: '#38bdf8', icon: Twitter },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {tiles.map(({ label, value, color, icon: Icon }) => (
        <div
          key={label}
          className="rounded-lg p-3 flex flex-col gap-1"
          style={{ background: `${color}12`, border: `1px solid ${color}28` }}
        >
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>
            <Icon className="h-3 w-3" />
            {label}
          </div>
          <div className="text-xl font-bold font-mono" style={{ color }}>
            {(value ?? 0).toLocaleString()}
          </div>
          {pts.updatedAt > 0 && label === 'Total Points' && (
            <div className="text-[10px] text-muted-foreground">
              Updated {relativeTime(pts.updatedAt)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Activity Log Tab ─────────────────────────────────────────────────────────

function ActivityLogTab({ items }: { items: PointsActivityResponse[] }) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.createdAt - a.createdAt),
    [items]
  );

  if (sorted.length === 0) return null;

  return (
    <ScrollArea className="h-[360px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="text-[10px] text-muted-foreground font-mono">
                {a.createdAt > 0 ? relativeTime(a.createdAt) : '—'}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-mono"
                >
                  {a.activityType}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                {a.description ?? '—'}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold text-xs">
                <span style={{ color: a.points >= 0 ? '#22c55e' : '#ef4444' }}>
                  {a.points >= 0 ? '+' : ''}{a.points.toLocaleString()}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

// ─── Trades Tab ───────────────────────────────────────────────────────────────

function TradesTab({ trades }: { trades: PhoenixTradeRecordResponse[] }) {
  const sorted = useMemo(
    () => [...trades].sort((a, b) => b.createdAt - a.createdAt),
    [trades]
  );

  if (sorted.length === 0) return null;

  return (
    <ScrollArea className="h-[360px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Time</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead className="w-16">Side</TableHead>
            <TableHead className="text-right">Size USD</TableHead>
            <TableHead className="text-right">Leverage</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Tx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((t) => {
            const isLong = t.side === 'long';
            return (
              <TableRow key={t.id}>
                <TableCell className="text-[10px] text-muted-foreground font-mono">
                  {t.createdAt > 0 ? relativeTime(t.createdAt) : '—'}
                </TableCell>
                <TableCell className="font-mono text-xs font-semibold">
                  {t.symbol ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge
                    className="text-[10px] px-1.5 py-0 font-bold uppercase"
                    style={
                      isLong
                        ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }
                        : { background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }
                    }
                  >
                    {t.side}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  ${(typeof t.sizeUsd === 'number' ? t.sizeUsd : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {typeof t.leverage === 'number' ? `${t.leverage}×` : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.orderType ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  {t.txSignature ? (
                    <a
                      href={`https://solscan.io/tx/${t.txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                    >
                      View <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  ) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

// ─── Social Tab ───────────────────────────────────────────────────────────────

function SocialTab({
  socialClaims,
  pendingClaims,
  promotions,
}: {
  socialClaims: SocialClaimsResponse | null;
  pendingClaims: PendingSocialClaimsResponse | null;
  promotions: PromotionClaimsResponse[];
}) {
  const sortedPromos = useMemo(
    () => [...promotions].sort((a, b) => b.createdAt - a.createdAt),
    [promotions]
  );

  const hasData =
    socialClaims !== null || pendingClaims !== null || promotions.length > 0;
  if (!hasData) return null;

  return (
    <div className="space-y-4">
      {/* Approved social claims */}
      {socialClaims && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Approved Social Rewards
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                label: 'Twitter Follow',
                claimed: socialClaims.twitterFollowClaimed,
                claimedAt: socialClaims.twitterFollowClaimedAt,
                icon: Twitter,
              },
              {
                label: 'Telegram Join',
                claimed: socialClaims.telegramJoinClaimed,
                claimedAt: socialClaims.telegramJoinClaimedAt,
                icon: MessageSquare,
              },
            ].map(({ label, claimed, claimedAt, icon: Icon }) => (
              <div
                key={label}
                className="rounded-lg p-3 flex items-center gap-2"
                style={
                  claimed
                    ? { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }
                    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
                }
              >
                <Icon className="h-4 w-4 shrink-0" style={{ color: claimed ? '#22c55e' : undefined }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{label}</div>
                  {claimed && claimedAt && claimedAt > 0 && (
                    <div className="text-[10px] text-muted-foreground">{relativeTime(claimedAt)}</div>
                  )}
                </div>
                {claimed ? (
                  <CheckCircle className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending social claims */}
      {pendingClaims && (pendingClaims.twitterFollowPending || pendingClaims.telegramJoinPending) && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Pending Claims
          </div>
          <div className="grid grid-cols-2 gap-2">
            {pendingClaims.twitterFollowPending && (
              <div
                className="rounded-lg p-3 flex items-center gap-2"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                <Twitter className="h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">Twitter Follow</div>
                  {pendingClaims.twitterFollowRequestedAt && pendingClaims.twitterFollowRequestedAt > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      Requested {relativeTime(pendingClaims.twitterFollowRequestedAt)}
                    </div>
                  )}
                </div>
                <Clock className="h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} />
              </div>
            )}
            {pendingClaims.telegramJoinPending && (
              <div
                className="rounded-lg p-3 flex items-center gap-2"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                <MessageSquare className="h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">Telegram Join</div>
                  {pendingClaims.telegramJoinRequestedAt && pendingClaims.telegramJoinRequestedAt > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      Requested {relativeTime(pendingClaims.telegramJoinRequestedAt)}
                    </div>
                  )}
                </div>
                <Clock className="h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Promotion claims */}
      {sortedPromos.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Promotion Link Claims ({sortedPromos.length})
          </div>
          <ScrollArea className="h-[220px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Link</TableHead>
                  <TableHead className="w-24 text-center">Status</TableHead>
                  <TableHead className="text-right w-24">Points</TableHead>
                  <TableHead className="text-right w-28">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPromos.map((p) => {
                  const statusColor =
                    p.status === 'approved'
                      ? '#22c55e'
                      : p.status === 'rejected'
                      ? '#ef4444'
                      : '#f59e0b';
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs max-w-[180px]">
                        <a
                          href={p.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1 truncate"
                        >
                          <span className="truncate">{p.link}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          className="text-[10px] px-1.5 py-0 capitalize font-medium"
                          style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}35` }}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs" style={{ color: p.status === 'approved' ? '#22c55e' : undefined }}>
                        {p.status === 'approved' ? `+${p.pointsAwarded.toLocaleString()}` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {p.createdAt > 0 ? relativeTime(p.createdAt) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ─── Battles Tab ──────────────────────────────────────────────────────────────

function BattlesTab({
  addr,
  participations,
  battleClaims,
  rumbleClaims,
  refunds,
}: {
  addr: string;
  participations: BattleParticipantsResponse[];
  battleClaims: BattleClaimsResponse[];
  rumbleClaims: RumbleClaimsResponse[];
  refunds: BattleRefundsResponse[];
}) {
  const sorted = useMemo(
    () => [...participations].sort((a, b) => b.joinedAt - a.joinedAt),
    [participations]
  );

  // Battles this user won (as winner in battleClaims)
  const winsAsWinner = battleClaims.filter((c) => c.winner === addr);

  // Rumbles where user placed (winner1/2/3)
  const rumbleWins = rumbleClaims.filter(
    (r) => r.winner1 === addr || r.winner2 === addr || r.winner3 === addr
  );

  const hasData =
    participations.length > 0 ||
    battleClaims.length > 0 ||
    rumbleClaims.length > 0 ||
    refunds.length > 0;

  if (!hasData) return null;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      {(winsAsWinner.length > 0 || rumbleWins.length > 0 || refunds.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {winsAsWinner.length > 0 && (
            <div
              className="rounded-lg p-3 text-center"
              style={{ background: 'rgba(183,148,246,0.08)', border: '1px solid rgba(183,148,246,0.2)' }}
            >
              <Trophy className="h-4 w-4 mx-auto mb-1" style={{ color: '#b794f6' }} />
              <div className="text-xl font-bold font-mono" style={{ color: '#b794f6' }}>{winsAsWinner.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">1v1 Wins</div>
            </div>
          )}
          {rumbleWins.length > 0 && (
            <div
              className="rounded-lg p-3 text-center"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
            >
              <Zap className="h-4 w-4 mx-auto mb-1" style={{ color: '#f59e0b' }} />
              <div className="text-xl font-bold font-mono" style={{ color: '#f59e0b' }}>{rumbleWins.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Rumble Wins</div>
            </div>
          )}
          {refunds.length > 0 && (
            <div
              className="rounded-lg p-3 text-center"
              style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)' }}
            >
              <ArrowUpCircle className="h-4 w-4 mx-auto mb-1" style={{ color: '#38bdf8' }} />
              <div className="text-xl font-bold font-mono" style={{ color: '#38bdf8' }}>{refunds.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Refunds</div>
            </div>
          )}
        </div>
      )}

      {/* Participations */}
      {sorted.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Swords className="h-3.5 w-3.5" />
            Battle Participations ({sorted.length})
          </div>
          <ScrollArea className="h-[260px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Battle ID</TableHead>
                  <TableHead className="text-right">Bet (USDC)</TableHead>
                  <TableHead className="text-right">Equity at Start</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((p) => {
                  const won1v1 = winsAsWinner.some((c) => c.battleId === p.battleId);
                  const rumblePlace = rumbleClaims.find((r) => r.battleId === p.battleId);
                  let place: string | null = null;
                  if (rumblePlace) {
                    if (rumblePlace.winner1 === addr) place = '1st';
                    else if (rumblePlace.winner2 === addr) place = '2nd';
                    else if (rumblePlace.winner3 === addr) place = '3rd';
                  }
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          {truncAddr(p.battleId)}
                          {won1v1 && (
                            <Badge
                              className="text-[10px] px-1 py-0 font-bold"
                              style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
                            >
                              Won
                            </Badge>
                          )}
                          {place && (
                            <Badge
                              className="text-[10px] px-1 py-0 font-bold"
                              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                            >
                              {place}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        ${(p.betAmountMicro / 1_000_000).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        ${(p.equityAtStartMicro / 1_000_000).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {p.joinedAt > 0 ? relativeTime(p.joinedAt) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface AdminUserProfileProps {
  address: string | null;
  onClose: () => void;
}

export function AdminUserProfile({ address, onClose }: AdminUserProfileProps) {
  const isOpen = address !== null;
  const addr = address ?? '';
  const safeAddr = isValidBase58(addr) ? addr : '';

  // Points summary
  const { data: userPoints } = useRealtimeData<UserPointsResponse | null>(
    subscribeUserPoints,
    !!safeAddr,
    safeAddr
  );

  // Points activity log
  const { data: activityRaw } = useRealtimeData<PointsActivityResponse[]>(
    subscribeManyPointsActivity,
    !!safeAddr,
    `where userAddress = '${safeAddr}'`
  );

  // Trades
  const { data: tradesRaw } = useRealtimeData<PhoenixTradeRecordResponse[]>(
    subscribeManyPhoenixTradeRecord,
    !!safeAddr,
    `where trader = '${safeAddr}'`
  );

  // Social claims (approved)
  const { data: socialClaims } = useRealtimeData<SocialClaimsResponse | null>(
    subscribeSocialClaims,
    !!safeAddr,
    safeAddr
  );

  // Pending social claims
  const { data: pendingSocial } = useRealtimeData<PendingSocialClaimsResponse | null>(
    subscribePendingSocialClaims,
    !!safeAddr,
    safeAddr
  );

  // Promotion claims
  const { data: promotionsRaw } = useRealtimeData<PromotionClaimsResponse[]>(
    subscribeManyPromotionClaims,
    !!safeAddr,
    `where userAddress = '${safeAddr}'`
  );

  // Battle participations
  const { data: participationsRaw } = useRealtimeData<BattleParticipantsResponse[]>(
    subscribeManyBattleParticipants,
    !!safeAddr,
    `where wallet = '${safeAddr}'`
  );

  // Battle claims (1v1 wins)
  const { data: battleClaimsRaw } = useRealtimeData<BattleClaimsResponse[]>(
    subscribeManyBattleClaims,
    !!safeAddr,
    `where winner = '${safeAddr}'`
  );

  // Rumble claims (top-3 placements)
  const { data: rumbleClaimsAllRaw } = useRealtimeData<RumbleClaimsResponse[]>(
    subscribeManyRumbleClaims,
    !!safeAddr
  );

  // Battle refunds
  const { data: battleRefundsRaw } = useRealtimeData<BattleRefundsResponse[]>(
    subscribeManyBattleRefunds,
    !!safeAddr,
    `where wallet = '${safeAddr}'`
  );

  const activity = activityRaw ?? [];
  const trades = tradesRaw ?? [];
  const promotions = promotionsRaw ?? [];
  const participations = participationsRaw ?? [];
  const battleClaims = battleClaimsRaw ?? [];
  const rumbleClaimsAll = (rumbleClaimsAllRaw ?? []).filter(
    (r) => r.winner1 === addr || r.winner2 === addr || r.winner3 === addr
  );
  const battleRefunds = battleRefundsRaw ?? [];

  // Determine which tabs have data
  const hasActivity = activity.length > 0;
  const hasTrades = trades.length > 0;
  const hasSocial =
    socialClaims !== null ||
    (pendingSocial !== null && (pendingSocial.twitterFollowPending || pendingSocial.telegramJoinPending)) ||
    promotions.length > 0;
  const hasBattles =
    participations.length > 0 ||
    battleClaims.length > 0 ||
    rumbleClaimsAll.length > 0 ||
    battleRefunds.length > 0;

  const defaultTab = hasActivity
    ? 'activity'
    : hasTrades
    ? 'trades'
    : hasSocial
    ? 'social'
    : 'battles';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        style={{ background: 'hsl(var(--background))', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold">
            <div
              className="h-7 w-7 rounded-md flex items-center justify-center shrink-0"
              style={{ background: 'rgba(183,148,246,0.15)', border: '1px solid rgba(183,148,246,0.3)' }}
            >
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div>User Profile</div>
              <div className="font-mono text-[10px] text-muted-foreground font-normal mt-0.5 break-all">
                {addr}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
          {/* Points headline */}
          {userPoints && <PointsTiles pts={userPoints} />}

          {/* Tabs for all data sections — only render tabs that have data */}
          {(hasActivity || hasTrades || hasSocial || hasBattles) ? (
            <Tabs defaultValue={defaultTab}>
              <TabsList className="glass-card w-full flex-wrap h-auto gap-1 p-1">
                {hasActivity && (
                  <TabsTrigger value="activity" className="text-xs gap-1">
                    <Activity className="h-3 w-3" />
                    Activity ({activity.length})
                  </TabsTrigger>
                )}
                {hasTrades && (
                  <TabsTrigger value="trades" className="text-xs gap-1">
                    <TrendingUp className="h-3 w-3" />
                    Trades ({trades.length})
                  </TabsTrigger>
                )}
                {hasSocial && (
                  <TabsTrigger value="social" className="text-xs gap-1">
                    <Twitter className="h-3 w-3" />
                    Social
                  </TabsTrigger>
                )}
                {hasBattles && (
                  <TabsTrigger value="battles" className="text-xs gap-1">
                    <Swords className="h-3 w-3" />
                    Arena
                  </TabsTrigger>
                )}
              </TabsList>

              {hasActivity && (
                <TabsContent value="activity" className="mt-3">
                  <ActivityLogTab items={activity} />
                </TabsContent>
              )}
              {hasTrades && (
                <TabsContent value="trades" className="mt-3">
                  <TradesTab trades={trades} />
                </TabsContent>
              )}
              {hasSocial && (
                <TabsContent value="social" className="mt-3">
                  <SocialTab
                    socialClaims={socialClaims}
                    pendingClaims={pendingSocial}
                    promotions={promotions}
                  />
                </TabsContent>
              )}
              {hasBattles && (
                <TabsContent value="battles" className="mt-3">
                  <BattlesTab
                    addr={safeAddr}
                    participations={participations}
                    battleClaims={battleClaims}
                    rumbleClaims={rumbleClaimsAll}
                    refunds={battleRefunds}
                  />
                </TabsContent>
              )}
            </Tabs>
          ) : !userPoints ? (
            <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
              <Activity className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">No activity found</p>
              <p className="text-xs">This wallet has no recorded data yet.</p>
            </div>
          ) : null}

          {/* Fund movements note */}
          <div
            className="text-[10px] text-muted-foreground px-2 py-1.5 rounded"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            Note: USDC deposit, withdraw, and SOL transfer history are onchain passthrough actions — the sender address is not stored as a queryable field in those collections. To trace fund movements, search on-chain (Solscan) using the wallet address above.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
