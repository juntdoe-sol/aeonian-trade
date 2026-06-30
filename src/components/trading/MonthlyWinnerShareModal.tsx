import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import { preloadShareCardFonts } from '@/utils/share-card-fonts';
import { remoteUrlToDataUrl, getShareCardBgDataUrl, SHARE_CARD_BG_URL } from '@/utils/share-card-image';
import { toast } from 'sonner';
import { Download, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { uploadAppFiles, getAppFiles } from '@/lib/collections/appFiles';
import { getSocialLinks } from '@/lib/collections/socialLinks';
import { useAuth } from '@pooflabs/web';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppLogo } from '@/hooks/use-app-logo';
import { useDefaultAvatars } from '@/hooks/use-default-avatars';
import { pickDefaultAvatar } from '@/utils/default-avatar';
import {
  MonthlyWinnerShareCard,
  MonthlyWinnerOverlayCapture,
  type WinnerTokenLine,
} from './MonthlyWinnerShareCard';

export interface MonthlyWinnerSnapshot {
  rank: number;
  monthLabel: string;
  tokens: WinnerTokenLine[];
}

interface MonthlyWinnerShareModalProps {
  open: boolean;
  onClose: () => void;
  winner: MonthlyWinnerSnapshot | null;
}

const CARD_BG_COLOR = '#1a3a6e';

function waitTwoFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function MonthlyWinnerShareModal({ open, onClose, winner }: MonthlyWinnerShareModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { user, login } = useAuth();
  const isMobile = useIsMobile();
  const platformLogoUrl = useAppLogo();
  const defaultAvatarUrls = useDefaultAvatars();

  // Background data URL (capture-safe), module-cached.
  const [bgDataUrl, setBgDataUrl] = useState<string | undefined>(undefined);
  const bgCaptureUrlRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getShareCardBgDataUrl()
      .then((dataUrl) => { if (!cancelled) { setBgDataUrl(dataUrl); bgCaptureUrlRef.current = dataUrl; } })
      .catch(() => { /* preview falls back to raw URL */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { bgCaptureUrlRef.current = bgDataUrl; }, [bgDataUrl]);

  const ensureBgCaptureReady = useCallback(async () => {
    if (bgCaptureUrlRef.current) return;
    try {
      const dataUrl = await getShareCardBgDataUrl();
      bgCaptureUrlRef.current = dataUrl;
      setBgDataUrl(dataUrl);
    } catch {
      /* degrade to solid bg */
    }
  }, []);

  // Platform logo as data URL.
  const [platformLogoDataUrl, setPlatformLogoDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!platformLogoUrl) { setPlatformLogoDataUrl(undefined); return; }
    let cancelled = false;
    remoteUrlToDataUrl(platformLogoUrl)
      .then((dataUrl) => { if (!cancelled) setPlatformLogoDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setPlatformLogoDataUrl(platformLogoUrl); });
    return () => { cancelled = true; };
  }, [platformLogoUrl]);

  // Snapshot winner data + X profile on open.
  const [frozen, setFrozen] = useState<MonthlyWinnerSnapshot | null>(null);
  const prevOpenRef = useRef(false);
  const [xUsername, setXUsername] = useState<string | undefined>(undefined);
  const [xAvatarDataUrl, setXAvatarDataUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open && !prevOpenRef.current && winner) {
      setFrozen({ ...winner, tokens: winner.tokens.map((t) => ({ ...t })) });
      if (user?.address) {
        const storageKey = `social:${user.address}:twitter`;
        getSocialLinks(storageKey).then(async (link) => {
          if (!link?.profile) {
            // No X profile — fall back to the default avatar pool if available.
            const fallbackUrl = pickDefaultAvatar(user.address, defaultAvatarUrls);
            if (fallbackUrl) {
              try {
                const dataUrl = await remoteUrlToDataUrl(fallbackUrl);
                setXAvatarDataUrl(dataUrl);
              } catch { /* default avatar optional */ }
            }
            return;
          }
          try {
            const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
            if (!parsed?.username) return;
            setXUsername(parsed.username);
            if (parsed.avatar) {
              try {
                const dataUrl = await remoteUrlToDataUrl(parsed.avatar);
                setXAvatarDataUrl(dataUrl);
              } catch { /* avatar optional */ }
            } else {
              // Has X username but no avatar — try default avatar pool.
              const fallbackUrl = pickDefaultAvatar(user.address, defaultAvatarUrls);
              if (fallbackUrl) {
                try {
                  const dataUrl = await remoteUrlToDataUrl(fallbackUrl);
                  setXAvatarDataUrl(dataUrl);
                } catch { /* default avatar optional */ }
              }
            }
          } catch { /* malformed JSON */ }
        });
      }
    }
    if (!open && prevOpenRef.current) {
      setFrozen(null);
      setXUsername(undefined);
      setXAvatarDataUrl(undefined);
    }
    prevOpenRef.current = open;
  }, [open, winner, user?.address, defaultAvatarUrls]);

  const CARD_W = 800;
  const CARD_H = 400;
  const scale = isMobile ? 0.42 : 0.55;
  const previewW = Math.round(CARD_W * scale);
  const previewH = Math.round(CARD_H * scale);

  const capture = useCallback(async (): Promise<string> => {
    await preloadShareCardFonts();
    await ensureBgCaptureReady();
    await waitTwoFrames();
    return toPng(overlayRef.current!, {
      cacheBust: true,
      pixelRatio: 2,
      width: 800,
      height: 400,
      style: { left: '0px', top: '0px', margin: '0', transform: 'none', opacity: '1', visibility: 'visible' },
    });
  }, [ensureBgCaptureReady]);

  const handleDownload = useCallback(async () => {
    const snap = frozen ?? winner;
    if (!overlayRef.current || !snap) return;
    setDownloading(true);
    try {
      const dataUrl = await capture();
      const link = document.createElement('a');
      link.download = `aeonian-winner-${snap.monthLabel.replace(/\s+/g, '-').toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Image downloaded');
    } catch {
      toast.error('Failed to generate image');
    } finally {
      setDownloading(false);
    }
  }, [frozen, winner, capture]);

  const handleShareX = useCallback(async () => {
    const snap = frozen ?? winner;
    if (!overlayRef.current || !snap) return;
    if (!user) {
      toast.error('Log in to share');
      login();
      return;
    }
    setSharing(true);
    try {
      const dataUrl = await capture();
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `aeonian-winner-${Date.now()}.png`, { type: 'image/png' });
      const fileId = `monthly-winner-share-${Date.now()}`;
      const uploaded = await uploadAppFiles(fileId, file);
      if (!uploaded) { toast.error('Upload failed — please try again'); setSharing(false); return; }
      const fileItem = await getAppFiles(fileId);
      if (!fileItem?.url) { toast.error('Could not get file URL'); setSharing(false); return; }
      const publicUrl = encodeURIComponent(fileItem.url);
      const tweetText = encodeURIComponent('I won the monthly trading prize on Aeonian');
      const xUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=${publicUrl}`;
      window.open(xUrl, '_blank');
      toast.success('Opening X...');
    } catch (err) {
      console.error('[MonthlyWinnerShareModal] share failed:', err);
      toast.error('Failed to share');
    } finally {
      setSharing(false);
    }
  }, [frozen, winner, user, login, capture]);

  if (!winner) return null;
  const snap = frozen ?? winner;

  const bgImageForPreview = bgDataUrl ?? SHARE_CARD_BG_URL;
  const bgImageForCapture = bgCaptureUrlRef.current ?? bgDataUrl;
  const bgReady = !!bgDataUrl;
  const isBusy = sharing || downloading;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {open && createPortal(
        <MonthlyWinnerOverlayCapture
          overlayRef={overlayRef}
          rank={snap.rank}
          monthLabel={snap.monthLabel}
          tokens={snap.tokens}
          platformLogoUrl={platformLogoDataUrl ?? undefined}
          bgImage={bgImageForCapture}
          bgColor={CARD_BG_COLOR}
          xAvatarDataUrl={xAvatarDataUrl}
          xUsername={xUsername}
        />,
        document.body,
      )}

      <DialogContent className="glass-dialog max-w-2xl gap-0 p-0 overflow-hidden w-[calc(100vw-2rem)] sm:w-auto">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share your win
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 sm:px-6 pb-5 space-y-5">
          <div className="flex justify-center">
            <div style={{ width: `${previewW}px`, height: `${previewH}px`, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
              <div
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  width: `${CARD_W}px`,
                  height: `${CARD_H}px`,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                }}
              >
                <MonthlyWinnerShareCard
                  rank={snap.rank}
                  monthLabel={snap.monthLabel}
                  tokens={snap.tokens}
                  platformLogoUrl={platformLogoDataUrl ?? undefined}
                  bgImageDataUrl={bgImageForPreview}
                  bgColor={CARD_BG_COLOR}
                  xAvatarDataUrl={xAvatarDataUrl}
                  xUsername={xUsername}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleShareX} disabled={isBusy || !bgReady} className="gap-2 flex-1 min-w-[120px]">
              {sharing ? (
                <span className="animate-pulse">Sharing...</span>
              ) : !bgReady ? (
                <span className="animate-pulse">Preparing...</span>
              ) : (
                <>
                  <Share2 className="h-4 w-4" />
                  Share on X
                </>
              )}
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={isBusy || !bgReady} className="gap-2 glass-button">
              {downloading ? (
                <span className="animate-pulse">Downloading...</span>
              ) : !bgReady ? (
                <span className="animate-pulse">Preparing...</span>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download PNG
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MonthlyWinnerShareModal;
