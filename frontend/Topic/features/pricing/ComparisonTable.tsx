import React from 'react';
import { Check, Minus } from 'lucide-react';
import { COMPARISON_GROUPS, PLANS, type BillingPeriod, type PlanCell, type PlanId } from './plans';
import { PlannedBadge } from './PlanBadges';
import { planPriceText } from './PlanCards';

/** 數字和後面的單位不拆到兩行（「3 次」「40 檔」）：中間換成不換行空白 */
const NBSP = String.fromCharCode(0xa0);
const keepUnit = (text: string): string => text.replace(/(\d) (?=\D)/g, `$1${NBSP}`);

function CellValue({ cell }: { cell: PlanCell }) {
  if (cell.kind === 'excluded') {
    return (
      <>
        <Minus size={16} className="mx-auto text-muted-foreground" aria-hidden />
        <span className="sr-only">不包含</span>
      </>
    );
  }
  // 窄欄只在空白與標點處換行，不把「不需登入」拆成兩行
  const note = cell.note ? (
    <span className="mt-0.5 block text-[12px] leading-snug text-balance text-muted-foreground [word-break:keep-all] [overflow-wrap:anywhere]">{keepUnit(cell.note)}</span>
  ) : null;
  if (cell.kind === 'included') {
    return (
      <>
        <Check size={16} className="mx-auto text-foreground" aria-hidden />
        <span className="sr-only">包含</span>
        {note}
      </>
    );
  }
  return (
    <>
      <span className="block font-medium">{keepUnit(cell.text)}</span>
      {note}
    </>
  );
}

/**
 * 方案比較表，依「所有方案都一樣／用量／工具」分組。
 * md 以上是一般的四欄表格；手機每列改成「功能名稱一整列，下面三欄是三個方案」，表頭（方案名與價格）黏在頁首下方，
 * 375 寬不必橫向捲動。改了 display 的表格元素明確標 ARIA role，表格語意才不會被瀏覽器丟掉。
 */
export function ComparisonTable({ billing, currentPlanId }: { billing: BillingPeriod; currentPlanId: PlanId }) {
  return (
    <div className="min-w-0 bg-card">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 text-[13px] text-muted-foreground sm:px-5">
        <span className="inline-flex items-center gap-1.5">
          <Check size={14} className="text-foreground" aria-hidden />
          包含
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Minus size={14} aria-hidden />
          不包含
        </span>
        <span className="inline-flex items-center gap-1.5">
          <PlannedBadge />
          系統還沒有這項功能
        </span>
      </p>
      <table role="table" className="block w-full border-collapse text-sm md:table md:table-fixed">
        <caption className="sr-only">免費版、進階版、專業版的功能與額度比較</caption>
        <thead role="rowgroup" className="sticky top-[var(--app-header-height)] z-10 block border-b border-border-strong bg-muted md:table-header-group">
          <tr role="row" className="grid grid-cols-3 md:table-row">
            <th
              role="columnheader"
              scope="col"
              className="sr-only text-left text-[12px] font-medium tracking-[0.04em] text-muted-foreground md:not-sr-only md:table-cell md:w-2/5 md:px-5 md:py-3 md:align-bottom"
            >
              功能
            </th>
            {PLANS.map((plan) => {
              const price = planPriceText(plan, billing);
              return (
                <th key={plan.id} role="columnheader" scope="col" className="px-2 py-2.5 text-center align-bottom md:table-cell md:px-3 md:py-3">
                  <span className="block text-[13px] font-medium text-foreground md:text-sm">{plan.name}</span>
                  <span className="characteristic mt-0.5 block font-normal text-subtle">
                    {price.amount}／{price.unit}
                  </span>
                  {plan.id === currentPlanId ? <span className="mt-0.5 block text-[12px] font-normal text-muted-foreground">目前方案</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        {COMPARISON_GROUPS.map((group) => (
          <tbody key={group.id} role="rowgroup" className="block md:table-row-group">
            <tr role="row" className="block border-b md:table-row">
              <th
                role="rowheader"
                scope="rowgroup"
                colSpan={PLANS.length + 1}
                className="block bg-accent px-4 py-2.5 text-left font-normal sm:px-5 md:table-cell"
              >
                <span className="text-[13px] font-medium tracking-[0.04em] text-foreground">{group.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">{group.description}</span>
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.feature} role="row" className="grid grid-cols-3 border-b last:border-b-0 md:table-row md:last:border-b">
                <th
                  role="rowheader"
                  scope="row"
                  className="col-span-3 px-4 pt-3 pb-1 text-left font-medium sm:px-5 md:table-cell md:py-3 md:align-middle"
                >
                  {row.feature}
                  {row.planned ? <PlannedBadge className="ml-1.5 align-[0.1em]" /> : null}
                </th>
                {PLANS.map((plan) => (
                  <td
                    key={plan.id}
                    role="cell"
                    className="min-h-11 px-2 pt-1 pb-3 text-center text-[13px] leading-snug md:table-cell md:px-3 md:py-3 md:align-middle md:text-sm"
                  >
                    <CellValue cell={row.cells[plan.id]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
