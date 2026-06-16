import { formatPrice, formatTime, type OrderHistoryEntry } from './types';

interface OrderHistoryTableProps {
  orders: OrderHistoryEntry[];
  loading?: boolean;
  showSymbol?: boolean;
}

function statusColor(status: string | undefined): string {
  switch (status?.toLowerCase()) {
    case 'filled': return '#4ADE80';
    case 'cancelled': return '#FF5252';
    case 'expired': return '#8A8A8A';
    case 'partial': return '#b794f6';
    default: return '#8A8A8A';
  }
}

export function OrderHistoryTable({ orders, loading, showSymbol = true }: OrderHistoryTableProps) {
  if (loading) {
    return (
      <div className='space-y-2'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='h-14 rounded-xl animate-pulse glass-card' />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className='glass-card rounded-xl p-6 text-center'>
        <p className='text-sm' style={{ color: '#8A8A8A' }}>No order history</p>
      </div>
    );
  }

  return (
    <div className='space-y-1.5'>
      {orders.map((order, i) => {
        const isBuy = order.side?.toLowerCase() === 'buy' || order.side?.toLowerCase() === 'long';
        const filledPct = order.size && order.filledSize
          ? Math.min(100, (order.filledSize / order.size) * 100)
          : 0;

        return (
          <div
            key={order.orderId ?? i}
            className='glass-inner rounded-xl p-3 space-y-1.5'
          >
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2 flex-wrap'>
                {showSymbol && <span className='font-bold text-sm'>{order.symbol ?? '—'}</span>}
                <span
                  className='text-xs px-1.5 py-0.5 rounded font-medium'
                  style={{
                    background: isBuy ? 'rgba(74,222,128,0.15)' : 'rgba(255,82,82,0.15)',
                    color: isBuy ? '#4ADE80' : '#FF5252',
                  }}
                >
                  {order.side?.toUpperCase()}
                </span>
                {order.orderType && (
                  <span className='text-xs capitalize' style={{ color: '#8A8A8A' }}>{order.orderType}</span>
                )}
              </div>
              <span
                className='text-xs font-medium capitalize flex-shrink-0'
                style={{ color: statusColor(order.status) }}
              >
                {order.status ?? '—'}
              </span>
            </div>
            <div className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
              {order.filledSize != null ? order.filledSize.toFixed(4) : '—'}
              {order.size != null ? ` / ${order.size.toFixed(4)}` : ''}
              {' '}@ ${formatPrice(order.price)}
            </div>
            {/* Fill progress bar */}
            {filledPct > 0 && (
              <div className='h-1 rounded-full overflow-hidden glass-inner'>
                <div
                  className='h-full rounded-full transition-all'
                  style={{ width: `${filledPct}%`, background: isBuy ? '#4ADE80' : '#FF5252' }}
                />
              </div>
            )}
            {order.updatedAt && (
              <div className='text-xs' style={{ color: '#555' }}>{formatTime(order.updatedAt)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
