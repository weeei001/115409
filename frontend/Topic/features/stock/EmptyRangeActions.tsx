import { CalendarRange, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface EmptyRangeActionsProps {
  onWidenRange: () => void;
  onRetry: () => void;
}

/** 個股各面板空狀態的兩個下一步：拉長日期區間、重新載入 */
export function EmptyRangeActions({ onWidenRange, onRetry }: EmptyRangeActionsProps) {
  return (
    <span className="flex flex-wrap items-center justify-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onWidenRange}>
        <CalendarRange aria-hidden />
        拉長日期區間
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden />
        重新載入
      </Button>
    </span>
  );
}
