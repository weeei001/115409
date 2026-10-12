import { useMemo, useState } from 'react';
import type { StockHoldings } from '@/lib/hooks/useStockHoldings';
import type { ForeignHoldingDay, HoldingWeek, MarginDay } from '@/lib/chips/holdings';
import { lastOf } from '@/lib/fundamentals/stockFundamentals';
import { foreignHoldingOption, holdingTopLevelOption, marginBalanceOption, plottedSpan, plottedSpanText } from '@/lib/charts/adapters';
import { exportFileName, type CsvTable } from '@/lib/export/csv';
import { DATA_SOURCES } from '@/lib/export/sources';
import { fmtNum, fmtPercent, fmtVolume, signedCount, signedText } from '@/lib/utils/format';
import { useTheme } from '@/lib/theme/ThemeContext';
import { EChart } from '@/components/charts/EChart';
import { useChartImage } from '@/components/charts/useChartImage';
import { CsvExportButton, ImageExportButton } from '@/components/common/ExportButtons';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { EmptyState, LoadingRows } from '@/components/common/Notice';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyRangeActions, type EmptyRangeActionsProps } from '../EmptyRangeActions';
import { RetryNotice, TabCaption, TableFrame, TableNote, headRow, td, tdLeft, th, thLeft } from '../tableParts';

/*
 * 融資融券的增減、餘額都不是漲跌或買賣超，不上紅綠，只帶正負號（DESIGN.md 第 7 節只替漲跌、買賣超、多空上色）。
 * 融資融券的單位已經是張（交易所原始單位），外資持股與股權分散是股，顯示時換成張。
 */

/** 張數（已經是張）→「1,234 張」 */
const lotsText = (value: number | null | undefined) => (value == null ? '--' : `${fmtNum(value)} 張`);
const signedLotsText = (value: number | null | undefined) => (value == null ? '--' : `${signedCount(value)} 張`);
const round = (value: number | null | undefined, digits = 2) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)));
const TABLE_ROWS = 30;

