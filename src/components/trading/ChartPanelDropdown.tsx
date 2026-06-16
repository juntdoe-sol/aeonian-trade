import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface ChartPanelDropdownOption {
  id: string;
  label: string;
}

/**
 * A compact dropdown styled to match the PriceChart's control-bar aesthetic
 * (rounded pill, glass-inner surface, #b794f6 accent, IBM-Plex/JetBrains mono
 * caption). Used to label/switch the panel that sits BESIDE the chart so it
 * reads as a sibling of the chart's own timeframe / Last-Mark controls.
 */
export function ChartPanelDropdown({
  options,
  value,
  onChange,
}: {
  options: ChartPanelDropdownOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.id === value) ?? options[0];

  // Close on outside click — mirrors the chart's lightweight popover behaviour.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const single = options.length <= 1;

  return (
    <div ref={ref} className='relative'>
      <button
        type='button'
        onClick={() => { if (!single) setOpen((v) => !v); }}
        className='flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors glass-inner'
        style={{ color: '#FFF', cursor: single ? 'default' : 'pointer' }}
      >
        <span>{active?.label}</span>
        {!single && (
          <ChevronDown
            size={13}
            style={{
              color: '#8A8A8A',
              transition: 'transform 0.2s ease',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        )}
      </button>

      {open && !single && (
        <div
          className='absolute top-full left-0 mt-1 z-30 min-w-[8rem] rounded-lg overflow-hidden glass-card-strong'
          style={{ background: 'linear-gradient(to bottom, #0a0a0a, #111114)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {options.map((o) => {
            const isActive = o.id === value;
            return (
              <button
                key={o.id}
                type='button'
                onClick={() => { onChange(o.id); setOpen(false); }}
                className='w-full text-left px-3 py-2 text-xs font-medium transition-colors'
                style={{
                  background: isActive ? 'rgba(183,148,246,0.15)' : 'transparent',
                  color: isActive ? '#b794f6' : '#C8C8D0',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ChartPanelDropdown;
