import { useState } from 'react';
import { OrderbookPanel } from './UserActivityPanel';
import { ChartPanelDropdown } from './ChartPanelDropdown';

const CHART_BORDER = 'rgba(255,255,255,0.08)';

/**
 * The Order Book rendered as a sibling of the price chart. Mirrors the chart's
 * card chrome: a glass-card shell with a top control bar (matching the chart's
 * `border-bottom` divider) holding a chart-style dropdown. Only one option
 * (Order Book) exists today, but it's still surfaced through the dropdown so it
 * visually matches the chart's control bar, per the requested design.
 */
export function OrderbookSidePanel({ symbol }: { symbol?: string }) {
  const [view, setView] = useState('orderbook');

  return (
    <div className='glass-card w-full rounded-xl overflow-hidden'>
      {/* Control bar — mirrors PriceChart's top bar height + divider */}
      <div
        className='flex items-center px-3 py-2'
        style={{ borderBottom: `1px solid ${CHART_BORDER}` }}
      >
        <ChartPanelDropdown
          options={[{ id: 'orderbook', label: 'Order Book' }]}
          value={view}
          onChange={setView}
        />
      </div>

      {/* Book body — compact so the whole card is visible at a glance without scrolling */}
      <div className='py-1.5'>
        <OrderbookPanel symbol={symbol} />
      </div>
    </div>
  );
}

export default OrderbookSidePanel;
