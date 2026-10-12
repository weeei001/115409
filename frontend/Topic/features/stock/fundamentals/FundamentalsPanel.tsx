import { useEffect, useMemo, useState } from 'react';
import type { StockFundamentals } from '@/lib/hooks/useStockFundamentals';
import {
  STATEMENT_BASIS_LABEL,
  dividendYears,
  lastOf,
  ytdLabel,
  type BalanceQuarter,
  type CashflowQuarter,
  type DividendEvent,
  type QuarterProfit,
  type RevenueMonth,
  type ValuationDay,
} from '@/lib/fundamentals/stockFundamentals';
import {
  QUARTER_CHART_QUARTERS,
  REVENUE_CHART_MONTHS,
  monthlyRevenueOption,
  quarterProfitOption,
  valuationOption,
} from '@/lib/charts/adapters';
import { exportFileName, type CsvTable } from '@/lib/export/csv';
import { DATA_SOURCES } from '@/lib/export/sources';
import { fmtAmount, fmtPercent, fmtPrice, signedText } from '@/lib/utils/format';
import { useTheme } from '@/lib/theme/ThemeContext';
import { EChart } from '@/components/charts/EChart';
import { useChartImage } from '@/components/charts/useChartImage';
import { CsvExportButton, ImageExportButton } from '@/components/common/ExportButtons';
import { Ledger, LedgerPanel } from '@/components/common/Ledger';
import { EmptyState, LoadingRows } from '@/components/common/Notice';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RetryNotice, TabCaption, TableFrame, TableNote, headRow, td, tdLeft, th, thLeft } from '../tableParts';

const round = (value: number | null | undefined, digits = 2) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)));
const growth = (value: number | null) => signedText(value, 2, '%');
const span = (first: string | undefined, last: string | undefined, count: number, unit: string) =>
  first && last ? `${first} → ${last}，共 ${count} ${unit}` : null;

interface Props {
  symbol: string;
  /** 「台積電 2330」 */
  stockLabel: string;
  data: StockFundamentals;
}

