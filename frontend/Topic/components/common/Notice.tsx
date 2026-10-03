import React from 'react';
import { AlertTriangle, CheckCircle2, Info, LightbulbOff } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { cn } from '@/lib/cn';

export type NoticeTone = 'danger' | 'warning' | 'success' | 'info';

const TONE: Record<NoticeTone, { className: string; icon: typeof Info }> = {
  danger: { className: 'border-danger-border bg-danger-muted text-danger', icon: LightbulbOff },
  warning: { className: 'border-warning-border bg-warning-muted text-warning', icon: AlertTriangle },
  success: { className: 'border-success-border bg-success-muted text-success', icon: CheckCircle2 },
  info: { className: 'border-input bg-accent text-subtle', icon: Info },
};

interface NoticeProps {
  tone?: NoticeTone;
  children: React.ReactNode;
  /** 右側動作（例如「重試」） */
  action?: React.ReactNode;
  className?: string;
  /** 錯誤預設 role=alert，其餘 role=status */
  role?: 'alert' | 'status';
}

/**
 * 錯誤／警告／成功／提示訊息框（航船布告）。狀態色與漲跌色分開（決議 D8），一律帶圖示；不做動畫。
 * 錯誤＝熄燈：圖示是熄掉的燈。
 */
export function Notice({ tone = 'info', children, action, className, role }: NoticeProps) {
  const { className: toneClass, icon: Icon } = TONE[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn('flex flex-wrap items-start justify-between gap-2 border border-l-2 px-3 py-2.5 text-sm leading-6', toneClass, className)}
    >
      <span className="flex min-w-0 items-start gap-2">
        <Icon size={16} className="mt-1 shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </span>
      {action}
    </div>
  );
}

/**
 * 空資料＝燈質 F（定光）：一盞不動、沒有光束的燈，加一句說明。
 * 能給下一步就傳 action（連結或按鈕）。
 */
export function EmptyState({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-muted-foreground sm:px-5', className)}>
      <BrandMark lit={false} className="size-12 text-input [stroke-width:0.9]" />
      <p className="max-w-[30em] text-pretty">{children}</p>
      {action}
    </div>
  );
}

/**
 * 載入＝燈質 Q（急閃）：有線的空白列加一道掃過的光帶，並且寫出「讀取中」。
 * className 給高度（例如 h-44）。
 */
export function LoadingRows({ label = '讀取中…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn('q-rows relative flex min-h-11 items-center justify-center', className)}>
      <span className="relative z-[1] bg-card px-2 text-xs tracking-[0.04em] text-muted-foreground">{label}</span>
    </div>
  );
}
