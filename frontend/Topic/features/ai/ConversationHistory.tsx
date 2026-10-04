import Link from 'next/link';
import { ChevronDown, LogIn, Plus } from 'lucide-react';
import type { ConversationSummary } from '@/lib/api/conversations';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { LightGlyph } from '@/components/common/Ledger';
import { cn } from '@/lib/cn';
import { inputClass } from '@/components/ui/input';
import { formatTaipei } from '@/lib/utils/date';

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
  /**
   * panel：lg 以上的左欄（預設）。sheet：放在手機的歷史對話抽屜裡，清單填滿抽屜高度，
   * 標題列右側留位置給抽屜的關閉鈕，搜尋框換一個 id（避免和隱藏中的左欄重複）。
   */
  variant?: 'panel' | 'sheet';
}

/** 日誌索引的日期欄：月／日 時:分（24 小時制，等寬對齊） */
function formatUpdatedAt(value: string): string {
  return formatTaipei(value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * 歷史對話＝值班日誌的索引。
 * 登入：上方搜尋、每列「日期＋標題」，選取列用燈色標線；訪客：一則定光說明加登入動作。
 */
export function ConversationHistory(props: Props) {
  const sheet = props.variant === 'sheet';
  const searchId = sheet ? 'conversation-search-sheet' : 'conversation-search';
  return (
    <aside aria-label="歷史對話" className={cn('flex min-w-0 flex-col bg-card', sheet ? 'min-h-0 flex-1' : 'shrink-0 lg:min-h-0 lg:w-72')}>
      <div className={cn('flex min-h-14 items-center justify-between gap-2 border-b border-border-strong py-1.5 pl-4', sheet ? 'pr-16' : 'pr-1.5')}>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="font-serif text-xl leading-snug font-black tracking-[0.06em]">歷史對話</h2>
          {/* 燈質記號：清單讀取中 Q、已載入 F、失敗熄燈；訪客沒有清單就不放 */}
          {!props.ready ? <LightGlyph state="loading" /> : props.signedIn
            ? <LightGlyph state={props.loading ? 'loading' : props.error ? 'error' : 'ready'} /> : null}
        </div>
        <Button type="button" variant="ghost" onClick={props.onNew} disabled={!props.ready} className="px-3">
          <Plus aria-hidden className="text-muted-foreground" />
          新增對話
        </Button>
      </div>
      {/* 載入＝燈質 Q（LoadingRows）；空資料＝燈質 F（EmptyState），能給下一步就附動作 */}
      {!props.ready ? <LoadingRows label="讀取對話紀錄…" className="h-[132px]" /> : !props.signedIn ? (
        <EmptyState
          className="px-4 py-6 text-[13px]"
          action={(
            <Button asChild variant="outline">
              <Link href="/login?returnUrl=%2Fai">
                <LogIn aria-hidden className="text-muted-foreground" />
                登入
              </Link>
            </Button>
          )}
        >
          登入後即可儲存、搜尋並繼續先前的對話。訪客對話離頁後不保留。
        </EmptyState>
      ) : <>
        <div className="border-b p-3">
          <label htmlFor={searchId} className="sr-only">搜尋歷史對話標題與內容</label>
          <input id={searchId} type="search" value={props.search} maxLength={200}
            onChange={(event) => props.onSearch(event.target.value)} placeholder="搜尋標題與對話內容"
            className={inputClass} />
        </div>
        {props.error ? (
          <div className="border-b p-3">
            <Notice tone="danger" action={<Button type="button" variant="outline" size="sm" onClick={props.onRetry} className="min-h-11">重試</Button>}>
              {props.error}
            </Notice>
          </div>
        ) : null}
        <div className={cn('overflow-y-auto', sheet ? 'min-h-0 flex-1 overscroll-y-contain' : 'max-h-72 overscroll-y-contain lg:max-h-none lg:min-h-0 lg:flex-1')} aria-busy={props.loading}>
          {props.items.length ? (
            <ul className="divide-y border-b">
              {props.items.map((item) => {
                const selected = item.id === props.selectedId;
                return <li key={item.id}>
                  <button type="button" onClick={() => props.onOpen(item.id)} aria-current={selected ? 'true' : undefined}
                    data-selected={selected ? 'true' : undefined}
                    className="lamp-row flex min-h-14 w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left focus-lamp-inset">
                    <time dateTime={item.updated_at} className="characteristic">{formatUpdatedAt(item.updated_at)}</time>
                    <span className={cn('line-clamp-2 text-sm break-words', selected ? 'font-medium text-foreground' : 'text-subtle')}>{item.title || '新對話'}</span>
                  </button>
                </li>;
              })}
            </ul>
          ) : null}
          {props.loading ? <LoadingRows label="讀取對話紀錄…" className={props.items.length ? 'h-11' : 'h-[132px]'} /> : !props.error && !props.items.length ? (
            <div role="status">
              {props.search.trim() ? (
                <EmptyState
                  className="px-4 text-[13px]"
                  action={<Button type="button" variant="outline" onClick={() => props.onSearch('')}>清除搜尋</Button>}
                >
                  找不到符合的對話。
                </EmptyState>
              ) : (
                <EmptyState className="px-4 text-[13px]">尚無歷史對話，送出問題開始聊天。</EmptyState>
              )}
            </div>
          ) : null}
          {props.hasMore ? (
            <button type="button" onClick={props.onMore} disabled={props.loading}
              className="lamp-row flex min-h-11 w-full items-center justify-between gap-3 border-b px-4 py-2.5 text-left text-sm font-medium focus-lamp-inset disabled:opacity-50">
              <span>載入更多</span>
              <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ) : null}
        </div>
      </>}
    </aside>
  );
}
