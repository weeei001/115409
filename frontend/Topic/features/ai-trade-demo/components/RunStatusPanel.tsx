import React from 'react';
import { Activity, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { executionLabel, fmtMoney } from '../display';
import type { RunState, RunStatus } from '../useSimulateTradingStream';
import { DemoCard } from './DemoCard';

const STATUS_TEXT: Record<Exclude<RunStatus, 'idle'>, string> = {
  running: '模擬中',
  done: '模擬完成',
  error: '模擬失敗',
  cancelled: '已取消',
  incomplete: '串流提前結束',
};

const STATUS_CLASS: Record<Exclude<RunStatus, 'idle'>, string> = {
  running: 'border-border-strong bg-accent text-accent-foreground',
  done: 'border-success-border bg-success-muted text-success',
  error: 'border-danger-border bg-danger-muted text-danger',
  cancelled: 'border-warning-border bg-warning-muted text-warning',
  incomplete: 'border-warning-border bg-warning-muted text-warning',
};

function Chip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg border bg-muted px-2.5 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium text-foreground">{value}</span>
    </span>
  );
}

interface Props {
  state: RunState;
  onCancel: () => void;
}

export function RunStatusPanel({ state, onCancel }: Props) {
  if (state.status === 'idle') return null;
  const { init, params, status } = state;
  const running = status === 'running';
  const total = init?.n_trading_days ?? null;
  const received = state.days.length;
  const percent = total ? Math.min(100, (received / total) * 100) : 0;
  const execution = init?.execution;

  return (
    <DemoCard
      title="執行狀態"
      icon={Activity}
      aside={
        <span role="status" className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', STATUS_CLASS[status])}>
          {running && !init ? '連線中…' : STATUS_TEXT[status]}
        </span>
      }
    >
      <div
        role="progressbar"
        aria-label="已收到的交易日"
        aria-valuemin={0}
        aria-valuemax={total ?? undefined}
        aria-valuenow={total ? received : undefined}
        aria-valuetext={`已收到 ${received}／${total ?? '未知'} 日`}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full bg-brand-gradient transition-[width] duration-300', !total && running && 'w-1/4 animate-pulse')}
          style={total ? { width: `${percent}%` } : undefined}
        />
      </div>
      <p className="mt-2 font-mono text-sm tabular-nums">
        已收到 {received}／{total ?? '—'} 日
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {params ? (
          <Chip
            label="參數"
            value={`${params.symbol}｜${params.start}～${params.end}｜${fmtMoney(params.initialCash)} 元｜風險偏好 ${params.confidence}`}
          />
        ) : null}
        {init?.model ? <Chip label="模型" value={init.model} /> : null}
        {execution ? (
          <Chip label="成交方式" value={executionLabel(execution) ? `${execution}（${executionLabel(execution)}）` : execution} />
        ) : null}
        {init?.cached ? <Chip label="快取" value="命中，重放先前的結果" /> : null}
      </div>

      {running ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button type="button" variant="outline" onClick={onCancel} className="min-h-11 self-start">
            <Square aria-hidden />
            取消
          </Button>
          <p className="text-xs text-muted-foreground">取消只會中斷畫面接收，後端可能仍在計算。</p>
        </div>
      ) : null}

      {status === 'cancelled' || status === 'incomplete' ? (
        <p className="mt-3 text-xs text-muted-foreground">
          畫面保留已收到的 {received} 日；沒有收到完成事件，所以不顯示績效摘要。
        </p>
      ) : null}
    </DemoCard>
  );
}