const TABS = [
  { key: 'margin', label: '融資融券' },
  { key: 'foreign', label: '外資持股' },
  { key: 'levels', label: '股權分散' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface Props {
  symbol: string;
  stockLabel: string;
  data: StockHoldings;
  actions: EmptyRangeActionsProps;
}

function LatestFigures({ data }: { data: StockHoldings }) {
  const margin = lastOf(data.margin.data ?? []);
  const foreign = lastOf(data.foreign.data ?? []);
  const week = lastOf(data.holding.data ?? []);
  const items = [
    { label: '融資餘額', value: lotsText(margin?.marginBalance), note: margin ? `${margin.date}；增減 ${signedLotsText(margin.marginChange)}` : '尚無資料' },
    { label: '融券餘額', value: lotsText(margin?.shortBalance), note: margin ? `${margin.date}；券資比 ${fmtPercent(margin.shortMarginRatio)}` : '尚無資料' },
    { label: '外資持股比例', value: fmtPercent(foreign?.ratio), note: foreign ? `${foreign.date}；${fmtVolume(foreign.shares)}` : '尚無資料' },
    { label: '持股超過 1,000 張的比例', value: fmtPercent(week?.top?.percent), note: week ? `集保 ${week.date}；${fmtNum(week.top?.people)} 人` : '尚無資料' },
  ];
  return (
    <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-card px-4 py-3 sm:px-5">
          <dt className="text-[13px] text-subtle">{item.label}</dt>
          <dd className="mt-1 font-mono text-lg font-semibold whitespace-nowrap tabular-nums">{item.value}</dd>
          <dd className="characteristic mt-0.5">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}

function MarginTab({ rows, stockLabel, symbol }: { rows: MarginDay[]; stockLabel: string; symbol: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const option = useMemo(() => marginBalanceOption(rows, isDark), [rows, isDark]);
  const spanText = plottedSpanText(plottedSpan(rows.map((r) => r.date)));
  const fileDate = lastOf(rows)?.date;
  const recent = [...rows].reverse().slice(0, TABLE_ROWS);
  const image = useChartImage({ title: `${stockLabel} 融資餘額與融券餘額（張）`, source: DATA_SOURCES.margin, period: spanText });
  const csv = (): CsvTable => ({
    title: `${stockLabel} 融資融券`,
    source: DATA_SOURCES.margin,
    period: spanText,
    columns: ['日期', '融資買進（張）', '融資賣出（張）', '現金償還（張）', '融資餘額（張）', '融資增減（張）', '融券賣出（張）', '融券買進（張）', '現券償還（張）', '融券餘額（張）', '融券增減（張）', '資券互抵（張）', '券資比（%）'],
    rows: rows.map((r) => [r.date, r.marginBuy, r.marginSell, r.marginRepay, r.marginBalance, r.marginChange, r.shortSell, r.shortBuy, r.shortRepay, r.shortBalance, r.shortChange, r.offset, round(r.shortMarginRatio)]),
  });
  return (
    <div className="space-y-4">
      <TabCaption span={spanText ? `圖上 ${spanText}` : null} actions={
          <>
            <CsvExportButton build={csv} fileName={exportFileName([symbol, '融資融券', fileDate], 'csv')} />
            {option ? <ImageExportButton capture={image.capture} fileName={exportFileName([symbol, '融資融券', fileDate], 'png')} /> : null}
          </>
        }>
        融資餘額（左軸）與融券餘額（右軸），單位張。券資比＝融券餘額 ÷ 融資餘額。
      </TabCaption>
      {option ? (
        <EChart
          title="融資餘額與融券餘額（張）"
          option={option}
          height={280}
          onRendered={image.onRendered}
        />
      ) : null}
      <TableFrame minWidth="min-w-[760px]" caption={`融資融券明細，由新到舊最多 ${TABLE_ROWS} 筆`}>
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>日期</th>
            <th className={th}>融資餘額</th>
            <th className={th}>融資增減</th>
            <th className={th}>融券餘額</th>
            <th className={th}>融券增減</th>
            <th className={th}>資券互抵</th>
            <th className={th}>券資比</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((row) => (
            <tr key={row.date} className="border-t">
              <td className={tdLeft}>{row.date}</td>
              <td className={td}>{fmtNum(row.marginBalance)}</td>
              <td className={td}>{signedCount(row.marginChange)}</td>
              <td className={td}>{fmtNum(row.shortBalance)}</td>
              <td className={td}>{signedCount(row.shortChange)}</td>
              <td className={`${td} text-subtle`}>{fmtNum(row.offset)}</td>
              <td className={td}>{fmtPercent(row.shortMarginRatio)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
      <TableNote>單位張（券資比除外）；表上列出最近 {TABLE_ROWS} 個交易日，匯出檔含整段期間與買賣明細。增減只表示餘額變化，不代表看多或看空。</TableNote>
    </div>
  );
}

function ForeignTab({ rows, stockLabel, symbol }: { rows: ForeignHoldingDay[]; stockLabel: string; symbol: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const option = useMemo(() => foreignHoldingOption(rows, isDark), [rows, isDark]);
  const spanText = plottedSpanText(plottedSpan(rows.map((r) => r.date)));
  const fileDate = lastOf(rows)?.date;
  const recent = [...rows].reverse().slice(0, TABLE_ROWS);
  const image = useChartImage({ title: `${stockLabel} 外資持股比例`, source: DATA_SOURCES.foreignHolding, period: spanText });
  const csv = (): CsvTable => ({
    title: `${stockLabel} 外資持股`,
    source: DATA_SOURCES.foreignHolding,
    period: spanText,
    columns: ['日期', '外資持股（股）', '外資持股比例（%）', '外資尚可投資比例（%）', '外資投資上限（%）', '發行股數（股）'],
    rows: rows.map((r) => [r.date, r.shares, r.ratio, r.remainRatio, r.upperLimitRatio, r.issuedShares]),
  });
  return (
    <div className="space-y-4">
      <TabCaption span={spanText ? `圖上 ${spanText}` : null} actions={
          <>
            <CsvExportButton build={csv} fileName={exportFileName([symbol, '外資持股', fileDate], 'csv')} />
            {option ? <ImageExportButton capture={image.capture} fileName={exportFileName([symbol, '外資持股', fileDate], 'png')} /> : null}
          </>
        }>
        外資（含陸資）持股占發行股數的比例。
      </TabCaption>
      {option ? (
        <EChart
          title="外資持股比例（%）"
          option={option}
          height={260}
          onRendered={image.onRendered}
        />
      ) : null}
      <TableFrame minWidth="min-w-[560px]" caption={`外資持股明細，由新到舊最多 ${TABLE_ROWS} 筆`}>
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>日期</th>
            <th className={th}>外資持股</th>
            <th className={th}>持股比例</th>
            <th className={th}>尚可投資比例</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((row) => (
            <tr key={row.date} className="border-t">
              <td className={tdLeft}>{row.date}</td>
              <td className={td}>{fmtVolume(row.shares)}</td>
              <td className={`${td} font-semibold`}>{fmtPercent(row.ratio)}</td>
              <td className={`${td} text-subtle`}>{fmtPercent(row.remainRatio)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </div>
  );
}

function LevelsTab({ weeks, stockLabel, symbol }: { weeks: HoldingWeek[]; stockLabel: string; symbol: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const series = useMemo(() => weeks.map((w) => ({ date: w.date, topPercent: w.top?.percent ?? null, totalPeople: w.total?.people ?? null })), [weeks]);
  const option = useMemo(() => holdingTopLevelOption(series, isDark), [series, isDark]);
  const latest = lastOf(weeks);
  const previous = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const weeksText = weeks.length ? `${weeks[0].date} → ${latest?.date}，共 ${weeks.length} 週` : null;
  const image = useChartImage({ title: `${stockLabel} 持股超過 1,000 張的比例與股東人數`, source: DATA_SOURCES.holdingLevels, period: weeksText });
  const csv = (): CsvTable => ({
    title: `${stockLabel} 集保股權分散`,
    source: DATA_SOURCES.holdingLevels,
    period: weeksText,
    columns: ['資料日', '持股級距（股）', '人數', '股數（股）', '占集保庫存比例（%）'],
    rows: weeks.flatMap((w) => [
      ...w.levels.map((level) => [w.date, level.level, level.people, level.shares, level.percent]),
      ...(w.total ? [[w.date, '合計', w.total.people, w.total.shares, w.total.percent]] : []),
    ]),
  });
  if (!latest) return null;
  const previousLevel = (min: number) => previous?.levels.find((level) => level.min === min) ?? null;
  return (
    <div className="space-y-4">
      <TabCaption span={weeksText ? `圖上 ${weeksText}` : null} actions={
          <>
            <CsvExportButton build={csv} fileName={exportFileName([symbol, '股權分散', latest.date], 'csv')} />
            {option ? <ImageExportButton capture={image.capture} fileName={exportFileName([symbol, '股權分散', latest.date], 'png')} /> : null}
          </>
        }>
        集保結算所每週公布的持股級距分布。圖上是持股超過 1,000 張（1,000,001 股以上）的股權比例與集保股東人數。
      </TabCaption>
      {option ? (
        <EChart
          title="持股超過 1,000 張的比例與股東人數"
          option={option}
          height={280}
          onRendered={image.onRendered}
        />
      ) : null}
      <TableFrame minWidth="min-w-[620px]" caption={`${latest.date} 集保股權分散，依持股級距由小到大`}>
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>持股級距</th>
            <th className={th}>人數</th>
            <th className={th}>股數</th>
            <th className={th}>比例</th>
            <th className={th}>比例較前一週</th>
          </tr>
        </thead>
        <tbody>
          {latest.levels.map((level) => {
            const before = previousLevel(level.min);
            const change = level.percent != null && before?.percent != null ? level.percent - before.percent : null;
            return (
              <tr key={level.level} className="border-t">
                <td className="h-11 px-3 py-2 text-left font-mono text-[13px] whitespace-nowrap tabular-nums">{level.label}</td>
                <td className={td}>{fmtNum(level.people)}</td>
                <td className={td}>{fmtVolume(level.shares)}</td>
                <td className={`${td} font-semibold`}>{fmtPercent(level.percent)}</td>
                <td className={`${td} text-subtle`}>{change == null ? '--' : signedText(change, 2, ' 個百分點')}</td>
              </tr>
            );
          })}
          {latest.total ? (
            <tr className="border-t border-border-strong bg-muted/50">
              <td className="h-11 px-3 py-2 text-left text-[13px] font-medium">合計</td>
              <td className={`${td} font-semibold`}>{fmtNum(latest.total.people)}</td>
              <td className={td}>{fmtVolume(latest.total.shares)}</td>
              <td className={td}>{fmtPercent(latest.total.percent)}</td>
              <td className={td} />
            </tr>
          ) : null}
        </tbody>
      </TableFrame>
      <TableNote>
        資料日 {latest.date}{previous ? `，和 ${previous.date} 比較` : ''}。級距以股數劃分（1 張＝1,000 股）；股數顯示成張。持股級距只反映帳戶持股規模，不代表投資人身分。
      </TableNote>
    </div>
  );
}

/** 「信用交易與持股」抽屜內容：最新數字 → 分頁（融資融券、外資持股、股權分散）；期間跟著個股頁的日期區間 */
export function HoldingsPanel({ symbol, stockLabel, data, actions }: Props) {
  const [tab, setTab] = useState<TabKey>('margin');
  const body = (key: TabKey) => {
    if (data.loading) return <LoadingRows className="h-[300px] border-y" />;
    const section = { margin: data.margin, foreign: data.foreign, levels: data.holding }[key];
    if (section.error) return <RetryNotice message={section.error} onRetry={data.reload} />;
    const empty = (text: string) => <EmptyState action={<EmptyRangeActions {...actions} />}>{text}</EmptyState>;
    switch (key) {
      case 'margin':
        return data.margin.data?.length ? <MarginTab rows={data.margin.data} stockLabel={stockLabel} symbol={symbol} /> : empty('所選期間沒有融資融券資料');
      case 'foreign':
        return data.foreign.data?.length ? <ForeignTab rows={data.foreign.data} stockLabel={stockLabel} symbol={symbol} /> : empty('所選期間沒有外資持股資料');
      default:
        return data.holding.data?.length ? <LevelsTab weeks={data.holding.data} stockLabel={stockLabel} symbol={symbol} /> : empty('所選期間沒有集保股權分散資料');
    }
  };
  const allFailed = [data.margin, data.foreign, data.holding].every((section) => section.error);

  return (
    <div className="flex flex-col gap-10">
      <Ledger as="h3" title="最新數字" stamp="所選期間的最後一筆，非即時">
        {data.loading ? (
          <LoadingRows className="h-[96px] bg-card" />
        ) : allFailed ? (
          <RetryNotice message={data.margin.error ?? '資料暫時無法取得'} onRetry={data.reload} />
        ) : (
          <LatestFigures data={data} />
        )}
      </Ledger>
      <Ledger as="h3" title="信用交易與持股走勢" stamp="期間同 K 線">
        <LedgerPanel>
          <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
            <TabsList aria-label="信用交易與持股分頁" className="w-full flex-wrap">
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="px-2.5 sm:px-4">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t.key} value={t.key} className="mt-4 min-h-[360px]">
                {tab === t.key ? body(t.key) : null}
              </TabsContent>
            ))}
          </Tabs>
        </LedgerPanel>
      </Ledger>
    </div>
  );
}
