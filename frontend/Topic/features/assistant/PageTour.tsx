import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useMediaQuery, usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';
import { LighthouseMascot } from './LighthouseMascot';
import { findTourTarget, type TourStep } from './tours';
import { calloutPlacement, scrollTargetTop, spotlightBox, type Box, type CalloutSide, type Viewport } from './tourLayout';

function readViewport(): Viewport {
  // 頁首高度可能是 rem（樣式表）或 px（頁首量測後寫入）；rem 依根元素字級換算（使用者可能調大字級）
  const root = getComputedStyle(document.documentElement);
  const raw = root.getPropertyValue('--app-header-height').trim();
  const header = (raw.endsWith('rem') ? parseFloat(raw) * parseFloat(root.fontSize) : parseFloat(raw)) || 56;
  return { width: document.documentElement.clientWidth, height: window.innerHeight, header };
}

function rectOf(element: Element): Box {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

type Placement = { top: number; left: number; side: CalloutSide };

/**
 * 「這頁怎麼看」：小燈一步一步框出頁面上的區塊並說明（DESIGN.md 第 12 節）。
 * 被介紹的區塊外面一圈燈色框，其餘變暗，框裡有一道光由左掃到右；說明卡放在框的下方或上方，手機貼在畫面底部。
 * 用 Radix Dialog（modal）：焦點留在說明卡裡、Esc 結束、背後的頁面讀屏器讀不到也點不到。
 */
export function PageTour({ title, steps, still, onClose, onCloseAutoFocus }: {
  title: string;
  steps: TourStep[];
  still: boolean;
  /** 走完最後一步或中途結束 */
  onClose: () => void;
  /** 結束後焦點要回到哪裡（小燈按鈕） */
  onCloseAutoFocus: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const docked = useMediaQuery('(max-width: 639px)');
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  // 換步：把區塊捲到看得見的地方，焦點放在「下一步」
  useEffect(() => {
    const target = findTourTarget(step.target);
    if (target) {
      // 預留說明卡的高度：手機貼在底部；桌面放得下時讓說明卡排在區塊下方，不蓋住區塊
      const card = cardRef.current?.offsetHeight ?? 260;
      const reserved = docked ? card : card + 28;
      const top = scrollTargetTop(rectOf(target), window.scrollY, readViewport(), reserved);
      window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
    }
    nextRef.current?.focus({ preventScroll: true });
  }, [step.target, docked, reduced]);

  // 每個 frame 重新量：捲動中、圖表載入撐高版面時外框和說明卡都跟著走
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const viewport = readViewport();
      const target = findTourTarget(step.target);
      const box = target ? spotlightBox(rectOf(target), viewport) : null;
      const card = cardRef.current;
      const size = card ? { width: card.offsetWidth, height: card.offsetHeight } : { width: 360, height: 240 };
      const next = calloutPlacement(box, viewport, size, docked);
      setSpot((previous) => (sameBox(previous, box) ? previous : box));
      setPlacement((previous) => (previous && previous.side === next.side && Math.abs(previous.top - next.top) < 0.5 && Math.abs(previous.left - next.left) < 0.5 ? previous : next));
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [step.target, docked]);

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0) return;
    if (next >= steps.length) onClose();
    else setIndex(next);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        {/* 變暗的背景：區塊以外上下左右四塊 --overlay（不用超大 box-shadow，太大時瀏覽器不一定畫得出來）；區塊外框用燈色（光照到的地方） */}
        <div className="pointer-events-none fixed inset-0 z-[60] print:hidden" aria-hidden>
          {spot ? (
            <>
              <div className="absolute inset-x-0 top-0 bg-overlay" style={{ height: spot.top }} />
              <div className="absolute inset-x-0 bottom-0 bg-overlay" style={{ top: spot.top + spot.height }} />
              <div className="absolute left-0 bg-overlay" style={{ top: spot.top, height: spot.height, width: spot.left }} />
              <div className="absolute right-0 bg-overlay" style={{ top: spot.top, height: spot.height, left: spot.left + spot.width }} />
              <div data-tour-spot className="absolute border-2 border-brand" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}>
                {/* 換一步，光束就從左到右掃過這一區一次（同圖廓的 neatline-sweep） */}
                {reduced || still ? null : <span key={index} className="tour-sweep" />}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 bg-overlay" />
          )}
        </div>
        <Dialog.Content
          ref={cardRef}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nextRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseAutoFocus();
          }}
          // 點到變暗的地方不結束：導覽常常一不小心點到旁邊，要結束請按「結束導覽」或 Esc
          onInteractOutside={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
          }}
          style={docked || !placement ? undefined : { top: placement.top, left: placement.left }}
          data-side={placement?.side}
          className={cn(
            'fixed z-[61] flex flex-col bg-card shadow-raised outline-none print:hidden',
            docked
              ? 'inset-x-0 bottom-0 border-t-2 border-border-strong pb-[var(--app-safe-area-bottom)]'
              : 'w-[min(22.5rem,calc(100vw-2rem))] border border-border-strong',
            !docked && !placement && 'invisible',
          )}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <LighthouseMascot key={index} mood="greet" scale={1.25} still={still} />
            <p className="characteristic min-w-0 flex-1">{title}</p>
            <p className="characteristic shrink-0" aria-hidden>{index + 1}／{steps.length}</p>
          </div>
          <div className="px-4 pt-3 pb-4">
            <Dialog.Title className="font-serif text-lg leading-snug font-black tracking-[0.06em]">{step.title}</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[15px] leading-[1.8] text-subtle">{step.body}</Dialog.Description>
          </div>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5">
            <Button type="button" variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              結束導覽
            </Button>
            <div className="flex gap-2">
              {index > 0 ? <Button type="button" variant="outline" onClick={() => go(-1)}>上一步</Button> : null}
              <Button ref={nextRef} type="button" onClick={() => go(1)}>{last ? '完成' : '下一步'}</Button>
            </div>
          </div>
          {/* 讀屏器：換步時念出第幾步與說明（焦點一直在「下一步」上，不會自己念內容） */}
          <p className="sr-only" aria-live="polite">{`第 ${index + 1} 步，共 ${steps.length} 步：${step.title}。${step.body}`}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
