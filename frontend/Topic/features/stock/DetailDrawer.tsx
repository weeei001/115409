import React, { useRef } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 個股頁的詳細抽屜：右側滑入，手機全寬。
 * Esc、點背景關閉、focus trap、鎖背景捲動由 Radix 處理；
 * 抽屜由外部 state 打開、沒有 SheetTrigger，Radix 不知道焦點該回哪，所以自己記住打開前的焦點。
 * 內容只在打開時掛載，避免關著也在跑圖表與 API。
 */
export function DetailDrawer({ open, onClose, title, subtitle, children }: Props) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 bg-card/95 p-0 pt-[var(--app-safe-area-top)] backdrop-blur-2xl sm:max-w-[min(1100px,90vw)]"
        onOpenAutoFocus={(event) => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          // 舊版行為：打開後焦點先放在關閉鈕
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
          returnFocus.current = null;
        }}
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-card/95 px-5 py-4 pr-16 backdrop-blur-2xl">
          <SheetTitle className="truncate text-lg font-bold">{title}</SheetTitle>
          <SheetDescription className={subtitle ? 'text-xs text-muted-foreground' : 'sr-only'}>{subtitle ?? title}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-[calc(1.25rem+var(--app-safe-area-bottom))] sm:px-6">
          {open ? children : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
