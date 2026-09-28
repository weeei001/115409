import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtAmount, fmtPercent } from '@/lib/utils/format';
import { deriveMetrics } from '../derive';
import { fmtMoney, fmtShares, signToneClass } from '../display';
import type { SimDayEvent, SimMetrics } from '../types';
import { DemoCard } from './DemoCard';

const pct = (v: number | null | undefined) => fmtPercent(v, { sign: true, fallback: '資料不足' });

interface KpiProps {
  label: string;
  value: string;
  /** 數值後面的小字單位（例如「個百分點」），避免擠在大字裡換行 */
  unit?: string;
  hint?: string;
  toneClass?: string;
}

function Kpi({ label, value, unit, hint, toneClass }: KpiProps) {
  return (
    <div data-stagger className="min-w-0 rounded-lg border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-mono text-lg font-semibold tabular-nums', toneClass ?? 'text-foreground')}>
        {value}
        {unit ? <span className="ml-1 font-sans text-xs font-medium">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface BackendRow {
  label: string;
  /** 後端 metrics 的 key，列出來方便對照 */
  keyName: string;
  value: string;
  toneClass?: string;
}

/**
 * 後端 metrics 只列實測確認過、且屬於標準可解釋的指標。
 * hindsight_bounds（事後最優／最差與 0～100 的 percentile）刻意不顯示。
 */
function backendRows(m: SimMetrics): BackendRow[] {
  const baseline = m.baseline_buy_and_hold;
  const moneyValue = (v: number | null) => (v === null ? '資料不足' : `${fmtMoney(v)} 元`);
  return [
    { label: '期末資產', keyName: 'final_portfolio_value', value: moneyValue(m.final_portfolio_value) },
    { label: '總報酬率', keyName: 'total_return_pct', value: pct(m.total_return_pct), toneClass: signToneClass(m.total_return_pct) },
    {
      label: m.annualized_is_extrapolated ? '年化報酬率（區間太短，為外推值）' : '年化報酬率',
      keyName: 'annualized_return_pct',
      value: pct(m.annualized_return_pct),
      toneClass: signToneClass(m.annualized_return_pct),
    },
    { label: '最大回撤', keyName: 'max_drawdown_pct', value: fmtPercent(m.max_drawdown_pct, { fallback: '資料不足' }) },
    { label: '交易次數', keyName: 'trade_count', value: m.trade_count === null ? '資料不足' : `${m.trade_count} 次` },
    { label: '賣出次數', keyName: 'sell_count', value: m.sell_count === null ? '資料不足' : `${m.sell_count} 次` },
    { label: '獲利次數', keyName: 'win_count', value: m.win_count === null ? '資料不足' : `${m.win_count} 次` },
    { label: '勝率', keyName: 'win_rate_pct', value: fmtPercent(m.win_rate_pct, { fallback: '資料不足' }) },
    { label: '已實現損益', keyName: 'realized_pnl', value: moneyValue(m.realized_pnl), toneClass: signToneClass(m.realized_pnl) },
    { label: '未實現損益', keyName: 'unrealized_pnl', value: moneyValue(m.unrealized_pnl), toneClass: signToneClass(m.unrealized_pnl) },
    { label: '總損益', keyName: 'total_pnl', value: moneyValue(m.total_pnl), toneClass: signToneClass(m.total_pnl) },
    {
      label: '買進持有報酬率（後端）',
      keyName: 'baseline_buy_and_hold.total_return_pct',
      value: pct(baseline?.total_return_pct),
      toneClass: signToneClass(baseline?.total_return_pct),
    },
    {
      label: '買進持有期末資產（後端）',
      keyName: 'baseline_buy_and_hold.final_value',
      value: moneyValue(baseline?.final_value ?? null),
    },
    {
      label: '買進持有股數（後端）',
      keyName: 'baseline_buy_and_hold.shares',
      value: baseline?.shares == null ? '資料不足' : `${fmtShares(baseline.shares)} 股`,
    },
  ];
}

interface Props {
  initialCash: number;
  days: SimDayEvent[];
  metrics: SimMetrics;
}

export function SummaryPanel({ initialCash, days, metrics }: Props) {
  const derived = useMemo(() => deriveMetrics(initialCash, days), [initialCash, days]);
  const rows = useMemo(() => backendRows(metrics), [metrics]);

  return (
    <DemoCard title="績效摘要" icon={BarChart3} description="模擬回測結果，不構成投資建議。">
      <h3 className="mb-2 text-xs font-semibold text-subtle">前端依逐日資料計算</h3>
      {derived ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Kpi label="期末資產" value={fmtAmount(derived.finalValue)} hint={`${fmtMoney(derived.finalValue)} 元`} />
          <Kpi
            label="累積報酬率"
            value={pct(derived.cumulativeReturnPct)}
            toneClass={signToneClass(derived.cumulativeReturnPct)}
            hint="期末資產 ÷ 初始資金 − 1"
          />
          <Kpi label="最大回撤" value={fmtPercent(derived.maxDrawdownPct)} hint="資產淨值自前高的最大跌幅" />
          <Kpi label="交易次數" value={`${derived.tradeCount} 次`} hint="成交股數不為 0 的交易日" />
          <Kpi
            label="買進持有報酬率"
            value={pct(derived.buyAndHoldReturnPct)}
            toneClass={signToneClass(derived.buyAndHoldReturnPct)}
            hint="末日收盤 ÷ 首日收盤 − 1"
          />
          <Kpi
            label="相對買進持有"
            value={derived.excessReturnPct === null ? '資料不足' : fmtPercent(derived.excessReturnPct, { sign: true }).replace('%', '')}
            unit={derived.excessReturnPct === null ? undefined : '個百分點'}
            toneClass={signToneClass(derived.excessReturnPct)}
            hint="累積報酬率 − 買進持有報酬率"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">資料不足，無法計算。</p>
      )}

      <h3 className="mt-5 mb-2 text-xs font-semibold text-subtle">後端 metrics</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.keyName} className="border-b last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="text-subtle">{row.label}</span>
                  <span className="block font-mono text-[11px] break-all text-muted-foreground">{row.keyName}</span>
                </th>
                <td className={cn('py-2 text-right font-mono tabular-nums whitespace-nowrap', row.toneClass ?? 'text-foreground')}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        後端的買進持有與前端的首末日收盤報酬算法不同，數字可能不一樣；計算方式以後端為準。
      </p>

      {metrics.note ? (
        <details className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-5 text-subtle">
          <summary className="cursor-pointer py-2.5 font-medium sm:py-1">後端方法說明（metrics.note 原文）</summary>
          <p className="mt-1 whitespace-pre-wrap">{metrics.note}</p>
        </details>
      ) : null}
    </DemoCard>
  );
}
