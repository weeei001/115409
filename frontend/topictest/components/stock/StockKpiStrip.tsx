import React from 'react';
import { clsx } from 'clsx';
import type { PriceChartData } from '../../lib/types/priceChart';
import type {
  InstitutionalTradeResponse,
  TechnicalIndicatorResponse,
} from '../../lib/types/stockDashboard';
import { fmtInstitutionalShares, fmtPercent } from '../../lib/utils/format';
import { getValueTone, type ValueTone } from '../../lib/utils/valueToneClass';

interface Props {
  priceChart: PriceChartData | null;
  institutionalLatest: InstitutionalTradeResponse | null;
  indicatorLatest: TechnicalIndicatorResponse | null;
}

interface KpiTile {
  label: string;
  value: string;
  tone: ValueTone;
  sub?: string;
}

/**
 * KPI strip 中性值用 primary 文字色（突顯數字），與一般 secondary 不同，
 * 故保留本地實作。漲跌側分別走 up / down token。
 */
function kpiToneClass(tone: ValueTone): string {
  if (tone === 'up') return 'text-up';
  if (tone === 'down') return 'text-down';
  return 'text-[var(--color-text-primary)]';
}

function rsiTone(value: number | null | undefined): ValueTone {
  if (value == null) return 'neutral';
  if (value >= 70) return 'up';
  if (value <= 30) return 'down';
  return 'neutral';
}

function buildRangeChange(priceChart: PriceChartData | null): KpiTile {
  if (!priceChart?.candles?.length) {
    return { label: '區間漲跌幅', value: '—', tone: 'neutral' };
  }
  const candles = priceChart.candles;
  const first = candles[0]?.close;
  const last = candles[candles.length - 1]?.close;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return { label: '區間漲跌幅', value: '—', tone: 'neutral' };
  }
  const diff = last - first;
  const pct = (diff / first) * 100;
  return {
    label: '區間漲跌幅',
    value: fmtPercent(pct, { sign: true }),
    tone: getValueTone(diff),
    sub: `${candles.length} 個交易日`,
  };
}

function buildHighLow(priceChart: PriceChartData | null, mode: 'high' | 'low'): KpiTile {
  if (!priceChart?.candles?.length) {
    return { label: mode === 'high' ? '區間最高' : '區間最低', value: '—', tone: 'neutral' };
  }
  const vals = priceChart.candles.map((c) => (mode === 'high' ? c.high : c.low)).filter((v) => Number.isFinite(v));
  if (!vals.length) {
    return { label: mode === 'high' ? '區間最高' : '區間最低', value: '—', tone: 'neutral' };
  }
  const value = mode === 'high' ? Math.max(...vals) : Math.min(...vals);
  return {
    label: mode === 'high' ? '區間最高' : '區間最低',
    value: value.toFixed(2),
    tone: mode === 'high' ? 'up' : 'down',
  };
}

export const StockKpiStrip: React.FC<Props> = ({
  priceChart,
  institutionalLatest,
  indicatorLatest,
}) => {
  const tiles: KpiTile[] = [
    buildRangeChange(priceChart),
    buildHighLow(priceChart, 'high'),
    buildHighLow(priceChart, 'low'),
    {
      label: '法人合計（股）',
      value: fmtInstitutionalShares(institutionalLatest?.total_net),
      tone: getValueTone(institutionalLatest?.total_net ?? null),
      sub: institutionalLatest?.date ? `截至 ${institutionalLatest.date}` : undefined,
    },
    {
      label: 'RSI10',
      value:
        indicatorLatest?.rsi10 != null && Number.isFinite(Number(indicatorLatest.rsi10))
          ? Number(indicatorLatest.rsi10).toFixed(1)
          : '—',
      tone: rsiTone(indicatorLatest?.rsi10 != null ? Number(indicatorLatest.rsi10) : null),
      sub: '>70 偏多 / <30 偏空',
    },
    {
      label: 'MACD 動能',
      value:
        indicatorLatest?.macd_hist != null && Number.isFinite(Number(indicatorLatest.macd_hist))
          ? Number(indicatorLatest.macd_hist).toFixed(3)
          : '—',
      tone: getValueTone(indicatorLatest?.macd_hist != null ? Number(indicatorLatest.macd_hist) : null),
      sub: '正值偏多 / 負值偏空',
    },
  ];

  return (
    <div
      className="grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3 overflow-x-auto snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="個股關鍵指標"
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="snap-start rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2.5 shadow-[var(--shadow-card)]"
        >
          <p className="text-[11px] text-[var(--color-text-muted)] leading-tight">{tile.label}</p>
          <p
            className={clsx(
              'mt-1 text-lg font-mono font-semibold tabular-nums leading-tight',
              kpiToneClass(tile.tone),
            )}
          >
            {tile.value}
          </p>
          {tile.sub ? (
            <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)] leading-tight tabular-nums truncate">
              {tile.sub}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
};
