import React, { useEffect, useLayoutEffect, useState } from 'react';
import { fetchHistory } from '../../lib/api/stock';
import { userFacingMessage } from '../../lib/api/errorDetail';
import { estimateFromHistory, orderEstimateInput, type OrderEstimateState } from './estimate';

const format = new Intl.NumberFormat('zh-TW');

/** 收據的一列：左側項目、右側等寬數字；列與列之間是 1px 線（父層 gap-px bg-border） */
const receiptRow = 'flex min-h-11 items-baseline justify-between gap-4 bg-card px-3 py-2.5';
const receiptValue = 'text-right font-mono text-[13.5px] tabular-nums text-foreground';

/** 收據頂端的讀數：預估金額用 Figure XL，是委託單帳頁的視覺重心 */
const figureXl = 'font-mono text-[clamp(30px,3vw,40px)] leading-tight font-semibold tabular-nums';

/** 還沒有數字時的一行說明：一般字級、不放大字的「--」，上下是收據的線 */
const quietLine = 'border-y px-3 py-2.5 text-[13px] leading-relaxed';

/**
 * 預估金額與試算：有估值時才出現大字的預估金額，下面是一張有線的收據（依據），數字等寬靠右。
 * 還沒填代號或張數（idle）、查詢中、無法估算時，只有一行一般字級的說明。
 */
export function OrderEstimateContent({ state, idle = false }: { state: OrderEstimateState; idle?: boolean }) {
  return <section aria-label="預估金額與試算" aria-busy={state.kind === 'loading'} className="min-w-0">
    <h3 className="mb-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">預估金額與試算</h3>
    <div role="status" className="text-sm leading-relaxed text-subtle">
      {idle ? <p className={`${quietLine} text-muted-foreground`}>填好代號與張數後會顯示預估金額</p>
        : state.kind === 'loading' ? <p className={`${quietLine} q-rows`}>正在查詢指定日收盤行情…</p>
        : state.kind === 'unavailable' ? <p className={quietLine}>{state.reason}</p>
          : <dl className="grid gap-px border-b bg-border">
            <div className="bg-card pb-3">
              <dt className="sr-only">預估金額</dt>
              <dd className={`${figureXl} break-all text-foreground`}>{format.format(state.amount)} TWD</dd>
            </div>
            <div className={`${receiptRow} border-t border-border-strong`}><dt className="text-muted-foreground">參考收盤價</dt><dd className={receiptValue}>{state.price} TWD／股</dd></div>
            <div className={receiptRow}><dt className="text-muted-foreground">採價日期</dt><dd className={receiptValue}>{state.date}</dd></div>
            <div className={receiptRow}><dt className="text-muted-foreground">數量</dt><dd className={receiptValue}>{format.format(state.lots)} 張（{format.format(state.shares)} 股）</dd></div>
          </dl>}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">依已儲存的指定日收盤價估算，每張 1,000 股；一般模擬單目前不計手續費與交易稅。不是即時報價或保證成交值，送出時仍由後端驗證並計算。</p>
  </section>;
}

export function OrderEstimate({ symbol, tradeDate, quantity, today }: { symbol: string; tradeDate: string; quantity: string; today: string }) {
  const date = tradeDate.trim() || today;
  const input = orderEstimateInput(symbol, date, quantity, today);
  const key = `${symbol}|${date}|${quantity}`;
  const [result, setResult] = useState<{ key: string; state: OrderEstimateState } | null>(null);

  useLayoutEffect(() => {
    setResult(null);
  }, [key, today]);

  useEffect(() => {
    if ('reason' in input) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      void fetchHistory(symbol, { start_date: date, end_date: date, limit: 1 }, { signal: controller.signal })
        .then((history) => {
          if (active) setResult({ key, state: estimateFromHistory(history, symbol, date, input.lots, today) });
        })
        .catch((error) => {
          if (active) setResult({ key, state: { kind: 'unavailable', reason: userFacingMessage(error, '收盤行情查詢失敗，目前無法估算。') } });
        });
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  // Primitive inputs own the request; a response cannot apply to another form snapshot.
  }, [symbol, date, quantity, today, key]);

  const state: OrderEstimateState = 'reason' in input ? { kind: 'unavailable', reason: input.reason }
    : result?.key === key ? result.state : { kind: 'loading' };
  // 代號或張數還空著：還沒開始試算，只放一行安靜的說明
  return <OrderEstimateContent state={state} idle={!symbol || !quantity.trim()} />;
}
