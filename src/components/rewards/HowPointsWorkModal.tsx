import { HelpCircle, TrendingUp, Twitter, MessageSquare, Link2, Swords } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface HowPointsWorkModalProps {
  open: boolean;
  onClose: () => void;
}

function WayToEarnRow({
  icon,
  title,
  description,
  points,
  soon,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  points: string;
  soon?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg glass-inner">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm" style={{ color: '#E5E5E5' }}>{title}</span>
          {soon && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.15)', color: '#A855F7' }}>
              Soon
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#8A8A8A' }}>{description}</div>
      </div>
      <div className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: '#F59E0B' }}>
        {points}
      </div>
    </div>
  );
}

export function HowPointsWorkModal({ open, onClose }: HowPointsWorkModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass-dialog max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            How Points Work
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-5 space-y-3">
          <p className="text-xs" style={{ color: '#8A8A8A' }}>
            Earn points across the AEONIAN platform. Points unlock leaderboard ranks and future rewards.
          </p>

          <WayToEarnRow
            icon={<TrendingUp size={16} style={{ color: '#b794f6' }} />}
            title="Trading"
            description="Open positions earn 1 pt per $1. A $100 trade = 100 pts."
            points="+1 / $1 notional"
          />
          <WayToEarnRow
            icon={<Twitter size={16} style={{ color: '#1D9BF0' }} />}
            title="Social Follow"
            description="Follow @AEONIAN_mobile on X. One-time reward."
            points="+500"
          />
          <WayToEarnRow
            icon={<MessageSquare size={16} style={{ color: '#10B981' }} />}
            title="Social Join"
            description="Join the AEONIAN group chat on X. One-time reward."
            points="+500"
          />
          <WayToEarnRow
            icon={<Link2 size={16} style={{ color: '#F59E0B' }} />}
            title="Promotion"
            description="Share AEONIAN on X and submit your link for admin review."
            points="+1000"
          />
          <WayToEarnRow
            icon={<Swords size={16} style={{ color: '#A855F7' }} />}
            title="Arena"
            description="Compete in the Arena against other traders."
            points="TBD"
            soon
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default HowPointsWorkModal;
