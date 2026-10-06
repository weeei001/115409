import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { StockSearch } from '@/components/common/StockSearch';
import { isNavPathActive, PRIMARY_NAV } from '@/lib/nav';
import { useStockInfos } from '@/lib/hooks/useStockInfos';
import { bulkSearchTarget } from '@/lib/utils/compareQuery';
import { cn } from '@/lib/cn';

/**
 * 頁首的主導覽（lg 以上顯示；手機用主選單抽屜）。目前頁用粗線標示，不用燈色。
 * 6 個項目加頁首搜尋在 1024 寬會擠到換行：標籤不換行，lg 的左右內距收窄，xl 再放寬
 */
export function PrimaryNav({ className }: { className?: string }) {
  const router = useRouter();
  const isActive = (path: string) => isNavPathActive(path, router.pathname);
  return (
    <nav aria-label="主導覽" className={cn('hidden items-stretch lg:flex', className)}>
      {PRIMARY_NAV.map((item) => {
        const active = isActive(item.path);
        return (
          <Link
            key={item.path}
            href={item.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-14 items-center border-b-2 px-2 text-sm whitespace-nowrap transition-colors duration-(--dur-flash) xl:px-3',
              active ? 'border-border-strong font-medium text-foreground dark:border-foreground' : 'border-transparent text-subtle hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 頁首、首頁的股票搜尋：貼上多個代號時的提示（行為見 bulkSearchTarget） */
export const NAV_SEARCH_BULK_HINT = '貼上多個代號會開啟多股比較';

/**
 * 頁首的股票搜尋：選了就到個股頁；貼上多個代號就到多股比較並帶入全部（P2-062）。
 * 清單來自 /stocks/info（有 30 秒快取）；還沒有清單時不顯示，showStatus 時改寫「載入中／載入失敗」。
 */
export function HeaderStockSearch({ className, autoFocus, showStatus = false }: { className?: string; autoFocus?: boolean; showStatus?: boolean }) {
  const router = useRouter();
  const { data, status, retry } = useStockInfos();
  const stockInfos = useMemo(() => data ?? [], [data]);

  const symbols = useMemo(() => stockInfos.map((s) => s.symbol), [stockInfos]);
  const go = useCallback((symbol: string) => void router.push(`/stock/${symbol}`), [router]);
  const bulk = useCallback(
    (input: string) => {
      const target = bulkSearchTarget(input, symbols);
      if (target) void router.push(target);
    },
    [symbols, router],
  );

  if (!symbols.length) {
    if (!showStatus) return null;
    return status === 'error' ? (
      <p className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
        股票清單載入失敗。
        <button type="button" onClick={retry} className="min-h-11 px-2 font-medium text-foreground underline underline-offset-4">重試</button>
      </p>
    ) : (
      <p className="flex min-h-11 items-center text-sm text-muted-foreground">{status === 'ready' ? '目前沒有可搜尋的股票。' : '股票清單載入中…'}</p>
    );
  }
  return (
    <StockSearch
      symbols={symbols}
      stockInfos={stockInfos}
      onSelect={go}
      onBulkSelect={bulk}
      placeholder="搜尋代號或公司名稱"
      bulkHint={NAV_SEARCH_BULK_HINT}
      autoFocus={autoFocus}
      className={className}
    />
  );
}
