import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface WordRotateProps {
  /** Array of words/phrases to cycle through. */
  words: string[];
  /** Time each word is shown in ms. Default 2500. */
  duration?: number;
  /** Slide direction. Default "up". */
  direction?: 'up' | 'down';
  /** Animation transition duration in seconds. Default 0.25. */
  transitionDuration?: number;
  className?: string;
}

/**
 * Cycling word animation — great for hero headlines.
 *
 * ```tsx
 * <h1 className="text-display">
 *   Build <WordRotate words={["faster", "smarter", "better"]} className="text-primary" />
 * </h1>
 * ```
 */
export function WordRotate({
  words,
  duration = 2500,
  direction = 'up',
  transitionDuration = 0.25,
  className,
}: WordRotateProps) {
  const [index, setIndex] = useState(0);
  const sign = direction === 'up' ? 1 : -1;

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % words.length);
    }, duration);
    return () => clearInterval(interval);
  }, [words, duration]);

  return (
    <span className="inline-block overflow-hidden align-bottom">
      <AnimatePresence mode="wait">
        <motion.span
          key={words[index]}
          className={cn('inline-block', className)}
          initial={{ opacity: 0, y: -30 * sign }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 * sign }}
          transition={{ duration: transitionDuration, ease: 'easeOut' }}
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
