import { useEffect, useState } from 'react';

interface CircularCountdownProps {
  startTime: number;
  endTime: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
}

export default function CircularCountdown({
  startTime,
  endTime,
  size = 72,
  strokeWidth = 5,
  color = '#b794f6',
  bgColor = 'rgba(183,148,246,0.15)',
}: CircularCountdownProps) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceRender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Math.floor(Date.now() / 1000);
  const total = endTime - startTime;
  const remaining = Math.max(0, endTime - now);
  const progress = total > 0 ? remaining / total : 0;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  let timeText: string;
  if (h > 0) {
    timeText = `${h}h ${m}m`;
  } else if (m > 0) {
    timeText = `${m}m ${s}s`;
  } else {
    timeText = `${s}s`;
  }

  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}
      >
        <span
          className="text-sm font-bold tabular-nums leading-none"
          style={{ color }}
        >
          {timeText}
        </span>
      </div>
    </div>
  );
}
