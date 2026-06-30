/**
 * ComingSoonCards — locked preview tiles for upcoming features.
 * Must stay legible — signal unavailability via label/pill + non-interactivity only.
 * Per user preference: do NOT dim into near-invisibility on dark theme.
 */

import type { ElementType } from 'react';
import { LineChart, Lock } from 'lucide-react';

const BG = '#1a1a1f';
const BORDER = '#2a2a35';
const ACCENT = '#ab9ff2';
const MUTED = '#6b6b7a';

interface ComingSoonCardProps {
  icon: ElementType;
  title: string;
  description: string;
}

function ComingSoonCard({ icon: Icon, title, description }: ComingSoonCardProps) {
  return (
    <div
      className='rounded-xl p-4'
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        cursor: 'default',
      }}
    >
      <div className='flex items-start justify-between mb-3'>
        <div
          className='w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0'
          style={{ background: `${ACCENT}15` }}
        >
          <Icon size={16} style={{ color: ACCENT }} />
        </div>
        <div
          className='flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold'
          style={{
            background: '#2a2a35',
            color: MUTED,
            border: '1px solid #3a3a45',
          }}
        >
          <Lock size={9} />
          Coming Soon
        </div>
      </div>
      <div className='text-sm font-semibold mb-1' style={{ color: '#e8e8f0' }}>
        {title}
      </div>
      <div className='text-xs leading-relaxed' style={{ color: MUTED }}>
        {description}
      </div>
    </div>
  );
}

export function ComingSoonCards() {
  return (
    <div className='space-y-3'>
      <ComingSoonCard
        icon={LineChart}
        title='Market Predictions'
        description='AI-powered market sentiment analysis and directional signals across all Phoenix perp markets.'
      />
    </div>
  );
}
