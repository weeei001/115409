import React from 'react';
import Link from 'next/link';
import type { ConversationSummary } from '@/lib/api/conversations';

interface Props {
  signedIn: boolean;
  ready: boolean;
  items: ConversationSummary[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onSearch: (value: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRetry: () => void;
  onMore: () => void;
}
const buttonClass = 'min-h-11 rounded-lg border px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';

export function ConversationHistory(props: Props) {
  return <aside aria-label="歷史對話" className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card p-3 lg:min-h-0 lg:w-60">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">歷史對話</h2>
      <button type="button" onClick={props.onNew} disabled={!props.ready} className={buttonClass}>新增對話</button>
    </div>
    {!props.ready ? <p role="status" className="text-sm text-muted-foreground">載入中…</p> : !props.signedIn ?
      <p className="text-sm text-muted-foreground"><Link href="/login?returnUrl=%2Fai" className="text-brand-text underline">登入</Link>後即可儲存、搜尋並繼續先前的對話。訪客對話離頁後不保留。</p> : <>
        <label htmlFor="conversation-search" className="sr-only">搜尋歷史對話標題與內容</label>
        <input id="conversation-search" type="search" value={props.search} maxLength={200}
          onChange={(event) => props.onSearch(event.target.value)} placeholder="搜尋標題與對話內容"
          className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2" />
        {props.error ? <div role="alert" className="text-sm"><p>{props.error}</p><button type="button" onClick={props.onRetry} className={`${buttonClass} mt-2`}>重試</button></div> : null}
        <div className="max-h-60 overflow-y-auto lg:min-h-0 lg:max-h-none lg:flex-1" aria-busy={props.loading}>
          <ul className="space-y-1">
            {props.items.map((item) => <li key={item.id}>
              <button type="button" onClick={() => props.onOpen(item.id)} aria-current={item.id === props.selectedId ? 'true' : undefined}
                className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 ${item.id === props.selectedId ? 'border-brand bg-accent' : 'border-transparent hover:bg-muted'}`}>
                <span className="line-clamp-2 break-words text-sm">{item.title || '新對話'}</span>
                <time dateTime={item.updated_at} className="mt-1 block text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              </button>
            </li>)}
          </ul>
          {props.loading ? <p role="status" className="p-3 text-sm text-muted-foreground">載入中…</p> : !props.error && !props.items.length ?
            <p role="status" className="p-3 text-sm text-muted-foreground">{props.search.trim() ? '找不到符合的對話。' : '尚無歷史對話，送出問題開始聊天。'}</p> : null}
          {props.hasMore ? <button type="button" onClick={props.onMore} disabled={props.loading} className={`${buttonClass} mt-2 w-full`}>載入更多</button> : null}
        </div>
      </>}
  </aside>;
}
