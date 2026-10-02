import React from 'react';
import Link from 'next/link';
import { ChevronRight, RefreshCw, Star, X } from 'lucide-react';
import { EmptyState, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFavorites } from '@/lib/favorites/FavoritesContext';

/** 個人中心的收藏清單：每列可進個股頁，也可直接移除（樂觀更新，失敗會回復並提示） */
export function FavoriteList() {
  const { status, items, loadError, reload, remove } = useFavorites();

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
        <EmptyState className="py-0">尚未收藏任何股票。到個股頁按標題旁的星號，就能加入收藏。</EmptyState>
        <Button asChild size="sm" variant="outline" className="min-h-9">
          <Link href="/">到首頁挑選股票</Link>
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
    <section aria-labelledby="me-favorites-heading" className="mt-8 border-t pt-8">
      <div className="mb-4 flex items-center gap-2">
        <div className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl">
          <Star size={18} className="text-on-brand" aria-hidden />
        </div>
        <h3 id="me-favorites-heading" className="text-base font-semibold">
          收藏股
        </h3>
        {status === 'ready' && items.length > 0 ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">共 {items.length} 檔</span>
        ) : null}
      </div>
      {content}
    </section>
  );
}
