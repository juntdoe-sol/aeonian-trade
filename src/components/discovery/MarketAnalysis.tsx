/**
 * MarketAnalysis — Community market analysis feed in DiscoveryPage Col4.
 * Features: post analysis (title + body + optional image), upvote/downvote,
 * comments, "Tipping — Coming Soon" pill per analysis.
 *
 * Collections used:
 *   - analyses (read/write)
 *   - analysisVotes (read/write/delete)
 *   - analysisComments (read/write)
 */

import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useAuth } from '@pooflabs/web';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useDefaultAvatars } from '@/hooks/use-default-avatars';
import { pickDefaultAvatar } from '@/utils/default-avatar';
import { subscribeAllSocialLinks, type SocialLinksResponse } from '@/lib/collections/socialLinks';
import { Time, Address } from '@/lib/db-client';
import {
  subscribeManyAnalyses,
  setAnalyses,
  deleteAnalyses,
  type AnalysesResponse,
} from '@/lib/collections/analyses';
import {
  subscribeManyAnalysisVotes,
  setAnalysisVotes,
  deleteAnalysisVotes,
  type AnalysisVotesResponse,
} from '@/lib/collections/analysisVotes';
import {
  subscribeManyAnalysisComments,
  setAnalysisComments,
  type AnalysisCommentsResponse,
} from '@/lib/collections/analysisComments';
import { uploadAppFiles, getAppFiles } from '@/lib/collections/appFiles';
import { truncateAddress } from '@/utils/format-address';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Link,
  Lock,
  MessageSquare,
  Plus,
  Upload,
  X,
  BarChart2,
  LogIn,
  Trash2,
} from 'lucide-react';

const BG = '#1a1a1f';
const BORDER = '#2a2a35';
const ACCENT = '#ab9ff2';
const MUTED = '#6b6b7a';
const POS = '#4ADE80';
const NEG = '#FF5252';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTimeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

interface XProfile { username: string; avatar?: string; }

function buildXProfileMap(socialLinks: SocialLinksResponse[]): Map<string, XProfile> {
  const map = new Map<string, XProfile>();
  for (const link of socialLinks) {
    if (link.provider !== 'twitter') continue;
    try {
      const p = JSON.parse(link.profile) as { username?: string; avatar?: string };
      if (p.username) map.set(link.wallet, { username: p.username, avatar: p.avatar });
    } catch {}
  }
  return map;
}

// ─── Author identity ──────────────────────────────────────────────────────────

