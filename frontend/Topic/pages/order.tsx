import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Copy, Loader2, RefreshCw, ShoppingCart } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Ledger, NextStep, type LightState } from '@/components/common/Ledger';
import { FoldSection } from '@/components/common/CollapsibleSection';
import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
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
/** 驗證不過時要把焦點移過去的欄位（general 沒有對應欄位） */
const FIELD_INPUT_ID: Record<ErrorField, string | null> = {
  symbol: 'order-symbol',
  quantity: 'order-quantity',
  holding: 'order-quantity',
  tradeDate: 'order-trade-date',
  sellPlan: 'order-planned-sell',
  general: null,
};

const SYMBOL_RE = /^[0-9A-Z.]+$/;
// 輸入框：2px 方角、border-input（對比 ≥ 3:1）、數字一律等寬
const inputBase =
  'h-11 w-full rounded-sm border bg-card px-3 font-mono text-base tabular-nums text-foreground outline-none transition-colors duration-(--dur-flash) placeholder:text-muted-foreground focus-lamp sm:text-sm';
const inputClass = (invalid: boolean) => cn(inputBase, invalid ? 'border-danger' : 'border-input hover:border-border-strong');
const labelClass = 'mb-1.5 block text-[13px] font-medium tracking-[0.04em] text-subtle';
/** 方角分段控制的一格：選取時換淺底，方向只用文字與底部 2px 標線表示（不整塊上色） */
const segmentClass = (active: boolean) =>
  cn(
    'relative flex min-h-11 items-center justify-center gap-2 bg-card px-3 text-sm font-medium transition-colors duration-(--dur-flash) focus-lamp',
    active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  );
