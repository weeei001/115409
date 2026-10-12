import { useState } from 'react';
import Router from 'next/router';
import { Download, ImageDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { refreshPlan, useCurrentPlan } from '@/features/pricing/currentPlan';
import { EXPORT_MIN_PLAN } from '@/features/pricing/plans';
import { downloadBlob, downloadCsv, type CsvTable } from '@/lib/export/csv';
import { cn } from '@/lib/cn';

/**
 * 匯出是專業版的工具（方案比較表「表格匯出 CSV、圖表存成圖片」）。
 * 匯出在瀏覽器端產生檔案，只在畫面上依方案開放；按鈕所有方案都看得到，未開放時按下去說明要哪個方案。
 */
function useExportGate() {
  const plan = useCurrentPlan();
  return (run: () => void | Promise<void>) => {
    if (!plan.ready) {
      void refreshPlan();
      toast.message('正在確認目前方案，請稍後再試一次。');
      return;
    }
    if (plan.planId !== EXPORT_MIN_PLAN) {
      toast.message('匯出是專業版的工具', {
        description: '專業版可以把表格匯出成 CSV、把圖表存成圖片，檔案會附資料來源與日期。',
        // 用 Router 單例：按鈕也會出現在沒有 router context 的靜態渲染（測試）裡
        action: { label: '查看方案', onClick: () => void Router.push('/pricing') },
      });
      return;
    }
    return run();
  };
}

const buttonClass = 'min-h-11 gap-1.5 text-[13px]';

/** 匯出 CSV：build 在按下時才組表格，回傳 null 表示沒有資料 */
export function CsvExportButton({ build, fileName, label = '匯出 CSV', className }: {
  build: () => CsvTable | null;
  fileName: string;
  label?: string;
  className?: string;
}) {
  const gate = useExportGate();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn(buttonClass, className)}
      onClick={() =>
        gate(() => {
          const table = build();
          if (!table || !table.rows.length) {
            toast.message('目前沒有可匯出的資料');
            return;
          }
          downloadCsv(table, fileName);
          toast.success(`已匯出 ${fileName}`);
        })
      }
    >
      <Download aria-hidden className="size-4" />
      {label}
    </Button>
  );
}

/** 存成圖片：capture 產生 PNG；圖表還沒畫好時回傳 null */
export function ImageExportButton({ capture, fileName, label = '存成圖片', className }: {
  capture: () => Promise<Blob | null>;
  fileName: string;
  label?: string;
  className?: string;
}) {
  const gate = useExportGate();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn(buttonClass, className)}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() =>
        gate(async () => {
          setBusy(true);
          try {
            const blob = await capture();
            if (!blob) {
              toast.message('圖表還沒畫好，請稍後再試。');
              return;
            }
            downloadBlob(blob, fileName);
            toast.success(`已存成 ${fileName}`);
          } catch {
            toast.error('圖片沒有存成，請稍後再試。');
          } finally {
            setBusy(false);
          }
        })
      }
    >
      <ImageDown aria-hidden className="size-4" />
      {busy ? '處理中…' : label}
    </Button>
  );
}