function AuthorAvatar({
  wallet,
  xProfile,
  defaultAvatarUrl,
  size = 24,
}: {
  wallet: string;
  xProfile?: XProfile;
  defaultAvatarUrl?: string | null;
  size?: number;
}) {
  if (xProfile?.avatar) {
    return (
      <img
        src={xProfile.avatar}
        alt={xProfile.username}
        width={size}
        height={size}
        className='rounded-full object-cover flex-shrink-0'
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  if (defaultAvatarUrl) {
    return (
      <img
        src={defaultAvatarUrl}
        alt={wallet}
        width={size}
        height={size}
        className='rounded-full object-cover flex-shrink-0'
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  const initials = wallet.slice(0, 2).toUpperCase();
  return (
    <div
      className='rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold'
      style={{ width: size, height: size, background: `${ACCENT}20`, color: ACCENT }}
    >
      {initials}
    </div>
  );
}

function AuthorLabel({ wallet, xProfile }: { wallet: string; xProfile?: XProfile }) {
  if (xProfile?.username) {
    return <span className='font-semibold' style={{ color: '#e8e8f0' }}>@{xProfile.username}</span>;
  }
  return <span className='font-medium font-mono' style={{ color: MUTED }}>{truncateAddress(wallet, 4, 4)}</span>;
}

// ─── Comments section ─────────────────────────────────────────────────────────

function CommentsSection({
  analysisId,
  walletAddress,
  xProfileMap,
  defaultAvatarUrls,
}: {
  analysisId: string;
  walletAddress?: string;
  xProfileMap: Map<string, XProfile>;
  defaultAvatarUrls: string[];
}) {
  const { data: comments } = useRealtimeData<AnalysisCommentsResponse[]>(
    subscribeManyAnalysisComments,
    true,
    `analysisId = '${analysisId}'`,
  );
  const sorted = useMemo(
    () => [...(comments ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [comments],
  );

  const [newBody, setNewBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleComment = async () => {
    if (!walletAddress || !newBody.trim()) return;
    setSubmitting(true);
    try {
      const commentId = `${analysisId}_${walletAddress}_${Date.now()}`;
      const ok = await setAnalysisComments(commentId, {
        analysisId,
        author: Address.publicKey(walletAddress),
        body: newBody.trim(),
        createdAt: Time.Now,
      });
      if (ok) {
        setNewBody('');
      } else {
        toast.error('Failed to post comment');
      }
    } catch {
      toast.error('Error posting comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='mt-3 space-y-2'>
      {sorted.map((c) => {
        const xp = xProfileMap.get(c.author);
        const ava = pickDefaultAvatar(c.author, defaultAvatarUrls);
        return (
          <div key={c.id} className='flex items-start gap-2'>
            <AuthorAvatar wallet={c.author} xProfile={xp} defaultAvatarUrl={ava} size={20} />
            <div className='flex-1 min-w-0'>
              <div className='flex items-baseline gap-1.5 flex-wrap'>
                <span className='text-[10px]'>
                  <AuthorLabel wallet={c.author} xProfile={xp} />
                </span>
                <span className='text-[9px]' style={{ color: MUTED }}>{fmtTimeAgo(c.createdAt)}</span>
              </div>
              <div className='text-xs mt-0.5 leading-snug' style={{ color: '#c8c8d8' }}>{c.body}</div>
            </div>
          </div>
        );
      })}

      {walletAddress ? (
        <div className='flex gap-2 mt-2'>
          <input
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
            placeholder='Add a comment...'
            className='flex-1 rounded-lg px-2.5 py-1.5 text-[11px] outline-none'
            style={{ background: '#111116', border: `1px solid ${BORDER}`, color: '#e8e8f0' }}
          />
          <button
            onClick={handleComment}
            disabled={submitting || !newBody.trim()}
            className='px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-opacity'
            style={{ background: ACCENT, color: '#0d0d0d', opacity: submitting || !newBody.trim() ? 0.5 : 1 }}
          >
            Post
          </button>
        </div>
      ) : (
        <div className='text-[10px] mt-1' style={{ color: MUTED }}>Log in to comment</div>
      )}
    </div>
  );
}

// ─── Single analysis card ─────────────────────────────────────────────────────

function AnalysisCard({
  analysis,
  walletAddress,
  xProfileMap,
  defaultAvatarUrls,
  allVotes,
}: {
  analysis: AnalysesResponse;
  walletAddress?: string;
  xProfileMap: Map<string, XProfile>;
  defaultAvatarUrls: string[];
  allVotes: AnalysisVotesResponse[];
}) {
  const [showComments, setShowComments] = useState(false);
  const [voting, setVoting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const analysisVotes = useMemo(
    () => allVotes.filter((v) => v.analysisId === analysis.id),
    [allVotes, analysis.id],
  );

  const score = useMemo(
    () => analysisVotes.reduce((s, v) => s + v.value, 0),
    [analysisVotes],
  );

  const myVote = walletAddress
    ? analysisVotes.find((v) => v.voter === walletAddress)
    : undefined;

  const commentCount = useMemo(
    () => analysisVotes.length, // We'll use votes as proxy to avoid extra sub query; actual comments loaded separately
    [analysisVotes],
  );

  const xp = xProfileMap.get(analysis.author);
  const ava = pickDefaultAvatar(analysis.author, defaultAvatarUrls);
  const isOwn = walletAddress === analysis.author;

  const handleVote = async (value: 1 | -1) => {
    if (!walletAddress) return;
    if (voting) return;
    setVoting(true);
    try {
      const voteId = `${analysis.id}_${walletAddress}`;
      if (myVote?.value === value) {
        // Toggle off — delete vote
        await deleteAnalysisVotes(voteId);
      } else {
        // Set or change vote
        const ok = await setAnalysisVotes(voteId, {
          analysisId: analysis.id,
          voter: Address.publicKey(walletAddress),
          value,
          createdAt: Time.Now,
        });
        if (!ok) toast.error('Failed to vote');
      }
    } finally {
      setVoting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this analysis?')) return;
    setDeleting(true);
    try {
      const ok = await deleteAnalyses(analysis.id);
      if (!ok) toast.error('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const scoreColor = score > 0 ? POS : score < 0 ? NEG : MUTED;

  return (
    <div
      className='rounded-xl overflow-hidden'
      style={{ background: '#111116', border: `1px solid ${BORDER}` }}
    >
      {/* Chart image */}
      {analysis.imageUrl && (
        <div className='w-full overflow-hidden' style={{ maxHeight: 160 }}>
          <img
            src={analysis.imageUrl}
            alt={analysis.title}
            className='w-full object-cover'
            style={{ maxHeight: 160 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      <div className='p-3'>
        {/* Author row */}
        <div className='flex items-center gap-2 mb-2'>
          <AuthorAvatar wallet={analysis.author} xProfile={xp} defaultAvatarUrl={ava} size={22} />
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-1.5 flex-wrap'>
              <span className='text-[10px]'>
                <AuthorLabel wallet={analysis.author} xProfile={xp} />
              </span>
              <span className='text-[9px]' style={{ color: MUTED }}>{fmtTimeAgo(analysis.createdAt)}</span>
            </div>
          </div>
          {/* Tipping coming soon pill */}
          <div
            className='flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold flex-shrink-0'
            style={{ background: '#2a2a35', color: MUTED, border: '1px solid #3a3a45' }}
          >
            <Lock size={8} />
            Tipping
          </div>
          {isOwn && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className='flex items-center justify-center w-5 h-5 rounded transition-colors hover:opacity-80 flex-shrink-0'
              style={{ color: NEG }}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>

        {/* Title */}
        <div className='text-xs font-semibold leading-snug mb-1' style={{ color: '#e8e8f0' }}>
          {analysis.title}
        </div>

        {/* Body */}
        <div className='text-[11px] leading-relaxed line-clamp-3 mb-2' style={{ color: MUTED }}>
          {analysis.body}
        </div>

        {/* Actions row */}
        <div className='flex items-center gap-3 mt-2'>
          {/* Upvote */}
          <button
            onClick={() => handleVote(1)}
            disabled={!walletAddress || voting}
            className='flex items-center gap-1 transition-opacity hover:opacity-80'
            style={{ color: myVote?.value === 1 ? POS : MUTED, opacity: !walletAddress ? 0.5 : 1 }}
          >
            <ChevronUp size={15} />
          </button>

          <span className='text-xs font-bold tabular-nums' style={{ color: scoreColor }}>{score > 0 ? `+${score}` : score}</span>

          {/* Downvote */}
          <button
            onClick={() => handleVote(-1)}
            disabled={!walletAddress || voting}
            className='flex items-center gap-1 transition-opacity hover:opacity-80'
            style={{ color: myVote?.value === -1 ? NEG : MUTED, opacity: !walletAddress ? 0.5 : 1 }}
          >
            <ChevronDown size={15} />
          </button>

          {/* Comments */}
          <button
            onClick={() => setShowComments((v) => !v)}
            className='flex items-center gap-1.5 text-[10px] ml-auto transition-opacity hover:opacity-80'
            style={{ color: showComments ? ACCENT : MUTED }}
          >
            <MessageSquare size={12} />
            Comments
          </button>
        </div>

        {/* Comments section (expandable) */}
        {showComments && (
          <CommentsSection
            analysisId={analysis.id}
            walletAddress={walletAddress}
            xProfileMap={xProfileMap}
            defaultAvatarUrls={defaultAvatarUrls}
          />
        )}
      </div>
    </div>
  );
}

// ─── Compose form ─────────────────────────────────────────────────────────────

function ComposeForm({ walletAddress, onPosted }: { walletAddress: string; onPosted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageMode, setImageMode] = useState<'none' | 'url' | 'upload'>('none');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Only PNG, JPG, WebP, or GIF images allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB');
      return;
    }
    setUploading(true);
    try {
      const fileId = `analysis-img-${Date.now()}`;
      const ok = await uploadAppFiles(fileId, file);
      if (!ok) { toast.error('Upload failed'); return; }
      const item = await getAppFiles(fileId);
      if (!item?.url) { toast.error('Could not retrieve image URL'); return; }
      setImageUrl(item.url);
      toast.success('Chart uploaded');
    } catch {
      toast.error('Upload error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and analysis are required');
      return;
    }
    setSubmitting(true);
    try {
      const analysisId = `analysis-${Date.now()}-${walletAddress.slice(0, 6)}`;
      const ok = await setAnalyses(analysisId, {
        author: Address.publicKey(walletAddress),
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim() || undefined,
        createdAt: Time.Now,
      });
      if (ok) {
        toast.success('Analysis posted');
        setTitle(''); setBody(''); setImageUrl(''); setOpen(false);
        onPosted?.();
      } else {
        toast.error('Failed to post analysis');
      }
    } catch {
      toast.error('Error posting analysis');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className='w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors hover:opacity-80'
        style={{ background: `${ACCENT}18`, border: `1px dashed ${ACCENT}40`, color: ACCENT }}
      >
        <Plus size={13} />
        Post Analysis
      </button>
    );
  }

  return (
    <div className='rounded-xl p-3 space-y-2.5' style={{ background: '#0d0d14', border: `1px solid ${ACCENT}30` }}>
      <div className='flex items-center justify-between'>
        <span className='text-xs font-semibold' style={{ color: ACCENT }}>New Analysis</span>
        <button onClick={() => setOpen(false)}><X size={14} style={{ color: MUTED }} /></button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='Title *'
        className='w-full rounded-lg px-3 py-2 text-xs outline-none'
        style={{ background: '#1a1a1f', border: `1px solid ${BORDER}`, color: '#e8e8f0' }}
      />

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder='Your analysis, thesis, or trade idea... *'
        rows={3}
        className='w-full rounded-lg px-3 py-2 text-xs outline-none resize-none'
        style={{ background: '#1a1a1f', border: `1px solid ${BORDER}`, color: '#e8e8f0' }}
      />

      {/* Image toggle */}
      {imageMode === 'none' ? (
        <div className='flex gap-2'>
          <button
            onClick={() => setImageMode('url')}
            className='flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors'
            style={{ background: 'transparent', color: MUTED, border: `1px solid ${BORDER}` }}
          >
            <Link size={10} /> Add chart URL
          </button>
          <button
            onClick={() => setImageMode('upload')}
            className='flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium transition-colors'
            style={{ background: 'transparent', color: MUTED, border: `1px solid ${BORDER}` }}
          >
            <ImagePlus size={10} /> Upload chart
          </button>
        </div>
      ) : imageMode === 'url' ? (
        <div className='flex gap-2'>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder='Chart image URL'
            className='flex-1 rounded-lg px-3 py-2 text-xs outline-none'
            style={{ background: '#1a1a1f', border: `1px solid ${BORDER}`, color: '#e8e8f0' }}
          />
          <button onClick={() => { setImageMode('none'); setImageUrl(''); }} className='px-2'>
            <X size={12} style={{ color: MUTED }} />
          </button>
        </div>
      ) : (
        <div>
          <input ref={fileInputRef} type='file' accept='image/*' className='hidden' onChange={handleImageUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className='w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs transition-opacity'
            style={{ background: '#1a1a1f', border: `1px dashed ${BORDER}`, color: MUTED, opacity: uploading ? 0.6 : 1 }}
          >
            <Upload size={13} />
            {uploading ? 'Uploading...' : imageUrl ? 'Chart ready' : 'Choose chart image'}
          </button>
          {imageUrl && <div className='text-[10px] mt-1 text-center' style={{ color: POS }}>Chart uploaded</div>}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !title.trim() || !body.trim()}
        className='w-full py-2 rounded-lg text-xs font-semibold transition-opacity'
        style={{ background: ACCENT, color: '#0d0d0d', opacity: submitting || !title.trim() || !body.trim() ? 0.5 : 1 }}
      >
        {submitting ? 'Posting...' : 'Post Analysis'}
      </button>
    </div>
  );
}

// ─── Main MarketAnalysis ──────────────────────────────────────────────────────

export function MarketAnalysis() {
  const { user, login } = useAuth();
  const walletAddress = user?.address;

  const defaultAvatarUrls = useDefaultAvatars();

  const { data: analyses } = useRealtimeData<AnalysesResponse[]>(
    subscribeManyAnalyses,
    true,
  );

  const { data: allVotes } = useRealtimeData<AnalysisVotesResponse[]>(
    subscribeManyAnalysisVotes,
    true,
  );

  const { data: socialLinks } = useRealtimeData<SocialLinksResponse[]>(
    subscribeAllSocialLinks,
    true,
  );

  const xProfileMap = useMemo(
    () => buildXProfileMap(socialLinks ?? []),
    [socialLinks],
  );

  const sorted = useMemo(
    () => [...(analyses ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [analyses],
  );

  return (
    <div
      className='rounded-xl overflow-hidden flex flex-col'
      style={{ background: BG, border: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div
        className='flex items-center justify-between px-4 py-3 border-b flex-shrink-0'
        style={{ borderColor: BORDER }}
      >
        <div className='flex items-center gap-2'>
          <BarChart2 size={14} style={{ color: ACCENT }} />
          <span className='text-sm font-semibold' style={{ color: '#e8e8f0' }}>Market Analysis</span>
        </div>
        {sorted.length > 0 && (
          <span className='text-xs' style={{ color: MUTED }}>{sorted.length}</span>
        )}
      </div>

      <div className='p-3 space-y-3'>
        {/* Compose or log-in prompt */}
        {walletAddress ? (
          <ComposeForm walletAddress={walletAddress} />
        ) : (
          <button
            onClick={() => login()}
            className='w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors hover:opacity-80'
            style={{ background: `${ACCENT}10`, border: `1px solid ${BORDER}`, color: MUTED }}
          >
            <LogIn size={13} />
            Log in to post an analysis
          </button>
        )}

        {/* Analyses */}
        {sorted.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-8 gap-2'>
            <BarChart2 size={22} style={{ color: MUTED }} />
            <div className='text-xs' style={{ color: MUTED }}>No analyses yet — be the first</div>
          </div>
        ) : (
          sorted.map((a) => (
            <AnalysisCard
              key={a.id}
              analysis={a}
              walletAddress={walletAddress}
              xProfileMap={xProfileMap}
              defaultAvatarUrls={defaultAvatarUrls}
              allVotes={allVotes ?? []}
            />
          ))
        )}
      </div>
    </div>
  );
}
