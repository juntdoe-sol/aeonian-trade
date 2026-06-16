import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import { preloadShareCardFonts } from '@/utils/share-card-fonts';
import { remoteUrlToDataUrl, getShareCardBgDataUrl, SHARE_CARD_BG_URL } from '@/utils/share-card-image';
import { toast } from 'sonner';
import { Download, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { uploadAppFiles, getAppFiles } from '@/lib/collections/appFiles';
import { getSocialLinks } from '@/lib/collections/socialLinks';
import { getTokenLogoUrl, getFallbackLogoUrl } from '@/utils/token-logos';
import { useAuth } from '@pooflabs/web';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppLogo } from '@/hooks/use-app-logo';
import PnlShareCard, { PnlOverlayCapture } from './PnlShareCard';
import type { ClosedTrade } from '@/utils/trade-computations';

interface PnlShareModalProps {
  open: boolean;
  onClose: () => void;
  trade: ClosedTrade | null;
}

const CARD_BG_COLOR = '#1a3a6e';

/** Resolve after two nested requestAnimationFrame ticks so the capture node has
 * repainted with the latest background before html-to-image rasterizes it. */
function waitTwoFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function PnlShareModal({ open, onClose, trade }: PnlShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Full-resolution capture node (portalled outside the scaled preview transform).
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pnlMode, setPnlMode] = useState<'$' | '%'>('$');
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { user, login } = useAuth();
  const isMobile = useIsMobile();
  const platformLogoUrl = useAppLogo();

  // Pre-fetch the dedicated PnL share-card background as a data URL so html-to-image
  // can embed it without cross-origin taint issues (remote S3 URLs are silently
  // dropped from the html-to-image PNG export, though they render in the preview).
  // Uses a module-level cache (getShareCardBgDataUrl) so the fixed bg image is
  // fetched+converted at most once per page session and reused instantly on
  // subsequent opens. The on-screen preview falls back to the raw URL (which the
  // browser renders fine cross-origin) so the background appears immediately.
  const [bgDataUrl, setBgDataUrl] = useState<string | undefined>(undefined);
  // Synchronous mirror of bgDataUrl so the export handlers can read the latest
  // resolved capture-safe data URL without lagging a render behind state.
  const bgCaptureUrlRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getShareCardBgDataUrl()
      .then((dataUrl) => { if (!cancelled) { setBgDataUrl(dataUrl); bgCaptureUrlRef.current = dataUrl; } })
      .catch(() => { /* keep undefined — preview falls back to raw URL below */ });
    return () => { cancelled = true; };
  }, []);
  // Keep the ref in sync with state on every change.
  useEffect(() => { bgCaptureUrlRef.current = bgDataUrl; }, [bgDataUrl]);

  // Guarantee the dedicated PnL background is baked into the captured node as a
  // data URL BEFORE rasterizing. The async prefetch effect may not have committed
  // bgDataUrl to state yet (or the user clicked Download/Share immediately), which
  // would leave the capture node with NO background — the exported PNG would show
  // only the solid fallback color even though the preview shows the bg via the raw
  // URL. So if we don't have a data URL yet, fetch it on demand, push it into state
  // + ref, then wait two animation frames for the capture node to repaint with the
  // inlined data URL. If the fetch fails, resolve anyway and degrade to the dark
  // readable fallback rather than blocking the save.
  const ensureBgCaptureReady = useCallback(async () => {
    if (bgCaptureUrlRef.current) return;
    try {
      const dataUrl = await getShareCardBgDataUrl();
      bgCaptureUrlRef.current = dataUrl;
      setBgDataUrl(dataUrl);
    } catch {
      // Proxy fetch failed — proceed with the solid dark underlay (still readable)
      // rather than blocking the export entirely.
    }
  }, []);

  // Pre-fetch platform logo as a data URL so html-to-image can embed it without
  // cross-origin taint issues (remote URLs are silently dropped on mobile Safari).
  const [platformLogoDataUrl, setPlatformLogoDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!platformLogoUrl) { setPlatformLogoDataUrl(undefined); return; }
    let cancelled = false;
    remoteUrlToDataUrl(platformLogoUrl)
      .then((dataUrl) => { if (!cancelled) setPlatformLogoDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setPlatformLogoDataUrl(platformLogoUrl); }); // fall back to raw URL for on-screen preview
    return () => { cancelled = true; };
  }, [platformLogoUrl]);

  // Snapshot the trade data at the moment the modal opens. Closed trade data
  // comes from fill history (already historical), but we snapshot anyway so that
  // any parent re-renders — e.g. from polling — cannot change what's on the card.
  const [frozenTrade, setFrozenTrade] = useState<typeof trade>(null);
  const prevOpenRef = useRef(false);

  // X/Twitter profile — fetched once on open, frozen for the session so the
  // card does not change while the user customizes or exports.
  const [xUsername, setXUsername] = useState<string | undefined>(undefined);
  const [xAvatarDataUrl, setXAvatarDataUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open && !prevOpenRef.current && trade) {
      setFrozenTrade({ ...trade });

      // Fetch the current user's X profile and pre-convert avatar to a data URL
      // so html-to-image can embed it (remote URLs are silently dropped in capture).
      if (user?.address) {
        const storageKey = `social:${user.address}:twitter`;
        getSocialLinks(storageKey).then(async (link) => {
          if (!link?.profile) return;
          try {
            const parsed = typeof link.profile === 'string' ? JSON.parse(link.profile) : link.profile;
            if (!parsed?.username) return;
            setXUsername(parsed.username);
            if (parsed.avatar) {
              try {
                const dataUrl = await remoteUrlToDataUrl(parsed.avatar);
                setXAvatarDataUrl(dataUrl);
              } catch {
                // avatar fetch failed — username still shows, avatar silently omitted
              }
            }
          } catch {
            // malformed profile JSON — ignore
          }
        });
      }
    }
    if (!open && prevOpenRef.current) {
      setFrozenTrade(null);
      setXUsername(undefined);
      setXAvatarDataUrl(undefined);
    }
    prevOpenRef.current = open;
  }, [open, trade, user?.address]);

  // Card design dimensions
  const CARD_W = 800;
  const CARD_H = 400;
  // Scale down more on mobile so the card fits within the viewport
  const scale = isMobile ? 0.42 : 0.55;
  const previewW = Math.round(CARD_W * scale);
  const previewH = Math.round(CARD_H * scale);

  const handleDownload = useCallback(async () => {
    const snap = frozenTrade ?? trade;
    if (!overlayRef.current || !snap) return;
    setDownloading(true);
    try {
      await preloadShareCardFonts();
      // Guarantee the background data URL is resolved & committed to state BEFORE
      // capture. If the user clicked Download before the prefetch resolved, this
      // awaits it (or kicks off + awaits an inline fetch) so the capture node never
      // rasterizes without the baked-in base64 background.
      await ensureBgCaptureReady();
      // Let the capture node repaint with the baked-in data-URL background
      // before rasterizing (two nested rAFs span a full layout+paint cycle).
      await waitTwoFrames();
      const dataUrl = await toPng(overlayRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        width: 800,
        height: 400,
        style: {
          left: '0px',
          top: '0px',
          margin: '0',
          transform: 'none',
          opacity: '1',
          visibility: 'visible',
        },
      });
      const link = document.createElement('a');
      link.download = `pnl-${snap.symbol}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Image downloaded');
    } catch {
      toast.error('Failed to generate image');
    } finally {
      setDownloading(false);
    }
  }, [frozenTrade, trade, ensureBgCaptureReady]);

  const handleShareX = useCallback(async () => {
    const snap = frozenTrade ?? trade;
    if (!overlayRef.current || !snap) return;
    if (!user) {
      toast.error('Connect your wallet to share');
      login();
      return;
    }
    setSharing(true);
    try {
      await preloadShareCardFonts();
      await ensureBgCaptureReady();
      // Let the capture node repaint with the baked-in data-URL background
      // before rasterizing (two nested rAFs span a full layout+paint cycle).
      await waitTwoFrames();
      const dataUrl = await toPng(overlayRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        width: 800,
        height: 400,
        style: {
          left: '0px',
          top: '0px',
          margin: '0',
          transform: 'none',
          opacity: '1',
          visibility: 'visible',
        },
      });
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `pnl-${snap.symbol}-${Date.now()}.png`, { type: 'image/png' });
      const fileId = `pnl-share-${Date.now()}`;
      const uploaded = await uploadAppFiles(fileId, file);
      if (!uploaded) {
        toast.error('Upload failed — please try again');
        setSharing(false);
        return;
      }
      const fileItem = await getAppFiles(fileId);
      if (!fileItem?.url) {
        toast.error('Could not get file URL');
        setSharing(false);
        return;
      }
      const publicUrl = encodeURIComponent(fileItem.url);
      const tweetText = encodeURIComponent('Check out my trade on Aeonian');
      const xUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=${publicUrl}`;
      window.open(xUrl, '_blank');
      toast.success('Opening X...');
    } catch (err) {
      console.error('[PnlShareModal] share failed:', err);
      toast.error('Failed to share');
    } finally {
      setSharing(false);
    }
  }, [frozenTrade, trade, user, login, ensureBgCaptureReady]);

  // Compute raw logoUrl here (before early return) so the useEffect below can depend on it.
  // symbol can change with frozenTrade; using trade?.symbol is a safe fallback before freeze.
  const rawLogoUrl = getTokenLogoUrl((frozenTrade ?? trade)?.symbol ?? '') ?? ((frozenTrade ?? trade)?.symbol ? getFallbackLogoUrl((frozenTrade ?? trade)!.symbol) : undefined);

  // Pre-fetch token logo as a data URL so html-to-image can embed it without
  // cross-origin taint issues (remote URLs are silently dropped on mobile Safari).
  // Mirrors the OpenPositionShareModal approach: data-URI passthrough, proxy→data-URL
  // conversion, and on failure render the placeholder rather than a raw remote URL.
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!rawLogoUrl) { setLogoDataUrl(undefined); return; }
    // Skip proxy for data: URIs (inline SVGs — already embedded, no fetch needed)
    if (rawLogoUrl.startsWith('data:')) { setLogoDataUrl(rawLogoUrl); return; }
    let cancelled = false;
    remoteUrlToDataUrl(rawLogoUrl)
      .then((dataUrl) => { if (!cancelled) setLogoDataUrl(dataUrl); })
      .catch(() => {
        // Do NOT fall back to the raw remote URL for capture — html-to-image will fail
        // to capture cross-origin images. Setting undefined renders the placeholder instead.
        if (!cancelled) setLogoDataUrl(undefined);
      });
    return () => { cancelled = true; };
  }, [rawLogoUrl]);

  if (!trade) return null;
  const snap = frozenTrade ?? trade;

  // For the on-screen preview, use the data URL when ready; fall back to raw URL
  // so the preview shows the logo while the conversion is in-flight.
  // For the hidden overlay capture node (html-to-image), use ONLY the data URL —
  // a raw cross-origin URL would cause capture to fail.
  const logoUrl = logoDataUrl ?? rawLogoUrl; // preview (browser-rendered, ok with cross-origin)
  const logoUrlForCapture = logoDataUrl; // capture-safe: data URL only, undefined if not ready

  // Hardcoded share-card background. Mirrors the logoUrl/logoUrlForCapture pattern:
  // - Preview: use the data URL once ready, else the raw S3 URL so the background
  //   shows INSTANTLY (the browser renders cross-origin background images fine).
  // - Capture: data URL ONLY — a raw cross-origin URL is silently dropped from the
  //   html-to-image PNG export, so the capture node must wait for the data URL.
  const bgImageForPreview = bgDataUrl ?? SHARE_CARD_BG_URL;
  const bgImageForCapture = bgCaptureUrlRef.current ?? bgDataUrl;

  const pnlPercent = snap.entryPrice > 0
    ? (snap.realizedPnl / (snap.entryPrice * snap.size)) * 100
    : 0;

  // The capture-safe base64 background is ready once the async prefetch has
  // committed it to state. Until then, gate the Download/Share buttons so the
  // user can't fire an html-to-image capture against a node whose bg still
  // points at the raw cross-origin URL (which gets silently dropped from the PNG).
  const bgReady = !!bgDataUrl;
  const isBusy = sharing || downloading;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/*
        Full-resolution capture node — renders the card WITH the effective
        background baked in as a data URL. Portalled to document.body so it
        escapes the DialogContent's transform + backdrop-filter containing block.
        html-to-image captures THIS node (not the scaled preview) so the
        background reliably embeds in the PNG on mobile.
      */}
      {open && createPortal(
        <PnlOverlayCapture
          overlayRef={overlayRef}
          market={snap.symbol}
          side={snap.side}
          entryPrice={snap.entryPrice}
          exitPrice={snap.exitPrice}
          size={snap.size}
          realizedPnl={snap.realizedPnl}
          pnlPercent={pnlPercent}
          logoUrl={logoUrlForCapture}
          platformLogoUrl={platformLogoDataUrl ?? undefined}
          bgImage={bgImageForCapture}
          bgColor={CARD_BG_COLOR}
          pnlMode={pnlMode}
          xAvatarDataUrl={xAvatarDataUrl}
          xUsername={xUsername}
        />,
        document.body,
      )}

      <DialogContent
        className="glass-dialog max-w-2xl gap-0 p-0 overflow-hidden w-[calc(100vw-2rem)] sm:w-auto"
      >
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share PnL
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 sm:px-6 pb-5 space-y-5">
          {/* Live preview — fixed-size card scaled to fit the modal width */}
          <div className="flex justify-center">
            <div
              style={{
                width: `${previewW}px`,
                height: `${previewH}px`,
                position: 'relative',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
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
                <PnlShareCard
                  ref={cardRef}
                  market={snap.symbol}
                  side={snap.side}
                  entryPrice={snap.entryPrice}
                  exitPrice={snap.exitPrice}
                  size={snap.size}
                  realizedPnl={snap.realizedPnl}
                  pnlPercent={pnlPercent}
                  bgColor={CARD_BG_COLOR}
                  logoUrl={logoUrl ?? undefined}
                  platformLogoUrl={platformLogoDataUrl ?? undefined}
                  bgImageDataUrl={bgImageForPreview}
                  pnlMode={pnlMode}
                  xAvatarDataUrl={xAvatarDataUrl}
                  xUsername={xUsername}
                />
              </div>
            </div>
          </div>

          {/* PnL display mode toggle ($ vs %) */}
          <div className="flex items-center gap-4">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Show PnL as
            </label>
            <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setPnlMode('$')}
                className={`px-4 h-8 text-xs font-bold transition-colors ${
                  pnlMode === '$'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                $
              </button>
              <button
                type="button"
                onClick={() => setPnlMode('%')}
                className={`px-4 h-8 text-xs font-bold transition-colors border-l border-border/60 ${
                  pnlMode === '%'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                %
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={handleShareX}
              disabled={isBusy || !bgReady}
              className="gap-2 flex-1 min-w-[120px]"
            >
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
            <Button
              variant="outline"
              onClick={handleDownload}
              disabled={isBusy || !bgReady}
              className="gap-2 glass-button"
            >
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

export default PnlShareModal;
