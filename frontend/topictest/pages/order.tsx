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
} from '../lib/api/simulatedOrder';
import {
  getOrCreateSimulatedSessionId,
  resetSimulatedSessionId,
  getLocalDateString,
} from '../lib/utils/session';

function formatCreatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatPriceCell(price: SimulatedOrderResponse['price']): string {
  if (price === null || price === undefined || price === '') return '—';
  const n = typeof price === 'string' ? parseFloat(price) : price;
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

export default function OrderPage() {
  const [sessionId, setSessionId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [tradeDate, setTradeDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [orders, setOrders] = useState<SimulatedOrderResponse[]>([]);
  const [profitSummary, setProfitSummary] = useState<SimulatedOrderCategoryProfitResponse | null>(null);

  const [listLoading, setListLoading] = useState(false);
  const [profitLoading, setProfitLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldInvalid = useMemo(() => {
    if (!error) {
      return { symbol: false, quantity: false, tradeDate: false };
    }
    return {
      symbol: error.includes('代號') || error.includes('股票') || error.includes('無日線'),
      quantity: error.includes('張數'),
      tradeDate: error.includes('下單日'),
    };
  }, [error]);

  const todayStr = getLocalDateString();

  useEffect(() => {
    setSessionId(getOrCreateSimulatedSessionId());
  }, []);

  const loadOrdersAndProfit = useCallback(async (sid: string) => {
    if (!sid) return;
    setListLoading(true);
    setProfitLoading(true);
    setError(null);
    try {
      const [listRes, profitRes] = await Promise.all([
        fetchSimulatedOrders(sid, 100),
        fetchSimulatedProfitByCategory(sid),
      ]);
      setOrders(listRes.data);
      setProfitSummary(profitRes);
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
    if (sessionId) void loadOrdersAndProfit(sessionId);
  }, [sessionId, loadOrdersAndProfit]);

  const handleCopySession = async () => {
    if (!sessionId || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      toast.success('已複製會話 ID');
    } catch {
      toast.error('無法複製會話 ID');
    }
  };

  const handleResetSession = () => {
    const next = resetSimulatedSessionId();
    setSessionId(next);
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
    if (!sessionId) return;
    const normalizedSymbol = symbol.trim().toUpperCase();
    const qty = parseInt(quantity, 10);
    const body: SimulatedOrderCreate = {
      session_id: sessionId,
      symbol: normalizedSymbol,
      side,
      order_type: 'market',
      quantity: qty,
    };
    const td = tradeDate.trim();
    if (td) body.trade_date = td;

    setSubmitting(true);
    setError(null);
    try {
      await createSimulatedOrder(body);
      setShowConfirm(false);
      setSymbol('');
      setQuantity('');
      setTradeDate('');
      toast.success('模擬下單成功');
      await loadOrdersAndProfit(sessionId);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) {
        const msg = '該股票在指定日期無日線收盤資料，請換日期或代號再試';
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

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Head>
        <title>股海明燈｜模擬下單</title>
        <meta
          name="description"
          content="模擬市價委託、檢視委託紀錄與依股票彙總損益（展示／專題用途）。"
        />
      </Head>
      <SubpageHeader
        icon={ShoppingCart}
        title="模擬下單"
        subtitle="模擬交易與損益紀錄"
      />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <ShoppingCart size={18} className="text-[#ffa95a]" />
            <h2 className="text-lg font-bold">委託下單</h2>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">（市價模擬，連線後端）</span>
          </div>

          {sessionId && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-sm">
              <span className="text-gray-500 dark:text-gray-400 shrink-0">會話 ID</span>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <code className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700/80 font-mono text-xs break-all">
                  {sessionId}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopySession()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors cursor-pointer"
                >
                  <Copy size={14} />
                  複製
                </button>
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors cursor-pointer"
                >
                  <RefreshCw size={14} />
                  重新產生會話
                </button>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            {error && (
              <div
                id="order-form-error"
                role="alert"
                className="mb-5 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400"
              >
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="order-symbol" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
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
                  className={`w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-gray-700 text-sm font-mono dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                             ${
                               fieldInvalid.symbol
                                 ? 'border-red-400 dark:border-red-500'
                                 : 'border-gray-200 dark:border-gray-600'
                             }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">買賣方向</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-semibold transition-all cursor-pointer ${
                      side === 'buy'
                        ? 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                        : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
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
                        ? 'border-green-400 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <ArrowDownCircle size={16} />
                    賣出
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">委託類型</label>
                <div className="px-4 py-2.5 rounded-lg border border-[#ffa95a]/40 bg-[#fff9e6] dark:bg-[#ffa95a]/10 text-sm text-[#b97a3a] dark:text-[#ffa95a]">
                  市價（後端目前僅支援 market）
                </div>
              </div>

              <div>
                <label htmlFor="order-trade-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  模擬下單日
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">（選填，預設今日）</span>
                </label>
                <input
                  id="order-trade-date"
                  type="date"
                  value={tradeDate}
                  max={todayStr}
                  onChange={(e) => setTradeDate(e.target.value)}
                  aria-invalid={fieldInvalid.tradeDate}
                  aria-describedby={error ? 'order-form-error' : undefined}
                  className={`w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-gray-700 text-sm font-mono dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                             ${
                               fieldInvalid.tradeDate
                                 ? 'border-red-400 dark:border-red-500'
                                 : 'border-gray-200 dark:border-gray-600'
                             }`}
                />
              </div>

              <div>
                <label htmlFor="order-quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  委託數量（張）
                </label>
                <input
                  id="order-quantity"
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="輸入張數"
                  min={1}
                  aria-invalid={fieldInvalid.quantity}
                  aria-describedby={error ? 'order-form-error' : undefined}
                  className={`w-full px-4 py-2.5 rounded-lg border bg-white dark:bg-gray-700 text-sm font-mono dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                             ${
                               fieldInvalid.quantity
                                 ? 'border-red-400 dark:border-red-500'
                                 : 'border-gray-200 dark:border-gray-600'
                             }`}
                />
              </div>

              <div className="flex items-end">
                <div className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">預估金額</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    送出後依該日<strong className="font-medium">日線收盤價</strong>× 張數 × 1000 計算
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                disabled={submitting || !sessionId}
                onClick={handleSubmit}
                className={`px-8 py-3 rounded-xl font-semibold shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  side === 'buy'
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                    : 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/20'
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
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl p-6 w-full max-w-sm mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">確認委託</h3>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">股票代號</span>
                  <span className="font-mono font-semibold">{symbol.trim().toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">方向</span>
                  <span
                    className={
                      side === 'buy'
                        ? 'text-red-600 dark:text-red-400 font-semibold'
                        : 'text-green-600 dark:text-green-400 font-semibold'
                    }
                  >
                    {side === 'buy' ? '買進' : '賣出'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">類型</span>
                  <span>市價</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">模擬下單日</span>
                  <span className="font-mono">{tradeDate.trim() || todayStr}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">數量</span>
                  <span className="font-mono">{parseInt(quantity, 10)} 張</span>
                </div>
                <div className="border-t border-gray-100 dark:border-gray-700 pt-3 text-xs text-gray-500 dark:text-gray-400">
                  預估金額將於送出後由後端依收盤價計算
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={submitting}
                  className="py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void confirmOrder()}
                  disabled={submitting}
                  className={`py-2.5 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                    side === 'buy' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
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
            <PieChart size={18} className="text-[#ffa95a]" />
            <h2 className="text-lg font-bold">依股票彙總（模擬收益）</h2>
            {profitLoading && <Loader2 size={16} className="animate-spin text-gray-400" />}
          </div>

          {profitSummary && (
            <div className="mb-4 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300">
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

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden mb-8">
            <p className="px-5 pt-3 pb-0 text-[11px] text-gray-400 dark:text-gray-500 sm:hidden">← 左右滑動查看完整表格 →</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">股票</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">筆數</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">成本（元）</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">市值（元）</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">損益（元）</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">收益率</th>
                  </tr>
                </thead>
                <tbody>
                  {profitLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400 dark:text-gray-500">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          載入中…
                        </span>
                      </td>
                    </tr>
                  ) : profitRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400 dark:text-gray-500">
                        尚無彙總資料
                      </td>
                    </tr>
                  ) : (
                    profitRows.map((row) => (
                      <tr
                        key={row.category}
                        className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
                      >
                        <td className="px-5 py-3 font-mono font-semibold">{row.category}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{row.order_count}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{row.cost_amount.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{row.market_amount.toLocaleString()}</td>
                        <td
                          className={`px-5 py-3 text-right font-mono text-xs font-medium ${
                            row.profit_amount >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
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
            <ClipboardList size={18} className="text-[#ffa95a]" />
            <h2 className="text-lg font-bold">委託紀錄</h2>
            {listLoading && <Loader2 size={16} className="animate-spin text-gray-400" />}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <p className="px-5 pt-3 pb-0 text-[11px] text-gray-400 dark:text-gray-500 sm:hidden">← 左右滑動查看完整表格 →</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">委託編號</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">股票</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">方向</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">類型</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">價格</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">下單日</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">數量</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">預估金額</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500 dark:text-gray-400">狀態</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">時間</th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading ? (
                    <tr>
                      <td colSpan={10} className="text-center py-12 text-gray-400 dark:text-gray-500">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={18} className="animate-spin" />
                          載入中…
                        </span>
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-12 text-gray-400 dark:text-gray-500">
                        尚無委託紀錄
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
                      >
                        <td className="px-5 py-3 font-mono text-xs text-gray-400 dark:text-gray-500">{o.id}</td>
                        <td className="px-5 py-3 font-mono font-semibold">{o.symbol}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              o.side === 'buy' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                            }`}
                          >
                            {o.side === 'buy' ? <ArrowUpCircle size={12} /> : <ArrowDownCircle size={12} />}
                            {o.side === 'buy' ? '買' : '賣'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {o.order_type === 'limit' ? '限價' : '市價'}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{formatPriceCell(o.price)}</td>
                        <td className="px-5 py-3 font-mono text-xs whitespace-nowrap">{o.trade_date}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{o.quantity}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">
                          {o.estimated_amount.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                              o.status === 'filled'
                                ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                : o.status === 'cancelled'
                                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                                  : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {o.status === 'filled' ? '已成交' : o.status === 'cancelled' ? '已取消' : '委託中'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {formatCreatedAt(o.created_at)}
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
