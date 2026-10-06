import { useMemo, useState } from 'react';
import { Check, Plus, RefreshCw, Search } from 'lucide-react';
import { searchStockOptions } from '@/components/common/StockSearch';
import { Ledger, LedgerPanel, LightGlyph } from '@/components/common/Ledger';
import { LightEntry } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { useStockInfos } from '@/lib/hooks/useStockInfos';

const PAGE_SIZE = 10;

/** 在完整的股票名單裡搜尋，不離開頁面就能直接加入收藏 */
export function FavoriteStockSearch() {
  const favorites = useFavorites();
  const stockList = useStockInfos();
  const stocks = useMemo(() => stockList.data ?? [], [stockList.data]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const loading = stockList.status === 'idle' || stockList.status === 'loading';
  const error = stockList.status === 'error' ? userFacingMessage(stockList.error, '無法載入股票名單，請重試。') : null;

  const matches = useMemo(
    () => searchStockOptions(stocks.map((stock) => stock.symbol), stocks, query, stocks.length),
    [stocks, query],
  );

  return (
    <Ledger
      aria-labelledby="add-favorite-heading"
      title={<span id="add-favorite-heading">加入收藏股</span>}
      stamp={
        <span className="inline-flex items-center gap-1.5">
          <LightGlyph state={loading ? 'loading' : error ? 'error' : 'ready'} />
          {loading ? '載入股票名單' : error ? '載入失敗' : `可收藏 ${stocks.length} 檔`}
        </span>
      }
    >
      <LedgerPanel>
        <p id="favorite-search-help" className="text-[13px] leading-relaxed text-muted-foreground">搜尋股票後直接加入收藏清單。</p>
        <label htmlFor="favorite-stock-query" className="mt-4 block text-[13px] font-medium tracking-[0.04em] text-subtle">股票代號、公司名稱或產業</label>
        <div className="relative mt-1.5">
          <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <input
            id="favorite-stock-query"
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
            aria-describedby="favorite-search-help"
            placeholder="例如：2330、台積電、半導體"
            className={cn(inputClass, 'pr-3 pl-10')}
          />
        </div>
        {loading ? (
          <LoadingRows label="載入股票名單中…" className="mt-4 h-[132px]" />
        ) : error ? (
          <Notice tone="danger" className="mt-4" action={<Button variant="outline" onClick={stockList.retry}><RefreshCw aria-hidden />重試</Button>}>{error}</Notice>
        ) : (
          <>
            <p role="status" className="pt-3 pb-2 text-xs text-muted-foreground">
              {query.trim() ? `找到 ${matches.length} 檔股票` : `可收藏 ${stocks.length} 檔股票`}
              {matches.length > limit ? `，目前顯示 ${limit} 檔` : ''}
            </p>
            {matches.length === 0 ? (
              <EmptyState className="border-y py-6">{stocks.length === 0 ? '目前沒有可收藏的股票，請稍後重新載入。' : '找不到符合的股票，試試其他代號、公司名稱或產業。'}</EmptyState>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto border-y">
                {matches.slice(0, limit).map((stock) => {
                  const saved = favorites.isFavorite(stock.symbol);
                  const pending = favorites.isPending(stock.symbol);
                  const label = `${stock.symbol} ${stock.name}`;
                  return (
                    <li key={stock.symbol}>
                      <LightEntry
                        symbol={stock.symbol}
                        name={stock.name}
                        meta={stock.industry || undefined}
                        hideQuote
                        className="bg-transparent px-0 py-1.5 sm:px-0"
                        trailing={
                          <Button
                            variant={saved ? 'ghost' : 'outline'}
                            size="sm"
                            className="min-w-22 shrink-0"
                            disabled={saved || pending || favorites.status !== 'ready'}
                            aria-label={`${pending ? '處理中' : saved ? '已收藏' : '加入收藏'} ${label}`}
                            aria-busy={pending || undefined}
                            onClick={() => { if (!saved) favorites.toggle(stock.symbol); }}
                          >
                            {pending ? null : saved ? <Check aria-hidden /> : <Plus aria-hidden />}
                            {pending ? '處理中…' : saved ? '已收藏' : '加入'}
                          </Button>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {matches.length > limit && <Button variant="ghost" className="mt-2 w-full" onClick={() => setLimit((value) => value + PAGE_SIZE)}>顯示更多股票</Button>}
          </>
        )}
      </LedgerPanel>
    </Ledger>
  );
}
