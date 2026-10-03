import React, { useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import type { OrderSide, SellPlan } from '@/lib/types/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const row = 'flex min-h-11 items-center justify-between gap-3 bg-card px-5 py-2';

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
        className="max-w-[min(24rem,calc(100%-2rem))] gap-0 rounded-none border-border-strong bg-card p-0 shadow-raised"
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
        <div className="flex items-center justify-between gap-3 border-b border-border-strong py-2 pr-2 pl-5">
          <DialogTitle className="font-serif text-xl font-black tracking-[0.06em]">確認委託</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="關閉確認對話框"
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={20} aria-hidden />
          </Button>
        </div>

        {/* 收據：列與列之間 1px 線，數字等寬靠右 */}
        <dl className="grid gap-px border-b bg-border text-sm">
          <div className={row}>
            <dt className="text-muted-foreground">股票代號</dt>
            <dd className="font-mono text-[13.5px] font-semibold tabular-nums">{symbol}</dd>
          </div>
          <div className={row}>
            <dt className="text-muted-foreground">方向</dt>
            {/* 方向用文字＋2px 標線（買進 up、賣出 down），不整塊上色 */}
            <dd className={cn('border-b-2 pb-0.5 font-semibold', side === 'buy' ? 'border-up text-up' : 'border-down text-down')}>{side === 'buy' ? '買進' : '賣出'}</dd>
          </div>
          <div className={row}>
            <dt className="text-muted-foreground">模擬下單日</dt>
            <dd className="font-mono text-[13.5px] tabular-nums">{tradeDate}</dd>
          </div>
          {side === 'buy' ? (
            <div className={row}>
              <dt className="shrink-0 text-muted-foreground">賣出時間</dt>
              <dd className="text-right font-mono text-[13.5px] font-medium tabular-nums">{sellPlan === 'long_term' ? '長期持有' : plannedSellDate || '—'}</dd>
            </div>
          ) : null}
          <div className={row}>
            <dt className="text-muted-foreground">數量</dt>
            <dd className="font-mono text-[13.5px] tabular-nums">{quantity} 張</dd>
          </div>
        </dl>
        <DialogDescription className="px-5 pt-3 text-xs leading-relaxed text-muted-foreground">
          送出後由後端依收盤計算金額；委託列表會顯示試算依據與參考行情。
        </DialogDescription>

        {/* 確認鈕是中性的燈色主要按鈕，不依買賣方向上色 */}
        <div className="grid grid-cols-2 gap-3 p-5">
          <Button ref={cancelRef} type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            確認送出
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
