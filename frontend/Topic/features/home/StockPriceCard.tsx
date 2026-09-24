import React, { memo, useRef } from 'react';
import { motion } from 'motion/react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { DailyPriceResponse } from '@/lib/types/api';
import { Sparkline } from '@/components/common/Sparkline';
import { useCanHoverTilt, usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { formatStockLabel, getStockName } from '@/lib/utils/symbolNames';
import { getValueTone, toneBadge, toneText } from '@/lib/utils/tone';
import { cn } from '@/lib/cn';
import { AnimatedCounter } from './AnimatedCounter';

interface Props {
  data: DailyPriceResponse;
  index: number;
  sparkline?: number[];
  onNavigate: (symbol: string) => void;
}

const GLOW = {
  up: 'color-mix(in srgb, var(--up) 18%, transparent)',
  down: 'color-mix(in srgb, var(--down) 18%, transparent)',
  neutral: 'var(--glow-brand)',
} as const;

const REST_TRANSFORM = 'perspective(600px) rotateY(0deg) rotateX(0deg) scale3d(1,1,1)';

/** 首頁即時股價卡：點擊進個股頁；滑鼠裝置才有 3D 傾斜 */
export const StockPriceCard = memo(function StockPriceCard({ data, index, sparkline, onNavigate }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const canTilt = useCanHoverTilt();
  const reduce = usePrefersReducedMotion();

  const close = Number(data.close ?? 0);
  const change = Number(data.change ?? 0);
  const prevClose = close - change;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const tone = getValueTone(change);
  const TrendIcon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : Minus;
  const sign = change > 0 ? '+' : '';
  const name = getStockName(data.symbol);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!canTilt || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -10;
    ref.current.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg) scale3d(1.03,1.03,1.03)`;
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={() => onNavigate(data.symbol)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (ref.current) ref.current.style.transform = REST_TRANSFORM;
      }}
      aria-label={`${formatStockLabel(data.symbol)} 收盤 ${close.toFixed(2)}，漲跌 ${sign}${change.toFixed(2)}（${sign}${changePct.toFixed(2)}%），查看個股`}
      className="w-full rounded-xl border bg-card px-4 py-4 text-left hover:border-border-strong hover:shadow-[0_0_24px_var(--card-glow),var(--elev-card-hover)]"
      style={
        {
          '--card-glow': GLOW[tone],
          transition: canTilt
            ? 'transform 0.15s ease-out, box-shadow 0.3s ease, border-color 0.3s ease'
            : 'box-shadow 0.3s ease, border-color 0.3s ease',
        } as React.CSSProperties
      }
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="mb-2 flex items-start justify-between gap-2" aria-hidden>
        <div className="min-w-0">
          <div className="font-mono text-lg font-bold tabular-nums">{data.symbol}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{name ?? '\u00a0'}</div>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-1 text-xs font-medium', toneBadge(tone))}>
          <TrendIcon size={12} />
          <span className="tabular-nums">
            {sign}
            {changePct.toFixed(2)}%
          </span>
        </span>
      </div>

      <div className="flex items-end justify-between gap-2" aria-hidden>
        <AnimatedCounter value={close} className="font-mono text-2xl font-bold tabular-nums" />
        <span className={cn('font-mono text-sm font-medium tabular-nums', toneText(tone))}>
          {sign}
          {change.toFixed(2)}
        </span>
      </div>

      {sparkline && sparkline.length >= 2 ? <Sparkline values={sparkline} trend={tone === 'neutral' ? 'flat' : tone} className="mt-3" /> : null}

      <div className="mt-2 text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        {data.date}
      </div>
    </motion.button>
  );
});
