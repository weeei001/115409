import React, { useMemo, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { LightEntry } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import type { TerminalData, WatchRow } from './useTerminalData';
import { cn } from '@/lib/cn';

const MOBILE_COLLAPSED_ROWS = 8;

/** 沒有任何股票資料時（清單是空的）：只說現況與下一步，不寫資料管線的維運用語（P1-25） */
export const NO_STOCKS_TEXT = '目前沒有股票資料，請稍後再來看。';
const FAVORITE_GROUP = '收藏';
const NO_INDUSTRY = '未分類';

interface Group {
  name: string;
  rows: WatchRow[];
}

/** 收藏排最前面，其餘依產業分組（燈塔表依海岸分組） */
function groupRows(rows: WatchRow[]): Group[] {
  const favorites = rows.filter((r) => r.favorite);
  const byIndustry = new Map<string, WatchRow[]>();
  for (const row of rows) {
    if (row.favorite) continue;
    const key = row.industry || NO_INDUSTRY;
    const list = byIndustry.get(key);
    if (list) list.push(row);
    else byIndustry.set(key, [row]);
  }
  const groups = Array.from(byIndustry, ([name, list]) => ({ name, rows: list })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return favorites.length ? [{ name: FAVORITE_GROUP, rows: favorites }, ...groups] : groups;
}

/**
 * 清單內的上下鍵移動（roving tabindex）：回傳要移到第幾列，不是移動鍵就回 null。
 * 停在頭尾不繞回，跟原生清單一樣。
 */
export function rovingIndex(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, current + 1);
    case 'ArrowUp':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * 整份清單的 Tab 停駐點：上次聚焦的列，否則目前選中的那一檔，否則第一列。
 * 手機收合時只有前幾列看得到：停駐點在收合的範圍外，就另外讓第一列也能 Tab 進來（不然整份清單 Tab 不到）。
 */
export function watchTabStops(order: string[], focused: string | null, selected: string | null, collapsedRows: number | null): Set<string> {
  const pick = [focused, selected, order[0]].find((symbol): symbol is string => Boolean(symbol && order.includes(symbol)));
  const stops = new Set<string>();
  if (!pick) return stops;
  stops.add(pick);
  if (collapsedRows != null && order.indexOf(pick) >= collapsedRows && order[0]) stops.add(order[0]);
  return stops;
}

/**
 * 觀測清單：全部收錄的股票，一檔一列條目，點了切換右邊的報價與圖表。
 * 整份清單只佔一個 Tab 停駐點，列與列之間用上下鍵、Home、End 移動（P2-083、03-F15）。
 */
export function Watchlist({ data, onSelect, quiet = false, describedBy }: { data: TerminalData; onSelect: (symbol: string) => void; /** 上方已經有整體錯誤提示時，不再重複一次 */ quiet?: boolean; /** 清單說明（觀測台的副標）的 id */ describedBy?: string }) {
  const { infos, watchState, watchRows, watchDates, selected } = data;
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const groups = useMemo(() => groupRows(watchRows), [watchRows]);
  const order = useMemo(() => groups.flatMap((group) => group.rows.map((row) => row.symbol)), [groups]);
  const tabStops = watchTabStops(order, focused, selected, expanded ? null : MOBILE_COLLAPSED_ROWS);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>('li[data-symbol]');
    if (!current) return;
    // 只在看得到的列之間移動（手機收合的列是 display:none）
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('li[data-symbol]')).filter((li) => li.getClientRects().length > 0);
    const next = rovingIndex(rows.length, rows.indexOf(current), event.key);
    if (next == null) return;
    event.preventDefault();
    rows[next]?.querySelector<HTMLButtonElement>('button')?.focus();
  };
  /** 多數股票的資料日；和它不同的列才另外標日期 */
  const commonDate = watchDates[watchDates.length - 1] ?? null;

  if (infos.status === 'loading' && !infos.data) {
    return <LoadingRows label="載入觀測清單…" className="h-[352px]" />;
  }
  if (infos.status === 'error' && quiet) return <EmptyState>股票清單載入失敗</EmptyState>;
  if (infos.status === 'error') {
    return (
      <div className="p-4">
        <Notice
          tone="danger"
          action={
            <Button size="sm" variant="outline" onClick={infos.reload}>
              <RefreshCw aria-hidden />
              重試
            </Button>
          }
        >
          {infos.error}
        </Notice>
      </div>
    );
  }
  if (watchRows.length === 0) return <EmptyState>{NO_STOCKS_TEXT}</EmptyState>;

  let shown = 0;
  return (
    <div
      role="group"
      aria-label="觀測清單"
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const symbol = (event.target as HTMLElement).closest<HTMLElement>('li[data-symbol]')?.dataset.symbol;
        if (symbol) setFocused(symbol);
      }}
    >
      {watchState.status === 'error' ? (
        <div className="p-4">
          <Notice
            tone="danger"
            action={
              <Button size="sm" variant="outline" onClick={watchState.reload}>
                <RefreshCw aria-hidden />
                重試
              </Button>
            }
          >
            {watchState.error}
          </Notice>
        </div>
      ) : null}
      {groups.map((group) => {
        const rows = group.rows.filter(() => {
          shown += 1;
          return expanded || shown <= MOBILE_COLLAPSED_ROWS;
        });
        return (
          <section key={group.name} aria-label={group.name} className={rows.length ? undefined : 'hidden lg:block'}>
            {/* 分組標題也是吸附點：清單捲回頂端時「收藏」標題不會被吸附藏起來（P2-082、04-H2） */}
            <h4 className="border-b bg-muted px-4 py-1.5 text-xs font-medium tracking-[0.04em] text-muted-foreground lg:snap-start sm:px-5">
              {group.name}
            </h4>
            <ul>
              {group.rows.map((row, i) => (
                <li key={row.symbol} data-symbol={row.symbol} className={cn('lg:snap-start', i < rows.length ? 'border-b' : 'hidden border-b lg:block')}>
                  <LightEntry
                    symbol={row.symbol}
                    name={row.name}
                    close={row.close}
                    change={row.change}
                    changePercent={row.changePercent}
                    date={row.date && row.date !== commonDate ? row.date : undefined}
                    selected={row.symbol === selected}
                    onSelect={onSelect}
                    tabIndex={tabStops.has(row.symbol) ? 0 : -1}
                    className="focus-lamp-inset"
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!expanded && watchRows.length > MOBILE_COLLAPSED_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="lamp-row flex min-h-11 w-full items-center justify-center gap-2 bg-card px-4 text-sm font-medium lg:hidden"
        >
          展開全部 {watchRows.length} 檔
          <ChevronDown size={16} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
