import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { StockSearch } from '@/components/common/StockSearch';
import { fetchStockInfos } from '@/lib/api/stock';
import { PRIMARY_NAV } from '@/lib/nav';
import type { StockInfo } from '@/lib/types/api';
import { parseBulkSymbolInput } from '@/lib/utils/stockSelection';
import { cn } from '@/lib/cn';

/** 頁首的主導覽（lg 以上顯示；手機用主選單抽屜）。目前頁用粗線標示，不用燈色 */
export function PrimaryNav({ className }: { className?: string }) {
  const router = useRouter();
  const isActive = (path: string) => (path === '/' ? router.pathname === '/' : router.pathname.startsWith(path));
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
              'flex h-14 items-center border-b-2 px-3 text-sm transition-colors duration-(--dur-flash)',
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

/** 頁首的股票搜尋：選了就到個股頁。清單來自 /stocks/info（有 30 秒快取）；載入失敗就不顯示 */
export function HeaderStockSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [stockInfos, setStockInfos] = useState<StockInfo[]>([]);

  useEffect(() => {
    let active = true;
    fetchStockInfos()
      .then((list) => {
        if (active) setStockInfos(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const symbols = useMemo(() => stockInfos.map((s) => s.symbol), [stockInfos]);
  const go = useCallback((symbol: string) => void router.push(`/stock/${symbol}`), [router]);
  const bulk = useCallback(
    (input: string) => {
      const first = parseBulkSymbolInput(input).find((symbol) => symbols.includes(symbol));
      if (first) go(first);
    },
    [symbols, go],
  );

  if (!symbols.length) return null;
  return <StockSearch symbols={symbols} stockInfos={stockInfos} onSelect={go} onBulkSelect={bulk} placeholder="搜尋代號或公司名稱" className={className} />;
}
