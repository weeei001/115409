import { useMemo, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { LightEntry } from '@/components/common/LightEntry';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import type { TerminalData, WatchRow } from './useTerminalData';
import { cn } from '@/lib/cn';

const MOBILE_COLLAPSED_ROWS = 8;
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

/** 觀測清單：全部收錄的股票，一檔一列條目，點了切換右邊的報價與圖表 */
export function Watchlist({ data, onSelect, quiet = false }: { data: TerminalData; onSelect: (symbol: string) => void; /** 上方已經有整體錯誤提示時，不再重複一次 */ quiet?: boolean }) {
  const { infos, watchState, watchRows, watchDates, selected } = data;
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupRows(watchRows), [watchRows]);
  /** 多數股票的資料日；和它不同的列才另外標日期 */
  const commonDate = watchDates[watchDates.length - 1] ?? null;

  if (infos.status === 'loading' && !infos.data) {
    return <LoadingRows label="讀取觀測清單…" className="h-[352px]" />;
  }
  if (infos.status === 'error' && quiet) return <EmptyState>股票清單沒有載入</EmptyState>;
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
  if (watchRows.length === 0) return <EmptyState>資料庫尚未匯入股票，匯入後這裡會依產業列出每一檔。</EmptyState>;

  let shown = 0;
  return (
    <div>
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
            <h4 className="border-b bg-muted px-4 py-1.5 text-xs font-medium tracking-[0.04em] text-muted-foreground sm:px-5">
              {group.name}
            </h4>
            <ul>
              {group.rows.map((row, i) => (
                <li key={row.symbol} className={cn('lg:snap-start', i < rows.length ? 'border-b' : 'hidden border-b lg:block')}>
                  <LightEntry
                    symbol={row.symbol}
                    name={row.name}
                    close={row.close}
                    change={row.change}
                    changePercent={row.changePercent}
                    date={row.date && row.date !== commonDate ? row.date : undefined}
                    selected={row.symbol === selected}
                    onSelect={onSelect}
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
