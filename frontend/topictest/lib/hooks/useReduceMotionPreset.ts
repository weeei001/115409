import { useMemo } from 'react';
import type { Target, Transition } from 'motion/react';
import { usePrefersReducedMotionClient } from '../usePrefersReducedMotionClient';

interface MotionProps {
  /** motion 的 initial 屬性；reduce 時為 false（跳過進場動畫） */
  initial: Target | false;
  /** motion 的 animate 屬性 */
  animate: Target;
  /** motion 的 transition；reduce 時 duration 為 0 */
  transition: Transition;
}

interface MotionPreset {
  /** 可直接 spread 到 <motion.div> 的 props 物件 */
  motionProps: MotionProps;
  /** 原始 reduceMotion 旗標，供需要更細控制的元件使用 */
  reduceMotion: boolean;
}

interface UseReduceMotionPresetOptions {
  /** 進場 initial 狀態，預設 `{ opacity: 0, y: 24 }` */
  initial?: Target;
  /** 動畫終態，預設 `{ opacity: 1, y: 0 }` */
  animate?: Target;
  /** 動畫 transition，預設 `{ duration: 0.5 }` */
  transition?: Transition;
}

/**
 * 統一處理 motion/react 與 `prefers-reduced-motion` 的常見組合：
 * - 一般情境：套用指定的 initial / animate / transition
 * - reduce 情境：initial=false、transition.duration=0（不執行進場）
 *
 * 取代散落於 login / register / forgot-password / reset-password 等頁的相同樣板。
 *
 * @example
 *   const { motionProps } = useReduceMotionPreset({
 *     initial: { opacity: 0, y: 24, scale: 0.96 },
 *     animate: { opacity: 1, y: 0, scale: 1 },
 *     transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
 *   });
 *   return <motion.div {...motionProps}>...</motion.div>;
 */
export function useReduceMotionPreset(options?: UseReduceMotionPresetOptions): MotionPreset {
  const reduceMotion = usePrefersReducedMotionClient();
  return useMemo<MotionPreset>(() => {
    const initial = options?.initial ?? { opacity: 0, y: 24 };
    const animate = options?.animate ?? { opacity: 1, y: 0 };
    const transition = options?.transition ?? { duration: 0.5 };
    if (reduceMotion) {
      return {
        motionProps: {
          initial: false,
          animate,
          transition: { ...transition, duration: 0 },
        },
        reduceMotion,
      };
    }
    return {
      motionProps: { initial, animate, transition },
      reduceMotion,
    };
  }, [reduceMotion, options?.initial, options?.animate, options?.transition]);
}
