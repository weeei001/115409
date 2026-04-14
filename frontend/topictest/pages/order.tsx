import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  ShoppingCart,
  ArrowUpCircle,
  ArrowDownCircle,
  ClipboardList,
  X,
  Copy,
  RefreshCw,
  PieChart,
  Loader2,
} from 'lucide-react';
import type {
  OrderSide,
  SimulatedSellPlan,
  SimulatedOrderCreate,
  SimulatedOrderResponse,
  SimulatedOrderCategoryProfitResponse,
} from '../lib/types';
import { ApiRequestError } from '../lib/api/client';
import { SubpageHeader } from '../components/SubpageHeader';
import {
  createSimulatedOrder,
  fetchSimulatedOrders,
  fetchSimulatedProfitByCategory,
  fetchAvailableLots,
} from '../lib/api/simulatedOrder';
import {
  getOrCreateSimulatedUserId,
  resetSimulatedUserId,
  getLocalDateString,
} from '../lib/utils/session';
import { getToken, getStoredUser, AUTH_CHANGE_EVENT } from '../lib/auth/storage';

function formatSellPlanCell(o: SimulatedOrderResponse): string {
  if (o.side === 'sell' || o.sell_plan == null) return '—';
  if (o.sell_plan === 'long_term') return '長期持有';
  return o.planned_sell_date ?? '—';
}

function formatMarkupBasis(basis: SimulatedOrderResponse['markup_basis']): string {
  if (basis === 'latest') return '最新收盤';
  if (basis === 'planned_sell') return '預計賣出日';
  if (basis === 'fifo_realized') return '實現損益';
  return '—';
}

