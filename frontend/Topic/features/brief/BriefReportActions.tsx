import React from 'react';
import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** 報告頁收到這個參數會在載入完成後自動開啟列印視窗（另存 PDF） */
export const REPORT_PRINT_PARAM = 'print';

export function stockReportHref(symbol: string, print = false): string {
  const base = `/stock/${encodeURIComponent(symbol)}/report`;
  return print ? `${base}?${REPORT_PRINT_PARAM}=1` : base;
}

/**
 * 個股 AI 分析完整報告的兩個入口：查看、下載 PDF。
 * 新分頁開，個股頁的抽屜和捲動位置都留著；按鈕用 outline，不搶這一屏唯一的主要按鈕。
 */
export const BriefReportActions: React.FC<{ symbol: string } & React.HTMLAttributes<HTMLDivElement>> = ({ symbol, className, ...rest }) => (
  <div {...rest} className={cn('flex flex-wrap items-center gap-2', className)}>
    <Button asChild variant="outline" size="sm">
      <Link href={stockReportHref(symbol)} target="_blank" rel="noopener">
        <FileText aria-hidden />
        AI 分析報告
      </Link>
    </Button>
    <Button asChild variant="outline" size="sm">
      <Link href={stockReportHref(symbol, true)} target="_blank" rel="noopener">
        <Download aria-hidden />
        下載 PDF
      </Link>
    </Button>
  </div>
);
