import React, { useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import type { OrderSide, SellPlan } from '@/lib/types/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onConfirm: () => void;
  symbol: string;
  side: OrderSide;
  tradeDate: string;
  sellPlan: SellPlan;
  plannedSellDate: string;
  quantity: number;
}

/**
 * 確認委託：Esc、點背景、取消、右上角 X 都會關閉（送出中全部不行，決議 c70）；焦點鎖在對話框內，
 * 一打開焦點在「取消」避免誤按 Enter 送出，關閉後回到觸發的按鈕。
 */
export function ConfirmOrderDialog({ open, onOpenChange, submitting, onConfirm, symbol, side, tradeDate, sellPlan, plannedSellDate, quantity }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const blockWhileSubmitting = (event: Event) => {
    if (submitting) event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && submitting ? undefined : onOpenChange(next))}>
      <DialogContent
        showCloseButton={false}
        className="max-w-sm gap-0 rounded-2xl bg-card p-6 shadow-raised"
        onOpenAutoFocus={(event) => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}
        onEscapeKeyDown={blockWhileSubmitting}
        onPointerDownOutside={blockWhileSubmitting}
        onInteractOutside={blockWhileSubmitting}
      >
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="text-lg font-bold">確認委託</DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="關閉確認對話框"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">股票代號</dt>
            <dd className="font-mono font-semibold">{symbol}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">方向</dt>
            <dd className={cn('font-semibold', side === 'buy' ? 'text-up' : 'text-down')}>{side === 'buy' ? '買進' : '賣出'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">模擬下單日</dt>
            <dd className="font-mono">{tradeDate}</dd>
          </div>
          {side === 'buy' ? (
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">賣出時間</dt>
              <dd className="text-right font-medium">{sellPlan === 'long_term' ? '長期持有' : plannedSellDate || '—'}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">數量</dt>
            <dd className="font-mono">{quantity} 張</dd>
          </div>
        </dl>
        <DialogDescription className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          送出後由後端依收盤計算金額；委託列表會顯示試算依據與參考行情。
        </DialogDescription>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="min-h-11 rounded-xl border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={cn(
              'flex min-h-11 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
              side === 'buy' ? 'bg-up' : 'bg-down',
            )}
          >
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            確認送出
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
