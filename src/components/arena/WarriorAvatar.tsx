/**
 * WarriorAvatar — geometric SVG warrior silhouette placeholder.
 * Used as the fallback avatar in the leaderboard when no X avatar is available.
 * Variants for rank 1/2/3 = gold/silver/bronze tint; ranks 4+ = stone neutral.
 */

interface WarriorAvatarProps {
  rank?: number;
  size?: number;
  className?: string;
}

function rankColors(rank?: number): { helm: string; armor: string; glow: string; bg: string } {
  if (rank === 1) return {
    helm: '#E0B341',
    armor: '#C8962A',
    glow: 'rgba(200,150,42,0.5)',
    bg: 'rgba(200,150,42,0.12)',
  };
  if (rank === 2) return {
    helm: '#C0C8D8',
    armor: '#9AA8B8',
    glow: 'rgba(180,190,210,0.35)',
    bg: 'rgba(180,190,210,0.08)',
  };
  if (rank === 3) return {
    helm: '#CD7F32',
    armor: '#A86020',
    glow: 'rgba(180,110,45,0.35)',
    bg: 'rgba(180,110,45,0.08)',
  };
  return {
    helm: '#6A6A78',
    armor: '#4A4A58',
    glow: 'rgba(80,80,100,0.2)',
    bg: 'rgba(80,80,100,0.06)',
  };
}

export function WarriorAvatar({ rank, size = 32, className = '' }: WarriorAvatarProps) {
  const colors = rankColors(rank);
  const r = size / 2;

  return (
    <div
      className={`flex-shrink-0 rounded-full overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        background: colors.bg,
        border: `1.5px solid ${colors.armor}55`,
        boxShadow: `0 0 8px ${colors.glow}`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox='0 0 32 32'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
      >
        {/* Background circle */}
        <circle cx='16' cy='16' r='16' fill='transparent' />

        {/* Helmet — dome top */}
        <path
          d='M8 16 C8 9 10 6 16 6 C22 6 24 9 24 16'
          fill={colors.helm}
          opacity='0.9'
        />
        {/* Helmet visor band */}
        <rect x='9' y='15' width='14' height='2.5' rx='1' fill={colors.armor} opacity='0.95' />
        {/* Plume ridge */}
        <rect x='14.5' y='5' width='3' height='5' rx='1.5' fill={colors.helm} opacity='0.7' />

        {/* Face area — dark slot in visor */}
        <rect x='11' y='14' width='10' height='2' rx='1' fill='rgba(0,0,0,0.6)' />

        {/* Cheek guards */}
        <path d='M8 16 L8 20 L10 22 L10 16 Z' fill={colors.armor} opacity='0.85' />
        <path d='M24 16 L24 20 L22 22 L22 16 Z' fill={colors.armor} opacity='0.85' />

        {/* Neck + gorget */}
        <rect x='13' y='22' width='6' height='2.5' rx='0.5' fill={colors.armor} opacity='0.8' />

        {/* Pauldrons (shoulder armor) */}
        <ellipse cx='8' cy='26' rx='5' ry='3' fill={colors.armor} opacity='0.9' />
        <ellipse cx='24' cy='26' rx='5' ry='3' fill={colors.armor} opacity='0.9' />

        {/* Chest plate center stripe */}
        <rect x='13.5' y='24.5' width='5' height='7' rx='1' fill={colors.helm} opacity='0.3' />

        {/* Subtle inner highlight on helm */}
        <path
          d='M12 11 C12 8 14 7 16 7 C18 7 20 8 20 11'
          stroke='rgba(255,255,255,0.18)'
          strokeWidth='1.2'
          fill='none'
        />
      </svg>
    </div>
  );
}
