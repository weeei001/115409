import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import { searchStockOptions } from '@/components/common/StockSearch';
import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { fetchStockInfos } from '@/lib/api/stock';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import type { StockInfo } from '@/lib/types/api';

const PAGE_SIZE = 10;

/** Search the complete service catalog and save stocks without leaving the page. */
export function FavoriteStockSearch() {
  const favorites = useFavorites();
  const [stocks, setStocks] = useState<StockInfo[]>([]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchStockInfos()
      .then((data) => { if (active) setStocks(data); })
      .catch((err) => { if (active) setError(userFacingMessage(err, '無法載入股票名單，請重試。')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const matches = useMemo(
    () => searchStockOptions(stocks.map((stock) => stock.symbol), stocks, query, stocks.length),
    [stocks, query],
  );

  return (
    <section aria-labelledby="add-favorite-heading" className="mb-6 rounded-2xl border bg-card p-5 sm:p-6">
      <h2 id="add-favorite-heading" className="text-lg font-semibold">加入收藏股</h2>
      <p id="favorite-search-help" className="mt-1 text-sm text-muted-foreground">搜尋股票後直接加入，在這裡建立你的關注清單。</p>
      <label htmlFor="favorite-stock-query" className="mt-5 block text-sm font-medium">股票代號、公司名稱或產業</label>
      <div className="relative mt-2">
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          id="favorite-stock-query"
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
          aria-describedby="favorite-search-help"
          placeholder="例如：2330、台積電、半導體"
          className="min-h-11 w-full rounded-xl border border-input bg-background py-2 pl-10 pr-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 sm:text-sm"
        />
      </div>
      {loading ? (
        <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" aria-hidden />載入股票名單中…</p>
      ) : error ? (
        <Notice tone="danger" className="mt-4" action={<Button variant="outline" className="min-h-11" onClick={() => setAttempt((value) => value + 1)}>重試</Button>}>{error}</Notice>
      ) : (
        <>
          <p role="status" className="py-3 text-xs text-muted-foreground">
            {query.trim() ? `找到 ${matches.length} 檔股票` : `可收藏 ${stocks.length} 檔股票`}
            {matches.length > limit ? `，目前顯示 ${limit} 檔` : ''}
          </p>
          {matches.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{stocks.length === 0 ? '目前沒有可收藏的股票，請稍後重新載入。' : '找不到符合的股票，試試其他代號、公司名稱或產業。'}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y border-y">
              {matches.slice(0, limit).map((stock) => {
                const saved = favorites.isFavorite(stock.symbol);
                const pending = favorites.isPending(stock.symbol);
                const label = `${stock.symbol} ${stock.name}`;
                return (
                  <li key={stock.symbol} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium"><span className="mr-2 tabular-nums text-subtle">{stock.symbol}</span>{stock.name}</p>
                      {stock.industry && <p className="mt-1 text-xs text-muted-foreground">{stock.industry}</p>}
                    </div>
                    <Button
                      variant={saved ? 'ghost' : 'outline'}
                      className="min-h-11 min-w-24"
                      disabled={saved || pending || favorites.status !== 'ready'}
                      aria-label={`${pending ? '處理中' : saved ? '已收藏' : '加入收藏'} ${label}`}
                      aria-busy={pending || undefined}
                      onClick={() => { if (!saved) favorites.toggle(stock.symbol); }}
                    >
                      {pending ? <Loader2 className="animate-spin" aria-hidden /> : saved ? <Check aria-hidden /> : <Plus aria-hidden />}
                      {pending ? '處理中' : saved ? '已收藏' : '加入'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {matches.length > limit && <Button variant="ghost" className="mt-3 min-h-11 w-full" onClick={() => setLimit((value) => value + PAGE_SIZE)}>顯示更多股票</Button>}
        </>
      )}
    </section>
  );
}
