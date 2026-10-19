import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DISCLAIMER_PATH, INVESTMENT_RISK_NOTICE } from '@/lib/disclaimers';
import { acknowledgeRiskNotice, browserStorage, hasAcknowledgedRiskNotice, RISK_NOTICE_ACK_EVENT } from '@/lib/riskNotice';

/**
 * 首次造訪的投資風險提示：固定在畫面底部，按「我已了解」後不再出現。
 * 不是對話框：不鎖焦點、不擋操作，只蓋住底部一條。伺服器輸出不含它（掛載後才判斷），避免 hydrate 不一致。
 * 顯示時把自己的高度（含手勢區）寫進 `--risk-notice-height`，貼著畫面底部的內容用它閃開（`--app-bottom-inset`）。
 */
export function RiskNoticeBanner() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setVisible(!hasAcknowledgedRiskNotice(browserStorage()));
  }, []);
  // layout effect：提示條出現的同一幀就讓開，不會先蓋住一下
  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--risk-notice-height', `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--risk-notice-height');
    };
  }, [visible]);
  if (!visible) return null;

  return (
    <section
      ref={ref}
      aria-labelledby="risk-notice-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-warning-border bg-card shadow-raised"
    >
      <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-4 pt-3 pb-[calc(0.75rem+var(--app-safe-area-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-start gap-2 text-sm leading-6">
          <AlertTriangle size={16} className="mt-1 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0">
            <strong id="risk-notice-title" className="mr-1 font-semibold">投資風險提示</strong>
            {INVESTMENT_RISK_NOTICE}
            <Link href={DISCLAIMER_PATH} className="ml-1 underline underline-offset-4">閱讀完整聲明</Link>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 self-end sm:self-auto"
          onClick={() => {
            acknowledgeRiskNotice(browserStorage());
            setVisible(false);
            window.dispatchEvent(new Event(RISK_NOTICE_ACK_EVENT));
          }}
        >
          我已了解
        </Button>
      </div>
    </section>
  );
}
