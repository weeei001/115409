import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDownCircle, ArrowUpCircle, Copy, Loader2, RefreshCw, ShoppingCart } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { ConfirmOrderDialog } from '@/features/order/ConfirmOrderDialog';
import { OrderEstimate } from '@/features/order/OrderEstimate';
import { OrdersTable, ProfitSummaryTable } from '@/features/order/OrderTables';
import { useSimulatedIdentity } from '@/features/order/useSimulatedIdentity';
import { ApiRequestError } from '@/lib/api/client';
import { createSimulatedOrder, fetchAvailableLots, fetchSimulatedOrders, fetchSimulatedProfitByCategory } from '@/lib/api/simulatedOrder';
import type { OrderSide, SellPlan, SimulatedOrderCategoryProfitResponse, SimulatedOrderCreate, SimulatedOrderResponse } from '@/lib/types/api';
import { toYmdLocal } from '@/lib/utils/date';
import { cn } from '@/lib/cn';
import { userFacingMessage } from '@/lib/api/errorDetail';

type ErrorField = 'symbol' | 'quantity' | 'tradeDate' | 'sellPlan' | 'holding' | 'general';

const SYMBOL_RE = /^[0-9A-Z.]+$/;
const inputBase =
  'w-full rounded-lg border bg-muted px-4 py-2.5 font-mono text-base text-foreground outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-2 focus:ring-brand/25 sm:text-sm';
const inputClass = (invalid: boolean) => cn(inputBase, invalid ? 'border-danger' : 'border-input');
const labelClass = 'mb-1.5 block text-sm font-medium text-subtle';
const optionClass = (active: boolean, activeClass: string) =>
  cn(
    'flex min-h-11 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold transition-[color,background-color,border-color]',
    active ? activeClass : 'text-muted-foreground hover:border-border-strong',
  );

