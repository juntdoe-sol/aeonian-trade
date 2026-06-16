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
import OpenPositionShareCard, { OpenPositionOverlayCapture } from './OpenPositionShareCard';
import type { TraderPosition } from './types';

const CARD_BG_COLOR = '#0f1a2e';
// Default share-card text color. Previously user-adjustable via a "Text Color"
// picker; that control was removed, so the card always renders with this default.
const CARD_FONT_COLOR = '#ffffff';

interface OpenPositionShareModalProps {
  open: boolean;
  onClose: () => void;
  position: TraderPosition | null;
  /**
   * Live mark price for the position's market (e.g. from candles on the trade
   * page). Used as a fallback when the position snapshot doesn't carry a mark
   * price (e.g. newly-closed position or stale polling tick).
   */
  liveMark?: number;
}

export function OpenPositionShareModal({ open, onClose, position, liveMark }: OpenPositionShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Full-resolution capture node (portalled outside the scaled preview transform).
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pnlMode, setPnlMode] = useState<'$' | '%'>('$');
  const [sharing, setSharing] = useState(false);
  const { user, login } = useAuth();
  const isMobile = useIsMobile();
  const platformLogoUrl = useAppLogo();

  // Snapshot the position data at the moment the modal opens so that live polling
  // updates to the underlying position data do NOT re-render the card while the
  // user is customizing and preparing to share/download.
  const [frozenPosition, setFrozenPosition] = useState<typeof position>(null);
  const prevOpenRef = useRef(false);

  // X/Twitter profile — fetched once on open, frozen for the session so the
  // card does not change while the user customizes or exports.
  const [xUsername, setXUsername] = useState<string | undefined>(undefined);
  const [xAvatarDataUrl, setXAvatarDataUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Capture snapshot on false→true transition only (i.e. each fresh open).
    if (open && !prevOpenRef.current && position) {
      // Resolve mark price: prefer the position's own markPrice, fall back to the
      // live candle price fed in from the parent. This handles the case where a
      // just-closed position (or a stale polling tick) leaves markPrice undefined/0.
      const resolvedMark = (position.markPrice && position.markPrice > 0)
        ? position.markPrice
        : (liveMark && liveMark > 0 ? liveMark : position.markPrice);
      setFrozenPosition({ ...position, markPrice: resolvedMark });

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
    // Clear the snapshot when the modal closes so the next open always gets fresh data.
    if (!open && prevOpenRef.current) {
      setFrozenPosition(null);
      setXUsername(undefined);
      setXAvatarDataUrl(undefined);
    }
    prevOpenRef.current = open;
  }, [open, position, user?.address, liveMark]);

  // Pre-fetch the hardcoded share-card background and platform logo as data URLs
  // so html-to-image can embed them without cross-origin taint issues (remote S3
  // URLs render in the preview but are silently dropped from the PNG export).
  const [bgDataUrl, setBgDataUrl] = useState<string | undefined>(undefined);
  const [platformLogoDataUrl, setPlatformLogoDataUrl] = useState<string | undefined>(undefined);

  // Resolve the shared share-card background ONCE per session via the module-level
  // cache (getShareCardBgDataUrl). The empty dependency array means this runs only
  // when the modal first mounts and is NOT re-triggered when live position numbers
  // tick — the resolved data URL is held in stable state and never reset on data
  // updates, so the rendered card background never re-fetches or flickers.
  useEffect(() => {
    let cancelled = false;
    getShareCardBgDataUrl()
      .then((dataUrl) => { if (!cancelled) setBgDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setBgDataUrl(SHARE_CARD_BG_URL); }); // fall back to raw URL for on-screen preview
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!platformLogoUrl) { setPlatformLogoDataUrl(undefined); return; }
    let cancelled = false;
    remoteUrlToDataUrl(platformLogoUrl)
      .then((dataUrl) => { if (!cancelled) setPlatformLogoDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setPlatformLogoDataUrl(platformLogoUrl); }); // fall back to raw URL for on-screen preview
    return () => { cancelled = true; };
  }, [platformLogoUrl]);

  // Card design dimensions
  const CARD_W = 800;
  const CARD_H = 400;
  // Scale down more on mobile so the card fits within the viewport
  const scale = isMobile ? 0.42 : 0.55;
  const previewW = Math.round(CARD_W * scale);
  const previewH = Math.round(CARD_H * scale);

  const handleDownload = useCallback(async () => {
    const snap = frozenPosition ?? position;
    if (!overlayRef.current || !snap) return;
    try {
      await preloadShareCardFonts();
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
      link.download = `position-${snap.symbol}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Image downloaded');
    } catch {
      toast.error('Failed to generate image');
    }
  }, [frozenPosition, position]);

  const handleShareX = useCallback(async () => {
    const snap = frozenPosition ?? position;
    if (!overlayRef.current || !snap) return;
    if (!user) {
      toast.error('Connect your wallet to share');
      login();
      return;
    }
    setSharing(true);
    try {
      await preloadShareCardFonts();
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
      const file = new File([blob], `position-${snap.symbol}-${Date.now()}.png`, { type: 'image/png' });
      const fileId = `pos-share-${Date.now()}`;
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
      const snapSide = snap.side ?? 'Long';
      const pnlSign = (snap.pnl ?? 0) >= 0 ? '+' : '';
      const pnlStr = `${pnlSign}$${Math.abs(snap.pnl ?? 0).toFixed(2)}`;
      const tweetText = encodeURIComponent(
        `${snapSide.toUpperCase()} ${snap.symbol} ${pnlStr} unrealized PnL on @aeonian_trade 🔥`
      );
      const publicUrl = encodeURIComponent(fileItem.url);
      const xUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=${publicUrl}`;
      window.open(xUrl, '_blank');
      toast.success('Opening X...');
    } catch (err) {
      console.error('[OpenPositionShareModal] share failed:', err);
      toast.error('Failed to share');
    } finally {
      setSharing(false);
    }
  }, [frozenPosition, position, user, login]);

  // Derive the token symbol for the logo lookup BEFORE the early return so the
  // useEffect hook below can depend on it. Use the frozen snapshot when available,
  // otherwise fall back to the live position prop. Safe with optional chaining since
  // position can be null here (we haven't reached the guard yet).
  const snapSymbol = (frozenPosition ?? position)?.symbol ?? '';
  const rawTokenLogoUrl: string | undefined =
    snapSymbol
      ? (getTokenLogoUrl(snapSymbol) ?? getFallbackLogoUrl(snapSymbol))
      : undefined;

  // Pre-fetch the token logo as a data URL so html-to-image can embed it without
  // cross-origin taint (remote CoinGecko/GitHub URLs are silently dropped in SVG
  // foreignObject on Safari and custom domains). On failure render the placeholder
  // rather than a raw remote URL (which would make capture fail).
  const [tokenLogoDataUrl, setTokenLogoDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!rawTokenLogoUrl) { setTokenLogoDataUrl(undefined); return; }
    // Skip proxy for data: URIs (inline SVGs — already embedded, no fetch needed)
    if (rawTokenLogoUrl.startsWith('data:')) { setTokenLogoDataUrl(rawTokenLogoUrl); return; }
    let cancelled = false;
    remoteUrlToDataUrl(rawTokenLogoUrl)
      .then((dataUrl) => { if (!cancelled) setTokenLogoDataUrl(dataUrl); })
      .catch(() => {
        // Do NOT fall back to the raw remote URL — html-to-image will fail to capture
        // cross-origin images and throw "Failed to generate image". Setting undefined
        // causes OpenPositionShareCard to render the fallback placeholder instead.
        if (!cancelled) setTokenLogoDataUrl(undefined);
      });
    return () => { cancelled = true; };
  }, [rawTokenLogoUrl]);

  // Use frozenPosition (snapshot at open time) for all card rendering.
  // Fall back to the live position prop only as an initial display guard — never for card data.
  if (!position) return null;
  const snap = frozenPosition ?? position;

  const side = (snap.side?.charAt(0).toUpperCase() + (snap.side?.slice(1) ?? '')) as 'Long' | 'Short';

  // For the on-screen preview, use the data URL when ready; fall back to raw URL
  // so the preview shows the logo while the conversion is in-flight.
  // For the hidden overlay capture node (html-to-image), use ONLY the data URL —
  // a raw cross-origin URL would cause capture to fail.
  const logoUrl = tokenLogoDataUrl ?? rawTokenLogoUrl; // preview (browser-rendered, ok with cross-origin)
  const logoUrlForCapture = tokenLogoDataUrl; // capture-safe: data URL only, undefined if not ready

  // Hardcoded share-card background (pre-fetched as a data URL for capture compatibility).
  const effectiveBg = bgDataUrl;

  const isBusy = sharing;

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
        <OpenPositionOverlayCapture
          overlayRef={overlayRef}
          market={snap.symbol ?? ''}
          side={side}
          entryPrice={snap.entryPrice ?? 0}
          markPrice={snap.markPrice ?? 0}
          size={snap.size ?? 0}
          unrealizedPnl={snap.pnl ?? 0}
          leverage={snap.leverage ?? undefined}
          liquidationPrice={snap.liquidationPrice ?? undefined}
          fontColor={CARD_FONT_COLOR}
          logoUrl={logoUrlForCapture}
          platformLogoUrl={platformLogoDataUrl ?? undefined}
          bgImage={effectiveBg}
          bgColor={CARD_BG_COLOR}
          pnlMode={pnlMode}
          xAvatarDataUrl={xAvatarDataUrl}
          xUsername={xUsername}
        />,
        document.body,
      )}

      <DialogContent className="glass-dialog max-w-2xl gap-0 p-0 overflow-hidden w-[calc(100vw-2rem)] sm:w-auto">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share Position
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
                <OpenPositionShareCard
                  ref={cardRef}
                  market={snap.symbol ?? ''}
                  side={side}
                  entryPrice={snap.entryPrice ?? 0}
                  markPrice={snap.markPrice ?? 0}
                  size={snap.size ?? 0}
                  unrealizedPnl={snap.pnl ?? 0}
                  leverage={snap.leverage ?? undefined}
                  liquidationPrice={snap.liquidationPrice ?? undefined}
                  bgColor={CARD_BG_COLOR}
                  fontColor={CARD_FONT_COLOR}
                  logoUrl={logoUrl ?? undefined}
                  platformLogoUrl={platformLogoDataUrl ?? undefined}
                  bgImage={effectiveBg}
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
              disabled={isBusy}
              className="gap-2 flex-1 min-w-[120px]"
            >
              {sharing ? (
                <span className="animate-pulse">Sharing...</span>
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
              disabled={isBusy}
              className="gap-2 glass-button"
            >
              <Download className="h-4 w-4" />
              Download PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OpenPositionShareModal;
