import React from 'react';
import { Landmark } from 'lucide-react';
import { Panel } from '@/components/common/Panel';
import type { CompareFundamentalsData } from '@/lib/api/compareFundamentals';
import { buildFundamentalsComparison, epsPeriodLabel } from '@/lib/utils/compareFundamentals';
import { fmtAmount, fmtPercent, fmtPrice } from '@/lib/utils/format';

const cell = 'px-3 py-3 text-right tabular-nums';
const note = 'mt-1 block text-[11px] font-normal text-muted-foreground';

export function FundamentalsPanel({ symbols, data, endDate }: {
  symbols: string[];
  data: Record<string, CompareFundamentalsData | null>;
  endDate: string;
}) {
  const comparison = buildFundamentalsComparison(symbols, data, endDate);
  return (
    <Panel icon={Landmark} title="基本面比較" description={`資料期間截至 ${endDate}，各項優先採所有股票都有資料的最近共同期間。`} className="rounded-2xl">
      <div className="space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">
          月營收：{comparison.aligned.revenue ? '同月份' : '無共同月份或資料不足，各自標示'}；
          估值：{comparison.aligned.valuation ? '同日期' : '無共同日期或資料不足，各自標示'}；
          EPS：{comparison.aligned.eps ? '同期間與口徑' : '期間／口徑未對齊或資料不足，各自標示'}。不進行排名。
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[850px] text-xs">
            <caption className="sr-only">各檔股票的營收、EPS、估值及其資料期間</caption>
            <thead className="bg-muted text-muted-foreground"><tr>
              {['股票', '月營收（新台幣）', '營收年增率', '基本 EPS（元／股）', 'EPS 年增率', '本益比', '股價淨值比', '殖利率'].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 text-right first:text-left">{label}</th>)}
            </tr></thead>
            <tbody>{comparison.rows.map((row) => <tr key={row.symbol} className="border-t align-top">
              <th scope="row" className="px-3 py-3 text-left font-mono">{row.symbol}</th>
              <td className={cell}>{fmtAmount(row.revenue?.value)}<span className={note}>{row.revenue?.period ?? '月份未提供'}</span><span className={note}>{row.revenue ? (row.revenue.publication ? `出表 ${row.revenue.publication}` : '出表日期未提供') : ''}</span></td>
              <td className={cell}>{fmtPercent(row.revenueYoy, { sign: true })}</td>
              <td className={cell}>{fmtPrice(row.eps?.value)}<span className={note}>{row.eps ? epsPeriodLabel(row.eps) : '期間／口徑未提供'}</span></td>
              <td className={cell}>{fmtPercent(row.epsYoy, { sign: true })}</td>
              <td className={cell}>{fmtPrice(row.valuation?.per)}<span className={note}>{row.valuation?.period ?? '日期未提供'}</span></td>
              <td className={cell}>{fmtPrice(row.valuation?.pbr)}<span className={note}>{row.valuation?.period ?? '日期未提供'}</span></td>
              <td className={cell}>{fmtPercent(row.valuation?.yield)}<span className={note}>{row.valuation?.period ?? '日期未提供'}</span></td>
            </tr>)}</tbody>
          </table>
        </div>
        {comparison.warnings.length > 0 && <p className="text-xs text-muted-foreground">{comparison.warnings.join('；')}。</p>}
        <p className="text-xs leading-5 text-muted-foreground">
          年增率只比較去年相同期間及相同 EPS 口徑；去年數值為零、負值、缺漏或 EPS 合併／個別口徑不明時顯示 --。估值高低須配合產業與獲利解讀。
          財報公告日未提供，月營收出表日也可能缺漏；此表是會計期間快照，不能視為截止日當時已公開的資訊。已知出表日在截止日之後的營收已排除。
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          官方來源：營收與累計財報可查 <a className="underline underline-offset-2" href="https://mopsfin.twse.com.tw/compare/report" target="_blank" rel="noreferrer">公開資訊觀測站</a>；
          估值可查 <a className="underline underline-offset-2" href="https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL" target="_blank" rel="noreferrer">證交所</a>／
          <a className="underline underline-offset-2" href="https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis" target="_blank" rel="noreferrer">櫃買中心</a>。單季 EPS 沿用既有匯入資料；來源未逐筆記錄。
        </p>
      </div>
    </Panel>
  );
}
