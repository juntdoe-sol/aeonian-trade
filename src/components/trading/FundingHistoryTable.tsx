import { formatFunding, formatTime, formatUsd, type TraderFundingEntry } from './types';

interface FundingHistoryTableProps {
  entries: TraderFundingEntry[];
  loading?: boolean;
  showSymbol?: boolean;
}

export function FundingHistoryTable({ entries, loading, showSymbol = true }: FundingHistoryTableProps) {
  if (loading) {
    return (
      <div className='space-y-2'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='h-12 rounded-xl animate-pulse glass-card' />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className='glass-card rounded-xl p-6 text-center'>
        <p className='text-sm' style={{ color: '#8A8A8A' }}>No funding history</p>
      </div>
    );
  }

  return (
    <div className='space-y-1.5'>
      {/* Header */}
      <div
        className='grid text-xs px-3 py-1.5'
        style={{
          gridTemplateColumns: showSymbol ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr',
          color: '#8A8A8A',
        }}
      >
        {showSymbol && <span>Symbol</span>}
        <span>Rate</span>
        <span className='text-right'>Payment</span>
        <span className='text-right'>Time</span>
      </div>

      {entries.map((entry, i) => {
        const isPos = (entry.payment ?? 0) >= 0;
        return (
          <div
            key={i}
            className='grid text-xs tabular-nums px-3 py-2 rounded-lg glass-inner'
            style={{
              gridTemplateColumns: showSymbol ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr',
            }}
          >
            {showSymbol && <span className='font-medium'>{entry.symbol ?? '—'}</span>}
            <span style={{ color: (entry.fundingRate ?? 0) >= 0 ? '#4ADE80' : '#FF5252' }}>
              {formatFunding(entry.fundingRate)}
            </span>
            <span className='text-right font-medium' style={{ color: isPos ? '#4ADE80' : '#FF5252' }}>
              {entry.payment != null
                ? `${isPos ? '+' : ''}${formatUsd(entry.payment)}`
                : '—'}
            </span>
            <span className='text-right' style={{ color: '#555' }}>
              {entry.timestamp
                ? new Date(entry.timestamp * 1000).toLocaleTimeString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
