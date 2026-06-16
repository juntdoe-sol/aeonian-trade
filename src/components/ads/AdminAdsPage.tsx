import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyAds, setAds, updateAds, deleteAds } from '@/lib/collections/ads';
import type { AdsResponse } from '@/lib/collections/ads';
import { uploadAdminFiles, getAdminFiles } from '@/lib/collections/adminFiles';
import { ADMIN_ADDRESS } from '@/lib/constants';
import { Time } from '@/lib/db-client';
import { useAuth } from '@pooflabs/web';
import {
  AlertTriangle,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Video,
  Eye,
  EyeOff,
  Megaphone,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

// ─── Create Form ──────────────────────────────────────────────────────────────

function CreateAdForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      toast.error('Only image or video files are allowed');
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB');
      return;
    }

    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!file) { toast.error('Please select an image or video'); return; }

    setSubmitting(true);
    try {
      const fileId = `ad-${crypto.randomUUID()}`;
      const uploaded = await uploadAdminFiles(fileId, file);
      if (!uploaded) { toast.error('File upload failed'); return; }

      const fileItem = await getAdminFiles(fileId);
      if (!fileItem?.url) { toast.error('Could not retrieve file URL after upload'); return; }

      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      const adId = crypto.randomUUID();

      const ok = await setAds(adId, {
        title: title.trim(),
        description: description.trim(),
        mediaUrl: fileItem.url,
        mediaType,
        active: true,
        createdAt: Time.Now,
        ...(linkUrl.trim() ? { linkUrl: linkUrl.trim() } : {}),
      });

      if (ok) {
        toast.success('Ad created and published');
        setTitle('');
        setDescription('');
        setLinkUrl('');
        setFile(null);
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        onCreated();
      } else {
        toast.error('Failed to save ad — permission denied?');
      }
    } catch {
      toast.error('Unexpected error creating ad');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      {/* Title */}
      <div className='space-y-1.5'>
        <label className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
          Title <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input
          type='text'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='Ad headline...'
          maxLength={80}
          className='glass-input w-full px-3 py-2 rounded-lg text-sm outline-none text-white'
        />
      </div>

      {/* Description */}
      <div className='space-y-1.5'>
        <label className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
          Short Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder='Brief description (optional)...'
          maxLength={160}
          rows={2}
          className='glass-input w-full px-3 py-2 rounded-lg text-sm outline-none resize-none text-white'
        />
      </div>

      {/* Link URL */}
      <div className='space-y-1.5'>
        <label className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
          Link URL <span style={{ color: '#888' }}>(optional)</span>
        </label>
        <input
          type='url'
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder='https://...'
          maxLength={2048}
          className='glass-input w-full px-3 py-2 rounded-lg text-sm outline-none text-white'
        />
        <p className='text-[10px]' style={{ color: '#555' }}>
          When set, clicking the carousel slide will open this URL in a new tab.
        </p>
      </div>

      {/* File upload */}
      <div className='space-y-1.5'>
        <label className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
          Media (image or video) <span style={{ color: '#EF4444' }}>*</span>
        </label>

        {preview && file ? (
          <div className='relative rounded-xl overflow-hidden' style={{ aspectRatio: '16/7', background: '#0d0d12' }}>
            {file.type.startsWith('video/') ? (
              <video src={preview} muted loop autoPlay playsInline className='w-full h-full object-cover' />
            ) : (
              <img src={preview} alt='Preview' className='w-full h-full object-cover' />
            )}
            <button
              type='button'
              onClick={() => { setFile(null); setPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              className='absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-full'
              style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <Trash2 size={12} className='text-white' />
            </button>
            <div className='absolute bottom-2 left-2 flex items-center gap-1.5'>
              {file.type.startsWith('video/') ? (
                <Video size={12} style={{ color: '#b794f6' }} />
              ) : (
                <ImageIcon size={12} style={{ color: '#b794f6' }} />
              )}
              <span className='text-[10px]' style={{ color: '#b794f6' }}>{file.name}</span>
            </div>
          </div>
        ) : (
          <label
            className='flex flex-col items-center justify-center gap-2 rounded-xl cursor-pointer transition-all hover:brightness-110'
            style={{
              aspectRatio: '16/7',
              background: 'rgba(183,148,246,0.04)',
              border: '2px dashed rgba(183,148,246,0.2)',
            }}
          >
            <Upload size={24} style={{ color: '#b794f6', opacity: 0.6 }} />
            <span className='text-xs text-muted-foreground'>Click to select image or video</span>
            <span className='text-[10px]' style={{ color: '#555' }}>Max 20MB</span>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*,video/*'
              onChange={handleFileChange}
              className='hidden'
            />
          </label>
        )}
      </div>

      <button
        type='submit'
        disabled={submitting || !title.trim() || !file}
        className='w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2'
        style={{ background: 'linear-gradient(135deg, #7c3aed, #b794f6)', color: '#fff' }}
      >
        {submitting ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />}
        {submitting ? 'Publishing...' : 'Publish Ad'}
      </button>
    </form>
  );
}

// ─── Ad Card ──────────────────────────────────────────────────────────────────

function AdCard({ ad }: { ad: AdsResponse }) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleToggle() {
    setToggling(true);
    const ok = await updateAds(ad.id, { active: !ad.active });
    if (ok) {
      toast.success(ad.active ? 'Ad hidden from carousel' : 'Ad now showing in carousel');
    } else {
      toast.error('Failed to update ad');
    }
    setToggling(false);
  }

  async function handleDelete() {
    setDeleting(true);
    const ok = await deleteAds(ad.id);
    if (ok) {
      toast.success('Ad deleted');
    } else {
      toast.error('Failed to delete ad');
    }
    setDeleting(false);
  }

  return (
    <div
      className='rounded-xl overflow-hidden glass-card transition-all'
      style={{ border: ad.active ? '1px solid rgba(183,148,246,0.25)' : '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Media preview */}
      <div className='relative w-full' style={{ aspectRatio: '16/7', background: '#0d0d12' }}>
        {ad.mediaType === 'video' ? (
          <video
            src={ad.mediaUrl}
            muted
            loop
            playsInline
            className='w-full h-full object-cover'
            style={{ opacity: ad.active ? 1 : 0.4 }}
          />
        ) : (
          <img
            src={ad.mediaUrl}
            alt={ad.title}
            className='w-full h-full object-cover'
            style={{ opacity: ad.active ? 1 : 0.4 }}
          />
        )}

        {/* Status badge */}
        <div className='absolute top-2 left-2'>
          <Badge
            className='text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider'
            style={
              ad.active
                ? { background: 'rgba(74,222,128,0.2)', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.35)' }
                : { background: 'rgba(138,138,138,0.2)', color: '#8A8A8A', border: '1px solid rgba(138,138,138,0.3)' }
            }
          >
            {ad.active ? 'Live' : 'Hidden'}
          </Badge>
        </div>

        {/* Media type indicator */}
        <div className='absolute top-2 right-2'>
          {ad.mediaType === 'video' ? (
            <Video size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
          ) : (
            <ImageIcon size={12} style={{ color: 'rgba(255,255,255,0.5)' }} />
          )}
        </div>
      </div>

      {/* Info + controls */}
      <div className='px-3 py-2.5 flex items-start justify-between gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-semibold text-sm text-white truncate'>{ad.title}</p>
          {ad.description && (
            <p className='text-xs text-muted-foreground mt-0.5 line-clamp-1'>{ad.description}</p>
          )}
          {ad.linkUrl && (
            <a
              href={ad.linkUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-1 mt-0.5 hover:underline line-clamp-1'
              style={{ color: '#b794f6', fontSize: '10px' }}
              title={ad.linkUrl}
            >
              <Link2 size={10} />
              <span className='truncate'>{ad.linkUrl}</span>
            </a>
          )}
          <p className='text-[10px] mt-1' style={{ color: '#444' }}>
            {ad.createdAt > 0
              ? new Date(ad.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '—'}
          </p>
        </div>

        <div className='flex items-center gap-1.5 shrink-0'>
          {/* Toggle active */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            className='flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:brightness-125'
            style={{
              background: ad.active ? 'rgba(74,222,128,0.12)' : 'rgba(138,138,138,0.12)',
              border: ad.active ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(138,138,138,0.2)',
              color: ad.active ? '#4ADE80' : '#8A8A8A',
            }}
            title={ad.active ? 'Hide from carousel' : 'Show in carousel'}
          >
            {toggling ? (
              <Loader2 size={13} className='animate-spin' />
            ) : ad.active ? (
              <EyeOff size={13} />
            ) : (
              <Eye size={13} />
            )}
          </button>

          {/* Delete */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={deleting}
                className='flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:brightness-125'
                style={{
                  background: 'rgba(239,68,68,0.10)',
                  border: '1px solid rgba(239,68,68,0.22)',
                  color: '#EF4444',
                }}
                title='Delete ad'
              >
                {deleting ? <Loader2 size={13} className='animate-spin' /> : <Trash2 size={13} />}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Ad?</AlertDialogTitle>
                <AlertDialogDescription>
                  "{ad.title}" will be permanently removed from the carousel. This cannot be undone.
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
        </div>
      </div>
    </div>
  );
}

// ─── Embeddable tab content (used inside AdminDashboard) ──────────────────────

export function AdsTabContent() {
  const { user } = useAuth();
  const { data: allAds, loading: adsLoading } = useRealtimeData<AdsResponse[]>(
    subscribeManyAds,
    !!user && user.address === ADMIN_ADDRESS,
  );

  const ads = [...(allAds ?? [])].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className='space-y-6 max-w-3xl'>
      {/* Create form */}
      <Card className='glass-card'>
        <CardHeader className='pb-4'>
          <CardTitle className='text-sm font-semibold flex items-center gap-2'>
            <Plus className='h-4 w-4 text-primary' />
            Create New Ad
          </CardTitle>
        </CardHeader>
        <CardContent className='pt-0'>
          <CreateAdForm onCreated={() => {}} />
        </CardContent>
      </Card>

      {/* Existing ads */}
      <div>
        <div className='flex items-center gap-2 mb-4'>
          <h2 className='font-semibold text-sm'>All Ads</h2>
          <Badge
            variant='outline'
            className='text-[10px] font-mono'
            style={{ color: '#8A8A8A', borderColor: '#333' }}
          >
            {ads.length}
          </Badge>
        </div>

        {adsLoading ? (
          <div className='flex items-center justify-center py-16 text-muted-foreground'>
            <Loader2 className='h-6 w-6 animate-spin mr-2' />
            <span className='text-sm'>Loading ads...</span>
          </div>
        ) : ads.length === 0 ? (
          <div
            className='flex flex-col items-center py-16 rounded-xl'
            style={{ border: '1px dashed rgba(255,255,255,0.08)' }}
          >
            <Megaphone className='h-10 w-10 mb-3 opacity-20' />
            <p className='text-sm text-muted-foreground font-medium'>No ads yet</p>
            <p className='text-xs text-muted-foreground mt-1'>Create your first ad above</p>
          </div>
        ) : (
          <div className='grid gap-4 sm:grid-cols-2'>
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AdminAdsPage() {
  const { user, loading: authLoading } = useAuth();
  const { data: allAds, loading: adsLoading } = useRealtimeData<AdsResponse[]>(
    subscribeManyAds,
    !!user && user.address === ADMIN_ADDRESS,
  );

  const ads = [...(allAds ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const activeCount = ads.filter((a) => a.active).length;

  // ── Auth gate ──────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className='min-h-screen flex items-center justify-center text-white'>
        <div className='flex flex-col items-center gap-3 text-muted-foreground'>
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
          <p className='text-sm'>Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!user || user.address !== ADMIN_ADDRESS) {
    return (
      <div className='min-h-screen flex items-center justify-center p-4 text-white'>
        <Card className='max-w-sm w-full glass-card' style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
          <CardContent className='pt-8 pb-8 flex flex-col items-center text-center gap-4'>
            <div
              className='h-14 w-14 rounded-full flex items-center justify-center'
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              <AlertTriangle className='h-7 w-7 text-destructive' />
            </div>
            <div>
              <h2 className='text-lg font-bold mb-1'>Access Restricted</h2>
              <p className='text-sm text-muted-foreground'>
                This page is restricted to the project administrator. Connect with the admin wallet to continue.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Admin view ─────────────────────────────────────────────────────────────

  return (
    <div className='min-h-screen pb-16 text-white'>
      {/* Header */}
      <div
        className='glass-header sticky top-0 z-10 border-b'
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className='container mx-auto px-4 py-4 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div
              className='h-9 w-9 rounded-lg flex items-center justify-center'
              style={{ background: 'rgba(183,148,246,0.15)', border: '1px solid rgba(183,148,246,0.3)' }}
            >
              <Megaphone className='h-5 w-5 text-primary' />
            </div>
            <div>
              <div className='flex items-center gap-2'>
                <h1 className='text-lg font-bold leading-none'>Ad Manager</h1>
                <Badge
                  className='text-[10px] px-2 py-0.5 font-bold tracking-widest uppercase'
                  style={{ background: 'rgba(183,148,246,0.15)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.4)' }}
                >
                  Admin
                </Badge>
              </div>
              <p className='text-xs text-muted-foreground mt-0.5'>
                {adsLoading ? '…' : `${ads.length} ads · ${activeCount} live`}
              </p>
            </div>
          </div>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <span
              className='inline-block h-2 w-2 rounded-full animate-pulse'
              style={{ background: '#22c55e' }}
            />
            Live
          </div>
        </div>
      </div>

      <div className='container mx-auto px-4 py-6 space-y-8 max-w-3xl'>
        {/* Create form */}
        <Card className='glass-card'>
          <CardHeader className='pb-4'>
            <CardTitle className='text-sm font-semibold flex items-center gap-2'>
              <Plus className='h-4 w-4 text-primary' />
              Create New Ad
            </CardTitle>
          </CardHeader>
          <CardContent className='pt-0'>
            <CreateAdForm onCreated={() => {}} />
          </CardContent>
        </Card>

        {/* Existing ads */}
        <div>
          <div className='flex items-center gap-2 mb-4'>
            <h2 className='font-semibold text-sm'>All Ads</h2>
            <Badge
              variant='outline'
              className='text-[10px] font-mono'
              style={{ color: '#8A8A8A', borderColor: '#333' }}
            >
              {ads.length}
            </Badge>
          </div>

          {adsLoading ? (
            <div className='flex items-center justify-center py-16 text-muted-foreground'>
              <Loader2 className='h-6 w-6 animate-spin mr-2' />
              <span className='text-sm'>Loading ads...</span>
            </div>
          ) : ads.length === 0 ? (
            <div
              className='flex flex-col items-center py-16 rounded-xl'
              style={{ border: '1px dashed rgba(255,255,255,0.08)' }}
            >
              <Megaphone className='h-10 w-10 mb-3 opacity-20' />
              <p className='text-sm text-muted-foreground font-medium'>No ads yet</p>
              <p className='text-xs text-muted-foreground mt-1'>Create your first ad above</p>
            </div>
          ) : (
            <div className='grid gap-4 sm:grid-cols-2'>
              {ads.map((ad) => (
                <AdCard key={ad.id} ad={ad} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminAdsPage;
