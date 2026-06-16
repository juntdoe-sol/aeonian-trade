import { Swords } from 'lucide-react';

interface BattleStandingsProps {
  challengerHandle: string;
  opponentHandle: string;
  challengerPnlPct: number;
  opponentPnlPct: number;
  hasOpponent: boolean;
}

export default function BattleStandings({
  challengerHandle,
  opponentHandle,
  challengerPnlPct,
  opponentPnlPct,
  hasOpponent,
}: BattleStandingsProps) {
  const maxAbs = Math.max(Math.abs(challengerPnlPct), Math.abs(opponentPnlPct), 1);
  const challWidth = (Math.abs(challengerPnlPct) / maxAbs) * 100;
  const oppWidth = hasOpponent ? (Math.abs(opponentPnlPct) / maxAbs) * 100 : 0;

  const challWinning = challengerPnlPct >= opponentPnlPct;
  const oppWinning = hasOpponent && opponentPnlPct > challengerPnlPct;

  const challColor = challengerPnlPct >= 0 ? '#4ADE80' : '#FF5252';
  const oppColor = opponentPnlPct >= 0 ? '#4ADE80' : '#FF5252';

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-center gap-2 mb-4">
        <Swords size={14} style={{ color: '#b794f6' }} />
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#8A8A8A' }}>
          Battle Standings
        </span>
      </div>

      <div className="flex items-stretch gap-3">
        {/* Challenger side */}
        <div className="flex-1 flex flex-col items-end">
          {challWinning && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded mb-1"
              style={{ background: 'rgba(255,215,0,0.15)', color: '#FFD700' }}
            >
              WINNING
            </span>
          )}
          <span className="text-xs font-semibold mb-1 truncate max-w-full" style={{ color: '#8A8A8A' }}>
            {challengerHandle}
          </span>
          <span
            className="text-xl font-black tabular-nums mb-2"
            style={{ color: challColor }}
          >
            {challengerPnlPct >= 0 ? '+' : ''}{challengerPnlPct.toFixed(2)}%
          </span>
          <div className="w-full flex justify-end">
            <div
              className="h-3 rounded-l-full"
              style={{
                width: `${challWidth}%`,
                background: challColor,
                opacity: 0.85,
                minWidth: '4px',
              }}
            />
          </div>
        </div>

        {/* Center divider */}
        <div className="flex flex-col items-center justify-center">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black"
            style={{ background: 'rgba(183,148,246,0.13)', color: '#b794f6', border: '1px solid rgba(183,148,246,0.3)' }}
          >
            VS
          </div>
          <div className="w-px flex-1 mt-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Opponent side */}
        <div className="flex-1 flex flex-col items-start">
          {oppWinning && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded mb-1"
              style={{ background: 'rgba(255,215,0,0.15)', color: '#FFD700' }}
            >
              WINNING
            </span>
          )}
          <span className="text-xs font-semibold mb-1 truncate max-w-full" style={{ color: '#8A8A8A' }}>
            {hasOpponent ? opponentHandle : 'Waiting…'}
          </span>
          <span
            className="text-xl font-black tabular-nums mb-2"
            style={{ color: hasOpponent ? oppColor : '#3A3A3A' }}
          >
            {hasOpponent ? `${opponentPnlPct >= 0 ? '+' : ''}${opponentPnlPct.toFixed(2)}%` : '—%'}
          </span>
          <div className="w-full">
            {hasOpponent ? (
              <div
                className="h-3 rounded-r-full"
                style={{
                  width: `${oppWidth}%`,
                  background: oppColor,
                  opacity: 0.85,
                  minWidth: '4px',
                }}
              />
            ) : (
              <div
                className="h-3 rounded-r-full"
                style={{ width: '20%', background: '#3A3A3A', opacity: 0.5 }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
