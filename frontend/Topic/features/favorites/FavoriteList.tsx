import React from 'react';
import { ArrowRight, RefreshCw, X } from 'lucide-react';
import { Ledger, LedgerPanel, LightGlyph } from '@/components/common/Ledger';
import { LightEntry } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { useFavorites } from '@/lib/favorites/FavoritesContext';

const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 收藏時間（ISO）轉成台北時間的 YYYY-MM-DD；剛加入、尚未回寫的項目沒有時間就不顯示 */
function taipeiDate(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : TAIPEI_YMD.format(d);
}

/**
 * 收藏股頁（/favorites）的收藏清單：每列可進個股頁，也可直接移除（樂觀更新，失敗會回復並提示；處理中的那一列先停用移除鈕）。
 * 列的排法跟條目列（LightEntry）一致：代號、名稱，名稱下方的燈質列放收藏日期。
 * 收藏 API（FavoriteStockResponse）只有代號、名稱與收藏時間，所以不顯示收盤與漲跌，也不為此另打 API。
 */
export function FavoriteList() {
  const { status, items, loadError, reload, remove, isPending } = useFavorites();

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
    // 載入＝燈質 Q：有線的空白列，並寫出「讀取中」
    content = (
      <div className="bg-card">
        <LoadingRows label="讀取收藏清單中…" className="h-[168px]" />
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
        {/* 收藏 API 只回代號、名稱與收藏時間；收盤與漲跌不在這裡另外查詢 */}
        <p className="border-b px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground sm:px-5">收盤與漲跌請到個股頁查看</p>
        <ul className="divide-y">
        {items.map(({ symbol, name, created_at }) => {
          const label = name ? `${symbol} ${name}` : symbol;
          const savedOn = taipeiDate(created_at);
          return (
            <li key={symbol}>
              <LightEntry
                symbol={symbol}
                name={name || symbol}
                meta={savedOn ? `收藏於 ${savedOn}` : undefined}
                hideQuote
                href={`/stock/${symbol}`}
                label={`看 ${label} 的收盤與走勢`}
                extra={
                  <>
                    <span aria-hidden className="hidden shrink-0 text-[13px] text-muted-foreground sm:inline">
                      收盤與走勢
                    </span>
                    <ArrowRight
                      size={16}
                      className="shrink-0 text-muted-foreground transition-transform duration-(--dur-flash) group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </>
                }
                // 列尾：取消收藏，44px 的 ghost 圖示鈕，放在連結外面避免巢狀互動元素
                trailing={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(symbol)}
                    disabled={isPending(symbol)}
                    aria-label={`移除收藏 ${label}`}
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
          {status === 'ready' ? `共 ${items.length} 檔` : status === 'error' ? '讀取失敗' : '讀取中'}
        </span>
      }
    >
      {content}
    </Ledger>
  );
}
