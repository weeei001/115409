import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, X } from 'lucide-react';
import { Ledger, LedgerPanel, LightGlyph } from '@/components/common/Ledger';
import { LightEntry } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { shiftYmdMonths, toYmdLocal } from '@/lib/utils/date';
import { fetchFavoriteQuotes, favoriteLabel, latestQuoteDate, toastRemoved, type FavoriteQuote } from './favoriteFeedback';

const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 收藏時間（ISO）轉成台北時間的 YYYY-MM-DD；剛加入、尚未回寫的項目沒有時間就不顯示 */
function taipeiDate(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : TAIPEI_YMD.format(d);
}

type QuotesState = { status: 'idle' | 'loading' | 'ready' | 'error'; data: Record<string, FavoriteQuote>; error: string | null };

/** 收藏清單的收盤與漲跌：用 /stocks/compare/multiple 一次取近一個月的每日收盤（和首頁觀測清單同一支 API） */
function useFavoriteQuotes(symbols: string[]) {
  const key = symbols.join(',');
  const [state, setState] = useState<QuotesState>({ status: 'idle', data: {}, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) {
      setState({ status: 'idle', data: {}, error: null });
      return;
    }
    let active = true;
    const end = toYmdLocal();
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));
    fetchFavoriteQuotes(key.split(','), shiftYmdMonths(end, -1), end)
      .then((data) => { if (active) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (active) setState((prev) => ({ status: 'error', data: prev.data, error: userFacingMessage(err, '收盤與漲跌暫時無法取得。') })); });
    return () => { active = false; };
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/**
 * 收藏股頁（/favorites）的收藏清單：每列有收盤、漲跌與資料日（P1-29），可進個股頁，也可直接取消收藏
 * （樂觀更新，失敗會回復並提示；成功後有可「復原」的提示，P2-114；處理中的那一列先停用按鈕）。
 * 列的排法跟條目列（LightEntry）一致：代號、名稱，名稱下方的燈質列放資料日與收藏日期。
 */
export function FavoriteList() {
  const { status, items, loadError, reload, remove, add, isPending } = useFavorites();
  // 只抓後端確認過的收藏（加入中的那筆還沒有名稱，回應後就會進來）
  const savedSymbols = useMemo(() => items.filter((item) => item.created_at).map((item) => item.symbol).sort(), [items]);
  const quotes = useFavoriteQuotes(status === 'ready' ? savedSymbols : []);
  const commonDate = useMemo(() => latestQuoteDate(quotes.data), [quotes.data]);

  const cancel = (symbol: string, name: string) => {
    void remove(symbol).then((ok) => {
      if (ok) toastRemoved(symbol, name, add);
    });
  };

  let content: React.ReactNode;
  if (status === 'error') {
    content = (
      <LedgerPanel>
        <Notice
          tone="danger"
          action={
            <Button variant="outline" onClick={reload}>
              <RefreshCw aria-hidden />
              重試
            </Button>
          }
        >
          {loadError}
        </Notice>
      </LedgerPanel>
    );
  } else if (status !== 'ready') {
    // 載入＝燈質 Q：有線的空白列，並寫出「載入中」
    content = (
      <div className="bg-card">
        <LoadingRows label="載入收藏清單中…" className="h-[168px]" />
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <LedgerPanel>
        <EmptyState
          className="py-6"
          action={
            // 搜尋框在同一頁的「加入收藏股」（FavoriteStockSearch；桌機在右欄、手機在清單下方）
            <Button variant="outline" className="mt-2" onClick={() => document.getElementById('favorite-stock-query')?.focus()}>
              搜尋股票
            </Button>
          }
        >
          尚未收藏股票，用「加入收藏股」搜尋並加入你關注的個股。
        </EmptyState>
      </LedgerPanel>
    );
  } else {
    content = (
      <div className="bg-card">
        {quotes.status === 'error' ? (
          <div className="border-b p-4 sm:px-5">
            <Notice
              tone="danger"
              action={
                <Button variant="outline" size="sm" onClick={quotes.retry}>
                  <RefreshCw aria-hidden />
                  重試
                </Button>
              }
            >
              {quotes.error}
            </Notice>
          </div>
        ) : quotes.status === 'loading' && !Object.keys(quotes.data).length ? (
          <p className="border-b px-4 py-2.5 text-[13px] text-muted-foreground sm:px-5" aria-live="polite">收盤與漲跌載入中…</p>
        ) : commonDate ? (
          // 資料日只寫一次；和多數不同的那幾檔才在列上另外標（和首頁觀測清單同一種做法）
          <p className="border-b px-4 py-2 text-[13px] text-muted-foreground sm:px-5">收盤 <span className="font-mono tabular-nums">{commonDate}</span> · 非即時</p>
        ) : null}
        <ul className="divide-y">
        {items.map(({ symbol, name, created_at }) => {
          const label = favoriteLabel(symbol, name);
          const savedOn = taipeiDate(created_at);
          const quote = quotes.data[symbol];
          const otherDate = quote?.date && quote.date !== commonDate ? `收 ${quote.date}` : null;
          const full = [otherDate, savedOn ? `收藏於 ${savedOn}` : null].filter(Boolean).join(' · ');
          // 手機的名稱欄很窄：只放和多數不同的資料日，收藏日期留給較寬的畫面
          const meta = full ? <><span className="sm:hidden">{otherDate}</span><span className="hidden sm:inline">{full}</span></> : undefined;
          return (
            <li key={symbol}>
              <LightEntry
                symbol={symbol}
                name={name || symbol}
                meta={meta}
                close={quote?.close ?? null}
                change={quote?.change ?? null}
                changePercent={quote?.changePercent ?? null}
                href={`/stock/${symbol}`}
                label={`看 ${label} 的行情`}
                extra={
                  <>
                    <span aria-hidden className="hidden shrink-0 text-[13px] text-muted-foreground sm:inline">
                      看行情
                    </span>
                    <ArrowRight
                      size={16}
                      className="hidden shrink-0 text-muted-foreground sm:block transition-transform duration-(--dur-flash) group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </>
                }
                // 列尾：取消收藏，44px 的 ghost 圖示鈕，放在連結外面避免巢狀互動元素
                trailing={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => cancel(symbol, name)}
                    disabled={isPending(symbol)}
                    aria-label={`取消收藏 ${label}`}
                    title="取消收藏"
                    className="mr-1 shrink-0 self-center text-muted-foreground hover:text-foreground sm:mr-2"
                  >
                    <X aria-hidden />
                  </Button>
                }
              />
            </li>
          );
        })}
        </ul>
      </div>
    );
  }

  return (
    <Ledger
      aria-labelledby="favorites-heading"
      title={<span id="favorites-heading">收藏清單</span>}
      stamp={
        // 燈質記號：讀取中 Q、讀取失敗熄燈、讀到了 F（空清單也是讀到了）
        <span className="inline-flex items-center gap-1.5">
          <LightGlyph state={status === 'error' ? 'error' : status === 'ready' ? 'ready' : 'loading'} />
          {status === 'ready' ? `共 ${items.length} 檔` : status === 'error' ? '載入失敗' : '載入中'}
        </span>
      }
    >
      {content}
    </Ledger>
  );
}