/** 分段控制下緣的 2px 標線 */
function SegmentRule({ active, className }: { active: boolean; className: string }) {
  return <span aria-hidden className={cn('absolute inset-x-0 bottom-0 h-0.5', active ? className : 'bg-transparent')} />;
}

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
  /** 委託紀錄與彙總的燈質：第一次讀到之前是 Q（讀取中） */
  const [listState, setListState] = useState<LightState>('loading');
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
      setListState('loading');
      setOrderError(null);
      try {
        const [list, summary] = await Promise.all([fetchSimulatedOrders(uid, 100), fetchSimulatedProfitByCategory(uid)]);
        setOrders(list.data);
        setProfit(summary);
        setListState('ready');
        setLotsRefresh((n) => n + 1);
      } catch (e) {
        setOrderError(userFacingMessage(e, '載入資料失敗'), 'general');
        setOrders([]);
        setProfit(null);
        setListState('error');
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
      const fieldId = FIELD_INPUT_ID[result.field];
      if (fieldId) document.getElementById(fieldId)?.focus();
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
  // 必填欄位還空著：主要按鈕顯示成中性的 aria-disabled，按下仍跑原本的驗證並把焦點移到第一個缺的欄位
  const requiredMissing = !normalizedSymbol || !quantity.trim() || (side === 'buy' && sellPlan === 'by_date' && !plannedSellDate.trim());

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Head>
        <title>股海明燈｜模擬下單</title>
        <meta name="description" content="模擬委託、檢視委託紀錄與依股票彙總損益（展示／專題用途）。" />
      </Head>
      <SiteHeader icon={ShoppingCart} title="模擬下單" subtitle="模擬交易與損益紀錄" />

      <main aria-label="模擬下單" className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-10 px-4 py-6 sm:px-6 lg:gap-16 lg:px-10 lg:py-10">
        <AnimatedSection>
          <Ledger
            id="order-form"
            className="scroll-mt-20"
            aria-labelledby="order-form-title"
            title={<span id="order-form-title">委託下單</span>}
            cols="grid-cols-1 lg:grid-cols-12"
          >
            <div className="min-w-0 bg-card p-4 sm:p-5 lg:col-span-7">
              {error ? (
                <div id="order-form-error" className="mb-5">
                  <Notice tone="danger">{error}</Notice>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
                  <div role="radiogroup" aria-labelledby="order-side-label" className="grid grid-cols-2 gap-px border border-input bg-input">
                    <button type="button" role="radio" aria-checked={side === 'buy'} onClick={() => setSide('buy')} className={segmentClass(side === 'buy')}>
                      <ArrowUp size={16} className={side === 'buy' ? 'text-up' : undefined} aria-hidden />
                      買進
                      <SegmentRule active={side === 'buy'} className="bg-up" />
                    </button>
                    <button type="button" role="radio" aria-checked={side === 'sell'} onClick={() => setSide('sell')} className={segmentClass(side === 'sell')}>
                      <ArrowDown size={16} className={side === 'sell' ? 'text-down' : undefined} aria-hidden />
                      賣出
                      <SegmentRule active={side === 'sell'} className="bg-down" />
                    </button>
                  </div>
                </div>

                <div className={side === 'sell' ? 'md:col-span-2' : undefined}>
                  <label htmlFor="order-trade-date" className={labelClass}>
                    模擬下單日
                    <span className="ml-1 font-normal tracking-normal text-muted-foreground">（選填）</span>
                  </label>
                  <input
                    id="order-trade-date"
                    type="date"
                    value={tradeDate}
                    max={today}
                    onChange={(e) => setTradeDate(e.target.value)}
                    aria-invalid={invalid('tradeDate')}
                    aria-describedby={describedBy ? `order-trade-date-hint ${describedBy}` : 'order-trade-date-hint'}
                    className={inputClass(invalid('tradeDate'))}
                  />
                  <p id="order-trade-date-hint" className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    選一個有收盤資料的交易日；沒有資料的日期無法估算。留空時以今天估算。
                  </p>
                </div>

                {side === 'buy' ? (
                  <div className="min-w-0">
                    <span id="order-sell-plan-label" className={labelClass}>
                      賣出時間
                      <span className="ml-1 font-normal tracking-normal text-muted-foreground">（買進時可記錄未來預計賣出日，僅紀錄用）</span>
                    </span>
                    <div role="radiogroup" aria-labelledby="order-sell-plan-label" className="grid grid-cols-2 gap-px border border-input bg-input">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={sellPlan === 'long_term'}
                        onClick={() => {
                          setSellPlan('long_term');
                          setPlannedSellDate('');
                        }}
                        className={segmentClass(sellPlan === 'long_term')}
                      >
                        長期持有
                        <SegmentRule active={sellPlan === 'long_term'} className="bg-foreground" />
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={sellPlan === 'by_date'}
                        onClick={() => setSellPlan('by_date')}
                        className={segmentClass(sellPlan === 'by_date')}
                      >
                        指定賣出日
                        <SegmentRule active={sellPlan === 'by_date'} className="bg-foreground" />
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
                        'mt-1.5 text-xs leading-5',
                        lotsError ? 'text-danger' : !symbolValidForLots || (!lotsPending && (availableLots ?? 0) <= 0) ? 'text-warning' : 'text-muted-foreground',
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
                          <span className="font-mono font-semibold tabular-nums">{availableLots}</span> 張{(availableLots ?? 0) <= 0 ? ' — 請先買進' : ''}
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
            </div>

            <div className="flex min-w-0 flex-col gap-5 bg-card p-4 sm:p-5 lg:col-span-5">
              <OrderEstimate symbol={normalizedSymbol} tradeDate={tradeDate} quantity={quantity} today={today} />
              {/* 買進／賣出的確認鈕一律是中性的燈色主要按鈕，方向只由文字表示（DESIGN.md 第 7 節） */}
              {/* 必填欄位空著時改成中性外框（aria-disabled，不是 disabled）：仍可按，按下會指出缺的欄位 */}
              <Button
                type="button"
                size="lg"
                variant={requiredMissing ? 'outline' : 'default'}
                aria-disabled={requiredMissing || undefined}
                aria-describedby="order-submit-hint"
                disabled={submitting || !userId || (side === 'sell' && symbolValidForLots && (lotsLoading || availableLots === null || availableLots <= 0))}
                onClick={handleSubmit}
                className="mt-auto w-full aria-disabled:bg-muted aria-disabled:text-subtle"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <ShoppingCart size={18} aria-hidden />}
                {side === 'buy' ? '確認買進' : '確認賣出'}
              </Button>
              <p id="order-submit-hint" className="-mt-3 text-xs leading-5 text-muted-foreground">
                {requiredMissing ? '填好股票代號與委託張數後才能送出；按下會指出缺少的欄位。' : '按下後會先顯示確認視窗，確認後才送出。'}
              </p>
            </div>

            {/* 記錄方式：識別用的 ID／Email 是技術細節，收在表單之後、預設收合 */}
            <FoldSection
              className="lg:col-span-12"
              title="記錄方式"
              summary={fromLogin ? '以帳號 Email 記錄，換裝置也是同一份委託與損益' : '以這個瀏覽器的匿名 ID 記錄；登入後可改用帳號 Email（選用）'}
              contentClassName="px-4 py-3 sm:px-5"
            >
              {userId ? (
                <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <span className="shrink-0 text-[13px] tracking-[0.04em] text-muted-foreground">{fromLogin ? '帳號識別（Email）' : '匿名使用者 ID'}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                    <code className="min-w-0 font-mono text-[13px] break-all tabular-nums text-foreground">{userId}</code>
                    <span className="-ml-3 flex sm:ml-auto">
                      <Button type="button" variant="ghost" onClick={() => void copyUserId()} className="text-subtle">
                        <Copy aria-hidden />
                        複製
                      </Button>
                      {!fromLogin ? (
                        <Button type="button" variant="ghost" onClick={resetUserId} className="text-subtle">
                          <RefreshCw aria-hidden />
                          重新產生 ID
                        </Button>
                      ) : null}
                    </span>
                  </div>
                </div>
              ) : null}
              {!fromLogin ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] leading-relaxed text-muted-foreground">
                  <span>匿名 ID 存在這個瀏覽器；清除瀏覽資料或換裝置後是另一份紀錄。</span>
                  <Link
                    href="/login?returnUrl=/order"
                    className="inline-flex min-h-11 items-center font-medium text-foreground underline decoration-input underline-offset-4 transition-colors duration-(--dur-flash) hover:decoration-foreground"
                  >
                    登入後改用帳號 Email
                  </Link>
                </p>
              ) : null}
            </FoldSection>
          </Ledger>
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
          <ProfitSummaryTable summary={profit} loading={profitLoading} state={listState} />
        </AnimatedSection>
        <AnimatedSection delay={0.2}>
          <OrdersTable orders={orders} loading={listLoading} today={today} state={listState} />
          {/* 頁尾的下一步：一行字加一個真的連結 */}
          <div className="mt-6 border">
            <NextStep href="/#terminal">
              <span className="font-normal text-muted-foreground">下一筆想買什麼？</span>回觀測台看行情
            </NextStep>
          </div>
        </AnimatedSection>
      </main>
    </div>
  );
}
