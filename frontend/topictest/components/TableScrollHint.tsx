import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';

interface Props {
  className?: string;
  /** 傳入可橫向捲動的容器；僅在內容實際溢出時顯示提示 */
  scrollRef?: React.RefObject<HTMLElement | null>;
}

/** 橫向捲動表格提示（有 scrollRef 時依溢出顯示，否則僅小螢幕顯示） */
export const TableScrollHint: React.FC<Props> = ({ scrollRef, className }) => {
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (!scrollRef) return;
    const el = scrollRef.current;
    if (!el) return;

    const check = () => {
      setOverflows(el.scrollWidth > el.clientWidth + 2);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    return () => observer.disconnect();
  }, [scrollRef]);

  if (scrollRef) {
    if (!overflows) return null;
    return (
      <p className={clsx('px-4 pt-3 pb-0 text-xs text-[var(--color-text-muted)]', className)}>
        ← 左右滑動查看完整表格 →
      </p>
    );
  }

  return (
    <p
      className={clsx(
        'px-4 pt-3 pb-0 text-xs text-[var(--color-text-muted)] sm:hidden',
        className,
      )}
    >
      ← 左右滑動查看完整表格 →
    </p>
  );
};
