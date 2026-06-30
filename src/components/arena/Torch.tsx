/**
 * Torch — pure CSS torch flame component for Arena section headers.
 * No images, no external assets. Uses keyframe animations for flicker.
 * Respects prefers-reduced-motion.
 */

interface TorchProps {
  size?: 'sm' | 'md' | 'lg';
  flip?: boolean; // mirror horizontally for the right-side torch
}

export function Torch({ size = 'md', flip = false }: TorchProps) {
  const dims = {
    sm: { stick: 'w-1.5 h-8', flame: 'w-3 h-4', outer: 'w-3 h-12' },
    md: { stick: 'w-2 h-10', flame: 'w-4 h-5', outer: 'w-4 h-14' },
    lg: { stick: 'w-2.5 h-12', flame: 'w-5 h-6', outer: 'w-5 h-16' },
  }[size];

  return (
    <div
      className='torch-root flex flex-col items-center select-none pointer-events-none'
      style={{ transform: flip ? 'scaleX(-1)' : undefined, flexShrink: 0 }}
    >
      {/* Flame layers */}
      <div className='relative flex justify-center' style={{ marginBottom: '-2px' }}>
        {/* Outer glow halo */}
        <div
          className='torch-glow absolute rounded-full'
          style={{
            width: '200%',
            height: '200%',
            top: '10%',
            left: '-50%',
            background: 'radial-gradient(ellipse 60% 80% at 50% 60%, rgba(255,160,30,0.35) 0%, rgba(200,100,10,0.18) 50%, transparent 80%)',
            filter: 'blur(4px)',
          }}
        />
        {/* Inner amber core flame */}
        <div
          className={`torch-flame-inner ${dims.flame} relative`}
          style={{
            background: 'radial-gradient(ellipse 55% 70% at 50% 80%, #fff8d0 0%, #ffb830 25%, #e07010 55%, transparent 80%)',
            clipPath: 'polygon(50% 0%, 80% 40%, 70% 60%, 90% 80%, 50% 100%, 10% 80%, 30% 60%, 20% 40%)',
            filter: 'blur(1px)',
          }}
        />
        {/* Outer orange flame */}
        <div
          className={`torch-flame-outer ${dims.flame} absolute`}
          style={{
            top: '15%',
            background: 'radial-gradient(ellipse 60% 75% at 50% 85%, #ffa020 0%, #c85000 45%, transparent 75%)',
            clipPath: 'polygon(50% 0%, 85% 35%, 72% 58%, 92% 75%, 50% 100%, 8% 75%, 28% 58%, 15% 35%)',
            opacity: 0.85,
          }}
        />
      </div>

      {/* Bracket / head */}
      <div
        style={{
          width: '150%',
          height: '6px',
          background: 'linear-gradient(180deg, #7a5a1a 0%, #5a3d0a 100%)',
          borderRadius: '2px 2px 0 0',
        }}
      />

      {/* Wooden stick */}
      <div
        className={dims.stick}
        style={{
          background: 'linear-gradient(180deg, #6b4a18 0%, #4a3210 50%, #3a2608 100%)',
          borderRadius: '0 0 2px 2px',
          boxShadow: 'inset -2px 0 4px rgba(0,0,0,0.4), inset 1px 0 3px rgba(255,200,100,0.06)',
        }}
      />
    </div>
  );
}
