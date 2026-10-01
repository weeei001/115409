import React from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme/ThemeContext';
import { DayTable } from './components/DayTable';
import { RunStatusPanel } from './components/RunStatusPanel';
import { SimulateForm } from './components/SimulateForm';
import { SummaryPanel } from './components/SummaryPanel';
import { TradeCharts } from './components/TradeCharts';
import { getDemoApiBase } from './config';
import { useSimulateTradingStream } from './useSimulateTradingStream';

const API_BASE = getDemoApiBase();

/** AI 模擬下單 Demo 的整頁內容；pages/ai-trade-demo.tsx 只負責頁首與組裝 */
export function AiTradeDemo() {
  if (!API_BASE) return <main aria-label="AI 模擬下單 Demo" className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-10 sm:px-6">
    <h2 className="text-xl font-semibold">AI模擬下單Demo尚未開放</h2>
    <p className="text-sm leading-relaxed text-muted-foreground">此獨立 Demo 目前尚未開放使用。您可以先使用本站的其他功能。</p>
    <nav aria-label="其他功能" className="flex flex-wrap gap-3">
      {[['/', '返回首頁'], ['/ai', 'AI 對話'], ['/order', '一般模擬下單']].map(([path, label]) => <Link key={path} href={path}
        className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm text-brand-text hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2">{label}</Link>)}
    </nav>
  </main>;
  return <ConfiguredDemo />;
}

function ConfiguredDemo() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { state, start, cancel } = useSimulateTradingStream(API_BASE);
  const running = state.status === 'running';
  const initialCash = state.init?.initial_cash ?? state.params?.initialCash ?? 0;
  const hasRun = state.status !== 'idle';
  const retry = () => {
    if (state.params) void start(state.params);
  };

  return (
    <main aria-label="AI 模擬下單 Demo" className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <Notice tone="info">
        這是 Demo：由大型語言模型（LLM）逐日決定買進或賣出，資料來自獨立的 Demo 後端，與本站其他功能無關。模擬回測，不構成投資建議。
      </Notice>

      <SimulateForm disabled={!API_BASE} running={running} onStart={(params) => void start(params)} />

      <RunStatusPanel state={state} onCancel={cancel} />

      {state.error ? (
        <Notice
          tone="danger"
          action={
            state.error.source === 'http' ? null : (
              <Button type="button" variant="outline" size="sm" onClick={retry} className="min-h-11 border-danger-border text-danger sm:min-h-8">
                <RotateCcw aria-hidden />
                重試
              </Button>
            )
          }
        >
          {state.error.message}
          {state.error.source === 'http' ? '（請調整參數後重新開始）' : null}
        </Notice>
      ) : null}

      {state.invalidCount ? <Notice tone="warning">有 {state.invalidCount} 筆事件格式與預期不符，已略過。</Notice> : null}

      {state.status === 'done' && state.metrics ? (
        <SummaryPanel initialCash={initialCash} days={state.days} metrics={state.metrics} />
      ) : null}

      {hasRun && (running || state.days.length > 0) ? (
        <>
          <TradeCharts days={state.days} initialCash={initialCash} isDark={isDark} />
          <DayTable days={state.days} />
        </>
      ) : null}

      {!hasRun ? (
        <div className="rounded-xl border border-dashed">
          <EmptyState>設定參數後按「開始模擬」，這裡會逐日顯示走勢圖、資產淨值與明細。</EmptyState>
        </div>
      ) : null}
    </main>
  );
}
