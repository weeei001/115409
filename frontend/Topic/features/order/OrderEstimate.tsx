import React, { useEffect, useLayoutEffect, useState } from 'react';
import { fetchHistory } from '../../lib/api/stock';
import { userFacingMessage } from '../../lib/api/errorDetail';
import { estimateFromHistory, orderEstimateInput, type OrderEstimateState } from './estimate';

const format = new Intl.NumberFormat('zh-TW');

export function OrderEstimateContent({ state }: { state: OrderEstimateState }) {
  return <section aria-label="預估金額與試算" aria-busy={state.kind === 'loading'} className="min-w-0 flex-1 rounded-lg border bg-muted/50 px-4 py-2.5">
    <h3 className="mb-1 text-xs text-muted-foreground">預估金額與試算</h3>
    <div role="status" className="text-sm leading-relaxed text-subtle">
      {state.kind === 'loading' ? <p>正在查詢指定日收盤行情…</p> : state.kind === 'unavailable' ? <p>{state.reason}</p> : <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline">參考收盤價：</dt><dd className="inline font-mono">{state.price} TWD／股</dd></div>
        <div><dt className="inline">採價日期：</dt><dd className="inline font-mono">{state.date}</dd></div>
        <div><dt className="inline">數量：</dt><dd className="inline">{format.format(state.lots)} 張（{format.format(state.shares)} 股）</dd></div>
        <div><dt className="inline">預估金額：</dt><dd className="inline font-mono font-semibold">{format.format(state.amount)} TWD</dd></div>
      </dl>}
    </div>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">依已儲存的指定日收盤價估算，每張 1,000 股；一般模擬單目前不計手續費與交易稅。不是即時報價或保證成交值，送出時仍由後端驗證並計算。</p>
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
  return <OrderEstimateContent state={state} />;
}
