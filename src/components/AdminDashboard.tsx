import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyPhoenixTrader } from '@/lib/collections/phoenixTrader';
import type { PhoenixTraderResponse } from '@/lib/collections/phoenixTrader';
import { subscribeManyUserPoints } from '@/lib/collections/userPoints';
import type { UserPointsResponse } from '@/lib/collections/userPoints';
import { subscribeManyPhoenixTradeRecord } from '@/lib/collections/phoenixTradeRecord';
import type { PhoenixTradeRecordResponse } from '@/lib/collections/phoenixTradeRecord';
import { subscribeAppSettings } from '@/lib/collections/appSettings';
import type { AppSettingsResponse } from '@/lib/collections/appSettings';
import { subscribeManyPromotionClaims, updatePromotionClaims } from '@/lib/collections/promotionClaims';
import { updatePendingSocialClaims } from '@/lib/collections/pendingSocialClaims';
import type { PromotionClaimsResponse } from '@/lib/collections/promotionClaims';
import { ADMIN_ADDRESS } from '@/lib/constants';
import { useAuth, getIdToken } from '@pooflabs/web';
import { truncateAddress as truncAddr } from '@/utils/format-address';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Shield,
  ShieldCheck,
  Users,
  TrendingUp,
  TrendingDown,
  Activity,
  Copy,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
  BarChart3,
  Clock,
  Image as ImageIcon,
  Upload,
  Twitter,
  MessageSquare,
  Crown,
  Swords,
  Flame,
  X,
  Trash2,
  Megaphone,
  Download,
  Trophy,
  FileText,
} from 'lucide-react';
import { createAuthenticatedApiClient } from '@/lib/api-client';
import { MonthlyPrizePotTab } from '@/components/admin/MonthlyPrizePotTab';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MetricGrid } from '@/components/poof-ui';
import { uploadAppFiles, getAppFiles } from '@/lib/collections/appFiles';
import { setAppSettings } from '@/lib/collections/appSettings';
import { subscribeAllSocialLinks } from '@/lib/collections/socialLinks';
import type { SocialLinksResponse } from '@/lib/collections/socialLinks';
import { setBattles } from '@/lib/collections/battles';
import { deleteBattleWithRelated } from '@/utils/delete-battle';
import { Time } from '@/lib/db-client';
import { Address } from '@/lib/db-client';
import { subscribeManyBattles, type BattlesResponse } from '@/lib/collections/battles';
import { subscribeManyBattleParticipants, type BattleParticipantsResponse } from '@/lib/collections/battleParticipants';
import { subscribeManyPotContributions, type PotContributionsResponse } from '@/lib/collections/potContributions';
import { AdsTabContent } from '@/components/ads/AdminAdsPage';
import { AdminUserProfile } from '@/components/AdminUserProfile';
import { uploadApkFiles, getApkFiles } from '@/lib/collections/apkFiles';
import { subscribeApkRelease, setApkRelease, type ApkReleaseResponse } from '@/lib/collections/apkRelease';
import { APK_RELEASE_ID } from '@/lib/constants';

// ─── Time helpers ───────────────────────────────────────────────────────────

function relativeTime(tsSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - tsSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Wallet display helpers ──────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  return truncAddr(addr);
}

function CopyableWallet({ address }: { address: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      toast.success('Copied');
    });
  };
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 font-mono text-xs hover:text-primary transition-colors group"
          >
            <span>{truncateAddress(address)}</span>
            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="font-mono text-xs">
          {address}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

interface TraderStat {
  address: string;
  orderCount: number;
  longCount: number;
  shortCount: number;
  totalSize: number;
  lastActive: number;
}

