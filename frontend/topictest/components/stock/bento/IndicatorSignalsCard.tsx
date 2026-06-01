import React from 'react';
import { Activity } from 'lucide-react';
import type { TechnicalIndicatorResponse, TechnicalIndicatorListResponse } from '../../../lib/types/stockDashboard';
import { toNum } from '../../../lib/utils/parseNumber';
import { getBadgeToneClass, type ValueTone } from '../../../lib/utils/valueToneClass';
import { BentoCardShell } from './BentoCardShell';

interface Props {
  indicatorLatest: TechnicalIndicatorResponse | null;
  indicatorsRange: TechnicalIndicatorListResponse | null;
  loading?: boolean;
  onOpenDetail: () => void;
}

interface Row {
  label: string;
  value: string;
  hint: string;
  tone: ValueTone;
}

export const IndicatorSignalsCard: React.FC<Props> = ({
  indicatorLatest,
  indicatorsRange,
  loading,
  onOpenDetail,
}) => {
  const latestRow = indicatorsRange?.data?.[indicatorsRange.data.length - 1] ?? null;

  const rsi = toNum(indicatorLatest?.rsi10);
  const macd = toNum(indicatorLatest?.macd_hist);
  const kdK = toNum(latestRow?.kd_k9);
  const kdD = toNum(latestRow?.kd_d9);

  const rows: Row[] = [
    {
      label: 'RSI10',
      value: rsi != null ? rsi.toFixed(1) : '—',
      hint: rsi == null ? '無資料' : rsi >= 70 ? '超買偏多' : rsi <= 30 ? '超賣偏空' : '中性',
      tone: rsi == null ? 'neutral' : rsi >= 70 ? 'up' : rsi <= 30 ? 'down' : 'neutral',
    },
    {
      label: 'MACD 動能',
      value: macd != null ? macd.toFixed(3) : '—',
      hint: macd == null ? '無資料' : macd > 0 ? '多方動能' : macd < 0 ? '空方動能' : '中性',
      tone: macd == null ? 'neutral' : macd > 0 ? 'up' : macd < 0 ? 'down' : 'neutral',
    },
    {
      label: 'KD',
      value: kdK != null && kdD != null ? `K ${kdK.toFixed(1)} / D ${kdD.toFixed(1)}` : '—',
      hint: kdK == null || kdD == null ? '無資料' : kdK > kdD ? 'K 上穿 D' : kdK < kdD ? 'K 下穿 D' : '黏合',
      tone: kdK == null || kdD == null ? 'neutral' : kdK > kdD ? 'up' : kdK < kdD ? 'down' : 'neutral',
    },
  ];

  return (
    <BentoCardShell
      icon={Activity}
      title="指標訊號"
      loading={loading}
      action={{ label: '詳細技術指標', onClick: onOpenDetail }}
    >
      <p className="text-[11px] text-[var(--color-text-muted)] -mt-1">最新一日讀數與偏向</p>
      <ul className="flex-1 flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.label}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">{row.label}</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${getBadgeToneClass(row.tone)}`}
              >
                {row.hint}
              </span>
            </div>
            <p className="mt-1 text-sm font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
              {row.value}
            </p>
          </li>
        ))}
      </ul>
    </BentoCardShell>
  );
};
