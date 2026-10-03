import React from 'react';
import Link from 'next/link';
import { ChevronRight, RefreshCw, Star, X } from 'lucide-react';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFavorites } from '@/lib/favorites/FavoritesContext';

/** Saved stocks with direct stock links and optimistic removal. */
export function FavoriteList() {
  const { status, items, loadError, reload, remove, isPending } = useFavorites();

  let content: React.ReactNode;
  if (status === 'error') {
    content = (
      <Notice
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={reload} className="min-h-9">
            <RefreshCw aria-hidden />
            重試
          </Button>
        }
      >
        {loadError}
      </Notice>
    );
  } else if (status !== 'ready') {
    content = (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-lg" aria-hidden />
        ))}
        <span className="sr-only">載入收藏清單中…</span>
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6">
        <EmptyState className="py-0">尚未收藏股票，從上方搜尋並加入你關注的個股。</EmptyState>
        <Button size="sm" variant="outline" className="min-h-11" onClick={() => document.getElementById('favorite-stock-query')?.focus()}>
          搜尋股票
        </Button>
      </div>
    );
  } else {
    content = (
      <ul className="flex flex-col divide-y rounded-lg border">
        {items.map(({ symbol, name }) => {
          const label = name ? `${symbol} ${name}` : symbol;
          return (
            <li key={symbol} className="flex items-center gap-1 pr-1">
              <Link
                href={`/stock/${symbol}`}
                aria-label={`查看 ${label} 個股頁`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:text-brand-text"
              >
                <span className="font-mono font-semibold tabular-nums">{symbol}</span>
                <span className="min-w-0 flex-1 truncate text-subtle">{name}</span>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(symbol)}
                disabled={isPending(symbol)}
                aria-label={`移除收藏 ${label}`}
                className="size-11 shrink-0 rounded-full"
              >
                <X aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="favorites-heading" className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl">
          <Star size={18} className="text-on-brand" aria-hidden />
        </div>
        <h2 id="favorites-heading" className="text-base font-semibold">
          收藏清單
        </h2>
        {status === 'ready' && items.length > 0 ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">共 {items.length} 檔</span>
        ) : null}
      </div>
      {content}
    </section>
  );
}
