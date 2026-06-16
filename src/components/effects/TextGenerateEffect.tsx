import { cn } from '@/lib/utils';
import { motion, useAnimation, useInView } from 'motion/react';
import { useEffect, useRef } from 'react';

interface TextGenerateEffectProps {
  /** The text to animate word-by-word. */
  words: string;
  className?: string;
  /** Duration per word in seconds. Default 0.3. */
  duration?: number;
  /** Delay between words in seconds. Default 0.08. */
  stagger?: number;
  /** Blur amount for the hidden state. Default "8px". Set "0px" to disable blur. */
  blur?: string;
}

/**
 * Word-by-word blur fade-in — great for descriptions and subheadings.
 *
 * ```tsx
 * <TextGenerateEffect words="Your description here" />
 * ```
 */
export function TextGenerateEffect({
  words,
  className,
  duration = 0.3,
  stagger = 0.08,
  blur = '8px',
}: TextGenerateEffectProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const controls = useAnimation();

  useEffect(() => {
    if (isInView) {
      controls.start('visible');
    }
  }, [isInView, controls]);

  const wordArray = words.split(' ');

  return (
    <div ref={ref} className={cn('inline', className)}>
      {wordArray.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className="inline-block"
          initial="hidden"
          animate={controls}
          variants={{
            hidden: { opacity: 0, filter: `blur(${blur})` },
            visible: { opacity: 1, filter: 'blur(0px)' },
          }}
          transition={{
            duration,
            delay: i * stagger,
            ease: 'easeOut',
          }}
        >
          {word}
          {i < wordArray.length - 1 && '\u00A0'}
        </motion.span>
      ))}
    </div>
  );
}
