import { X } from 'lucide-react';
import { formatPrice, type TraderOrder } from './types';

interface OpenOrdersTableProps {
  orders: TraderOrder[];
  loading?: boolean;
  onCancel?: (order: TraderOrder) => void;
  showSymbol?: boolean;
}

export function OpenOrdersTable({ orders, loading, onCancel, showSymbol = true }: OpenOrdersTableProps) {
  if (loading) {
    return (
      <div className='space-y-2'>
        {[1, 2].map((i) => (
          <div key={i} className='h-16 rounded-xl animate-pulse glass-card' />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className='glass-card rounded-xl p-6 text-center'>
        <p className='text-sm' style={{ color: '#8A8A8A' }}>No open orders</p>
      </div>
    );
  }

  return (
    <div className='space-y-2'>
      {orders.map((order, i) => {
        const isBuy = order.side?.toLowerCase() === 'buy' || order.side?.toLowerCase() === 'long';
        return (
          <div
            key={order.orderId ?? i}
            className='glass-card rounded-xl p-3 flex items-center justify-between gap-3'
          >
            <div className='space-y-1 min-w-0'>
              <div className='flex items-center gap-2 flex-wrap'>
                {showSymbol && <span className='text-sm font-bold'>{order.symbol}</span>}
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
              <div className='text-xs tabular-nums' style={{ color: '#8A8A8A' }}>
                {order.size?.toFixed(4) ?? '—'} @ ${formatPrice(order.price)}
              </div>
            </div>
            {onCancel && (
              <button
                onClick={() => onCancel(order)}
                className='p-2 rounded-lg flex-shrink-0 transition-colors'
                style={{ color: '#FF5252' }}
                title='Cancel order'
              >
                <X size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
