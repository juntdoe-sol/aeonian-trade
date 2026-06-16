/**
 * Disables pinch-zoom and double-tap-zoom on iOS Safari app-wide,
 * while preserving touch interactions inside `.chart-touch-zone` elements.
 *
 * iOS Safari ignores `user-scalable=no` and `maximum-scale` since iOS 10,
 * so we must preventDefault() on the gesture and touch events directly.
 */

let lastTouchEnd = 0;

function isInsideChartZone(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return target.closest('.chart-touch-zone') !== null;
}

function handleGestureStart(e: Event): void {
  if (!isInsideChartZone(e.target)) {
    e.preventDefault();
  }
}

function handleGestureChange(e: Event): void {
  if (!isInsideChartZone(e.target)) {
    e.preventDefault();
  }
}

function handleGestureEnd(e: Event): void {
  if (!isInsideChartZone(e.target)) {
    e.preventDefault();
  }
}

function handleTouchMove(e: TouchEvent): void {
  if (e.touches.length > 1 && !isInsideChartZone(e.target)) {
    e.preventDefault();
  }
}

function handleTouchEnd(e: TouchEvent): void {
  if (isInsideChartZone(e.target)) return;
  const now = Date.now();
  if (now - lastTouchEnd < 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}

export function disableZoom(): void {
  // WebKit-specific gesture events (iOS Safari pinch-zoom)
  document.addEventListener('gesturestart', handleGestureStart, { passive: false });
  document.addEventListener('gesturechange', handleGestureChange, { passive: false });
  document.addEventListener('gestureend', handleGestureEnd, { passive: false });

  // Multi-touch touchmove (pinch-zoom fallback path)
  document.addEventListener('touchmove', handleTouchMove, { passive: false });

  // Double-tap-zoom prevention
  document.addEventListener('touchend', handleTouchEnd, { passive: false });
}
