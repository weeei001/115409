import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Ledger } from '@/components/common/Ledger';
import { Input } from '@/components/ui/input';
import { EmptyState, Notice } from '@/components/common/Notice';
import apiClient from '@/lib/api/client';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { canStartAdminJob } from '@/lib/api/admin';
import type { AdminJob, AdminList, AdminStock } from '@/lib/api/admin';

export function StockManagement({ checkedAt, disabled, backfillJob, schedulerRunning, onAdd, onBackfill, onAccessError, onViewRuns }: {
  checkedAt: string; disabled: boolean; backfillJob?: AdminJob; schedulerRunning: boolean;
  onAdd: (stock: AdminStock) => void; onBackfill: (stock: AdminStock) => void;
  onAccessError: (error: unknown) => boolean; onViewRuns: () => void;
}) {
  const [query, setQuery] = useState('');
  const [stocks, setStocks] = useState<AdminStock[]>([]);
  const [catalogAvailable, setCatalogAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void apiClient.get<AdminList<AdminStock> & { catalog_available: boolean }>('/admin/stocks', { signal: controller.signal, params: { query: query.trim() } })
        .then(({ data }) => { if (!controller.signal.aborted) { setStocks(data.items); setCatalogAvailable(data.catalog_available); setError(null); } })
        .catch((err: unknown) => { if (!controller.signal.aborted && !onAccessError(err)) setError(userFacingMessage(err, '無法載入股票目錄，請重新載入。')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, checkedAt, attempt, onAccessError]);
  const canBackfill = schedulerRunning && backfillJob && canStartAdminJob(backfillJob);
  return <Ledger aria-labelledby="stocks-heading" title={<span id="stocks-heading">股票管理</span>}>
    <div className="min-w-0 bg-card">
    <div className="space-y-2 border-b p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">從公司目錄加入股票，後續行情更新會一併處理。加入後可手動回補近兩年的開高低收、成交量、估值、技術指標與法人資料。</p>
      <p className="text-xs text-muted-foreground">透過 FinMind 回補，可取得範圍依來源資料與 API 額度而定；新上市股票可能不足兩年。</p>
      <Button variant="outline" onClick={onViewRuns}>查看回補進度與執行紀錄</Button>
    </div>
    <div className="space-y-3 p-4 sm:p-5">
      <label htmlFor="stock-catalog-query" className="block text-sm font-medium">搜尋股票代碼或公司名稱</label>
      <Input id="stock-catalog-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：2330 或台積電" maxLength={100} className="min-h-11" />
      {!canBackfill ? <p className="text-xs text-muted-foreground">{!schedulerRunning ? '排程器未運作，目前可加入股票，恢復後即可回補。' : '回補工作執行中、已排入等待，或尚未就緒；完成後即可提交下一檔。'}</p> : null}
      {!catalogAvailable && !loading ? <Notice tone="warning">公司目錄尚未備妥，請先至工作與執行紀錄執行行情更新，再重新載入。現有股票仍可回補。</Notice> : null}
      {error ? <div role="alert"><Notice tone="warning">{error}</Notice><Button variant="outline" className="mt-2" onClick={() => setAttempt((value) => value + 1)}>重新載入</Button></div> : null}
    </div>
    <div aria-busy={loading}>
      {loading ? <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">載入股票目錄中…</p> : null}
      {!error ? <>
        <p role="status" className="px-4 pb-3 text-xs text-muted-foreground">共 {stocks.length} 檔，已加入 {stocks.filter((stock) => stock.supported).length} 檔</p>
        <ul className="max-h-[36rem] divide-y overflow-y-auto border-t">{stocks.map((stock) => <li key={stock.symbol} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
          <div><p className="text-sm font-medium">{stock.symbol} {stock.name}</p><p className="mt-1 text-xs text-muted-foreground">{[stock.market, stock.industry, stock.supported ? '已加入' : '尚未加入'].filter(Boolean).join(' · ')}</p></div>
          {stock.supported ? <Button variant="outline" className="min-h-11" disabled={disabled || !canBackfill} aria-label={`回補 ${stock.symbol} ${stock.name} 近兩年市場資料`} onClick={() => onBackfill(stock)}>回補近兩年</Button>
            : <Button className="min-h-11" disabled={disabled} aria-label={`加入 ${stock.symbol} ${stock.name}`} onClick={() => onAdd(stock)}>加入股票</Button>}
        </li>)}</ul>
        {!loading && !stocks.length ? <EmptyState>找不到符合條件的股票。</EmptyState> : null}
      </> : null}
    </div>
    </div>
  </Ledger>;
}
