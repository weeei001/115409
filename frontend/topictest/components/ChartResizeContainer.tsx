import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

export type ChartSize = { width: number; height: number };

interface Props {
  className?: string;
  children: (size: ChartSize) => React.ReactNode;
  role?: string;
  'aria-label'?: string;
}

/** 量測容器實際尺寸後再渲染圖表，並在 resize 時更新，避免 Recharts 寬度計算錯誤 */
export const ChartResizeContainer: React.FC<Props> = ({
  className,
  children,
  role,
  'aria-label': ariaLabel,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      const nextWidth = Math.floor(width);
      const nextHeight = Math.floor(height);
      setSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight },
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={clsx('relative min-h-0 min-w-0 w-full', className)}
      role={role}
      aria-label={ariaLabel}
    >
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
};
