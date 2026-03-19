import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import {
  TrendingUp,
  ShoppingCart,
  ArrowUpCircle,
  ArrowDownCircle,
  ClipboardList,
  CheckCircle,
  X,
} from 'lucide-react';
import type { OrderSide, OrderType, OrderRecord } from '../lib/types';
import { ThemeToggle } from '../components/ThemeToggle';

const MOCK_PRICES: Record<string, number> = {
  '2330': 985,
  '2317': 178,
  '2454': 1680,
  '2412': 128,
  '2308': 420,
  '3711': 260,
  '2881': 67.5,
  '2882': 62.3,
  '2891': 28.9,
  '0050': 187,
};

const INITIAL_ORDERS: OrderRecord[] = [
  {
    id: 'ORD-001',
    symbol: '2330',
    side: 'buy',
    type: 'limit',
    price: 980,
    quantity: 2,
    status: 'filled',
    estimatedAmount: 1960000,
    createdAt: '2026-03-17 09:15:30',
  },
  {
    id: 'ORD-002',
    symbol: '2454',
    side: 'sell',
    type: 'market',
    price: null,
    quantity: 1,
    status: 'pending',
    estimatedAmount: 1680000,
    createdAt: '2026-03-17 10:02:15',
  },
];

export default function OrderPage() {
  const router = useRouter();

  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPrice = MOCK_PRICES[symbol] ?? null;

  const estimatedAmount = useMemo(() => {
    const qty = parseInt(quantity) || 0;
    if (qty <= 0) return 0;
    const unitPrice =
      orderType === 'market'
        ? currentPrice ?? 0
        : parseFloat(price) || 0;
    return unitPrice * qty * 1000;
  }, [orderType, price, quantity, currentPrice]);

  const validateOrder = (): string | null => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) return '請輸入股票代號';
    if (normalizedSymbol.length > 12) return '股票代號過長';
    if (!/^[0-9A-Z.]+$/.test(normalizedSymbol)) return '股票代號格式不正確';
    if (!currentPrice) return `找不到股票 ${normalizedSymbol} 的報價資料`;
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) return '請輸入有效的委託數量';
    if (orderType === 'limit') {
      const p = parseFloat(price);
      if (!p || p <= 0) return '請輸入有效的限價價格';
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

  const confirmOrder = () => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const newOrder: OrderRecord = {
      id: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: normalizedSymbol,
      side,
      type: orderType,
      price: orderType === 'limit' ? parseFloat(price) : null,
      quantity: parseInt(quantity),
      status: 'pending',
      estimatedAmount,
      createdAt: new Date().toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    };
    setOrders((prev) => [newOrder, ...prev]);
    setShowConfirm(false);
    setShowSuccess(true);
    setSymbol('');
    setPrice('');
    setQuantity('');
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20">
              <TrendingUp size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-gray-100">股海明燈</span>
          </button>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
              <ShoppingCart size={16} />
              模擬下單
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        {/* Success toast */}
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl bg-green-50 dark:bg-green-900/40 border border-green-200 dark:border-green-800 shadow-lg"
          >
            <CheckCircle size={20} className="text-green-500" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">模擬下單成功！</span>
          </motion.div>
        )}

        {/* Order Form */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <ShoppingCart size={18} className="text-[#ffa95a]" />
            <h2 className="text-lg font-bold">委託下單</h2>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">（模擬功能）</span>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Symbol */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">股票代號</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="例如: 2330"
                  autoComplete="off"
                  inputMode="text"
                  maxLength={12}
                  pattern="[0-9A-Za-z.]+"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]"
                />
                {symbol && currentPrice && (
                  <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                    目前模擬報價：<span className="font-mono font-semibold text-gray-600 dark:text-gray-300">{currentPrice.toLocaleString()}</span> 元
                  </p>
                )}
                {symbol && !currentPrice && (
                  <p className="mt-1.5 text-xs text-red-400">
                    可用代號：{Object.keys(MOCK_PRICES).join('、')}
                  </p>
                )}
              </div>

              {/* Buy/Sell */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">買賣方向</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSide('buy')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
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
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
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

              {/* Order Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">委託類型</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setOrderType('limit')}
                    className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      orderType === 'limit'
                        ? 'border-[#ffa95a] bg-[#fff9e6] dark:bg-[#ffa95a]/10 text-[#e8953a]'
                        : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    限價
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderType('market');
                      setPrice('');
                    }}
                    className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      orderType === 'market'
                        ? 'border-[#ffa95a] bg-[#fff9e6] dark:bg-[#ffa95a]/10 text-[#e8953a]'
                        : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    市價
                  </button>
                </div>
              </div>

              {/* Price (limit only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  委託價格 {orderType === 'market' && <span className="text-gray-400 dark:text-gray-500 font-normal">（市價免填）</span>}
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={orderType === 'market' ? '依市價成交' : '輸入限價'}
                  disabled={orderType === 'market'}
                  min={0}
                  step={0.01}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                             disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
                />
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">委託數量（張）</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="輸入張數"
                  min={1}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono dark:text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]"
                />
              </div>

              {/* Estimated Amount */}
              <div className="flex items-end">
                <div className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">預估金額</p>
                  <p className="text-lg font-bold font-mono text-gray-900 dark:text-gray-100">
                    {estimatedAmount > 0
                      ? `NT$ ${estimatedAmount.toLocaleString()}`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSubmit}
                className={`px-8 py-3 rounded-xl font-semibold shadow-lg transition-all flex items-center gap-2 ${
                  side === 'buy'
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                    : 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/20'
                }`}
              >
                <ShoppingCart size={18} />
                {side === 'buy' ? '確認買進' : '確認賣出'}
              </button>
            </div>
          </div>
        </motion.section>

        {/* Confirm Dialog */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl p-6 w-full max-w-sm mx-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">確認委託</h3>
                <button onClick={() => setShowConfirm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">股票代號</span>
                  <span className="font-mono font-semibold">{symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">方向</span>
                  <span className={side === 'buy' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400 font-semibold'}>
                    {side === 'buy' ? '買進' : '賣出'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">類型</span>
                  <span>{orderType === 'limit' ? '限價' : '市價'}</span>
                </div>
                {orderType === 'limit' && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 dark:text-gray-500">委託價格</span>
                    <span className="font-mono">{parseFloat(price).toLocaleString()} 元</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">數量</span>
                  <span className="font-mono">{parseInt(quantity)} 張</span>
                </div>
                <div className="border-t border-gray-100 dark:border-gray-700 pt-3 flex justify-between">
                  <span className="text-gray-400 dark:text-gray-500">預估金額</span>
                  <span className="font-bold font-mono text-[#ffa95a]">
                    NT$ {estimatedAmount.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmOrder}
                  className={`py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${
                    side === 'buy'
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-green-500 hover:bg-green-600'
                  }`}
                >
                  確認送出
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Order History */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <ClipboardList size={18} className="text-[#ffa95a]" />
            <h2 className="text-lg font-bold">委託紀錄</h2>
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">（模擬資料）</span>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">委託編號</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">股票</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">方向</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">類型</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">價格</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">數量</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500 dark:text-gray-400">預估金額</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500 dark:text-gray-400">狀態</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">時間</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-gray-400 dark:text-gray-500">
                        尚無委託紀錄
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
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
                          {o.type === 'limit' ? '限價' : '市價'}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs">
                          {o.price ? o.price.toLocaleString() : '—'}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs">{o.quantity}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">
                          {o.estimatedAmount.toLocaleString()}
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
                        <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{o.createdAt}</td>
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
