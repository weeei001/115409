import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { toneText } from '@/lib/utils/tone';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { CLOSE_DATA_NOTE, boardFigures, type HeroBoard } from './boardFormat';

/** 首屏：燈質列、h1、一句說明與「直接看行情」，往下直接是觀測台（#terminalId） */

interface Props {
  /** 觀測台的元素 id；「直接看行情」捲到這裡並把焦點移過去 */
  terminalId: string;
  /** 大盤（TAIEX）最近一筆已儲存收盤；載入前或失敗時是 null */
  board: HeroBoard | null;
}

export function HomeHero({ terminalId, board }: Props) {
  const reduce = usePrefersReducedMotion();
  const goToTerminal = () => {
    const el = document.getElementById(terminalId);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };

  // 首屏就看得到加權指數與收盤日（P2-079、04-H1）；漲跌用紅漲綠跌
  const boardNow = boardFigures(board);
  const characteristic = boardNow ? (
    // 每一段不在中間斷行（375 寬不會把日期拆成兩行）
    <>
      <span className="whitespace-nowrap">加權指數 <span className="font-mono tabular-nums">{boardNow.close}</span></span>
      {boardNow.change ? <span className={cn('ml-1.5 font-mono whitespace-nowrap tabular-nums', toneText(boardNow.tone))}>{boardNow.change}</span> : null}
      {' · '}<span className="whitespace-nowrap">收盤 {boardNow.date}</span>{' · '}<span className="whitespace-nowrap">非即時</span>
    </>
  ) : CLOSE_DATA_NOTE;

  return (
    <section aria-label="股海明燈" className="border-b">
      <div className="mx-auto max-w-[1320px] px-4 pt-10 pb-12 sm:px-6 lg:px-10 lg:pt-16 lg:pb-20">
        <p className="characteristic text-foreground!">{characteristic}</p>
        <h1 className="mt-2 font-serif text-[clamp(32px,10.2vw,46px)] leading-[1.14] font-black tracking-[0.03em] text-foreground [word-break:keep-all] lg:mt-3 lg:text-[clamp(44px,min(6.2vw,9svh),86px)] lg:leading-[1.12]">
          股海明燈
        </h1>
        <p lang="en" className="mt-1 text-[11px] tracking-[0.25em] text-foreground uppercase lg:text-xs">
          Stock Lighthouse
        </p>
        <p className="mt-3 max-w-[34em] text-[15px] leading-[1.75] text-foreground max-lg:mt-2 lg:text-[17px]">收盤後的台股，一次看清楚。</p>
        <div className="mt-4 flex flex-wrap gap-3 lg:mt-5">
          <Button type="button" variant="outline" onClick={goToTerminal}>
            直接看行情
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