const TABS = [
  { key: 'revenue', label: '月營收' },
  { key: 'profit', label: '季度獲利' },
  { key: 'health', label: '財務體質' },
  { key: 'valuation', label: '估值' },
  { key: 'dividend', label: '股利' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** 最新數字：每一格寫明資料期間；年增率不上漲跌色（不是股價漲跌） */
function LatestFigures({ data }: { data: StockFundamentals }) {
  const month = lastOf(data.revenue.data ?? []);
  const quarter = [...(data.quarters.data ?? [])].reverse().find((q) => q.eps != null) ?? null;
  const valuation = lastOf(data.valuations.data ?? []);
  const dividend = data.dividends.data?.[0] ?? null;
  const items = [
    { label: '月營收', value: fmtAmount(month?.revenue), note: month ? `${month.period}；年增 ${growth(month.yoy)}` : '尚無資料' },
    { label: '單季 EPS', value: quarter?.eps != null ? `${fmtPrice(quarter.eps)} 元` : '--', note: quarter ? `${quarter.label}；年增 ${growth(quarter.epsYoy)}` : '尚無資料' },
    { label: '本益比', value: valuation?.per != null ? `${fmtPrice(valuation.per)} 倍` : '--', note: valuation?.date ?? '尚無資料' },
    { label: '股價淨值比', value: valuation?.pbr != null ? `${fmtPrice(valuation.pbr)} 倍` : '--', note: valuation?.date ?? '尚無資料' },
    { label: '殖利率', value: fmtPercent(valuation?.dividendYield), note: valuation?.date ?? '尚無資料' },
    { label: '最近除權息', value: dividend?.value != null ? `${fmtPrice(dividend.value)} 元` : '--', note: dividend ? `${dividend.date}（${dividend.kind ?? '類別未提供'}）` : '近 5 年無資料' },
  ];
  return (
    <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
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

function RevenueTab({ rows, stockLabel, symbol }: { rows: RevenueMonth[]; stockLabel: string; symbol: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const option = useMemo(() => monthlyRevenueOption(rows, isDark), [rows, isDark]);
  const plotted = rows.slice(-REVENUE_CHART_MONTHS);
  const plottedText = span(plotted[0]?.period, lastOf(plotted)?.period, plotted.length, '個月');
  const fileDate = lastOf(rows)?.period;
  const image = useChartImage({ title: `${stockLabel} 月營收與年增率`, source: DATA_SOURCES.revenue, period: plottedText });
  const csv = (): CsvTable => ({
    title: `${stockLabel} 月營收`,
    source: DATA_SOURCES.revenue,
    period: span(rows[0]?.period, lastOf(rows)?.period, rows.length, '個月'),
    columns: ['月份', '營收（元）', '月增率（%）', '年增率（%）', '出表日'],
    rows: rows.map((r) => [r.period, r.revenue, round(r.mom), round(r.yoy), r.published]),
    notes: ['出表日是公開資訊觀測站營收彙總表的出表日期，不是公司首次公布營收的日期。'],
  });
  return (
    <div className="space-y-4">
      <TabCaption
        span={plottedText ? `圖上 ${plottedText}` : null}
        actions={
          <>
            <CsvExportButton build={csv} fileName={exportFileName([symbol, '月營收', fileDate], 'csv')} />
            {option ? <ImageExportButton capture={image.capture} fileName={exportFileName([symbol, '月營收', fileDate], 'png')} /> : null}
          </>
        }
      >
        每月營業收入（柱，億元）與年增率（線，右軸）。月增率比上個月、年增率比去年同月。
      </TabCaption>
      {option ? (
        <EChart
          title="月營收與年增率"
          option={option}
          height={300}
          onRendered={image.onRendered}
        />
      ) : null}
      <TableFrame minWidth="min-w-[560px]" caption="月營收明細，由新到舊">
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>月份</th>
            <th className={th}>營收</th>
            <th className={th}>月增率</th>
            <th className={th}>年增率</th>
            <th className={th}>出表日</th>
          </tr>
        </thead>
        <tbody>
          {[...plotted].reverse().map((row) => (
            <tr key={row.period} className="border-t">
              <td className={tdLeft}>{row.period}</td>
              <td className={td}>{fmtAmount(row.revenue)}</td>
              <td className={td}>{growth(row.mom)}</td>
              <td className={td}>{growth(row.yoy)}</td>
              <td className={`${td} text-subtle`}>{row.published ?? '--'}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
      <TableNote>
        年增率、月增率在比較基期不是正數時不計算，顯示 --。出表日是公開資訊觀測站營收彙總表的出表日期，不是公司首次公布營收的日期。營收高低須配合產業季節性解讀。
      </TableNote>
    </div>
  );
}

function ProfitTab({ rows, stockLabel, symbol }: { rows: QuarterProfit[]; stockLabel: string; symbol: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const option = useMemo(() => quarterProfitOption(rows, isDark), [rows, isDark]);
  const plotted = rows.slice(-QUARTER_CHART_QUARTERS);
  const plottedText = span(plotted[0]?.label, lastOf(plotted)?.label, plotted.length, '季');
  const fileDate = lastOf(rows)?.label.replace(' ', '');
  const image = useChartImage({ title: `${stockLabel} 單季 EPS 與利潤率`, source: DATA_SOURCES.statements, period: plottedText });
  const csv = (): CsvTable => ({
    title: `${stockLabel} 單季獲利`,
    source: DATA_SOURCES.statements,
    period: span(rows[0]?.label, lastOf(rows)?.label, rows.length, '季'),
    columns: ['季別', '季底日', '營收（元）', '營業毛利（元）', '營業利益（元）', '毛利率（%）', '營業利益率（%）', '基本 EPS（元）', 'EPS 年增率（%）'],
    rows: rows.map((r) => [r.label, r.period, r.revenue, r.grossProfit, r.operatingIncome, round(r.grossMargin), round(r.operatingMargin), r.eps, round(r.epsYoy)]),
    notes: ['單季數字，未標示合併或個別報表。'],
  });
  return (
    <div className="space-y-4">
      <TabCaption
        span={plottedText ? `圖上 ${plottedText}` : null}
        actions={
          <>
            <CsvExportButton build={csv} fileName={exportFileName([symbol, '單季獲利', fileDate], 'csv')} />
            {option ? <ImageExportButton capture={image.capture} fileName={exportFileName([symbol, '單季獲利', fileDate], 'png')} /> : null}
          </>
        }
      >
        單季基本 EPS（柱）與毛利率、營業利益率（線，右軸）。利潤率＝毛利或營業利益 ÷ 營收。
      </TabCaption>
      {option ? (
        <EChart
          title="單季 EPS 與利潤率"
          option={option}
          height={300}
          onRendered={image.onRendered}
        />
      ) : null}
      <TableFrame minWidth="min-w-[860px]" caption="單季獲利明細，由新到舊">
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>季別</th>
            <th className={th}>營收</th>
            <th className={th}>營業毛利</th>
            <th className={th}>營業利益</th>
            <th className={th}>毛利率</th>
            <th className={th}>營業利益率</th>
            <th className={th}>EPS（元）</th>
            <th className={th}>EPS 年增率</th>
          </tr>
        </thead>
        <tbody>
          {[...plotted].reverse().map((row) => (
            <tr key={row.period} className="border-t">
              <td className={tdLeft}>{row.label}</td>
              <td className={td}>{fmtAmount(row.revenue)}</td>
              <td className={td}>{fmtAmount(row.grossProfit)}</td>
              <td className={td}>{fmtAmount(row.operatingIncome)}</td>
              <td className={td}>{fmtPercent(row.grossMargin)}</td>
              <td className={td}>{fmtPercent(row.operatingMargin)}</td>
              <td className={`${td} font-semibold`}>{fmtPrice(row.eps)}</td>
              <td className={td}>{growth(row.epsYoy)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
      <TableNote>
        單季數字取自公開資訊觀測站，未標示合併或個別報表；金融業沒有營業毛利，毛利率顯示 --。EPS 年增率在去年同季不是正數（例如虧損）時不計算。財報實際公布日未保存。
      </TableNote>
    </div>
  );
}

function HealthTab({ data, stockLabel, symbol }: { data: StockFundamentals; stockLabel: string; symbol: string }) {
  const { statements, loadStatements } = data;
  const loaded = statements.balance != null || statements.cashflow != null;
  useEffect(() => {
    if (!loaded && !statements.loading && !statements.error) loadStatements();
    // 只在第一次打開這個分頁時讀
  }, []);
  if (statements.loading || (!loaded && !statements.error)) return <LoadingRows label="讀取財報中…" className="h-[300px] border-y" />;
  if (statements.error) return <RetryNotice message={statements.error} onRetry={loadStatements} />;
  const balance = (statements.balance ?? []).slice(-8).reverse();
  const cashflow = (statements.cashflow ?? []).slice(-8).reverse();
  if (!balance.length && !cashflow.length) return <EmptyState>近 3 年沒有資產負債表與現金流量表資料</EmptyState>;
  return (
    <div className="space-y-8">
      <BalanceTable rows={balance} all={statements.balance ?? []} stockLabel={stockLabel} symbol={symbol} />
      <CashflowTable rows={cashflow} all={statements.cashflow ?? []} stockLabel={stockLabel} symbol={symbol} />
      <TableNote>每一季優先採合併報表，沒有才用個別報表，並標示在季別旁。財報實際公布日未保存，表中數字不一定是當時已公開的資訊。</TableNote>
    </div>
  );
}

function BalanceTable({ rows, all, stockLabel, symbol }: { rows: BalanceQuarter[]; all: BalanceQuarter[]; stockLabel: string; symbol: string }) {
  if (!rows.length) return null;
  const csv = (): CsvTable => ({
    title: `${stockLabel} 資產負債（季底）`,
    source: DATA_SOURCES.statements,
    period: span(all[0]?.label, lastOf(all)?.label, all.length, '季'),
    columns: ['季別', '季底日', '編製基礎', '資產總額（元）', '負債總額（元）', '權益總額（元）', '現金及約當現金（元）', '流動資產（元）', '流動負債（元）', '負債比率（%）', '流動比率（%）'],
    rows: all.map((r) => [r.label, r.period, STATEMENT_BASIS_LABEL[r.basis], r.totalAssets, r.totalLiabilities, r.totalEquity, r.cash, r.currentAssets, r.currentLiabilities, round(r.debtRatio), round(r.currentRatio)]),
  });
  return (
    <section aria-label="資產負債" className="space-y-3">
      <TabCaption actions={<CsvExportButton build={csv} fileName={exportFileName([symbol, '資產負債', lastOf(all)?.label.replace(' ', '')], 'csv')} />}>
        <span className="block font-medium text-foreground">資產負債（季底餘額）</span>
        負債比率＝負債總額 ÷ 資產總額；流動比率＝流動資產 ÷ 流動負債（金融業沒有流動、非流動之分，顯示 --）。
      </TabCaption>
      <TableFrame minWidth="min-w-[860px]" caption="資產負債，由新到舊">
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>季別</th>
            <th className={th}>資產總額</th>
            <th className={th}>負債總額</th>
            <th className={th}>權益總額</th>
            <th className={th}>現金及約當現金</th>
            <th className={th}>負債比率</th>
            <th className={th}>流動比率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period} className="border-t">
              <td className={tdLeft}>
                {row.label}
                <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">{STATEMENT_BASIS_LABEL[row.basis]}</span>
              </td>
              <td className={td}>{fmtAmount(row.totalAssets)}</td>
              <td className={td}>{fmtAmount(row.totalLiabilities)}</td>
              <td className={td}>{fmtAmount(row.totalEquity)}</td>
              <td className={td}>{fmtAmount(row.cash)}</td>
              <td className={td}>{fmtPercent(row.debtRatio)}</td>
              <td className={td}>{fmtPercent(row.currentRatio)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </section>
  );
}

function CashflowTable({ rows, all, stockLabel, symbol }: { rows: CashflowQuarter[]; all: CashflowQuarter[]; stockLabel: string; symbol: string }) {
  if (!rows.length) return null;
  const csv = (): CsvTable => ({
    title: `${stockLabel} 現金流量（年初累計）`,
    source: DATA_SOURCES.statements,
    period: span(all[0]?.label, lastOf(all)?.label, all.length, '季'),
    columns: ['期間', '季底日', '編製基礎', '營業活動淨現金流（元）', '投資活動淨現金流（元）', '籌資活動淨現金流（元）'],
    rows: all.map((r) => [ytdLabel(r.period), r.period, STATEMENT_BASIS_LABEL[r.basis], r.operating, r.investing, r.financing]),
    notes: ['現金流量表是年初累計到該季的數字，不是單季。'],
  });
  return (
    <section aria-label="現金流量" className="space-y-3">
      <TabCaption actions={<CsvExportButton build={csv} fileName={exportFileName([symbol, '現金流量', lastOf(all)?.label.replace(' ', '')], 'csv')} />}>
        <span className="block font-medium text-foreground">現金流量（年初累計）</span>
        現金流量表是從年初累計到該季，Q4 即全年；負數是淨流出。
      </TabCaption>
      <TableFrame minWidth="min-w-[640px]" caption="現金流量，由新到舊">
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>期間</th>
            <th className={th}>營業活動</th>
            <th className={th}>投資活動</th>
            <th className={th}>籌資活動</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period} className="border-t">
              <td className={tdLeft}>
                {ytdLabel(row.period)}
                <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">{STATEMENT_BASIS_LABEL[row.basis]}</span>
              </td>
              <td className={td}>{fmtAmount(row.operating)}</td>
              <td className={td}>{fmtAmount(row.investing)}</td>
              <td className={td}>{fmtAmount(row.financing)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </section>
  );
}

function ValuationTab({ rows, stockLabel, symbol }: { rows: ValuationDay[]; stockLabel: string; symbol: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const option = useMemo(() => valuationOption(rows, isDark), [rows, isDark]);
  const rangeText = span(rows[0]?.date, lastOf(rows)?.date, rows.length, '個交易日');
  const fileDate = lastOf(rows)?.date;
  const image = useChartImage({ title: `${stockLabel} 本益比與股價淨值比`, source: DATA_SOURCES.valuation, period: rangeText });
  const csv = (): CsvTable => ({
    title: `${stockLabel} 本益比、股價淨值比、殖利率`,
    source: DATA_SOURCES.valuation,
    period: rangeText,
    columns: ['日期', '本益比（倍）', '股價淨值比（倍）', '殖利率（%）'],
    rows: rows.map((r) => [r.date, r.per, r.pbr, r.dividendYield]),
  });
  return (
    <div className="space-y-4">
      <TabCaption span={rangeText ? `圖上 ${rangeText}` : null} actions={
          <>
            <CsvExportButton build={csv} fileName={exportFileName([symbol, '估值', fileDate], 'csv')} />
            {option ? <ImageExportButton capture={image.capture} fileName={exportFileName([symbol, '估值', fileDate], 'png')} /> : null}
          </>
        }>
        交易所每日公布的本益比（左軸）與股價淨值比（右軸）；殖利率在上方「最新數字」與匯出檔。
      </TabCaption>
      {option ? (
        <EChart
          title="本益比與股價淨值比"
          option={option}
          height={300}
          onRendered={image.onRendered}
        />
      ) : (
        <EmptyState>近 1 年沒有本益比與股價淨值比資料</EmptyState>
      )}
      <TableNote>本益比、股價淨值比、殖利率由交易所依其公式公布；公司虧損時本益比不提供。估值高低須配合產業與獲利解讀。</TableNote>
    </div>
  );
}

function DividendTab({ rows, stockLabel, symbol }: { rows: DividendEvent[]; stockLabel: string; symbol: string }) {
  const years = dividendYears(rows);
  const rangeText = span(lastOf(rows)?.date, rows[0]?.date, rows.length, '次');
  const csv = (): CsvTable => ({
    title: `${stockLabel} 除權息`,
    source: DATA_SOURCES.dividend,
    period: rangeText,
    columns: ['除權息日', '類別', '權值＋息值（元）', '除權息前收盤（元）', '除權息參考價（元）'],
    rows: rows.map((r) => [r.date, r.kind, r.value, r.beforePrice, r.referencePrice]),
  });
  return (
    <div className="space-y-4">
      <TabCaption span={rangeText ? `表列 ${rangeText}` : null} actions={<CsvExportButton build={csv} fileName={exportFileName([symbol, '除權息', rows[0]?.date], 'csv')} />}>
        近 5 年的除權息結果：權值＋息值＝除權息前收盤 − 參考價，單位元／股。
      </TabCaption>
      {years.length ? (
        <dl className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-3 lg:grid-cols-5">
          {years.map((year) => (
            <div key={year.year} className="bg-card px-4 py-3">
              <dt className="characteristic">{year.year} 年 · {year.count} 次</dt>
              <dd className="mt-1 font-mono text-[15px] font-semibold tabular-nums">{fmtPrice(year.total)} 元</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <TableFrame minWidth="min-w-[560px]" caption="除權息明細，由新到舊">
        <thead>
          <tr className={headRow}>
            <th className={thLeft}>除權息日</th>
            <th className={thLeft}>類別</th>
            <th className={th}>權值＋息值（元）</th>
            <th className={th}>除權息前收盤</th>
            <th className={th}>參考價</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.date}-${row.kind}`} className="border-t">
              <td className={tdLeft}>{row.date}</td>
              <td className="h-11 px-3 py-2 text-left text-[13.5px]">{row.kind ?? '--'}</td>
              <td className={`${td} font-semibold`}>{fmtPrice(row.value)}</td>
              <td className={td}>{fmtPrice(row.beforePrice)}</td>
              <td className={td}>{fmtPrice(row.referencePrice)}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
      <TableNote>年度合計依除權息日所在年度加總，和公司公告的「所屬年度」不一定相同；除權的權值是以參考價換算，不是配股數。</TableNote>
    </div>
  );
}

/** 「基本面明細」抽屜內容：最新數字 → 分頁（月營收、季度獲利、財務體質、估值、股利） */
export function FundamentalsPanel({ symbol, stockLabel, data }: Props) {
  const [tab, setTab] = useState<TabKey>('revenue');
  const body = (key: TabKey) => {
    if (key === 'health') return <HealthTab data={data} stockLabel={stockLabel} symbol={symbol} />;
    if (data.loading) return <LoadingRows className="h-[300px] border-y" />;
    const section = { revenue: data.revenue, profit: data.quarters, valuation: data.valuations, dividend: data.dividends }[key];
    if (section.error) return <RetryNotice message={section.error} onRetry={data.reload} />;
    switch (key) {
      case 'revenue':
        return data.revenue.data?.length ? <RevenueTab rows={data.revenue.data} stockLabel={stockLabel} symbol={symbol} /> : <EmptyState>近 3 年沒有月營收資料</EmptyState>;
      case 'profit':
        return data.quarters.data?.length ? <ProfitTab rows={data.quarters.data} stockLabel={stockLabel} symbol={symbol} /> : <EmptyState>近 4 年沒有單季財報資料</EmptyState>;
      case 'valuation':
        return <ValuationTab rows={data.valuations.data ?? []} stockLabel={stockLabel} symbol={symbol} />;
      default:
        return data.dividends.data?.length ? <DividendTab rows={data.dividends.data} stockLabel={stockLabel} symbol={symbol} /> : <EmptyState>近 5 年沒有除權息紀錄</EmptyState>;
    }
  };
  const anyError = [data.revenue, data.quarters, data.valuations, data.dividends].find((section) => section.error)?.error;

  return (
    <div className="flex flex-col gap-10">
      <Ledger as="h3" title="最新數字" stamp="各格寫明資料期間">
        {data.loading ? (
          <LoadingRows className="h-[180px] bg-card" />
        ) : anyError && !data.revenue.data && !data.quarters.data && !data.valuations.data ? (
          <RetryNotice message={anyError} onRetry={data.reload} />
        ) : (
          <LatestFigures data={data} />
        )}
      </Ledger>
      <Ledger as="h3" title="基本面走勢" stamp="官方公布資料，非投資建議">
        <LedgerPanel>
          <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
            <TabsList aria-label="基本面分頁" className="w-full flex-wrap">
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
