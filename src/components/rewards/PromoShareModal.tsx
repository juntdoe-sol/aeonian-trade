import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
import { preloadShareCardFonts } from '@/utils/share-card-fonts';
import { remoteUrlToDataUrl, SHARE_CARD_BG_URL } from '@/utils/share-card-image';
import { Download, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppLogo } from '@/hooks/use-app-logo';
import PromoShareCard from './PromoShareCard';

interface PromoShareModalProps {
  open: boolean;
  onClose: () => void;
}

export function PromoShareModal({ open, onClose }: PromoShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Full-resolution capture node (portalled outside the scaled preview transform).
  // html-to-image captures THIS node so the admin background — baked in as a data
  // URL — reliably embeds in the downloaded PNG on mobile Safari.
  const captureRef = useRef<HTMLDivElement>(null);
  const logoUrl = useAppLogo();
  // Hardcoded Aeonian-branded share-card background (replaces the former
  // admin-uploadable background). Pre-fetched to a data URL below for capture.
  const backgroundUrl = SHARE_CARD_BG_URL;

  // Pre-fetch admin background and platform logo as data URLs so html-to-image
  // can embed them without cross-origin taint issues (Safari / mobile).
  //
  // We track TWO values for the background:
  //   - bgPreviewUrl: data URL when available, else the raw URL (on-screen <img>/CSS
  //     background works cross-origin, so the preview always shows something).
  //   - bgCaptureUrl: data URL ONLY (undefined on failure). A raw cross-origin URL
  //     handed to the captured node renders in the preview but is silently dropped
  //     from the html-to-image PNG on mobile — which was the download bug. Keeping
  //     capture strictly to a baked-in data URL guarantees the background embeds.
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | undefined>(undefined);
  const [bgCaptureUrl, setBgCaptureUrl] = useState<string | undefined>(undefined);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | undefined>(undefined);
  const [logoCaptureUrl, setLogoCaptureUrl] = useState<string | undefined>(undefined);

  // Hold the latest resolved capture-safe data URL in a ref so the download
  // handler can read it synchronously (state may lag a tick behind, and the
  // user can click Download before the async prefetch effect has committed
  // bgCaptureUrl to state — which previously left the exported PNG with no
  // background even though the preview showed it via the raw-URL fallback).
  const bgCaptureUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!backgroundUrl) { setBgPreviewUrl(undefined); setBgCaptureUrl(undefined); bgCaptureUrlRef.current = undefined; return; }
    if (backgroundUrl.startsWith('data:')) { setBgPreviewUrl(backgroundUrl); setBgCaptureUrl(backgroundUrl); bgCaptureUrlRef.current = backgroundUrl; return; }
    let cancelled = false;
    remoteUrlToDataUrl(backgroundUrl)
      .then((dataUrl) => { if (!cancelled) { setBgPreviewUrl(dataUrl); setBgCaptureUrl(dataUrl); bgCaptureUrlRef.current = dataUrl; } })
      .catch(() => {
        if (cancelled) return;
        setBgPreviewUrl(backgroundUrl); // raw URL is fine for on-screen preview
        setBgCaptureUrl(undefined);     // but NOT for capture — drop it rather than embed a raw URL
        bgCaptureUrlRef.current = undefined;
      });
    return () => { cancelled = true; };
  }, [backgroundUrl]);

  useEffect(() => {
    if (!logoUrl) { setLogoPreviewUrl(undefined); setLogoCaptureUrl(undefined); return; }
    if (logoUrl.startsWith('data:')) { setLogoPreviewUrl(logoUrl); setLogoCaptureUrl(logoUrl); return; }
    let cancelled = false;
    remoteUrlToDataUrl(logoUrl)
      .then((dataUrl) => { if (!cancelled) { setLogoPreviewUrl(dataUrl); setLogoCaptureUrl(dataUrl); } })
      .catch(() => {
        if (cancelled) return;
        setLogoPreviewUrl(logoUrl);   // raw URL is fine for on-screen preview
        setLogoCaptureUrl(undefined); // capture-safe: data URL only
      });
    return () => { cancelled = true; };
  }, [logoUrl]);

  const handleDownload = useCallback(async () => {
    if (!captureRef.current) return;
    try {
      await preloadShareCardFonts();

      // Guarantee the admin background is baked into the captured node as a data
      // URL before we rasterize. The async prefetch effect may not have committed
      // bgCaptureUrl to state yet (or the user clicked Download immediately), in
      // which case the capture node would render with NO background and the
      // exported PNG would be missing the admin bg — even though the preview shows
      // it via the raw-URL fallback. So if we don't yet have a data URL, fetch it
      // on demand here, push it into state, and wait for the capture node to
      // repaint with the inlined data URL before calling toPng.
      if (backgroundUrl && !bgCaptureUrlRef.current && !backgroundUrl.startsWith('data:')) {
        try {
          const dataUrl = await remoteUrlToDataUrl(backgroundUrl);
          bgCaptureUrlRef.current = dataUrl;
          setBgCaptureUrl(dataUrl);
          setBgPreviewUrl(dataUrl);
          // Let React commit the new background into the portalled capture node,
          // then wait one more frame for the browser to paint the inlined image.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
        } catch {
          // Proxy fetch failed — proceed with the solid dark underlay (still
          // readable) rather than blocking the download entirely.
        }
      }

      // Capture the full-resolution node (with the data-URL background baked in),
      // NOT the scaled/transformed preview. Neutralize any inherited transform/offset
      // so the 1200×675 node renders cleanly into the SVG foreignObject.
      const dataUrl = await toPng(captureRef.current, {
        cacheBust: true,
        pixelRatio: 1.5,
        width: 1200,
        height: 675,
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
      link.download = `aeonian-promo-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Image downloaded');
    } catch {
      toast.error('Failed to generate image');
    }
  }, [backgroundUrl]);

  const handlePostOnX = useCallback(() => {
    const xUrl = `https://twitter.com/intent/tweet?text=Check+out+%40Aeonian_Arena+%F0%9F%94%A5+Trade+perps+%26+earn+points%21`;
    window.open(xUrl, '_blank');
  }, []);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/*
        Full-resolution capture node — portalled to document.body so it escapes the
        DialogContent's transform + backdrop-filter containing block. Rendered at its
        natural 1200×675 size with the admin background baked in as a data URL. This is
        the node html-to-image captures (not the scaled preview), guaranteeing the
        background embeds in the downloaded PNG on mobile.

        Zero-size overflow:hidden fixed wrapper keeps the child invisible on the live
        page while preserving its position at the origin inside the SVG viewBox.
      */}
      {open && createPortal(
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            overflow: 'hidden',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: -1,
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 0 }}>
            <PromoShareCard
              ref={captureRef}
              logoUrl={logoCaptureUrl}
              backgroundUrl={bgCaptureUrl}
            />
          </div>
        </div>,
        document.body,
      )}

      <DialogContent className="glass-dialog max-w-2xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share AEONIAN
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-5 space-y-5">
          {/* Live preview — fixed-size card scaled down to fit container */}
          <div
            className="w-full overflow-hidden rounded-lg"
            style={{ paddingTop: 'calc(56.25% * 0.45)' /* 16:9 * scale */ , position: 'relative' }}
          >
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              <div
                style={{
                  transform: 'scale(0.45)',
                  transformOrigin: 'top center',
                  width: '1200px',
                  height: '675px',
                  flexShrink: 0,
                }}
              >
                <PromoShareCard
                  ref={cardRef}
                  logoUrl={logoPreviewUrl ?? undefined}
                  backgroundUrl={bgPreviewUrl ?? undefined}
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button
              onClick={handleDownload}
              className="gap-2 w-full"
            >
              <Download className="h-4 w-4" />
              Download Card
            </Button>
            <Button
              variant="outline"
              onClick={handlePostOnX}
              className="gap-2 w-full glass-button"
            >
              <Share2 className="h-4 w-4" />
              Post on X
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PromoShareModal;
