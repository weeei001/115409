import React from 'react';
import Link from 'next/link';
import { Ledger, LedgerPanel, cellClass, headCellClass } from '@/components/common/Ledger';
import { Notice } from '@/components/common/Notice';
import { textLinkClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatCount, planById } from '@/features/pricing/plans';
import {
  BASE_ASSUMPTIONS,
  REVENUE_SCENARIOS,
  payersToCover,
  scenarioAssumptions,
  simulateMonthlyRevenue,
  unitEconomics,
  type MonthlyRevenue,
} from '@/features/pricing/revenue';

/** 行情授權最壞情況：盤後網頁報價，註冊會員未滿 20 萬戶時每月 5 萬元（商業模式 7.2，[待查證]） */
const MARKET_DATA_LICENSE_TWD = 50_000;

const money = (value: number, digits = 0): string => value.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (ratio: number): string => `${money(ratio * 100)}%`;
const numCell = cn(cellClass, 'text-right font-mono text-[13.5px] tabular-nums');

const SCENARIO_ROWS: Array<{ label: string; value: (r: MonthlyRevenue, members: number) => string; strong?: boolean }> = [
  { label: '註冊會員（A1）', value: (_, members) => formatCount(members) },
  { label: '付費人數（A2）', value: (r) => formatCount(r.paid) },
  { label: '其中進階版、專業版（A3）', value: (r) => `${formatCount(r.plus)}、${formatCount(r.pro)}` },
  { label: '訂閱收入', value: (r) => money(r.revenue), strong: true },
  { label: '金流手續費', value: (r) => money(r.fees) },
  { label: 'AI 對話：免費會員', value: (r) => money(r.aiFree) },
  { label: 'AI 對話：進階版', value: (r) => money(r.aiPlus) },
  { label: 'AI 對話：專業版', value: (r) => money(r.aiPro) },
  { label: '固定 LLM（摘要預熱加新聞判讀上限）', value: (r) => money(r.fixedLlm) },
  { label: '貢獻毛利（還沒扣主機、授權、人力）', value: (r) => money(r.contribution), strong: true },
];

/**
 * 後台「方案與營收（展示）」：商業模式第 6 節的試算表。後端沒有訂閱資料，這裡不放各方案的實際人數，
 * 只放標明是假設值的情境試算；實際的 AI 摘要用量與估算成本在「AI 成效」分頁。
 */
