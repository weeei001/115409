import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

export type NoticeTone = 'danger' | 'warning' | 'success' | 'info';

const TONE: Record<NoticeTone, { className: string; icon: typeof Info }> = {
  danger: { className: 'border-danger-border bg-danger-muted text-danger', icon: AlertCircle },
  warning: { className: 'border-warning-border bg-warning-muted text-warning', icon: AlertTriangle },
  success: { className: 'border-success-border bg-success-muted text-success', icon: CheckCircle2 },
  info: { className: 'border-border-strong bg-accent text-subtle', icon: Info },
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

/** 錯誤／警告／成功／提示訊息框。狀態色與漲跌色分開（決議 D8），並且一律帶圖示 */
export function Notice({ tone = 'info', children, action, className, role }: NoticeProps) {
  const { className: toneClass, icon: Icon } = TONE[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn('flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm leading-6', toneClass, className)}
    >
      <span className="flex min-w-0 items-start gap-2">
        <Icon size={16} className="mt-1 shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </span>
      {action}
    </div>
  );
}

/** 空資料／載入完成但沒有內容 */
export function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>{children}</p>;
}
