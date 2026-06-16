import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Link2, Send } from 'lucide-react';
import { useAuth, getIdToken } from '@pooflabs/web';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { subscribePromotionClaims, type PromotionClaimsResponse } from '@/lib/collections/promotionClaims';
import { createAuthenticatedApiClient } from '@/lib/api-client';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { errorToast } from '@/utils/toast-helpers';

const PROMOTION_COOLDOWN_SECS = 24 * 3600;

/** Reference timestamp (Unix seconds) the server measures the cooldown against. */
function getClaimLastWriteSec(claim: PromotionClaimsResponse): number {
  const meta = claim as unknown as { tarobase_updated_at?: number; tarobase_created_at?: number };
  return meta.tarobase_updated_at || meta.tarobase_created_at || claim.updatedAt || claim.createdAt || 0;
}

function formatRemaining(secondsLeft: number): string {
  const totalMinutes = Math.ceil(secondsLeft / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

interface SubmitPromotionModalProps {
  open: boolean;
  onClose: () => void;
  walletAddress?: string;
}

export function SubmitPromotionModal({ open, onClose, walletAddress }: SubmitPromotionModalProps) {
  const { user, login } = useAuth();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const address = walletAddress || user?.address;

  // Live claim for the instant client-side cooldown pre-check (UX only — the
  // backend is now the authority and re-enforces the cooldown + duplicate guard).
  const { data: existingClaim } = useRealtimeData<PromotionClaimsResponse | null>(
    subscribePromotionClaims,
    !!address,
    address as string,
  );

  const handleSubmit = useCallback(async () => {
    if (!address) {
      toast.error('Log in first');
      return;
    }
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error('Please enter a link URL');
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error('URL must start with http:// or https://');
      return;
    }

    // Client-side cooldown pre-check for instant feedback (backend re-checks).
    if (existingClaim) {
      const nowSec = Math.floor(Date.now() / 1000);
      const secondsLeft = PROMOTION_COOLDOWN_SECS - (nowSec - getClaimLastWriteSec(existingClaim));
      if (secondsLeft > 0) {
        errorToast(`You can submit one promotion every 24 hours. Please wait ~${formatRemaining(secondsLeft)}, then promote again.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // getIdToken() can return null for social/Privy wallets (async session) —
      // refresh via login() and retry once before giving up.
      let token = await getIdToken();
      if (!token) {
        try {
          await login();
        } catch {
          // ignore — handled by the null check below
        }
        token = await getIdToken();
      }
      if (!token) {
        errorToast('Could not verify your login. Please try again in a moment.');
        setSubmitting(false);
        return;
      }

      const authApi = createAuthenticatedApiClient(token, address);
      await authApi.post('/api/promotion/submit', { link: trimmed });

      toast.success('Promotion link submitted for review!');
      setUrl('');
      onClose();
    } catch (err) {
      // The backend is authoritative — surface its message (duplicate link OR
      // cooldown both come back as a 400 with a descriptive message).
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong submitting your promotion.';
      errorToast(message);
    } finally {
      setSubmitting(false);
    }
  }, [address, url, existingClaim, login, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-dialog max-w-md gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Submit Promotion Link
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-5 space-y-4">
          <p className="text-xs" style={{ color: '#8A8A8A' }}>
            Paste the link to your X post, Discord message, or other promotion. Admin will review and approve.
          </p>

          <Input
            placeholder="https://x.com/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="glass-input text-sm"
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />

          <Button
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
            className="w-full gap-2"
          >
            {submitting ? (
              <span className="animate-pulse">Submitting...</span>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Submit Link
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SubmitPromotionModal;