export default function OrderPage() {
  const { userId, fromLogin, resetAnonymousId } = useSimulatedIdentity();
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [tradeDate, setTradeDate] = useState('');
  const [sellPlan, setSellPlan] = useState<SellPlan>('long_term');
  const [plannedSellDate, setPlannedSellDate] = useState('');
  const [quantity, setQuantity] = useState('');

  const [orders, setOrders] = useState<SimulatedOrderResponse[]>([]);
  const [profit, setProfit] = useState<SimulatedOrderCategoryProfitResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [profitLoading, setProfitLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availableLots, setAvailableLots] = useState<number | null>(null);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState<string | null>(null);
  const [lotsRefresh, setLotsRefresh] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField | null>(null);

  const today = toYmdLocal();
  const normalizedSymbol = symbol.trim().toUpperCase();
  // 決議 D9-c17：一律用轉大寫後的代號判斷是否可查可賣張數
  const symbolValidForLots = normalizedSymbol.length > 0 && SYMBOL_RE.test(normalizedSymbol);
  const invalid = (field: ErrorField) => errorField === field;

  const setOrderError = useCallback((message: string | null, field: ErrorField | null = null) => {
    setError(message);
    setErrorField(message ? field : null);
  }, []);

  const loadOrdersAndProfit = useCallback(
    async (uid: string) => {
      if (!uid) return;
      setListLoading(true);
      setProfitLoading(true);
      setOrderError(null);
      try {
        const [list, summary] = await Promise.all([fetchSimulatedOrders(uid, 100), fetchSimulatedProfitByCategory(uid)]);
        setOrders(list.data);
        setProfit(summary);
        setLotsRefresh((n) => n + 1);
      } catch (e) {
        setOrderError(userFacingMessage(e, '載入資料失敗'), 'general');
        setOrders([]);
        setProfit(null);
      } finally {
        setListLoading(false);
        setProfitLoading(false);
      }
    },
    [setOrderError],
  );

  useEffect(() => {
    if (userId) void loadOrdersAndProfit(userId);
  }, [userId, loadOrdersAndProfit]);

  // 賣出時查可賣張數；查詢失敗顯示錯誤，不再當成 0 張（決議 D9-c17）
  useEffect(() => {
    setLotsError(null);
    if (side !== 'sell' || !userId || !symbolValidForLots) {
      setAvailableLots(null);
      setLotsLoading(false);
      return;
    }
    let cancelled = false;
    setAvailableLots(null);
    setLotsLoading(true);
    fetchAvailableLots(userId, normalizedSymbol)
      .then((res) => {
        if (!cancelled) setAvailableLots(res.available_lots);
      })
      .catch((e) => {
        if (!cancelled) setLotsError(userFacingMessage(e, '查詢失敗'));
      })
      .finally(() => {
        if (!cancelled) setLotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, normalizedSymbol, symbolValidForLots, side, lotsRefresh]);

  const copyUserId = async () => {
    if (!userId || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(userId);
      toast.success(fromLogin ? '已複製帳號 Email' : '已複製使用者 ID');
    } catch {
      toast.error(fromLogin ? '無法複製 Email' : '無法複製使用者 ID');
    }
  };

  const resetUserId = () => {
    if (fromLogin) {
      toast.info('已登入時以帳號 Email 識別模擬資料，無法重新產生匿名 ID');
      return;
    }
    resetAnonymousId();
    setOrders([]);
    setProfit(null);
  };

  const validate = (): { field: ErrorField; message: string } | null => {
    if (!normalizedSymbol) return { field: 'symbol', message: '請輸入股票代號' };
    if (normalizedSymbol.length > 12) return { field: 'symbol', message: '股票代號過長' };
    if (!SYMBOL_RE.test(normalizedSymbol)) return { field: 'symbol', message: '股票代號格式不正確' };
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return { field: 'quantity', message: '請輸入有效的委託張數' };
    if (tradeDate && tradeDate > today) return { field: 'tradeDate', message: '模擬下單日不可晚於今天' };
    if (side === 'sell') {
      if (lotsError) return { field: 'holding', message: `無法取得可賣張數：${lotsError}` };
      if (lotsLoading || availableLots === null) return { field: 'holding', message: '可賣張數載入中，請稍候再試' };
      if (availableLots <= 0) return { field: 'holding', message: '尚未持有此股票，無法賣出（請先以買進建立持股）' };
      if (qty > availableLots) return { field: 'quantity', message: `賣出張數不可超過持有 ${availableLots} 張` };
      return null;
    }
    if (sellPlan === 'by_date') {
      const planned = plannedSellDate.trim();
      if (!planned) return { field: 'sellPlan', message: '請選擇預計賣出日' };
      if (planned < (tradeDate.trim() || today)) return { field: 'sellPlan', message: '預計賣出日不可早於模擬下單日' };
    }
    return null;
  };

  const handleSubmit = () => {
    const result = validate();
    if (result) {
      setOrderError(result.message, result.field);
      return;
    }
    setOrderError(null);
    setShowConfirm(true);
  };

  const confirmOrder = async () => {
    if (!userId) return;
    const body: SimulatedOrderCreate = { user_id: userId, symbol: normalizedSymbol, side, quantity: parseInt(quantity, 10) };
    if (tradeDate.trim()) body.trade_date = tradeDate.trim();
    if (side === 'buy') {
      body.sell_plan = sellPlan;
      if (sellPlan === 'by_date') body.planned_sell_date = plannedSellDate.trim();
    }
    setSubmitting(true);
    setOrderError(null);
    try {
      await createSimulatedOrder(body);
      setShowConfirm(false);
      setSymbol('');
      setQuantity('');
      setTradeDate('');
      setSellPlan('long_term');
      setPlannedSellDate('');
      toast.success('模擬下單成功');
      await loadOrdersAndProfit(userId);
    } catch (e) {
      let message: string;
      let field: ErrorField = 'general';
      if (e instanceof ApiRequestError && e.status === 404) {
        message = '該股票在指定日期無日線收盤資料，請換日期或代號再試';
        field = 'symbol';
      } else if (e instanceof ApiRequestError && e.status === 400) {
        message = userFacingMessage(e, '請求無效');
      } else {
        message = userFacingMessage(e, '下單失敗');
      }
      setOrderError(message, field);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const lotsPending = lotsLoading || (availableLots === null && !lotsError);
  const quantityPlaceholder =
    side !== 'sell'
      ? '輸入張數'
      : !symbolValidForLots
        ? '請先輸入有效代號'
        : lotsError
          ? '可賣張數查詢失敗'
          : lotsPending
            ? '可賣張數載入中…'
            : `最多 ${availableLots! > 0 ? availableLots : '—'} 張`;
  const describedBy = error ? 'order-form-error' : undefined;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>股海明燈｜模擬下單</title>
        <meta name="description" content="模擬委託、檢視委託紀錄與依股票彙總損益（展示／專題用途）。" />
      </Head>
      <SiteHeader icon={ShoppingCart} title="模擬下單" subtitle="模擬交易與損益紀錄" />

      <main aria-label="模擬下單" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {!fromLogin ? (
          <p className="rounded-lg border bg-muted px-4 py-3 text-sm text-subtle">
            目前以瀏覽器匿名 ID 記錄模擬單。
            <Link href="/login?returnUrl=/order" className="ml-1 font-medium text-brand-text hover:underline">
              登入
            </Link>
            後可改以帳號 Email 跨裝置同步（選用）。
          </p>
        ) : null}

        <AnimatedSection>
          <section aria-labelledby="order-form-title">
            <div className="mb-5 flex items-center gap-2">
              <ShoppingCart size={18} className="text-brand" aria-hidden />
              <h2 id="order-form-title" className="text-lg font-bold">
                委託下單
              </h2>
            </div>

            {userId ? (
              <div className="mb-4 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                <span className="shrink-0 text-muted-foreground">{fromLogin ? '帳號識別（Email）' : '匿名使用者 ID'}</span>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="rounded-lg bg-muted px-2 py-1 font-mono text-xs break-all">{userId}</code>
                  <button
                    type="button"
                    onClick={() => void copyUserId()}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-2 py-1 text-xs text-subtle sm:min-h-9 transition-colors hover:border-border-strong hover:text-brand-text"
                  >
                    <Copy size={14} aria-hidden />
                    複製
                  </button>
                  {!fromLogin ? (
                    <button
                      type="button"
                      onClick={resetUserId}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-brand/30 sm:min-h-9 px-2 py-1 text-xs text-brand-text transition-colors hover:bg-accent"
                    >
                      <RefreshCw size={14} aria-hidden />
                      重新產生 ID
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border bg-card p-6 shadow-card">
              {error ? (
                <div id="order-form-error" role="alert" className="mb-5 rounded-lg border border-danger-border bg-danger-muted px-4 py-3 text-sm text-danger">
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label htmlFor="order-symbol" className={labelClass}>
                    股票代號
                  </label>
                  <input
                    id="order-symbol"
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="例如: 2330"
                    autoComplete="off"
                    inputMode="text"
                    maxLength={12}
                    aria-invalid={invalid('symbol')}
                    aria-describedby={describedBy}
                    className={inputClass(invalid('symbol'))}
                  />
                </div>

                <div>
                  <span id="order-side-label" className={labelClass}>
                    買賣方向
                  </span>
                  <div role="radiogroup" aria-labelledby="order-side-label" className="grid grid-cols-2 gap-3">
                    <button type="button" role="radio" aria-checked={side === 'buy'} onClick={() => setSide('buy')} className={optionClass(side === 'buy', 'border-up bg-up-muted text-up')}>
                      <ArrowUpCircle size={16} aria-hidden />
                      買進
                    </button>
                    <button type="button" role="radio" aria-checked={side === 'sell'} onClick={() => setSide('sell')} className={optionClass(side === 'sell', 'border-down bg-down-muted text-down')}>
                      <ArrowDownCircle size={16} aria-hidden />
                      賣出
                    </button>
                  </div>
                </div>

                <div className={side === 'sell' ? 'md:col-span-2' : undefined}>
                  <label htmlFor="order-trade-date" className={labelClass}>
                    模擬下單日
                    <span className="ml-1 font-normal text-muted-foreground">（選填，預設今日）</span>
                  </label>
                  <input
                    id="order-trade-date"
                    type="date"
                    value={tradeDate}
                    max={today}
                    onChange={(e) => setTradeDate(e.target.value)}
                    aria-invalid={invalid('tradeDate')}
                    aria-describedby={describedBy}
                    className={inputClass(invalid('tradeDate'))}
                  />
                </div>

                {side === 'buy' ? (
                  <div className="min-w-0">
                    <span id="order-sell-plan-label" className={labelClass}>
                      賣出時間
                      <span className="ml-1 font-normal text-muted-foreground">（買進時可記錄未來預計賣出日，僅紀錄用）</span>
                    </span>
                    <div role="radiogroup" aria-labelledby="order-sell-plan-label" className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={sellPlan === 'long_term'}
                        onClick={() => {
                          setSellPlan('long_term');
                          setPlannedSellDate('');
                        }}
                        className={optionClass(sellPlan === 'long_term', 'border-brand bg-accent text-accent-foreground')}
                      >
                        長期持有
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={sellPlan === 'by_date'}
                        onClick={() => setSellPlan('by_date')}
                        className={optionClass(sellPlan === 'by_date', 'border-brand bg-accent text-accent-foreground')}
                      >
                        指定賣出日
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className={side === 'sell' || sellPlan === 'long_term' ? 'md:col-span-2' : undefined}>
                  <label htmlFor="order-quantity" className={labelClass}>
                    委託數量（張）
                  </label>
                  <input
                    key={`order-qty-${side}`}
                    id="order-quantity"
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder={quantityPlaceholder}
                    min={1}
                    {...(side === 'sell' && symbolValidForLots && availableLots !== null && availableLots > 0 ? { max: availableLots } : {})}
                    aria-invalid={invalid('quantity') || invalid('holding')}
                    aria-describedby={describedBy}
                    className={inputClass(invalid('quantity') || invalid('holding'))}
                  />
                  {side === 'sell' && symbol.trim().length > 0 ? (
                    <p
                      className={cn(
                        'mt-1.5 text-xs',
                        lotsError ? 'text-danger' : !symbolValidForLots || (!lotsPending && (availableLots ?? 0) <= 0) ? 'text-brand-text' : 'text-muted-foreground',
                      )}
                    >
                      可賣張數（後端依委託推算）：
                      {!symbolValidForLots ? (
                        <span>請輸入有效股票代號後顯示</span>
                      ) : lotsError ? (
                        <span>查詢失敗（{lotsError}）</span>
                      ) : lotsPending ? (
                        <span className="font-mono">載入中…</span>
                      ) : (
                        <>
                          <span className="font-mono font-semibold">{availableLots}</span> 張{(availableLots ?? 0) <= 0 ? ' — 請先買進' : ''}
                        </>
                      )}
                    </p>
                  ) : null}
                </div>

                {side === 'buy' && sellPlan === 'by_date' ? (
                  <div className="min-w-0">
                    <label htmlFor="order-planned-sell" className={labelClass}>
                      預計賣出日
                    </label>
                    <input
                      id="order-planned-sell"
                      type="date"
                      value={plannedSellDate}
                      min={tradeDate.trim() || today}
                      onChange={(e) => setPlannedSellDate(e.target.value)}
                      aria-invalid={invalid('sellPlan')}
                      aria-describedby={describedBy}
                      className={inputClass(invalid('sellPlan'))}
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                <OrderEstimate symbol={normalizedSymbol} tradeDate={tradeDate} quantity={quantity} today={today} />
                <button
                  type="button"
                  disabled={submitting || !userId || (side === 'sell' && symbolValidForLots && (lotsLoading || availableLots === null || availableLots <= 0))}
                  onClick={handleSubmit}
                  className={cn(
                    'flex min-h-11 shrink-0 items-center gap-2 self-end rounded-xl px-8 py-3 font-semibold text-on-brand shadow-card transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto',
                    side === 'buy' ? 'bg-up' : 'bg-down',
                  )}
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <ShoppingCart size={18} aria-hidden />}
                  {side === 'buy' ? '確認買進' : '確認賣出'}
                </button>
              </div>
            </div>
          </section>
        </AnimatedSection>

        <ConfirmOrderDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          submitting={submitting}
          onConfirm={() => void confirmOrder()}
          symbol={normalizedSymbol}
          side={side}
          tradeDate={tradeDate.trim() || today}
          sellPlan={sellPlan}
          plannedSellDate={plannedSellDate.trim()}
          quantity={parseInt(quantity, 10)}
        />

        <AnimatedSection delay={0.1}>
          <ProfitSummaryTable summary={profit} loading={profitLoading} />
        </AnimatedSection>
        <AnimatedSection delay={0.2}>
          <OrdersTable orders={orders} loading={listLoading} today={today} />
        </AnimatedSection>
      </main>
    </div>
  );
}
