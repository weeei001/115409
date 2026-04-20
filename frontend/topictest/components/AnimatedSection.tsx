import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

type Preset = 'fadeUp' | 'fadeIn' | 'scaleIn' | 'slideLeft' | 'slideRight';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

interface PresetConfig {
  hidden: { opacity: number; y?: number; x?: number; scale?: number };
  visible: { opacity: number; y?: number; x?: number; scale?: number };
}

const presets: Record<Preset, PresetConfig> = {
  fadeUp: { hidden: { opacity: 0, y: 32 }, visible: { opacity: 1, y: 0 } },
  fadeIn: { hidden: { opacity: 0 }, visible: { opacity: 1 } },
  scaleIn: { hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1 } },
  slideLeft: { hidden: { opacity: 0, x: 40 }, visible: { opacity: 1, x: 0 } },
  slideRight: { hidden: { opacity: 0, x: -40 }, visible: { opacity: 1, x: 0 } },
};

interface Props {
  children: React.ReactNode;
  preset?: Preset;
  delay?: number;
  duration?: number;
  className?: string;
  once?: boolean;
  stagger?: number;
}

export function AnimatedSection({
  children,
  preset = 'fadeUp',
  delay = 0,
  duration = 0.5,
  className,
  once = true,
  stagger,
}: Props) {
  const reduceMotion = useReducedMotion();
  const config = presets[preset];

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  if (stagger) {
    return (
      <motion.div
        className={className}
        initial="hidden"
        whileInView="visible"
        viewport={{ once, margin: '-80px' }}
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
        }}
      >
        {React.Children.map(children, (child, index) => {
          if (!React.isValidElement(child)) return child;
          return (
            <motion.div
              key={child.key ?? index}
              variants={{
                hidden: config.hidden,
                visible: {
                  ...config.visible,
                  transition: { duration, ease: [...EASE] },
                },
              }}
            >
              {child}
            </motion.div>
          );
        })}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      initial={config.hidden}
      whileInView={config.visible}
      viewport={{ once, margin: '-80px' }}
      transition={{ duration, delay, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}
