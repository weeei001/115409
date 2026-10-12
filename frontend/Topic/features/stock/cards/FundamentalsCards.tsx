import { ChartColumn, Coins, RefreshCw, Scale } from 'lucide-react';
import type { LightState } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import type { StockFundamentals } from '@/lib/hooks/useStockFundamentals';
import type { StockHoldings } from '@/lib/hooks/useStockHoldings';
import { lastOf } from '@/lib/fundamentals/stockFundamentals';
import { fmtAmount, fmtNum, fmtPercent, fmtPrice, signedCount, signedText } from '@/lib/utils/format';
import { CardShell } from './CardShell';

/*
 * 個股頁「基本面與持股」帳頁的三格。年增率、餘額增減不是股價漲跌，只帶正負號、不上紅綠。
 */

const retryButton = (onRetry: () => void) => (
  <Button type="button" size="sm" variant="outline" onClick={onRetry} className="min-h-11">
    <RefreshCw aria-hidden />
    重試
  </Button>
);

function Rows({ rows }: { rows: Array<{ label: string; value: string; note?: string | null }> }) {
  return (
    <dl className="mt-4 flex-1 border-t">
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-11 items-center justify-between gap-2 border-b py-1.5">
          <dt className="min-w-0 text-[13px] text-subtle">
            {row.label}
            {row.note ? <span className="characteristic block">{row.note}</span> : null}
          </dt>
          <dd className="font-mono text-[13.5px] font-medium whitespace-nowrap tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Headline({ value, caption }: { value: string; caption: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-2xl leading-none font-semibold whitespace-nowrap tabular-nums">{value}</span>
      <span className="text-[13px] text-muted-foreground">{caption}</span>
    </p>
  );
}

const growth = (value: number | null | undefined) => signedText(value, 2, '%');
const stateOf = (loading: boolean, error: string | null | undefined): LightState => (loading ? 'loading' : error ? 'error' : 'ready');

export function RevenueProfitCard({ data, onOpenDetail }: { data: StockFundamentals; onOpenDetail: () => void }) {
  const month = lastOf(data.revenue.data ?? []);
  const quarter = [...(data.quarters.data ?? [])].reverse().find((q) => q.eps != null || q.revenue != null) ?? null;
  const error = data.revenue.error && data.quarters.error ? data.revenue.error : null;
  return (
    <CardShell
      icon={ChartColumn}
      title="營收與獲利"
      unit="新台幣"
      state={stateOf(data.loading, error)}
      stampDate={month?.period ?? undefined}
      stampLabel="月營收"
      loading={data.loading}
      loadingRows={4}
      error={error}
      errorAction={retryButton(data.reload)}
      isEmpty={!month && !quarter}
      emptyText="尚無月營收與財報資料"
      action={{ label: '基本面明細', onClick: onOpenDetail }}
    >
      <Headline value={fmtAmount(month?.revenue)} caption={month ? `${month.period} 月營收` : '月營收'} />
      <Rows
        rows={[
          { label: '營收年增率', note: month ? `${month.period} 比去年同月` : null, value: growth(month?.yoy) },
          { label: '單季 EPS', note: quarter?.label ?? null, value: quarter?.eps != null ? `${fmtPrice(quarter.eps)} 元` : '--' },
          { label: '毛利率', note: quarter?.label ?? null, value: fmtPercent(quarter?.grossMargin) },
        ]}
      />
    </CardShell>
  );
}

export function ValuationDividendCard({ data, onOpenDetail }: { data: StockFundamentals; onOpenDetail: () => void }) {
  const valuation = lastOf(data.valuations.data ?? []);
  const dividend = data.dividends.data?.[0] ?? null;
  const error = data.valuations.error && data.dividends.error ? data.valuations.error : null;
  return (
    <CardShell
      icon={Scale}
      title="估值與股利"
      unit="交易所公布"
      state={stateOf(data.loading, error)}
      stampDate={valuation?.date ?? undefined}
      stampLabel="估值"
      loading={data.loading}
      loadingRows={4}
      error={error}
      errorAction={retryButton(data.reload)}
      isEmpty={!valuation && !dividend}
      emptyText="尚無估值與除權息資料"
      action={{ label: '基本面明細', onClick: onOpenDetail }}
    >
      <Headline value={valuation?.per != null ? `${fmtPrice(valuation.per)} 倍` : '--'} caption="本益比" />
      <Rows
        rows={[
          { label: '股價淨值比', value: valuation?.pbr != null ? `${fmtPrice(valuation.pbr)} 倍` : '--' },
          { label: '殖利率', value: fmtPercent(valuation?.dividendYield) },
          {
            label: '最近除權息',
            note: dividend ? `${dividend.date}（${dividend.kind ?? '類別未提供'}）` : '近 5 年無紀錄',
            value: dividend?.value != null ? `${fmtPrice(dividend.value)} 元` : '--',
          },
        ]}
      />
    </CardShell>
  );
}

export function HoldingsCard({ data, onOpenDetail }: { data: StockHoldings; onOpenDetail: () => void }) {
  const margin = lastOf(data.margin.data ?? []);
  const foreign = lastOf(data.foreign.data ?? []);
  const week = lastOf(data.holding.data ?? []);
  const error = data.margin.error && data.foreign.error && data.holding.error ? data.margin.error : null;
  return (
    <CardShell
      icon={Coins}
      title="信用交易與持股"
      unit="張"
      state={stateOf(data.loading, error)}
      stampDate={margin?.date ?? foreign?.date ?? undefined}
      stampLabel="信用交易"
      loading={data.loading}
      loadingRows={4}
      error={error}
      errorAction={retryButton(data.reload)}
      isEmpty={!margin && !foreign && !week}
      emptyText="所選期間沒有信用交易與持股資料"
      action={{ label: '信用交易與持股', onClick: onOpenDetail }}
    >
      <Headline value={margin?.marginBalance != null ? `${fmtNum(margin.marginBalance)} 張` : '--'} caption="融資餘額" />
      <Rows
        rows={[
          { label: '融資增減', note: margin ? '比前一交易日' : null, value: margin?.marginChange != null ? `${signedCount(margin.marginChange)} 張` : '--' },
          { label: '外資持股比例', note: foreign?.date ?? null, value: fmtPercent(foreign?.ratio) },
          { label: '持股超過 1,000 張的比例', note: week ? `集保 ${week.date}` : null, value: fmtPercent(week?.top?.percent) },
        ]}
      />
    </CardShell>
  );
}
