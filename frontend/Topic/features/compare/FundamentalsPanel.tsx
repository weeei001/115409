import { LedgerPanel } from '@/components/common/Ledger';
import type { CompareFundamentalsData } from '@/lib/api/compareFundamentals';
import { buildFundamentalsComparison, epsPeriodLabel } from '@/lib/utils/compareFundamentals';
import { fmtAmount, fmtPercent, fmtPrice } from '@/lib/utils/format';

const cell = 'px-3 py-3 text-right font-mono text-[13.5px] tabular-nums sm:px-4';
const note = 'mt-1 block font-sans text-[11px] font-normal text-muted-foreground';
const link = 'text-subtle underline underline-offset-4 hover:text-foreground';

/** 基本面比較：營收、EPS、估值與各自的資料期間；不排名 */
export function FundamentalsPanel({ symbols, data, endDate }: {
  symbols: string[];
  data: Record<string, CompareFundamentalsData | null>;
  endDate: string;
}) {
  const comparison = buildFundamentalsComparison(symbols, data, endDate);
  return (
      <div className="grid gap-px bg-border">
      <LedgerPanel className="space-y-1 text-[13px] leading-relaxed text-muted-foreground">
        <p>資料期間截至 {endDate}，各項優先採所有股票都有資料的最近共同期間。</p>
        {/* 同一段的全形標點後不換行，避免 JSX 換行多出半形空格（P2-109） */}
        <p>
          {`月營收：${comparison.aligned.revenue ? '同月份' : '無共同月份或資料不足，各自標示'}；`}
          {`估值：${comparison.aligned.valuation ? '同日期' : '無共同日期或資料不足，各自標示'}；`}
          {`EPS：${comparison.aligned.eps ? '同期間、同編製基礎' : '期間或編製基礎（合併／個別）未對齊、或資料不足，各自標示'}。不進行排名。`}
        </p>
      </LedgerPanel>
      <LedgerPanel padded={false}>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[850px] text-sm">
            <caption className="sr-only">各檔股票的營收、EPS、估值及其資料期間</caption>
            <thead>
              <tr className="border-b border-border-strong">
                {['股票', '月營收（新台幣）', '營收年增率', '基本 EPS（元／股）', 'EPS 年增率', '本益比', '股價淨值比', '殖利率'].map((label) => (
                  <th key={label} scope="col" className="h-11 px-3 text-right text-[13px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground first:text-left sm:px-4">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>{comparison.rows.map((row) => <tr key={row.symbol} className="border-b align-top last:border-b-0">
              <th scope="row" className="px-3 py-3 text-left font-mono text-[13.5px] font-medium tabular-nums sm:px-4">{row.symbol}</th>
              <td className={cell}>{fmtAmount(row.revenue?.value)}<span className={note}>{row.revenue?.period ?? '月份未提供'}</span><span className={note}>{row.revenue ? (row.revenue.publication ? `公布 ${row.revenue.publication}` : '公布日期未提供') : ''}</span></td>
              <td className={cell}>{fmtPercent(row.revenueYoy, { sign: true })}</td>
              <td className={cell}>{fmtPrice(row.eps?.value)}<span className={note}>{row.eps ? epsPeriodLabel(row.eps) : '期間／編製基礎未提供'}</span></td>
              <td className={cell}>{fmtPercent(row.epsYoy, { sign: true })}</td>
              <td className={cell}>{fmtPrice(row.valuation?.per)}<span className={note}>{row.valuation?.period ?? '日期未提供'}</span></td>
              <td className={cell}>{fmtPrice(row.valuation?.pbr)}<span className={note}>{row.valuation?.period ?? '日期未提供'}</span></td>
              <td className={cell}>{fmtPercent(row.valuation?.yield)}<span className={note}>{row.valuation?.period ?? '日期未提供'}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
      </LedgerPanel>
      <LedgerPanel className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        {comparison.warnings.length > 0 && <p>{comparison.warnings.map((warning) => warning.replace(/。$/, '')).join('；')}。</p>}
        <p>年增率只和去年同期、同編製基礎比較；無法比較時顯示 --。估值高低須配合產業與獲利解讀。</p>
        <p>財報實際公布日未保存，表中數字不一定是當時已公開的資訊。</p>
        <p>
          官方來源：營收與累計財報可查 <a className={link} href="https://mopsfin.twse.com.tw/compare/report" target="_blank" rel="noreferrer">公開資訊觀測站</a>
          {'；估值可查 '}
          <a className={link} href="https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL" target="_blank" rel="noreferrer">證交所</a>／
          <a className={link} href="https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis" target="_blank" rel="noreferrer">櫃買中心</a>。單季 EPS 取自本站資料，未逐筆標示出處。
        </p>
      </LedgerPanel>
      </div>
  );
}
