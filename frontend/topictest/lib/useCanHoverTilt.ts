import { useEffect, useState } from 'react';

const HOVER_TILT_QUERY = '(hover: hover) and (pointer: fine)';

/** 是否為精細指標裝置（滑鼠等），可安全使用 3D tilt／hover 強化動效 */
export function useCanHoverTilt(): boolean {
  const [canHoverTilt, setCanHoverTilt] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(HOVER_TILT_QUERY);
    setCanHoverTilt(mq.matches);
    const onChange = () => setCanHoverTilt(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return canHoverTilt;
}
