import { useRef, useState, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
import { preloadShareCardFonts } from '@/utils/share-card-fonts';
import { Download, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { uploadAppFiles, getAppFiles } from '@/lib/collections/appFiles';
import { useAppLogo } from '@/hooks/use-app-logo';
import BattleResultShareCard from './BattleResultShareCard';

interface BattleResultShareModalProps {
  open: boolean;
  onClose: () => void;
  winnerHandle: string;
  challengerHandle: string;
  opponentHandle: string;
  challengerPnlPct: number;
  opponentPnlPct: number;
  potUsdc: string;
  battleUrl: string;
}

export function BattleResultShareModal({
  open,
  onClose,
  winnerHandle,
  challengerHandle,
  opponentHandle,
  challengerPnlPct,
  opponentPnlPct,
  potUsdc,
  battleUrl,
}: BattleResultShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const logoUrl = useAppLogo();

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      await preloadShareCardFonts();
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `battle-result-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Image downloaded');
    } catch {
      toast.error('Failed to generate image');
    }
  }, []);

  const handleShareX = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      await preloadShareCardFonts();
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `battle-result-${Date.now()}.png`, { type: 'image/png' });
      const fileId = `battle-share-${Date.now()}`;
      const uploaded = await uploadAppFiles(fileId, file);
      if (!uploaded) {
        toast.error('Upload failed');
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
      const tweetText = encodeURIComponent(
        `${winnerHandle} won a Trading Battle! Final PnL: ${challengerHandle} ${challengerPnlPct >= 0 ? '+' : ''}${challengerPnlPct.toFixed(2)}% vs ${opponentHandle} ${opponentPnlPct >= 0 ? '+' : ''}${opponentPnlPct.toFixed(2)}%. Pot: ${potUsdc} 🔥⚔️`
      );
      const xUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=${publicUrl}`;
      window.open(xUrl, '_blank');
      toast.success('Opening X...');
    } catch {
      toast.error('Failed to share');
    } finally {
      setSharing(false);
    }
  }, [winnerHandle, challengerHandle, opponentHandle, challengerPnlPct, opponentPnlPct, potUsdc]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-dialog max-w-2xl gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share Battle Result
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-5 space-y-5">
          {/* Live preview */}
          <div className="flex justify-center overflow-auto">
            <div
              style={{
                transform: 'scale(0.5)',
                transformOrigin: 'top center',
                width: '800px',
                height: '500px',
              }}
            >
              <BattleResultShareCard
                ref={cardRef}
                winnerHandle={winnerHandle}
                challengerHandle={challengerHandle}
                opponentHandle={opponentHandle}
                challengerPnlPct={challengerPnlPct}
                opponentPnlPct={opponentPnlPct}
                potUsdc={potUsdc}
                logoUrl={logoUrl ?? undefined}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleShareX}
              disabled={sharing}
              className="gap-2 flex-1"
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
              disabled={sharing}
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

export default BattleResultShareModal;
