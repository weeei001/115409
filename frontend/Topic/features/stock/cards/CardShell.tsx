import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { DataStamp, LedgerPanel, LightGlyph, NextStep, type LightState } from '@/components/common/Ledger';
import { EmptyState, LoadingRows } from '@/components/common/Notice';
import { cn } from '@/lib/cn';

interface Props {
  icon?: LucideIcon;
  title: string;
  /** 標題右側：單位或補充（燈質列） */
  unit?: React.ReactNode;
  /** 面板底部的資料日戳記；省略則不顯示 */
  stampDate?: string | null;
  stampLabel?: string;
  /** 資料狀態的燈質記號（Q 讀取中／F 已載入／熄燈），放在標題旁 */
  state?: LightState;
  loading?: boolean;
  loadingRows?: number;
  isEmpty?: boolean;
  emptyText?: string;
  /** 空狀態的下一步（例如「重新載入」） */
  emptyAction?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  children?: React.ReactNode;
  className?: string;
}

/**
 * 個股頁帳頁裡的一格面板。固定順序：標題與單位 → 讀數 → 圖或刻度 → 日期戳記，
 * 最底下是一列「下一步」（NextStep），不是淡色品牌按鈕。
 */
export function CardShell({
  icon: Icon,
  title,
  unit,
  stampDate,
  stampLabel,
  state,
  loading,
  loadingRows = 3,
  isEmpty,
  emptyText = '尚無資料',
  emptyAction,
  action,
  children,
  className,
}: Props) {
  return (
    <LedgerPanel
      title={
        <span className="inline-flex items-center gap-1.5">
          {Icon ? <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden /> : null}
          {title}
        </span>
      }
      // 燈質記號放在標題列右側（不放進 h3，標題的可及名稱不會多一段狀態文字）
      unit={
        state ? (
          <span className="inline-flex items-center gap-1.5">
            <LightGlyph state={state} />
            {unit}
          </span>
        ) : (
          unit
        )
      }
      className={cn('flex min-h-[280px] flex-col', className)}
    >
      <div className="flex flex-1 flex-col">
        {loading ? (
          // 載入＝燈質 Q：有線的空白列，寫出「讀取中」
          <div className="flex flex-1 flex-col border-t" style={{ minHeight: `${loadingRows * 44}px` }}>
            <LoadingRows className="flex-1" />
          </div>
        ) : isEmpty ? (
          <EmptyState className="flex-1" action={emptyAction}>
            {emptyText}
          </EmptyState>
        ) : (
          children
        )}
      </div>
      {stampDate !== undefined && !loading ? <DataStamp date={stampDate} label={stampLabel} className="mt-3 block" /> : null}
      {action ? (
        <div className="-mx-4 mt-4 -mb-4 border-t sm:-mx-5 sm:-mb-5">
          <NextStep onClick={action.onClick}>{action.label}</NextStep>
        </div>
      ) : null}
    </LedgerPanel>
  );
}
