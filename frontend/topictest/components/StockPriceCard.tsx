import React, { useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DailyPriceResponse } from '../lib/types';
import { AnimatedCounter } from './AnimatedCounter';

interface Props {
  data: DailyPriceResponse;
  onNavigate?: (symbol: string) => void;
  index?: number;
}

const STOCK_NAMES: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2408': '南亞科',
  '2454': '聯發科',
  '2615': '萬海',
  '2881': '富邦金',
  '2882': '國泰金',
  '2303': '聯電',
  '2308': '台達電',
  '3711': '日月光投控',
  '2412': '中華電',
  '2886': '兆豐金',
};

export const StockPriceCard = React.memo<Props>(function StockPriceCard({ data, onNavigate, index = 0 }) {
  const cardRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    onNavigate?.(data.symbol);
  }, [onNavigate, data.symbol]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -10;
    el.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg) scale3d(1.03,1.03,1.03)`;
  }, []);

  const handleMouseLeave = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = 'perspective(600px) rotateY(0deg) rotateX(0deg) scale3d(1,1,1)';
    el.style.boxShadow = '';
  }, []);

  const close = Number(data.close ?? 0);
  const change = Number(data.change ?? 0);
  const prevClose = close - change;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const isUp = change > 0;
  const isDown = change < 0;

  const colorClass = isUp ? 'text-up' : isDown ? 'text-down' : 'text-[var(--color-text-muted)]';
  const badgeBg = isUp
    ? 'bg-up-muted text-up'
    : isDown
      ? 'bg-down-muted text-down'
      : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]';

  const glowColor = isUp
    ? 'rgba(208, 101, 101, 0.18)'
    : isDown
      ? 'rgba(100, 154, 126, 0.18)'
      : 'var(--glow-brand)';

  const name = STOCK_NAMES[data.symbol] || '';

  return (
    <motion.button
      ref={cardRef}
      type="button"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.boxShadow = `0 0 24px ${glowColor}, 0 8px 32px rgba(0,0,0,0.06)`;
      }}
      className="bento-cell w-full text-left px-4 py-4 cursor-pointer"
      style={{
        transition: 'transform 0.15s ease-out, box-shadow 0.3s ease, border-color 0.3s ease',
        willChange: 'transform',
      }}
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, delay: index * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-lg font-bold font-mono tabular-nums">{data.symbol}</div>
          {name && <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{name}</div>}
        </div>
        <div className={`flex items-center gap-0.5 text-xs font-medium px-2 py-1 rounded-full ${badgeBg}`}>
          {isUp ? <TrendingUp size={12} /> : isDown ? <TrendingDown size={12} /> : <Minus size={12} />}
          <span className="tabular-nums">{isUp ? '+' : ''}{changePct.toFixed(2)}%</span>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold font-mono tabular-nums">
          <AnimatedCounter value={close} decimals={2} />
        </div>
        <div className={`text-sm font-mono font-medium tabular-nums ${colorClass}`}>
          {isUp ? '+' : ''}{change.toFixed(2)}
        </div>
      </div>

      <div className="mt-2 text-[11px] text-[var(--color-text-muted)] tabular-nums">
        {data.date}
      </div>
    </motion.button>
  );
});