export function PlanRevenuePanel({ onViewAiUsage }: { onViewAiUsage?: () => void }) {
  const results = REVENUE_SCENARIOS.map((scenario) => ({ scenario, result: simulateMonthlyRevenue(scenarioAssumptions(scenario)) }));
  const base = results.find((item) => item.scenario.id === 'base') ?? results[0];
  const units = unitEconomics(scenarioAssumptions(base.scenario));
  const licensePayers = payersToCover(MARKET_DATA_LICENSE_TWD + base.result.fixedLlm, base.result.netPerPayer);

  return (
    <div className="space-y-10 lg:space-y-16">
      <Notice tone="warning">
        以下數字全部是商業模式第 6 節的假設試算，不是實際營收、付費人數或實測成本；後端目前沒有方案或訂閱資料。
        {onViewAiUsage ? (
          <button type="button" onClick={onViewAiUsage} className={cn('ml-1', textLinkClass)}>
            實際的 AI 用量與估算成本見「AI 成效」
          </button>
        ) : null}
      </Notice>

      <Ledger aria-labelledby="revenue-scenarios-heading" title={<span id="revenue-scenarios-heading">每月情境試算</span>} stamp="新臺幣 · 假設值 · 全部以月繳計">
        <LedgerPanel padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">保守、基準、樂觀三種情境的每月收入與成本試算，單位新臺幣</caption>
              <thead className="border-b border-border-strong bg-muted">
                <tr>
                  <th scope="col" className={headCellClass}>項目</th>
                  {results.map(({ scenario }) => (
                    <th key={scenario.id} scope="col" className={cn(headCellClass, 'text-right')}>{scenario.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SCENARIO_ROWS.map((row) => (
                  <tr key={row.label} className="border-b last:border-b-0">
                    <th scope="row" className={cn(cellClass, 'font-normal', row.strong && 'font-semibold')}>{row.label}</th>
                    {results.map(({ scenario, result }) => (
                      <td key={scenario.id} className={cn(numCell, row.strong && 'font-semibold')}>{row.value(result, scenario.members)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LedgerPanel>
      </Ledger>

      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
        <Ledger aria-labelledby="revenue-units-heading" title={<span id="revenue-units-heading">每位付費者的單位經濟</span>} stamp="月繳 · 新臺幣" className="lg:col-span-7">
          <LedgerPanel padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <caption className="sr-only">進階版、專業版每位付費者每月的收入、手續費、LLM 成本與貢獻</caption>
                <thead className="border-b border-border-strong bg-muted">
                  <tr>
                    {['方案', '收入', '手續費', '平均 LLM 成本', '貢獻', '用滿額度時'].map((heading, index) => (
                      <th key={heading} scope="col" className={cn(headCellClass, index && 'text-right')}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.planId} className="border-b last:border-b-0">
                      <th scope="row" className={cn(cellClass, 'font-medium')}>{planById(unit.planId).name}</th>
                      <td className={numCell}>{money(unit.price)}</td>
                      <td className={numCell}>{money(unit.fee, 2)}</td>
                      <td className={numCell}>{money(unit.llmCost, 1)}</td>
                      <td className={numCell}>{money(unit.contribution, 1)}</td>
                      <td className={numCell}>
                        {money(unit.fullQuotaContribution, 1)}
                        <span className="block font-sans text-xs text-muted-foreground">{formatCount(unit.quota)} 次</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LedgerPanel>
        </Ledger>

        <Ledger aria-labelledby="revenue-breakeven-heading" title={<span id="revenue-breakeven-heading">損益兩平</span>} stamp={`${base.scenario.label}情境`} className="lg:col-span-5">
          <LedgerPanel>
            <ul className="list-disc space-y-2 pl-5 text-[15px] leading-[1.8] marker:text-muted-foreground">
              <li>扣掉免費會員攤到的 AI 對話成本後，每位付費者每月淨貢獻約 NT${money(base.result.netPerPayer, 1)}。</li>
              <li>打平固定 LLM 成本（NT${money(base.result.fixedLlm)}）需要 {formatCount(payersToCover(base.result.fixedLlm, base.result.netPerPayer))} 位付費者。</li>
              <li>
                如果行情授權要付每月 {money(MARKET_DATA_LICENSE_TWD)} 元，需要約 {formatCount(licensePayers)} 位付費者；以 {percent(base.scenario.conversion)} 轉換率換算，約{' '}
                {formatCount(Math.ceil(licensePayers / base.scenario.conversion))} 位註冊會員。
              </li>
            </ul>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              貢獻毛利只說明變動成本能不能被收入涵蓋，不代表整體獲利；主機、資料與新聞授權、人力都還沒有計入。
              <Link href="/pricing" className={cn('ml-1', textLinkClass)}>查看方案頁</Link>
            </p>
          </LedgerPanel>
        </Ledger>
      </div>

      <Ledger aria-labelledby="revenue-assumptions-heading" title={<span id="revenue-assumptions-heading">假設值</span>} stamp="商業模式第 6.1 節">
        <LedgerPanel>
          <dl className="grid grid-cols-1 gap-px border-y bg-border text-sm md:grid-cols-2">
            {[
              ['A1 註冊會員數', REVENUE_SCENARIOS.map((s) => `${s.label} ${formatCount(s.members)}`).join('、')],
              ['A2 付費轉換率', REVENUE_SCENARIOS.map((s) => `${s.label} ${percent(s.conversion)}`).join('、')],
              ['A3 付費方案組合', `進階版 ${percent(BASE_ASSUMPTIONS.plusShare)}、專業版 ${percent(1 - BASE_ASSUMPTIONS.plusShare)}`],
              ['A5 免費會員每月活躍比例', percent(BASE_ASSUMPTIONS.activeFreeShare)],
              ['A6 每人每月 AI 提問', `免費 ${BASE_ASSUMPTIONS.asksPerMonth.free}、進階 ${BASE_ASSUMPTIONS.asksPerMonth.plus}、專業 ${BASE_ASSUMPTIONS.asksPerMonth.pro} 次`],
              ['A7 每次提問 tokens', `輸入 ${formatCount(BASE_ASSUMPTIONS.askTokens.input)}、輸出 ${formatCount(BASE_ASSUMPTIONS.askTokens.output)}`],
              ['A8 每份 AI 摘要 tokens', `輸入 ${formatCount(BASE_ASSUMPTIONS.briefTokens.input)}、輸出 ${formatCount(BASE_ASSUMPTIONS.briefTokens.output)}`],
              ['A9 LLM 單價（美元／百萬 tokens）', `輸入 ${BASE_ASSUMPTIONS.usdPerMillion.input}、輸出 ${BASE_ASSUMPTIONS.usdPerMillion.output}`],
              ['A10 匯率', `1 美元 = ${BASE_ASSUMPTIONS.twdPerUsd} 新臺幣`],
              ['A11 每月交易日', `${BASE_ASSUMPTIONS.tradingDays} 天`],
            ].map(([label, value]) => (
              <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card px-0 py-2.5 md:px-3 md:odd:pl-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 text-right">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            依上面的假設，每次 AI 提問約 NT${money(base.result.costPerAsk, 2)}。A4 計費方式全部以月繳計算；A9 取自專案設定的預設單價，不是供應商報價。
          </p>
        </LedgerPanel>
      </Ledger>
    </div>
  );
}