function formatReferenceCell(o: SimulatedOrderResponse): React.ReactNode {
  if (!o.reference_date && o.reference_close == null) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  return (
    <div className="text-right space-y-0.5">
      {o.reference_date && (
        <div className="font-mono text-xs whitespace-nowrap text-[var(--color-text-secondary)]">{o.reference_date}</div>
      )}
      {o.reference_close != null && (
        <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
          {o.reference_close.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      )}
    </div>
  );
}

export default function OrderPage() {
  const [userId, setUserId] = useState('');
  /** 已登入時以帳號 email 作為 user_id，不顯示／不重置匿名 UUID */
  const [identityFromLogin, setIdentityFromLogin] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [tradeDate, setTradeDate] = useState('');
  const [sellPlan, setSellPlan] = useState<SimulatedSellPlan>('long_term');
  const [plannedSellDate, setPlannedSellDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [orders, setOrders] = useState<SimulatedOrderResponse[]>([]);
  const [profitSummary, setProfitSummary] = useState<SimulatedOrderCategoryProfitResponse | null>(null);

  const [listLoading, setListLoading] = useState(false);
  const [profitLoading, setProfitLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availableLots, setAvailableLots] = useState<number | null>(null);
  const [availableLotsLoading, setAvailableLotsLoading] = useState(false);
  const [lotsRefresh, setLotsRefresh] = useState(0);

  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldInvalid = useMemo(() => {
    if (!error) {
      return { symbol: false, quantity: false, tradeDate: false, sellPlan: false, holding: false };
    }
    return {
      symbol: error.includes('代號') || error.includes('股票') || error.includes('無日線'),
      quantity: error.includes('張數'),
      tradeDate: error.includes('下單日'),
      sellPlan: error.includes('預計賣出') || error.includes('長期持有時'),
      holding: error.includes('持有') || error.includes('可賣') || error.includes('載入'),
    };
  }, [error]);

  const todayStr = getLocalDateString();

  useEffect(() => {
    const resolveSimulatedIdentity = () => {
      if (typeof window === 'undefined') return;
      const token = getToken();
      const user = getStoredUser();
      const email = user?.email?.trim().toLowerCase();
      if (token && email) {
        setUserId(email);
        setIdentityFromLogin(true);
      } else {
        setUserId(getOrCreateSimulatedUserId());
        setIdentityFromLogin(false);
      }
    };
    resolveSimulatedIdentity();
    window.addEventListener(AUTH_CHANGE_EVENT, resolveSimulatedIdentity);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, resolveSimulatedIdentity);
  }, []);

  const loadOrdersAndProfit = useCallback(async (uid: string) => {
    if (!uid) return;
    setListLoading(true);
    setProfitLoading(true);
    setError(null);
    try {
      const [listRes, profitRes] = await Promise.all([
        fetchSimulatedOrders(uid, 100),
        fetchSimulatedProfitByCategory(uid),
      ]);
      setOrders(listRes.data);
      setProfitSummary(profitRes);
      setLotsRefresh((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入資料失敗');
      setOrders([]);
      setProfitSummary(null);
    } finally {
      setListLoading(false);
      setProfitLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) void loadOrdersAndProfit(userId);
  }, [userId, loadOrdersAndProfit]);

  useEffect(() => {
    if (side !== 'sell' || !userId) {
      setAvailableLots(null);
      setAvailableLotsLoading(false);
      return;
    }
    const sym = symbol.trim().toUpperCase();
    if (!sym || !/^[0-9A-Z.]+$/.test(sym)) {
      setAvailableLots(null);
      setAvailableLotsLoading(false);
      return;
    }
    let cancelled = false;
    setAvailableLotsLoading(true);
    void fetchAvailableLots(userId, sym)
      .then((res) => {
        if (!cancelled) setAvailableLots(res.available_lots);
      })
      .catch(() => {
        if (!cancelled) setAvailableLots(0);
      })
      .finally(() => {
        if (!cancelled) setAvailableLotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, symbol, side, lotsRefresh]);

  const handleCopyUserId = async () => {
    if (!userId || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(userId);
      toast.success(identityFromLogin ? '已複製帳號 Email' : '已複製使用者 ID');
    } catch {
      toast.error(identityFromLogin ? '無法複製 Email' : '無法複製使用者 ID');
    }
  };

  const handleResetUserId = () => {
    if (identityFromLogin) {
      toast.info('已登入時以帳號 Email 識別模擬資料，無法重新產生匿名 ID');
      return;
    }
    const next = resetSimulatedUserId();
    setUserId(next);
    setOrders([]);
    setProfitSummary(null);
  };

  const validateOrder = (): string | null => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) return '請輸入股票代號';
    if (normalizedSymbol.length > 12) return '股票代號過長';
    if (!/^[0-9A-Z.]+$/.test(normalizedSymbol)) return '股票代號格式不正確';
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return '請輸入有效的委託張數';
    if (tradeDate) {
      if (tradeDate > todayStr) return '模擬下單日不可晚於今天';
    }
    if (side === 'sell') {
      if (availableLotsLoading || availableLots === null) return '可賣張數載入中，請稍候再試';
      if (availableLots <= 0) return '尚未持有此股票，無法賣出（請先以買進建立持股）';
      if (qty > availableLots) return `賣出張數不可超過持有 ${availableLots} 張`;
      return null;
    }
    const effectiveTrade = tradeDate.trim() || todayStr;
    if (sellPlan === 'by_date') {
      const psd = plannedSellDate.trim();
      if (!psd) return '請選擇預計賣出日';
      if (psd < effectiveTrade) return '預計賣出日不可早於模擬下單日';
    }
    return null;
  };

  const handleSubmit = () => {
    const msg = validateOrder();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setShowConfirm(true);
  };

  const confirmOrder = async () => {
    if (!userId) return;
    const normalizedSymbol = symbol.trim().toUpperCase();
    const qty = parseInt(quantity, 10);
    const body: SimulatedOrderCreate = {
      user_id: userId,
      symbol: normalizedSymbol,
      side,
      quantity: qty,
    };
    const td = tradeDate.trim();
    if (td) body.trade_date = td;
    if (side === 'buy') {
      body.sell_plan = sellPlan;
      if (sellPlan === 'by_date') body.planned_sell_date = plannedSellDate.trim();
    }

    setSubmitting(true);
    setError(null);
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
      if (e instanceof ApiRequestError && e.status === 404) {
        const msg = '該股票在指定日期無日線收盤資料，請換日期或代號再試';
        setError(msg);
        toast.error(msg);
      } else if (e instanceof ApiRequestError && e.status === 400) {
        const msg = e.message || '請求無效';
        setError(msg);
        toast.error(msg);
      } else {
        const msg = e instanceof Error ? e.message : '下單失敗';
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!showConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) setShowConfirm(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showConfirm, submitting]);

  const profitRows = profitSummary?.data ?? [];

  const symbolTrimmed = symbol.trim();
  const symbolValidForLots =
    symbolTrimmed.length > 0 && /^[0-9A-Z.]+$/.test(symbolTrimmed);

  return (
    <div className="min-h-screen flex flex-col text-[var(--color-text-primary)]">
      <Head>
        <title>股海明燈｜模擬下單</title>
        <meta
          name="description"
          content="模擬委託、檢視委託紀錄與依股票彙總損益（展示／專題用途）。"
        />
      </Head>
      <SubpageHeader
        icon={ShoppingCart}
        title="模擬下單"
        subtitle="模擬交易與損益紀錄"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <ShoppingCart size={18} className="text-brand" />
            <h2 className="text-lg font-bold">委託下單</h2>
            <span className="text-xs text-[var(--color-text-muted)] ml-1">（連線後端）</span>
          </div>

          {userId && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-sm">
              <span className="text-[var(--color-text-muted)] shrink-0">
                {identityFromLogin ? '帳號識別（Email）' : '匿名使用者 ID'}
              </span>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <code className="px-2 py-1 rounded-lg bg-[var(--color-bg-elevated)]/80 font-mono text-xs break-all">
                  {userId}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyUserId()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:border-brand/40 hover:text-brand transition-colors cursor-pointer"
                >
                  <Copy size={14} />
                  複製
                </button>
                {!identityFromLogin && (
                  <button
                    type="button"
                    onClick={handleResetUserId}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-brand/30 dark:border-brand/25 text-xs text-brand-deep dark:text-brand-light hover:bg-brand/5 dark:hover:bg-brand/10 transition-colors cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    重新產生 ID
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm p-6">
            {error && (
              <div
                id="order-form-error"
                role="alert"
                className="mb-5 px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up"
              >
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="order-symbol" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
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
                  aria-invalid={fieldInvalid.symbol}
                  aria-describedby={error ? 'order-form-error' : undefined}
                  className={`w-full px-4 py-2.5 rounded-lg border bg-[var(--color-bg-elevated)] text-sm font-mono text-[var(--color-text-primary)]
                             focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                             ${
                               fieldInvalid.symbol
                                 ? 'border-up'
                                 : 'border-[var(--color-border)]'
                             }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">買賣方向</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-semibold transition-all cursor-pointer ${
                      side === 'buy'
                        ? 'border-up bg-up-muted text-up'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                    }`}
                  >
                    <ArrowUpCircle size={16} />
                    買進
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide('sell')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-semibold transition-all cursor-pointer ${
                      side === 'sell'
                        ? 'border-down bg-down-muted text-down'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                    }`}
                  >
                    <ArrowDownCircle size={16} />
                    賣出
                  </button>
                </div>
              </div>

              <div className={side === 'sell' ? 'md:col-span-2' : undefined}>
                <label htmlFor="order-trade-date" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  模擬下單日
                  <span className="text-[var(--color-text-muted)] font-normal ml-1">（選填，預設今日）</span>
                </label>
                <input
                  id="order-trade-date"
                  type="date"
                  value={tradeDate}
                  max={todayStr}
                  onChange={(e) => setTradeDate(e.target.value)}
                  aria-invalid={fieldInvalid.tradeDate}
                  aria-describedby={error ? 'order-form-error' : undefined}
                  className={`w-full px-4 py-2.5 rounded-lg border bg-[var(--color-bg-elevated)] text-sm font-mono text-[var(--color-text-primary)]
                             focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                             ${
                               fieldInvalid.tradeDate
                                 ? 'border-up'
                                 : 'border-[var(--color-border)]'
                             }`}
                />
              </div>

              {side === 'buy' && (
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                    賣出時間
                    <span className="text-[var(--color-text-muted)] font-normal ml-1">
                      （買進時可記錄未來預計賣出日，僅紀錄用）
                    </span>
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSellPlan('long_term');
                        setPlannedSellDate('');
                      }}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                        sellPlan === 'long_term'
                          ? 'border-brand bg-brand/5 dark:bg-brand/15 text-brand-deep dark:text-brand'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                      }`}
                    >
                      長期持有
                    </button>
                    <button
                      type="button"
                      onClick={() => setSellPlan('by_date')}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                        sellPlan === 'by_date'
                          ? 'border-brand bg-brand/5 dark:bg-brand/15 text-brand-deep dark:text-brand'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                      }`}
                    >
                      指定賣出日
                    </button>
                  </div>
                </div>
              )}

              <div
                className={
                  side === 'sell' || (side === 'buy' && sellPlan === 'long_term') ? 'md:col-span-2' : undefined
                }
              >
                <label htmlFor="order-quantity" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  委託數量（張）
                </label>
                <input
                  key={`order-qty-${side}`}
                  id="order-quantity"
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder={
                    side === 'sell'
                      ? !symbolValidForLots
                        ? '請先輸入有效代號'
                        : availableLotsLoading || availableLots === null
                          ? '可賣張數載入中…'
                          : `最多 ${availableLots > 0 ? availableLots : '—'} 張`
                      : '輸入張數'
                  }
                  min={1}
                  {...(side === 'sell' && symbolValidForLots && availableLots !== null && availableLots > 0
                    ? { max: availableLots }
                    : {})}
                  aria-invalid={fieldInvalid.quantity || fieldInvalid.holding}
                  aria-describedby={error ? 'order-form-error' : undefined}
                  className={`w-full px-4 py-2.5 rounded-lg border bg-[var(--color-bg-elevated)] text-sm font-mono text-[var(--color-text-primary)]
                             focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                             ${
                               fieldInvalid.quantity || fieldInvalid.holding
                                 ? 'border-up'
                                 : 'border-[var(--color-border)]'
                             }`}
                />
                {side === 'sell' && symbolTrimmed.length > 0 && (
                  <p
                    className={`mt-1.5 text-xs ${
                      !symbolValidForLots
                        ? 'text-brand-deep dark:text-brand-light'
                        : availableLotsLoading || availableLots === null
                          ? 'text-[var(--color-text-muted)]'
                          : availableLots <= 0
                            ? 'text-brand-deep dark:text-brand-light'
                            : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    可賣張數（後端依委託推算）：
                    {!symbolValidForLots ? (
                      <span>請輸入有效股票代號後顯示</span>
                    ) : availableLotsLoading || availableLots === null ? (
                      <span className="font-mono">載入中…</span>
                    ) : (
                      <>
                        <span className="font-mono font-semibold">{availableLots}</span> 張
                        {availableLots <= 0 ? ' — 請先買進' : ''}
                      </>
                    )}
                  </p>
                )}
              </div>

              {side === 'buy' && sellPlan === 'by_date' && (
                <div className="min-w-0">
                  <label htmlFor="order-planned-sell" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                    預計賣出日
                  </label>
                  <input
                    id="order-planned-sell"
                    type="date"
                    value={plannedSellDate}
                    min={tradeDate.trim() || todayStr}
                    onChange={(e) => setPlannedSellDate(e.target.value)}
                    aria-invalid={fieldInvalid.sellPlan}
                    aria-describedby={error ? 'order-form-error' : undefined}
                    className={`w-full px-4 py-2.5 rounded-lg border bg-[var(--color-bg-elevated)] text-sm font-mono text-[var(--color-text-primary)]
                               focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                               ${
                                 fieldInvalid.sellPlan
                                   ? 'border-up'
                                   : 'border-[var(--color-border)]'
                               }`}
                  />
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className="min-w-0 flex-1 px-4 py-2.5 rounded-lg bg-[var(--color-bg-elevated)]/50 border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)] mb-0.5">預估金額與試算</p>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed max-sm:whitespace-normal sm:whitespace-nowrap">
                  金額依<strong className="font-medium">成交日收盤</strong>試算；列表中的試算損益由後端標示依據（最新收盤、預計賣出日或賣出實現）。
                </p>
              </div>
              <button
                type="button"
                disabled={
                  submitting ||
                  !userId ||
                  (side === 'sell' &&
                    symbolValidForLots &&
                    (availableLotsLoading || availableLots === null || availableLots <= 0))
                }
                onClick={handleSubmit}
                className={`shrink-0 self-end sm:self-auto px-8 py-3 rounded-xl font-semibold shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  side === 'buy'
                    ? 'bg-up hover:bg-up/90 text-white shadow-up/20'
                    : 'bg-down hover:bg-down/90 text-white shadow-down/20'
                }`}
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <ShoppingCart size={18} />}
                {side === 'buy' ? '確認買進' : '確認賣出'}
              </button>
            </div>
          </div>
        </motion.section>

        {showConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
            onClick={() => { if (!submitting) setShowConfirm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-2xl p-6 w-full max-w-sm mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">確認委託</h3>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">股票代號</span>
                  <span className="font-mono font-semibold">{symbol.trim().toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">方向</span>
                  <span
                    className={
                      side === 'buy'
                        ? 'text-up font-semibold'
                        : 'text-down font-semibold'
                    }
                  >
                    {side === 'buy' ? '買進' : '賣出'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">模擬下單日</span>
                  <span className="font-mono">{tradeDate.trim() || todayStr}</span>
                </div>
                {side === 'buy' && (
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-muted)] shrink-0">賣出時間</span>
                    <span className="text-right font-medium">
                      {sellPlan === 'long_term' ? '長期持有' : plannedSellDate.trim() || '—'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">數量</span>
                  <span className="font-mono">{parseInt(quantity, 10)} 張</span>
                </div>
                <div className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)] leading-relaxed">
                  送出後由後端依收盤計算金額；委託列表會顯示試算依據與參考行情。
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={submitting}
                  className="py-2.5 rounded-xl border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)] transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void confirmOrder()}
                  disabled={submitting}
                  className={`py-2.5 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                    side === 'buy' ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90'
                  }`}
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  確認送出
                </button>
              </div>
            </motion.div>
          </div>
        )}

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <PieChart size={18} className="text-brand" />
            <h2 className="text-lg font-bold">依股票彙總（模擬收益）</h2>
            {profitLoading && <Loader2 size={16} className="animate-spin text-[var(--color-text-muted)]" />}
          </div>

          {profitSummary && (
            <div className="mb-4 flex flex-wrap gap-4 text-sm text-[var(--color-text-secondary)]">
              <span>
                總委託 <strong className="font-mono">{profitSummary.total_orders}</strong> 筆
              </span>
              <span>
                可估值 <strong className="font-mono">{profitSummary.priced_orders}</strong> 筆
              </span>
              <span>
                無行情 <strong className="font-mono">{profitSummary.unpriced_orders}</strong> 筆
              </span>
            </div>
          )}

          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden mb-8">
            <p className="px-5 pt-3 pb-0 text-[11px] text-[var(--color-text-muted)] sm:hidden">← 左右滑動查看完整表格 →</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-bg-elevated)]/80 border-b border-[var(--color-border)]">
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)]">股票</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">筆數</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">成本（元）</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">市值（元）</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">損益（元）</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">收益率</th>
                  </tr>
                </thead>
                <tbody>
                  {profitLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          載入中…
                        </span>
                      </td>
                    </tr>
                  ) : profitRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">
                        尚無彙總資料
                      </td>
                    </tr>
                  ) : (
                    profitRows.map((row) => (
                      <tr
                        key={row.category}
                        className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 transition-colors"
                      >
                        <td className="px-5 py-3 font-mono font-semibold">{row.category}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{row.order_count}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{row.cost_amount.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{row.market_amount.toLocaleString()}</td>
                        <td
                          className={`px-5 py-3 text-right font-mono text-xs font-medium ${
                            row.profit_amount >= 0 ? 'text-up' : 'text-down'
                          }`}
                        >
                          {row.profit_amount >= 0 ? '+' : ''}
                          {row.profit_amount.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs">
                          {row.profit_rate.toFixed(2)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <ClipboardList size={18} className="text-brand" />
            <h2 className="text-lg font-bold">委託紀錄</h2>
            {listLoading && <Loader2 size={16} className="animate-spin text-[var(--color-text-muted)]" />}
          </div>

          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
            <p className="px-5 pt-3 pb-0 text-[11px] text-[var(--color-text-muted)] sm:hidden">← 左右滑動查看完整表格 →</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-bg-elevated)]/80 border-b border-[var(--color-border)]">
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)]">委託編號</th>
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)]">股票</th>
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)]">方向</th>
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)]">下單日</th>
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)]">賣出時間</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">數量</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">預估金額</th>
                    <th className="text-left px-5 py-3 font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                      試算依據
                    </th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                      參考行情
                    </th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">試算損益</th>
                    <th className="text-right px-5 py-3 font-medium text-[var(--color-text-muted)]">收益率</th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading ? (
                    <tr>
                      <td colSpan={11} className="text-center py-12 text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          載入中…
                        </span>
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-12 text-[var(--color-text-muted)]">
                        尚無委託紀錄
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 transition-colors"
                      >
                        <td className="px-5 py-3 font-mono text-xs text-[var(--color-text-muted)]">{o.id}</td>
                        <td className="px-5 py-3 font-mono font-semibold">{o.symbol}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              o.side === 'buy' ? 'text-up' : 'text-down'
                            }`}
                          >
                            {o.side === 'buy' ? <ArrowUpCircle size={12} /> : <ArrowDownCircle size={12} />}
                            {o.side === 'buy' ? '買' : '賣'}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs whitespace-nowrap">{o.trade_date}</td>
                        <td className="px-5 py-3 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                          {formatSellPlanCell(o)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{o.quantity}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">
                          {o.estimated_amount.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--color-text-secondary)] align-top">
                          {o.markup_basis ? (
                            <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 font-medium">
                              {formatMarkupBasis(o.markup_basis)}
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 align-top">{formatReferenceCell(o)}</td>
                        <td className="px-5 py-3 text-right">
                          {o.markup_amount != null ? (
                            <span
                              className={`font-mono text-xs font-medium ${
                                o.markup_amount >= 0 ? 'text-up' : 'text-down'
                              }`}
                            >
                              {o.markup_amount >= 0 ? '+' : ''}
                              {o.markup_amount.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {o.sell_plan === 'by_date' && o.planned_sell_date && o.planned_sell_date > todayStr
                                ? '預計賣出日未到'
                                : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs">
                          {o.markup_rate != null ? (
                            <span
                              className={
                                o.markup_rate >= 0 ? 'text-up' : 'text-down'
                              }
                            >
                              {o.markup_rate >= 0 ? '+' : ''}
                              {o.markup_rate.toFixed(2)}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
