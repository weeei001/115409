import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ChevronDown, LogIn, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from 'lucide-react';
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
  /** 每列尾端的刪除鈕；按下並在確認框按「確定」後才呼叫 */
  onDelete?: (item: ConversationSummary) => void;
  /** 正在刪除的那一則：所有刪除鈕停用，那一列標 aria-busy */
  deletingId?: string | null;
  /**
   * panel：lg 以上的左欄（預設）。sheet：放在手機的歷史對話抽屜裡，清單填滿抽屜高度，
   * 標題列右側留位置給抽屜的關閉鈕，搜尋框換一個 id（避免和隱藏中的左欄重複）。
   */
  variant?: 'panel' | 'sheet';
  /** panel 才有：收合成細條（只留展開與新增對話），把寬度讓給對話與資料 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
  /** 收合／展開時按鈕換成另一顆：焦點跟到新的那顆，鍵盤使用者不會掉回頁首 */
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    toggleRef.current?.focus();
  }, [props.collapsed]);
  const toggle = () => {
    refocus.current = true;
    props.onToggleCollapsed?.();
  };
  /** 刪掉一列後焦點移到同一個位置的下一列（刪的是最後一列就往上一列，清單空了就到搜尋框），鍵盤使用者不會掉回頁首 */
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const deletedRow = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const pending = deletedRow.current;
    if (!pending) return;
    if (props.items.some((item) => item.id === pending.id)) {
      // 已經不在刪除中、那一列還在＝刪除失敗：不移焦點
      if (props.deletingId !== pending.id) deletedRow.current = null;
      return;
    }
    deletedRow.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-conversation-open]') ?? [];
    (rows[Math.min(pending.index, rows.length - 1)] ?? searchRef.current)?.focus();
  }, [props.items, props.deletingId]);
  const remove = (item: ConversationSummary, index: number) => {
    if (props.deletingId) return;
    if (!window.confirm(`刪除「${item.title || '新對話'}」？對話內容與回饋會一併刪除，無法復原。`)) return;
    deletedRow.current = { id: item.id, index };
    props.onDelete?.(item);
  };
  /* 燈質記號：清單讀取中 Q、已載入 F、失敗熄燈；訪客沒有清單就不放 */
  const glyph = !props.ready ? <LightGlyph state="loading" /> : props.signedIn
    ? <LightGlyph state={props.loading ? 'loading' : props.error ? 'error' : 'ready'} /> : null;

  if (!sheet && props.collapsed) {
    // 細條：頂端一格和其他欄的標題列同高，底下是新增對話；訪客多一顆登入（展開時的登入說明收在細條裡看不到）
    return (
      <aside aria-label="歷史對話" className="flex w-14 shrink-0 flex-col items-center bg-card lg:min-h-0">
        <h2 className="sr-only">歷史對話</h2>
        <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-border-strong">
          <Button ref={toggleRef} type="button" variant="ghost" size="icon" onClick={toggle} aria-expanded={false}
            aria-label="展開歷史對話" title="展開歷史對話" className="text-muted-foreground hover:text-foreground">
            <PanelLeftOpen className="size-[18px]" aria-hidden />
          </Button>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={props.onNew} disabled={!props.ready}
          aria-label="新增對話" title="新增對話" className="mt-1.5 text-muted-foreground hover:text-foreground">
          <Plus className="size-[18px]" aria-hidden />
        </Button>
        {props.ready && !props.signedIn ? (
          <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Link href="/login?returnUrl=%2Fai" aria-label="登入以儲存對話" title="登入以儲存對話">
              <LogIn className="size-[18px]" aria-hidden />
            </Link>
          </Button>
        ) : null}
      </aside>
    );
  }

  return (
    <aside aria-label="歷史對話" className={cn('flex min-w-0 flex-col bg-card', sheet ? 'min-h-0 flex-1' : 'shrink-0 lg:min-h-0 lg:w-72')}>
      {/* 和對話欄、資料欄的標題列同高（h-14），三欄的粗線連成一條 */}
      <div className={cn('flex h-14 shrink-0 items-center justify-between gap-1 border-b border-border-strong pl-4', sheet ? 'pr-16' : 'pr-1.5')}>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="font-serif text-xl leading-snug font-black tracking-[0.06em]">歷史對話</h2>
          {glyph}
        </div>
        <div className="flex shrink-0 items-center">
          <Button type="button" variant="ghost" onClick={props.onNew} disabled={!props.ready} className="px-3">
            <Plus aria-hidden className="text-muted-foreground" />
            新增對話
          </Button>
          {!sheet && props.onToggleCollapsed ? (
            <Button ref={toggleRef} type="button" variant="ghost" size="icon" onClick={toggle} aria-expanded
              aria-label="收合歷史對話" title="收合歷史對話" className="text-muted-foreground hover:text-foreground">
              <PanelLeftClose className="size-[18px]" aria-hidden />
            </Button>
          ) : null}
        </div>
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
          <input ref={searchRef} id={searchId} type="search" value={props.search} maxLength={200}
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
            <ul ref={listRef} className="divide-y border-b">
              {props.items.map((item, index) => {
                const selected = item.id === props.selectedId;
                const title = item.title || '新對話';
                // 刪除鈕疊在列尾（不放進開啟鈕裡，避免巢狀互動元素）；開啟鈕右側留位置，hover 與選取的底色仍是整列
                return <li key={item.id} className="relative" aria-busy={props.deletingId === item.id || undefined}>
                  <button type="button" data-conversation-open onClick={() => props.onOpen(item.id)} aria-current={selected ? 'true' : undefined}
                    data-selected={selected ? 'true' : undefined}
                    className={cn('lamp-row flex min-h-14 w-full flex-col items-start gap-0.5 py-2.5 pl-4 text-left focus-lamp-inset', props.onDelete ? 'pr-14' : 'pr-4')}>
                    <time dateTime={item.updated_at} className="characteristic">{formatUpdatedAt(item.updated_at)}</time>
                    <span className={cn('line-clamp-2 text-sm break-words', selected ? 'font-medium text-foreground' : 'text-subtle')}>{title}</span>
                  </button>
                  {/* 刪除中用 aria-disabled 而不是 disabled：按下的那顆停用會讓焦點掉回頁首，刪除失敗時鍵盤使用者就找不到位置 */}
                  {props.onDelete ? (
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(item, index)} aria-disabled={props.deletingId ? true : undefined}
                      aria-label={`刪除對話：${title}`} title="刪除對話"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-lamp-inset aria-disabled:opacity-50">
                      <Trash2 className="size-[18px]" aria-hidden />
                    </Button>
                  ) : null}
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