function Leaderboard({ orders, onSelectWallet }: { orders: PhoenixTradeRecordResponse[]; onSelectWallet: (addr: string) => void }) {
  const [showAll, setShowAll] = useState(false);

  const stats = useMemo<TraderStat[]>(() => {
    const map = new Map<string, TraderStat>();
    for (const o of orders) {
      const addr = String(o.trader ?? '');
      if (!addr) continue;
      const existing = map.get(addr) ?? {
        address: addr,
        orderCount: 0,
        longCount: 0,
        shortCount: 0,
        totalSize: 0,
        lastActive: 0,
      };
      existing.orderCount += 1;
      if (o.side === 'long') existing.longCount += 1;
      else if (o.side === 'short') existing.shortCount += 1;
      existing.totalSize += typeof o.sizeBaseLots === 'number' ? o.sizeBaseLots : 0;
      const ts = typeof o.createdAt === 'number' ? o.createdAt : (typeof o.tarobase_created_at === 'number' ? o.tarobase_created_at : 0);
      if (ts > existing.lastActive) existing.lastActive = ts;
      map.set(addr, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.orderCount - a.orderCount);
  }, [orders]);

  const visible = showAll ? stats : stats.slice(0, 25);

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground">
        <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">No order data yet</p>
        <p className="text-xs mt-1">Leaderboard populates as traders place orders</p>
      </div>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-center">#</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-center">Long / Short</TableHead>
            <TableHead className="text-right">Total Size</TableHead>
            <TableHead className="text-right">Last Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((s, i) => (
            <TableRow
              key={s.address}
              className="cursor-pointer hover:bg-primary/5 transition-colors"
              onClick={() => onSelectWallet(s.address)}
            >
              <TableCell className="text-center font-bold text-muted-foreground text-xs">
                {i + 1}
              </TableCell>
              <TableCell>
                <CopyableWallet address={s.address} />
              </TableCell>
              <TableCell className="text-right font-mono font-semibold">
                {s.orderCount.toLocaleString()}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex items-center justify-center gap-1">
                  <Badge
                    className="text-[10px] px-1.5 py-0 font-mono"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
                  >
                    {s.longCount}L
                  </Badge>
                  <Badge
                    className="text-[10px] px-1.5 py-0 font-mono"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    {s.shortCount}S
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {s.totalSize.toLocaleString()}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {s.lastActive > 0 ? relativeTime(s.lastActive) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {stats.length > 25 && (
        <div className="flex justify-center mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            className="gap-1.5 text-xs"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Show top 25
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show all {stats.length} traders
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Points Leaderboard ────────────────────────────────────────────────────────

function exportPointsTxt(users: UserPointsResponse[]) {
  const sorted = [...users].sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));
  const snapshotLine = `Snapshot taken: ${new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}`;
  const header = 'rank\taddress\ttotalPoints\ttradingPoints\tbattlePoints\tsocialPoints';
  const rows = sorted.map(
    (u, i) =>
      `${i + 1}\t${u.address}\t${u.totalPoints ?? 0}\t${u.tradingPoints ?? 0}\t${u.battlePoints ?? 0}\t${u.socialPoints ?? 0}`,
  );
  const content = [snapshotLine, '', header, ...rows].join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aeonian-points-${date}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPointsDoc(users: UserPointsResponse[]) {
  const sorted = [...users].sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));
  const date = new Date().toISOString().slice(0, 10);
  const rows = sorted
    .map(
      (u, i) => `
      <tr>
        <td style="padding:6px 10px;text-align:center;font-weight:bold;color:#888">${i + 1}</td>
        <td style="padding:6px 10px;font-family:monospace;font-size:12px">${u.address}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:bold">${(u.totalPoints ?? 0).toLocaleString()}</td>
        <td style="padding:6px 10px;text-align:right">${(u.tradingPoints ?? 0).toLocaleString()}</td>
        <td style="padding:6px 10px;text-align:right">${(u.battlePoints ?? 0).toLocaleString()}</td>
        <td style="padding:6px 10px;text-align:right">${(u.socialPoints ?? 0).toLocaleString()}</td>
      </tr>`,
    )
    .join('');
  const html = `
    <html><head><meta charset="utf-8" /><style>
      body{font-family:Arial,sans-serif;padding:24px}
      h1{font-size:18px;margin-bottom:4px}
      p{font-size:12px;color:#666;margin-bottom:16px}
      table{border-collapse:collapse;width:100%}
      th{background:#f0f0f0;padding:8px 10px;text-align:left;font-size:12px;border-bottom:2px solid #ddd}
      tr:nth-child(even){background:#fafafa}
      td{border-bottom:1px solid #eee;font-size:12px}
    </style></head><body>
    <h1>AEONIAN Points Leaderboard</h1>
    <p style="font-size:13px;font-weight:bold;color:#333;margin-bottom:2px">Snapshot taken: ${new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}</p>
    <p>Export date: ${date} &mdash; ${sorted.length} users</p>
    <table>
      <thead><tr>
        <th style="text-align:center">Rank</th>
        <th>Wallet Address</th>
        <th style="text-align:right">Total Pts</th>
        <th style="text-align:right">Trading</th>
        <th style="text-align:right">Battle</th>
        <th style="text-align:right">Social</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`;
  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aeonian-points-${date}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

function PointsLeaderboard({
  users,
  loading,
  onSelectWallet,
}: {
  users: UserPointsResponse[];
  loading: boolean;
  onSelectWallet: (addr: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(
    () => [...users].sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
    [users],
  );

  const visible = showAll ? sorted : sorted.slice(0, 50);

  const rankLabel = (i: number) => {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return String(i + 1);
  };

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-500" />
          Points Leaderboard
          <Badge variant="outline" className="text-[10px] font-mono">
            {loading ? '…' : `${sorted.length} users`}
          </Badge>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1.5 px-2.5"
              onClick={() => {
                if (sorted.length === 0) { toast.error('No data to export'); return; }
                exportPointsTxt(sorted);
                toast.success('Exported .txt');
              }}
            >
              <Download className="h-3 w-3" />
              .txt
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1.5 px-2.5"
              onClick={() => {
                if (sorted.length === 0) { toast.error('No data to export'); return; }
                exportPointsDoc(sorted);
                toast.success('Exported .doc');
              }}
            >
              <FileText className="h-3 w-3" />
              .doc
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm">Loading points data…</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground">
            <Trophy className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">No points data yet</p>
            <p className="text-xs mt-1">Leaderboard populates as users earn points</p>
          </div>
        ) : (
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right font-semibold">Total Pts</TableHead>
                  <TableHead className="text-right text-[11px]">Trading</TableHead>
                  <TableHead className="text-right text-[11px]">Battle</TableHead>
                  <TableHead className="text-right text-[11px]">Social</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((u, i) => (
                  <TableRow
                    key={u.address}
                    className="cursor-pointer hover:bg-primary/5 transition-colors"
                    onClick={() => onSelectWallet(u.address)}
                  >
                    <TableCell className="text-center font-bold text-muted-foreground text-xs">
                      {rankLabel(i)}
                    </TableCell>
                    <TableCell>
                      <CopyableWallet address={u.address} />
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-primary">
                      {(u.totalPoints ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {(u.tradingPoints ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {(u.battlePoints ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {(u.socialPoints ?? 0).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sorted.length > 50 && (
              <div className="flex justify-center mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1.5 text-muted-foreground"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? (
                    <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5" /> Show all {sorted.length} users</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── All Users list ────────────────────────────────────────────────────────────
// Primary source: userPoints (all users who earned any points: social, trading, battle)
// Supplementary: phoenixTrader (subset who activated a trading account — shown as "Trader: Yes/No")

function WalletList({
  allUsers,
  traders,
  orders,
  onSelectWallet,
  xProfileMap,
}: {
  allUsers: UserPointsResponse[];
  traders: PhoenixTraderResponse[];
  orders: PhoenixTradeRecordResponse[];
  onSelectWallet: (addr: string) => void;
  xProfileMap: Map<string, { username: string; avatar?: string; displayName?: string }>;
}) {
  const [search, setSearch] = useState('');

  // Build a set of addresses that have a phoenixTrader record (registered traders)
  const registeredTraderSet = useMemo(() => {
    const s = new Set<string>();
    for (const t of traders) {
      const addr = String(t.id ?? '');
      if (addr) s.add(addr);
    }
    return s;
  }, [traders]);

  const orderCountByTrader = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const addr = String(o.trader ?? '');
      if (!addr) continue;
      map.set(addr, (map.get(addr) ?? 0) + 1);
    }
    return map;
  }, [orders]);

  // Sort by totalPoints descending so highest earners appear first
  const sorted = useMemo(() => {
    return [...allUsers].sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));
  }, [allUsers]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sorted.filter((u) => !q || String(u.id ?? '').toLowerCase().includes(q)).slice(0, 200);
  }, [sorted, search]);

  if (allUsers.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground">
        <Users className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">No users yet</p>
        <p className="text-xs mt-1">Users appear here after earning any points</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 font-mono text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {allUsers.length} users
        {filtered.length >= 200 && ' (capped at 200)'}
      </p>
      <ScrollArea className="h-[480px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead className="text-right">Total Pts</TableHead>
              <TableHead className="text-center">Trader</TableHead>
              <TableHead className="text-right">Orders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => {
              const addr = String(u.id ?? '');
              const isRegistered = registeredTraderSet.has(addr);
              const xProfile = xProfileMap.get(addr);
              return (
                <TableRow
                  key={addr}
                  className="cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => onSelectWallet(addr)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {xProfile && (
                        xProfile.avatar ? (
                          <img
                            src={xProfile.avatar}
                            alt={xProfile.username}
                            className="w-5 h-5 rounded-full flex-shrink-0 object-cover"
                            style={{ border: '1px solid rgba(183,148,246,0.35)' }}
                          />
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold"
                            style={{ background: 'rgba(183,148,246,0.2)', border: '1px solid rgba(183,148,246,0.35)', color: '#b794f6' }}
                          >
                            {(xProfile.displayName ?? xProfile.username)[0].toUpperCase()}
                          </div>
                        )
                      )}
                      <div className="flex flex-col gap-0.5">
                        <CopyableWallet address={addr} />
                        {xProfile && (
                          <span className="text-[10px] font-medium" style={{ color: '#b794f6' }}>
                            @{xProfile.username}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold" style={{ color: '#b794f6' }}>
                    {(u.totalPoints ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-center">
                    {isRegistered ? (
                      <Badge
                        className="text-[10px] px-1.5 py-0"
                        style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}
                      >
                        Yes
                      </Badge>
                    ) : (
                      <Badge
                        className="text-[10px] px-1.5 py-0"
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'hsl(var(--muted-foreground))', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        No
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {(orderCountByTrader.get(addr) ?? 0).toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({ orders, onSelectWallet }: { orders: PhoenixTradeRecordResponse[]; onSelectWallet: (addr: string) => void }) {
  const recent = useMemo(
    () =>
      [...orders]
        .sort((a, b) => {
          const ta = typeof a.createdAt === 'number' ? a.createdAt : (typeof a.tarobase_created_at === 'number' ? a.tarobase_created_at : 0);
          const tb = typeof b.createdAt === 'number' ? b.createdAt : (typeof b.tarobase_created_at === 'number' ? b.tarobase_created_at : 0);
          return tb - ta;
        })
        .slice(0, 50),
    [orders]
  );

  if (recent.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted-foreground">
        <Activity className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">No activity yet</p>
        <p className="text-xs mt-1">Trades will stream in as they are placed</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[520px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Time</TableHead>
            <TableHead className="w-20">Side</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Leverage</TableHead>
            <TableHead className="text-right">Size (USD)</TableHead>
            <TableHead>Trader</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recent.map((o) => {
            const ts = typeof o.createdAt === 'number' ? o.createdAt : (typeof o.tarobase_created_at === 'number' ? o.tarobase_created_at : 0);
            const isLong = o.side === 'long';
            return (
              <TableRow key={o.id}>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {ts > 0 ? relativeTime(ts) : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    className="text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider"
                    style={
                      isLong
                        ? { background: 'rgba(34,197,94,0.18)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }
                        : { background: 'rgba(239,68,68,0.18)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.35)' }
                    }
                  >
                    {isLong ? (
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" /> Long
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" /> Short
                      </span>
                    )}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs font-semibold">
                  {o.symbol ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {typeof o.leverage === 'number' ? `${o.leverage}×` : '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {typeof o.sizeUsd === 'number' ? `$${o.sizeUsd.toLocaleString()}` : '—'}
                </TableCell>
                <TableCell
                  className="cursor-pointer hover:text-primary transition-colors"
                  onClick={() => { const a = String(o.trader ?? ''); if (a) onSelectWallet(a); }}
                >
                  <CopyableWallet address={String(o.trader ?? '')} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

// ─── Logo Settings ───────────────────────────────────────────────────────────

function LogoSettings() {
  const { data: logoSetting } = useRealtimeData<AppSettingsResponse | null>(
    subscribeAppSettings,
    true,
    'logo'
  );
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only PNG, JPG, and SVG files are allowed');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be under 2MB');
      return;
    }

    setUploading(true);
    try {
      const fileId = `logo-${Date.now()}`;
      const uploaded = await uploadAppFiles(fileId, file);
      if (!uploaded) {
        toast.error('Upload failed');
        return;
      }
      const fileItem = await getAppFiles(fileId);
      if (!fileItem?.url) {
        toast.error('Could not retrieve file URL');
        return;
      }
      const saved = await setAppSettings('logo', {
        value: fileItem.url,
        label: 'App Logo',
        updatedAt: Time.Now,
      });
      if (saved) {
        toast.success('Logo saved successfully');
      } else {
        toast.error('Failed to save logo setting');
      }
    } catch {
      toast.error('Upload error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div
          className="glass-card h-20 w-20 rounded-lg flex items-center justify-center overflow-hidden"
        >
          {logoSetting?.value ? (
            <img
              src={logoSetting.value}
              alt="App logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground opacity-40" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Current Logo</p>
          <p className="text-xs text-muted-foreground">
            {logoSetting?.value ? 'Logo is set' : 'No logo uploaded yet'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.svg"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
          <Button
            variant="outline"
            disabled={uploading}
            className="gap-2 glass-button"
            asChild
          >
            <span>
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? 'Uploading...' : 'Upload New Logo'}
            </span>
          </Button>
        </label>
        <span className="text-xs text-muted-foreground">PNG, JPG, or SVG. Max 2MB.</span>
      </div>
    </div>
  );
}

// ─── Pending Social Claims Tab ────────────────────────────────────────────────

interface PendingClaimItem {
  id: string;
  address: string;
  twitterFollowPending: boolean;
  twitterFollowRequestedAt?: number;
  telegramJoinPending: boolean;
  telegramJoinRequestedAt?: number;
}

function PendingSocialClaimsTab() {
  const { user } = useAuth();
  const [claims, setClaims] = useState<PendingClaimItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<Record<string, boolean>>({});

  const fetchPending = useCallback(async () => {
    const address = user?.address;
    if (!address) return;
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) { toast.error('Auth token missing'); return; }
      const authApi = createAuthenticatedApiClient(token, address);
      const res = await authApi.get<{ claims: PendingClaimItem[] }>('/api/admin/social/pending');
      setClaims(res.claims ?? []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load pending claims');
    } finally {
      setLoading(false);
    }
  }, [user?.address]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  async function handleApprove(walletAddress: string, claimType: 'twitter' | 'telegram') {
    const address = user?.address;
    if (!address) return;
    const key = `${walletAddress}-${claimType}`;
    setApproving((prev) => ({ ...prev, [key]: true }));
    try {
      const token = await getIdToken();
      if (!token) { toast.error('Auth token missing'); return; }
      const authApi = createAuthenticatedApiClient(token, address);
      await authApi.post('/api/admin/social/approve', { walletAddress, claimType });
      toast.success(`Approved ${claimType} claim for ${truncAddr(walletAddress)}`);
      await fetchPending();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to approve claim');
    } finally {
      setApproving((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleReject(walletAddress: string, claimType: 'twitter' | 'telegram') {
    const key = `${walletAddress}-${claimType}`;
    setRejecting((prev) => ({ ...prev, [key]: true }));
    try {
      const update = claimType === 'twitter'
        ? { twitterFollowPending: false }
        : { telegramJoinPending: false };
      const success = await updatePendingSocialClaims(walletAddress, update);
      if (success) {
        toast.success(`Rejected ${claimType} claim for ${truncAddr(walletAddress)}`);
        await fetchPending();
      } else {
        toast.error('Failed to reject claim');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reject claim');
    } finally {
      setRejecting((prev) => ({ ...prev, [key]: false }));
    }
  }

  function requestedAt(item: PendingClaimItem, type: 'twitter' | 'telegram'): number | undefined {
    return type === 'twitter' ? item.twitterFollowRequestedAt : item.telegramJoinRequestedAt;
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Pending Social Claims
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">
            {claims.length} pending
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm">Loading claims...</span>
          </div>
        ) : claims.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground">
            <ShieldCheck className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">No pending social claims</p>
            <p className="text-xs mt-1">All social claims have been reviewed</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wallet</TableHead>
                <TableHead>Twitter</TableHead>
                <TableHead>Telegram</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((claim) => (
                <TableRow key={claim.id}>
                  <TableCell>
                    <CopyableWallet address={claim.address} />
                  </TableCell>
                  <TableCell>
                    {claim.twitterFollowPending ? (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          className="text-[10px] px-1.5 py-0 font-mono"
                          style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
                        >
                          <Clock className="h-3 w-3 mr-0.5" />
                          Pending
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {claim.twitterFollowRequestedAt ? relativeTime(claim.twitterFollowRequestedAt) : '—'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {claim.telegramJoinPending ? (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          className="text-[10px] px-1.5 py-0 font-mono"
                          style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
                        >
                          <Clock className="h-3 w-3 mr-0.5" />
                          Pending
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {claim.telegramJoinRequestedAt ? relativeTime(claim.telegramJoinRequestedAt) : '—'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {claim.twitterFollowPending && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={approving[`${claim.address}-twitter`] || rejecting[`${claim.address}-twitter`]}
                            onClick={() => handleApprove(claim.address, 'twitter')}
                            className="text-[11px] font-semibold h-7 gap-1"
                            style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}
                          >
                            {approving[`${claim.address}-twitter`] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Twitter className="h-3 w-3" />
                            )}
                            Approve X
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={rejecting[`${claim.address}-twitter`] || approving[`${claim.address}-twitter`]}
                            onClick={() => handleReject(claim.address, 'twitter')}
                            className="text-[11px] font-semibold h-7 gap-1"
                            style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
                          >
                            {rejecting[`${claim.address}-twitter`] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                            Reject X
                          </Button>
                        </>
                      )}
                      {claim.telegramJoinPending && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={approving[`${claim.address}-telegram`] || rejecting[`${claim.address}-telegram`]}
                            onClick={() => handleApprove(claim.address, 'telegram')}
                            className="text-[11px] font-semibold h-7 gap-1"
                            style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}
                          >
                            {approving[`${claim.address}-telegram`] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <MessageSquare className="h-3 w-3" />
                            )}
                            Approve Chat
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={rejecting[`${claim.address}-telegram`] || approving[`${claim.address}-telegram`]}
                            onClick={() => handleReject(claim.address, 'telegram')}
                            className="text-[11px] font-semibold h-7 gap-1"
                            style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
                          >
                            {rejecting[`${claim.address}-telegram`] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                            Reject Chat
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Promotions Tab ───────────────────────────────────────────────────────────

function PromotionsTab() {
  const { data: pendingClaims, loading } = useRealtimeData<PromotionClaimsResponse[]>(
    subscribeManyPromotionClaims,
    true,
    `status = "pending"`
  );

  const claims = pendingClaims ?? [];

  async function handleApprove(claimId: string) {
    const success = await updatePromotionClaims(claimId, { status: 'approved', updatedAt: Time.Now });
    if (success) {
      toast.success('Claim approved');
    } else {
      toast.error('Failed to approve claim');
    }
  }

  async function handleReject(claimId: string) {
    const success = await updatePromotionClaims(claimId, { status: 'rejected', updatedAt: Time.Now });
    if (success) {
      toast.success('Claim rejected');
    } else {
      toast.error('Failed to reject claim');
    }
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Pending Promotion Claims
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">
            {claims.length} pending
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm">Loading claims...</span>
          </div>
        ) : claims.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground">
            <ShieldCheck className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">No pending promotions</p>
            <p className="text-xs mt-1">All promotion claims have been reviewed</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wallet</TableHead>
                <TableHead>Link</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((claim) => (
                <TableRow key={claim.id}>
                  <TableCell>
                    <CopyableWallet address={claim.userAddress} />
                  </TableCell>
                  <TableCell>
                    <a
                      href={claim.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium hover:underline"
                      style={{ color: '#b794f6' }}
                      title={claim.link}
                    >
                      {claim.link.length > 50 ? claim.link.slice(0, 50) + '...' : claim.link}
                    </a>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApprove(claim.id)}
                        className="text-[11px] font-semibold h-7"
                        style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReject(claim.id)}
                        className="text-[11px] font-semibold h-7"
                        style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Battles Tab ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'rgba(183,148,246,0.15)', color: '#b794f6' },
  active: { bg: 'rgba(74,222,128,0.15)', color: '#4ADE80' },
  ended: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A' },
  claimed: { bg: 'rgba(138,138,138,0.15)', color: '#8A8A8A' },
  cancelled: { bg: 'rgba(255,82,82,0.15)', color: '#FF5252' },
};

function AdminBattleDeleteButton({ battleId }: { battleId: string }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await deleteBattleWithRelated(battleId);
      if (!result.battleDeleted) {
        toast.error('Failed to delete battle');
      } else if (result.relatedError) {
        toast.success('Battle and related records deleted');
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
        <Button
          variant="outline"
          size="sm"
          disabled={deleting}
          className="h-7 w-7 p-0"
          style={{ background: 'rgba(239,68,68,0.10)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
          title="Delete battle"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Battle?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the battle record ({battleId.slice(0, 12)}…) and all related participants, messages, and spectators. This action cannot be undone.
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

function BattlesTab() {
  const { user } = useAuth();
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

  const rumbleBattles = battles.filter((b) => b.type === 'royalrumble');
  const activeRumbles = rumbleBattles.filter((b) => b.status === 'active');
  const pendingRumbles = rumbleBattles.filter((b) => b.status === 'pending');

  // All battles sorted by creation time descending (most recent first)
  const allBattlesSorted = [...battles].sort((a, b) => b.createdAt - a.createdAt);

  const [createOpen, setCreateOpen] = useState(false);
  const [battleSearch, setBattleSearch] = useState('');

  // Create form state
  const [rumbleBetAmount, setRumbleBetAmount] = useState('');
  const [rumbleDuration, setRumbleDuration] = useState(3600);
  const [minParticipants, setMinParticipants] = useState(5);
  const [maxParticipants, setMaxParticipants] = useState(20);
  const [creating, setCreating] = useState(false);

  const DURATION_OPTIONS = [
    { label: '1 hour', value: 3600 },
    { label: '4 hours', value: 14400 },
    { label: '24 hours', value: 86400 },
    { label: '7 days', value: 604800 },
  ];

  function getParticipantCount(battleId: string): number {
    return participants.filter((p) => p.battleId === battleId).length;
  }

  function getPotMicro(battleId: string, betAmountMicro: number): number {
    const fighterCount = getParticipantCount(battleId);
    const contributionSum = contributions
      .filter((c) => c.battleId === battleId)
      .reduce((sum, c) => sum + c.amountMicro, 0);
    return fighterCount * betAmountMicro + contributionSum;
  }

  function timeRemaining(endTime: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = endTime - now;
    if (diff <= 0) return 'Ended';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m`;
  }

  async function handleCreateRumble(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.address) return;

    const bet = parseFloat(rumbleBetAmount);
    if (!bet || bet < 1) {
      toast.error('Minimum entry fee is 1 USDC');
      return;
    }

    setCreating(true);
    try {
      const betAmountMicro = Math.round(bet * 1_000_000);
      const battleId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      const ok = await setBattles(battleId, {
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

      if (ok) {
        toast.success('Royal Rumble created!');
        setRumbleBetAmount('');
        setCreateOpen(false);
      } else {
        toast.error('Failed to create rumble');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  const filteredBattles = useMemo(() => {
    const q = battleSearch.toLowerCase().trim();
    if (!q) return allBattlesSorted;
    return allBattlesSorted.filter(
      (b) =>
        b.id.toLowerCase().includes(q) ||
        b.status.toLowerCase().includes(q) ||
        (b.type ?? '1v1').toLowerCase().includes(q) ||
        b.challenger.toLowerCase().includes(q) ||
        (b.opponent ?? '').toLowerCase().includes(q),
    );
  }, [allBattlesSorted, battleSearch]);

  return (
    <div className="space-y-6">
      {/* All Battles — full list with delete */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            All Arena Matches
            <Badge variant="outline" className="ml-auto text-[10px] font-mono">
              {battles.length} total
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by ID, status, type, wallet..."
              value={battleSearch}
              onChange={(e) => setBattleSearch(e.target.value)}
              className="pl-9 font-mono text-xs"
            />
          </div>
          {battles.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <Swords className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">No Arena matches yet</p>
            </div>
          ) : (
            <ScrollArea className="h-[480px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Battle ID</TableHead>
                    <TableHead className="w-20">Type</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead>Challenger</TableHead>
                    <TableHead className="text-right">Bet</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="w-12 text-center">Del</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBattles.map((b) => {
                    const style = STATUS_STYLES[b.status] ?? STATUS_STYLES.pending;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.id.slice(0, 12)}…</TableCell>
                        <TableCell>
                          <Badge
                            className="text-[10px] px-1.5 py-0"
                            style={
                              b.type === 'royalrumble'
                                ? { background: 'rgba(255,215,0,0.15)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)' }
                                : { background: 'rgba(183,148,246,0.12)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.25)' }
                            }
                          >
                            {b.type === 'royalrumble' ? 'Rumble' : '1v1'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className="text-[10px] px-1.5 py-0 capitalize"
                            style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}44` }}
                          >
                            {b.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <CopyableWallet address={b.challenger} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          ${(b.betAmountMicro / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {b.createdAt > 0 ? relativeTime(b.createdAt) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          <AdminBattleDeleteButton battleId={b.id} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Create Rumble */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Crown className="h-4 w-4" style={{ color: '#FFD700' }} />
            Create Royal Rumble
            <button
              onClick={() => setCreateOpen((v) => !v)}
              className="ml-auto text-xs font-bold px-2.5 py-1 rounded-lg transition-all hover:brightness-110"
              style={{ background: 'rgba(255,215,0,0.12)', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)' }}
            >
              {createOpen ? 'Close' : 'Open Form'}
            </button>
          </CardTitle>
        </CardHeader>
        {createOpen && (
          <CardContent className="pt-0">
            <form onSubmit={handleCreateRumble} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entry Fee (USDC)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={rumbleBetAmount}
                    onChange={(e) => setRumbleBetAmount(e.target.value)}
                    placeholder="10"
                    className="glass-input w-full px-3 py-2 rounded-lg text-sm outline-none tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duration</label>
                  <select
                    value={rumbleDuration}
                    onChange={(e) => setRumbleDuration(Number(e.target.value))}
                    className="glass-input w-full appearance-none px-3 py-2 rounded-lg text-sm outline-none"
                  >
                    {DURATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Min Fighters ({minParticipants})</label>
                  <input
                    type="range"
                    min={3}
                    max={10}
                    value={minParticipants}
                    onChange={(e) => setMinParticipants(Number(e.target.value))}
                    className="w-full accent-violet-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Max Fighters ({maxParticipants})</label>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    value={maxParticipants}
                    onChange={(e) => setMaxParticipants(Number(e.target.value))}
                    className="w-full accent-violet-400"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={creating || !rumbleBetAmount || parseFloat(rumbleBetAmount) < 1}
                className="w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: '#FFD700', color: '#000' }}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                Create Royal Rumble
              </button>
            </form>
          </CardContent>
        )}
      </Card>

      {/* Active Rumbles */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            Active Royal Rumbles
            <Badge variant="outline" className="ml-auto text-[10px] font-mono">
              {activeRumbles.length} active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {activeRumbles.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <Flame className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">No active rumbles</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Battle ID</TableHead>
                  <TableHead className="text-right">Pot</TableHead>
                  <TableHead className="text-right">Fighters</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Time Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeRumbles.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{b.id.slice(0, 12)}…</span>
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-xs">
                      ${(getPotMicro(b.id, b.betAmountMicro) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {getParticipantCount(b.id)}/{b.maxParticipants ?? 20}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className="text-[10px] px-1.5 py-0"
                        style={{ background: 'rgba(74,222,128,0.15)', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}
                      >
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {timeRemaining(b.endTime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending Rumbles */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Pending Rumbles
            <Badge variant="outline" className="ml-auto text-[10px] font-mono">
              {pendingRumbles.length} pending
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {pendingRumbles.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">No pending rumbles</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Battle ID</TableHead>
                  <TableHead className="text-right">Pot</TableHead>
                  <TableHead className="text-right">Fighters</TableHead>
                  <TableHead className="text-right">Min Needed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRumbles.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{b.id.slice(0, 12)}…</span>
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-xs">
                      ${(getPotMicro(b.id, b.betAmountMicro) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {getParticipantCount(b.id)}/{b.maxParticipants ?? 20}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {b.minParticipants ?? 5}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── APK Releases Tab ─────────────────────────────────────────────────────────

function generateApkFileId(): string {
  return `apk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatApkDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ApkReleasesTab() {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [uploadKey, setUploadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: release } = useRealtimeData<ApkReleaseResponse | null>(
    subscribeApkRelease,
    true,
    APK_RELEASE_ID,
  );

  async function handleUpload() {
    if (!file || !version.trim()) {
      toast.error('Please select an APK file and enter a version number.');
      return;
    }
    setUploading(true);
    setProgress('Uploading APK file…');
    try {
      const fileId = generateApkFileId();
      const uploadOk = await uploadApkFiles(fileId, file);
      if (!uploadOk) {
        toast.error('File upload failed. Check admin permissions.');
        setUploading(false);
        setProgress('');
        return;
      }
      setProgress('Fetching public URL…');
      const fileItem = await getApkFiles(fileId);
      if (!fileItem?.url) {
        toast.error('Could not retrieve file URL after upload.');
        setUploading(false);
        setProgress('');
        return;
      }
      setProgress('Saving release metadata…');
      const saveOk = await setApkRelease(APK_RELEASE_ID, {
        fileUrl: fileItem.url,
        version: version.trim(),
        fileName: file.name,
        updatedAt: Time.Now,
      });
      if (!saveOk) {
        toast.error('Failed to save release metadata. Policy may have rejected the write.');
        setUploading(false);
        setProgress('');
        return;
      }
      toast.success(`Version ${version.trim()} published!`);
      setFile(null);
      setVersion('');
      setProgress('');
      if (fileRef.current) fileRef.current.value = '';
      setUploadKey((k) => k + 1);
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Unexpected error during upload.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current release */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Download className="h-4 w-4 text-green-400" />
            Current Release
          </CardTitle>
        </CardHeader>
        <CardContent>
          {release ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <div>
                  <div className="text-sm font-semibold text-green-400 font-mono">v{release.version}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{release.fileName}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">{formatApkDate(release.updatedAt)}</div>
                  <a
                    href={release.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-400 hover:text-green-300 transition-colors mt-0.5 block"
                  >
                    Download ↗
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No release published yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Upload new release */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" style={{ color: '#b794f6' }} />
            Publish New Build
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div key={uploadKey} className="space-y-4">
            {/* File picker */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-mono">APK File</label>
              <div
                className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(167,139,250,0.3)' }}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={16} className="text-muted-foreground" />
                <span className="text-sm flex-1 truncate font-mono text-xs" style={{ color: file ? '#E5E5E5' : '#4A4A4A' }}>
                  {file ? file.name : 'Click to choose .apk file…'}
                </span>
                {file && <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>}
              </div>
              <input ref={fileRef} type="file" accept=".apk" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>

            {/* Version input */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-mono">Version Number</label>
              <Input
                type="text"
                placeholder="e.g. 1.0.3"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={uploading}
                className="font-mono text-sm"
              />
            </div>

            {/* Progress */}
            {progress && (
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" style={{ color: '#b794f6' }} />
                <span className="text-xs font-mono text-muted-foreground">{progress}</span>
              </div>
            )}

            {/* Publish button */}
            <Button
              onClick={handleUpload}
              disabled={uploading || !file || !version.trim()}
              className="w-full"
              variant="outline"
              style={{
                background: uploading || !file || !version.trim()
                  ? 'rgba(167,139,250,0.08)'
                  : 'linear-gradient(135deg, rgba(167,139,250,0.3) 0%, rgba(124,58,237,0.25) 100%)',
                borderColor: 'rgba(167,139,250,0.3)',
                color: uploading || !file || !version.trim() ? '#4A4A4A' : '#E5E5E5',
              }}
            >
              {uploading ? 'Publishing…' : 'Publish Release'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function AdminDashboard() {
  const { user, login, logout, loading: authLoading } = useAuth();
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  // All users (canonical — anyone who earned any points: social, trading, battle)
  const { data: allUsers, loading: usersLoading } = useRealtimeData<UserPointsResponse[]>(
    subscribeManyUserPoints,
    true
  );

  // Phoenix traders (registered trading accounts — a SUBSET of allUsers)
  const { data: traders } = useRealtimeData<PhoenixTraderResponse[]>(
    subscribeManyPhoenixTrader,
    true
  );

  const { data: orders, loading: ordersLoading } = useRealtimeData<PhoenixTradeRecordResponse[]>(
    subscribeManyPhoenixTradeRecord,
    true
  );

  // Social links — used to show X username/avatar in the wallet list
  const { data: allSocialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true
  );

  const xProfileMap = useMemo(() => {
    const map = new Map<string, { username: string; avatar?: string; displayName?: string }>();
    for (const link of allSocialLinks ?? []) {
      if (link.provider === 'twitter' && link.wallet) {
        try {
          const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
          if (parsed?.username) {
            map.set(String(link.wallet), {
              username: parsed.username,
              avatar: parsed.avatar ?? undefined,
              displayName: parsed.displayName ?? undefined,
            });
          }
        } catch {
          // malformed profile JSON — skip
        }
      }
    }
    return map;
  }, [allSocialLinks]);

  const safeAllUsers = allUsers ?? [];
  const safeTraders = traders ?? [];
  const safeOrders = orders ?? [];

  const totalLongs = useMemo(() => safeOrders.filter((o) => o.side === 'long').length, [safeOrders]);
  const totalShorts = useMemo(() => safeOrders.filter((o) => o.side === 'short').length, [safeOrders]);

  // ── Auth gate ──────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!user || user.address !== ADMIN_ADDRESS) {
    const isWrongAccount = !!user && user.address !== ADMIN_ADDRESS;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-white">
        <Card className="max-w-sm w-full border-destructive/40 glass-card">
          <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-bold mb-1">
                {isWrongAccount ? 'Access Denied' : 'Admin Login'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isWrongAccount
                  ? `Logged in as ${truncateAddress(user.address)} — this account does not have admin access.`
                  : 'This page is restricted to the project administrator. Log in with the admin account to continue.'}
              </p>
            </div>
            {isWrongAccount ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => logout()}
              >
                Log Out
              </Button>
            ) : (
              <Button
                size="sm"
                className="w-full"
                onClick={() => login()}
              >
                <Shield className="h-4 w-4 mr-2" />
                Log In
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Admin view ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen pb-10 text-white">
      {/* Header */}
      <div
        className="glass-header sticky top-0 z-10 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(183,148,246,0.15)', border: '1px solid rgba(183,148,246,0.3)' }}
            >
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold leading-none">Admin Dashboard</h1>
                <Badge
                  className="text-[10px] px-2 py-0.5 font-bold tracking-widest uppercase"
                  style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.4)' }}
                >
                  Admin
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                {truncateAddress(user.address)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full animate-pulse"
                style={{ background: '#22c55e' }}
              />
              Live
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 px-3 border-white/10 hover:border-destructive/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() => logout()}
            >
              Log Out
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-8">
        {/* Stat Cards */}
        <MetricGrid
          columns={4}
          metrics={[
            {
              label: 'Total Users',
              value: usersLoading ? '—' : safeAllUsers.length.toLocaleString(),
              description: `All users with points (${safeTraders.length} registered traders)`,
            },
            {
              label: 'Total Orders',
              value: ordersLoading ? '—' : safeOrders.length.toLocaleString(),
              description: 'All-time order count',
            },
            {
              label: 'Total Longs',
              value: ordersLoading ? '—' : totalLongs.toLocaleString(),
              trend: totalLongs > 0 ? { direction: 'up', value: `${Math.round((totalLongs / Math.max(safeOrders.length, 1)) * 100)}%` } : undefined,
              description: 'Long positions placed',
            },
            {
              label: 'Total Shorts',
              value: ordersLoading ? '—' : totalShorts.toLocaleString(),
              trend: totalShorts > 0 ? { direction: 'down', value: `${Math.round((totalShorts / Math.max(safeOrders.length, 1)) * 100)}%` } : undefined,
              description: 'Short positions placed',
            },
          ]}
        />

        {/* Tabs */}
        <Tabs defaultValue="leaderboard">
          <TabsList className="mb-4 glass-card">
            <TabsTrigger value="leaderboard" className="gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" />
              Leaderboard
            </TabsTrigger>
            <TabsTrigger value="wallets" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" />
              All Users
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5" />
              Activity Feed
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <ImageIcon className="h-3.5 w-3.5" />
              App Branding
            </TabsTrigger>
            <TabsTrigger value="promotions" className="gap-1.5 text-xs">
              <ShieldCheck className="h-3.5 w-3.5" />
              Promotions
            </TabsTrigger>
            <TabsTrigger value="social-claims" className="gap-1.5 text-xs">
              <Twitter className="h-3.5 w-3.5" />
              Social Claims
            </TabsTrigger>
            <TabsTrigger value="battles" className="gap-1.5 text-xs">
              <Swords className="h-3.5 w-3.5" />
              Arena
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-1.5 text-xs">
              <Megaphone className="h-3.5 w-3.5" />
              Ads
            </TabsTrigger>
            <TabsTrigger value="releases" className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              APK Releases
            </TabsTrigger>
            <TabsTrigger value="prize-pot" className="gap-1.5 text-xs">
              <Trophy className="h-3.5 w-3.5" />
              Prize Pot
            </TabsTrigger>
          </TabsList>

          {/* Leaderboard tab */}
          <TabsContent value="leaderboard">
            {/* ── Points Leaderboard ─────────────────────────────────── */}
            <PointsLeaderboard
              users={safeAllUsers}
              loading={usersLoading}
              onSelectWallet={setSelectedWallet}
            />

            {/* ── Top Traders by Activity (existing) ─────────────────── */}
            <Card className="glass-card mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Top Traders by Activity
                  <Badge variant="outline" className="ml-auto text-[10px] font-mono">
                    {safeOrders.length > 0 ? `${Math.min(25, new Set(safeOrders.map((o) => String(o.trader))).size)} shown` : '0'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {ordersLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    <span className="text-sm">Loading trades...</span>
                  </div>
                ) : (
                  <Leaderboard orders={safeOrders} onSelectWallet={setSelectedWallet} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Wallets tab */}
          <TabsContent value="wallets">
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  All Users
                  <Badge variant="outline" className="ml-auto text-[10px] font-mono">
                    {usersLoading ? '…' : safeAllUsers.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {usersLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    <span className="text-sm">Loading wallets...</span>
                  </div>
                ) : (
                  <WalletList allUsers={safeAllUsers} traders={safeTraders} orders={safeOrders} onSelectWallet={setSelectedWallet} xProfileMap={xProfileMap} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Feed tab */}
          <TabsContent value="activity">
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Recent Activity
                  <span className="text-xs text-muted-foreground font-normal">(latest 50 orders)</span>
                  <span
                    className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-green-400"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    Live
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {ordersLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    <span className="text-sm">Loading activity...</span>
                  </div>
                ) : (
                  <ActivityFeed orders={safeOrders} onSelectWallet={setSelectedWallet} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings tab */}
          <TabsContent value="settings">
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  App Branding
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-8">
                <LogoSettings />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Promotions tab */}
          <TabsContent value="promotions">
            <PromotionsTab />
          </TabsContent>

          {/* Social Claims tab */}
          <TabsContent value="social-claims">
            <PendingSocialClaimsTab />
          </TabsContent>

          {/* Battles tab */}
          <TabsContent value="battles">
            <BattlesTab />
          </TabsContent>

          {/* Ads tab */}
          <TabsContent value="ads">
            <AdsTabContent />
          </TabsContent>

          {/* APK Releases tab */}
          <TabsContent value="releases">
            <ApkReleasesTab />
          </TabsContent>

          {/* Monthly Prize Pot tab */}
          <TabsContent value="prize-pot">
            <MonthlyPrizePotTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Per-user profile dialog */}
      <AdminUserProfile
        address={selectedWallet}
        onClose={() => setSelectedWallet(null)}
      />
    </div>
  );
}

export default AdminDashboard;
