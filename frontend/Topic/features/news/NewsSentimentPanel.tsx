import React from 'react';
import Link from 'next/link';
import { Bot, Info, Quote, TrendingUp } from 'lucide-react';
import type { SentimentResponse } from '@/lib/types/api';
import { sentimentMeta } from '@/lib/news/sentiment';
import { formatDateTime } from '@/lib/utils/date';
import { formatStockLabel } from '@/lib/utils/symbolNames';
import { cn } from '@/lib/cn';

interface Props {
  sentiments: SentimentResponse[];
  active: SentimentResponse | undefined;
  selectedStock: string;
  onSelectStock: (code: string) => void;
  /** 沒有情緒分析時提供第一個關聯股票的連結 */
  fallbackStock?: string;
}

/** 情緒大卡外框：正面用漲色、負面用跌色，其餘中性（決議 D8） */
function cardTone(label: string) {
  if (label === 'positive') return 'border-up/30 bg-up-muted/60';
  if (label === 'negative') return 'border-down/30 bg-down-muted/60';
  return 'border-border bg-muted/60';
}

const isStockCode = (code: string) => /^\d{4,6}$/.test(code);

/** 新聞內容頁右欄：AI 新聞情緒分析 */
export function NewsSentimentPanel({ sentiments, active, selectedStock, onSelectStock, fallbackStock }: Props) {
  const meta = active ? sentimentMeta(active.label) : null;

  return (
    <aside className="space-y-4 rounded-xl border bg-card p-5 shadow-card lg:sticky lg:top-[calc(var(--app-header-height)+1rem)] lg:col-span-4" aria-label="AI 新聞情緒分析">
      <div className="flex items-center gap-2 border-b pb-3">
        <Bot size={18} className="text-brand" aria-hidden />
        <h2 className="text-sm font-semibold">AI 新聞情緒分析</h2>
      </div>

      {sentiments.length > 1 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">分析目標股票：</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {sentiments.map((s) => {
              const current = s.target_stock_id === selectedStock;
              return (
                <button
                  key={s.target_stock_id}
                  type="button"
                  aria-pressed={current}
                  onClick={() => onSelectStock(s.target_stock_id)}
                  className={cn(
                    'min-h-11 rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors sm:min-h-9',
                    current ? 'border-brand bg-accent font-semibold text-accent-foreground' : 'text-subtle hover:border-border-strong',
                  )}
                >
                  {formatStockLabel(s.target_stock_id)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {active && meta ? (
        <div className="space-y-4">
          <div className={cn('rounded-lg border p-3.5', cardTone(active.label))}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                分析目標：{formatStockLabel(active.target_stock_id)}
              </span>
              <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', meta.badge)}>{meta.label}</span>
            </div>
            {meta.description ? <p className="text-xs leading-relaxed text-subtle">{meta.description}</p> : null}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold">判斷理由：</h3>
            <p className="rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed text-subtle">{active.reason}</p>
          </div>

          {active.evidence?.length ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                <h3 className="flex items-center gap-1">
                  <Quote size={12} className="text-brand" aria-hidden />
                  原文依據引用：
                </h3>
                <span className="text-[10px] font-normal text-muted-foreground">共 {active.evidence.length} 處引證</span>
              </div>
              <ul className="space-y-2">
                {active.evidence.map((ev, i) => (
                  <li key={i} className="rounded-lg border bg-muted/40 p-2.5 text-xs">
                    <p className="mb-1 font-mono text-[10px] text-muted-foreground">[{ev.field === 'title' ? '標題' : '內文'}]</p>
                    <blockquote className="border-l-2 border-brand/60 pl-2 leading-relaxed text-subtle italic">「{ev.quote}」</blockquote>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1.5 border-t pt-2 text-[11px] text-muted-foreground">
            {active.analyzed_at ? <p className="tabular-nums">分析時間：{formatDateTime(active.analyzed_at)}</p> : null}
            <p className="flex items-start gap-1 text-[10px] leading-relaxed">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
              情緒反映新聞訊息，不代表股價預測。投資決策請綜合考量基本面與技術面。
            </p>
          </div>

          {isStockCode(active.target_stock_id) ? (
            <Link
              href={`/stock/${active.target_stock_id}`}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border bg-muted px-3 py-2 text-xs font-medium transition-colors hover:border-border-strong hover:text-brand-text"
            >
              <TrendingUp size={13} aria-hidden />
              前往 {active.target_stock_id} 個股儀表板
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 py-6 text-center text-xs text-muted-foreground">
          <p>此篇新聞目前尚無 AI 情緒分析記錄。</p>
          {fallbackStock ? (
            <Link href={`/stock/${fallbackStock}`} className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-text hover:underline">
              查看 {fallbackStock} 個股頁面
            </Link>
          ) : null}
        </div>
      )}
    </aside>
  );
}
