import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Ledger, LightGlyph, type LightState } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface AnalysisEntry {
  key: string;
  name: string;
  /** 由頁面上已算好的值挑出的一句發現；挑不出時為 null，改顯示 description */
  finding: string | null;
  /** 這項分析裡有什麼（finding 為 null 時顯示） */
  description: string;
  /** 打開後才掛載的內容（圖表在 0 寬容器裡不初始化） */
  content: () => React.ReactNode;
  /** 這一項資料的燈質記號：讀取中＝Q、已載入＝F、讀取失敗＝熄燈；省略則不畫 */
  state?: LightState;
}

/** 展開／收合其中一項，其他項維持原狀（可以同時開好幾項對照，P2-093） */
export function toggleOpenKey(open: readonly string[], key: string): string[] {
  return open.includes(key) ? open.filter((item) => item !== key) : [...open, key];
}

/**
 * 延伸分析的索引表：一列一項分析——名稱、一句發現、「展開」。
 * 打開的列在原位展開內容；可以同時打開多列對照（例如法人與技術面），另有「全部展開／全部收合」。
 * 選取列只用墨色標線與淺色底，不用燈色（旁邊就是各檔代表色）。
 */
export function AnalysisIndex({ title, entries }: { title: string; entries: AnalysisEntry[] }) {
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const uid = useId().replace(/:/g, '');
  const allOpen = entries.length > 0 && entries.every((entry) => openKeys.includes(entry.key));

  return (
    <Ledger
      title={title}
      stamp={`${entries.length} 項`}
      aria-label={title}
      actions={(
        <Button
          type="button"
          variant="ghost"
          onClick={() => setOpenKeys(allOpen ? [] : entries.map((entry) => entry.key))}
          className="-my-1.5 text-subtle hover:text-foreground"
        >
          {allOpen ? '全部收合' : '全部展開'}
        </Button>
      )}
    >
      <div className="min-w-0 bg-card">
        {/* 桌機欄名；手機每列自帶名稱與發現 */}
        <div aria-hidden className="hidden border-b px-5 md:grid md:grid-cols-[13rem_minmax(0,1fr)_6.5rem] md:gap-x-6">
          {['分析', '這次比較的發現', ''].map((h, i) => (
            <span key={i} className="flex h-11 items-center text-xs font-medium tracking-[0.04em] text-muted-foreground">
              {h}
            </span>
          ))}
        </div>
        <ul className="divide-y">
          {entries.map((entry) => {
            const open = openKeys.includes(entry.key);
            const headingId = `${uid}-${entry.key}-h`;
            const regionId = `${uid}-${entry.key}-r`;
            return (
              <li key={entry.key} data-stagger className="min-w-0">
                <div
                  className={cn(
                    'relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 pr-2 pl-4 sm:pl-5 md:min-h-14 md:grid-cols-[13rem_minmax(0,1fr)_6.5rem] md:gap-x-6 md:pr-3',
                    open && 'bg-accent',
                  )}
                >
                  {/* 打開的列：左側 2px 墨色標線 */}
                  <span aria-hidden className={cn('absolute inset-y-0 left-0 w-0.5 bg-foreground', open ? 'opacity-100' : 'opacity-0')} />
                  <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
                    {entry.state ? <LightGlyph state={entry.state} className="text-muted-foreground" /> : null}
                    <h3 id={headingId} className="min-w-0 text-[15px] leading-snug font-medium tracking-[0.04em]">
                      {entry.name}
                    </h3>
                  </div>
                  <p
                    className={cn(
                      'col-span-2 row-start-2 text-[13px] leading-relaxed md:col-span-1 md:col-start-2 md:row-start-1',
                      entry.finding ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {entry.finding ?? entry.description}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={open}
                    aria-controls={regionId}
                    aria-describedby={headingId}
                    onClick={() => setOpenKeys((prev) => toggleOpenKey(prev, entry.key))}
                    className="col-start-2 row-start-1 justify-end gap-1 justify-self-end px-2 font-normal tracking-normal text-subtle hover:text-foreground md:col-start-3"
                  >
                    {open ? '收合' : '展開'}
                    <ChevronDown aria-hidden className={cn('transition-transform duration-(--dur-sweep) ease-flash', open && 'rotate-180')} />
                  </Button>
                </div>
                <div id={regionId} role="region" aria-labelledby={headingId} hidden={!open} className="border-t">
                  {open ? entry.content() : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Ledger>
  );
}
