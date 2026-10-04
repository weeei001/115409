import { useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { FoldSection, TableScrollHint } from '@/components/common/CollapsibleSection';
import { Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import type { CompareMetricsRow } from '@/lib/types/compare';
import { sortMetricsRows, type CompareSortState } from '@/lib/utils/compare';
import { fmtAmount, fmtPercent, fmtVolume } from '@/lib/utils/format';
import { valueToneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';

const HEADERS: Array<{ key: keyof CompareMetricsRow; label: string; title?: string }> = [
  { key: 'symbol', label: '股票' },
  { key: 'totalReturnPct', label: '區間漲跌幅%' },
  { key: 'volatilityPct', label: '年化波動%', title: '有效日漲跌幅的樣本標準差 × √252 × 100%' },
  { key: 'maxDrawdownPct', label: '最大回撤%' },
  { key: 'winRatePct', label: '上漲日比例%' },
  { key: 'maxDailyGainPct', label: '最大單日漲%' },
  { key: 'maxDailyLossPct', label: '最大單日跌%' },
  { key: 'avgVolume', label: '平均量' },
  { key: 'avgAmount', label: '平均金額（TWD）' },
];

/**
 * 粗底線標記：只標方向沒有爭議的四欄（漲跌幅最高、波動最低、回撤最淺、上漲日比例最高）。
 * 只是表內的相對位置，不是評分；同值並列時一起標。
 */
const MARKED: Partial<Record<keyof CompareMetricsRow, { pick: 'max' | 'min'; tag: string }>> = {
  totalReturnPct: { pick: 'max', tag: '本欄最高' },
  volatilityPct: { pick: 'min', tag: '本欄最低' },
  maxDrawdownPct: { pick: 'max', tag: '本欄回撤最淺' },
  winRatePct: { pick: 'max', tag: '本欄最高' },
};

function markedValues(rows: CompareMetricsRow[]): Partial<Record<keyof CompareMetricsRow, number>> {
  const out: Partial<Record<keyof CompareMetricsRow, number>> = {};
  if (rows.length < 2) return out;
  for (const [key, rule] of Object.entries(MARKED) as Array<[keyof CompareMetricsRow, { pick: 'max' | 'min' }]>) {
    const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length < 2) continue;
    out[key] = rule.pick === 'max' ? Math.max(...values) : Math.min(...values);
  }
  return out;
}

/** The volume API preserves domestic TWSE/TPEx trade values in NT dollars. */
export function formatCompareAmount(value: number | null) {
  if (value == null || !Number.isFinite(value)) return { label: '--', detail: '平均金額資料未提供' };
  return {
    label: `${value < 0 ? '-' : ''}${fmtAmount(Math.abs(value))}`,
    detail: `新臺幣 ${value.toLocaleString('zh-TW', { maximumFractionDigits: 20 })} 元（TWD）`,
  };
}

const td = 'h-11 px-3 py-2.5 text-right font-mono text-[13.5px] whitespace-nowrap tabular-nums sm:px-4';

/** 比較指標表：印刷式帳表，點欄位標題排序（預設區間報酬由高到低） */
export function MetricsTable({
  rows,
  symbolColors,
  benchmarkReturnPct = null,
  period = null,
  tradingDays = null,
  state = 'ready',
}: {
  rows: CompareMetricsRow[];
  symbolColors: Record<string, string>;
  benchmarkReturnPct?: number | null;
  /** 區間漲跌幅的實際期間（共同起訖日）；表頭只寫一次 */
  period?: { startDate: string; endDate: string } | null;
  /** 期間內的交易日數 */
  tradingDays?: number | null;
  /** 燈質記號：重新比較中＝Q、已載入＝F */
  state?: LightState;
}) {
  const captionId = useId();
  const [sort, setSort] = useState<CompareSortState>({ key: 'totalReturnPct', direction: 'desc' });
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => sortMetricsRows(rows, sort), [rows, sort]);
  const marks = useMemo(() => markedValues(rows), [rows]);

  const toggleSort = (key: keyof CompareMetricsRow) =>
    setSort((prev) => ({
      key,
      direction: prev.key === key ? (prev.direction === 'asc' ? 'desc' : 'asc') : key === 'symbol' ? 'asc' : 'desc',
    }));

  /** 數值格：本欄的極值加粗底線，另附螢幕閱讀器文字 */
  const figure = (key: keyof CompareMetricsRow, value: number | null, text: string) => {
    const marked = marks[key] != null && value === marks[key];
    return marked ? (
      // 夜海的 border-strong 太暗，粗底線改用 muted-foreground 才看得見；
      // relative 讓 sr-only 文字留在表格捲動容器內，不然手機版會把整頁撐寬
      <span className="relative inline-block border-b-2 border-border-strong pb-px font-semibold dark:border-muted-foreground">
        {text}
        <span className="sr-only">（{MARKED[key]?.tag}）</span>
      </span>
    ) : text;
  };

  return (
    <Ledger title="比較指標表" aria-label="股票比較指標表" stamp="粗底線＝本欄極值">
      <LedgerPanel padded={false}>
        {/* 表的圖說：區間漲跌幅等欄位的實際期間，只在這裡寫一次 */}
        <div className="flex items-baseline gap-2 px-4 pt-3 sm:px-5">
        {/* 燈質記號放在圖說外：表格的 aria-describedby 只讀到期間文字 */}
        <LightGlyph state={state} className="translate-y-px self-center text-muted-foreground" />
        <p id={captionId} className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
          {period ? (
            <>
              區間漲跌幅期間{' '}
              <span className="font-mono whitespace-nowrap text-foreground tabular-nums">
                {period.startDate} → {period.endDate}
              </span>
              {tradingDays ? `，共 ${tradingDays} 個交易日` : ''}；以共同起訖日的未還原收盤價計算，不含息。
            </>
          ) : (
            '共同有效收盤價不足 2 天，區間漲跌幅無法計算。'
          )}
        </p>
        </div>
        <TableScrollHint scrollRef={scrollRef} className="px-4 pt-2 sm:px-5" />
        <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm" aria-describedby={captionId}>
            <thead>
              <tr className="border-b border-border-strong">
                {HEADERS.map((h) => {
                  const active = sort.key === h.key;
                  const SortIcon = sort.direction === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={h.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn(
                        'px-3 font-sans whitespace-nowrap sm:px-4',
                        h.key === 'symbol' ? 'sticky left-0 z-10 bg-card text-left' : 'text-right',
                      )}
                    >
                      <button
                        type="button"
                        title={h.title}
                        onClick={() => toggleSort(h.key)}
                        className={cn(
                          'inline-flex min-h-11 items-center gap-1 text-[13px] font-medium tracking-[0.04em] transition-colors duration-(--dur-flash) hover:text-foreground focus-lamp-inset',
                          active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {h.label}
                        {active ? <SortIcon size={12} aria-hidden /> : null}
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="px-3 text-right text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground sm:px-4">相對加權差值（百分點）</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const amount = formatCompareAmount(r.avgAmount);
                return (
                  <tr key={r.symbol} className="group border-b transition-colors duration-(--dur-flash) last:border-b-0 hover:bg-accent">
                    <td className={cn(td, 'sticky left-0 z-10 bg-card text-left font-medium transition-colors duration-(--dur-flash) group-hover:bg-accent')}>
                      <span className="relative inline-flex items-center pl-3">
                        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: symbolColors[r.symbol] }} aria-hidden />
                        {r.symbol}
                      </span>
                    </td>
                    <td className={cn(td, valueToneText(r.totalReturnPct))}>{figure('totalReturnPct', r.totalReturnPct, fmtPercent(r.totalReturnPct, { sign: true }))}</td>
                    <td className={td}>{figure('volatilityPct', r.volatilityPct, fmtPercent(r.volatilityPct))}</td>
                    <td className={td}>{figure('maxDrawdownPct', r.maxDrawdownPct, fmtPercent(r.maxDrawdownPct))}</td>
                    <td className={td}>{figure('winRatePct', r.winRatePct, fmtPercent(r.winRatePct))}</td>
                    <td className={cn(td, valueToneText(r.maxDailyGainPct))}>{fmtPercent(r.maxDailyGainPct, { sign: true })}</td>
                    <td className={cn(td, valueToneText(r.maxDailyLossPct))}>{fmtPercent(r.maxDailyLossPct, { sign: true })}</td>
                    <td className={td}>{r.avgVolume == null ? '--' : fmtVolume(r.avgVolume)}</td>
                    <td className={td}>
                      <span title={amount.detail} className="relative">
                        <span aria-hidden="true">{amount.label}</span>
                        <span className="sr-only">{amount.detail}</span>
                      </span>
                    </td>
                    <td className={td}>{r.totalReturnPct == null || benchmarkReturnPct == null ? '--' : (r.totalReturnPct - benchmarkReturnPct).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </LedgerPanel>
      <FoldSection title="欄位定義" summary="漲跌幅、年化波動、上漲日比例、平均金額與相對加權差值的算法">
        <div className="space-y-0.5 p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
          <p>點擊欄位標題可排序，空值以 -- 顯示。粗底線標示該欄的最高區間漲跌幅、最低年化波動、最淺最大回撤與最高上漲日比例，只是表內相對位置。</p>
          <p>平均金額以新臺幣（TWD）呈現，依數值縮放為元／萬元／億元。</p>
          <p>漲跌幅依共同起訖日的未還原收盤價計算，未計入股息；「上漲日比例」為有效日漲跌幅中大於 0 的比例。</p>
          <p>「年化波動%」為有效日漲跌幅的樣本標準差 × √252；台股年化常用 252 個交易日。</p>
          <p>相對加權差值＝個股區間漲跌幅 − 加權價格指數同期漲跌幅，單位為百分點；非含息超額報酬。基準缺少起訖資料時顯示 --。</p>
        </div>
      </FoldSection>
    </Ledger>
  );
}
