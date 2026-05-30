import React from 'react';
import { motion } from 'motion/react';
import {
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompareMetricsRow } from '../lib/types';
import { COMPARE_COLOR_PALETTE } from '../lib/utils/compare';
import { useTheme } from '../lib/ThemeContext';
import { getChartPalette } from '../lib/chartTheme';
import { ChartResizeContainer } from './ChartResizeContainer';

interface Props {
  rows: CompareMetricsRow[];
  symbolColors?: Record<string, string>;
}

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 依資料推算座標域：取 min/max 後外擴 padding，保證 0 軸與資料都可見、單點時給合理視窗。 */
function computeDomain(values: number[], includeZero: boolean): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  const range = max - min;
  const padding = range === 0 ? Math.max(Math.abs(max) * 0.2, 1) : range * 0.18;
  return [min - padding, max + padding];
}

export const RiskReturnScatter: React.FC<Props> = ({ rows, symbolColors = {} }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);
  const data = rows
    .filter((r) => r.volatilityPct != null && r.totalReturnPct != null)
    .map((r) => ({
      symbol: r.symbol,
      x: r.volatilityPct as number,
      y: r.totalReturnPct as number,
      color: symbolColors[r.symbol] ?? fallbackColor(r.symbol),
    }));

  if (data.length === 0) {
    const missing = rows
      .filter((r) => r.volatilityPct == null || r.totalReturnPct == null)
      .map((r) => r.symbol);
    return (
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm px-5 py-10 text-center space-y-1.5">
          <p className="text-sm text-[var(--color-text-primary)] font-medium">資料不足，無法繪製風險–報酬分佈</p>
          {missing.length > 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              缺少波動度或報酬：<span className="font-mono">{missing.join('、')}</span>
            </p>
          ) : null}
          <p className="text-xs text-[var(--color-text-muted)]">下一步：拉長比較區間或換成資料較完整的個股。</p>
        </div>
      </motion.section>
    );
  }

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xDomain = computeDomain(xs, false);
  const yDomain = computeDomain(ys, true); // 報酬軸保留 0 基準
  const xMedian = median(xs);
  const quadrantFill = isDark ? 'rgba(148,163,184,0.06)' : 'rgba(148,163,184,0.08)';
  const labelFill = c.tick;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-1">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">風險-報酬分佈</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            X 軸＝年化波動度（%，越右越震盪），Y 軸＝區間報酬（%，越上越賺）。象限以「樣本波動中位數」與「0% 報酬」切分。
          </p>
        </div>
        <div className="p-4 h-[340px] min-h-0 min-w-0">
          <ChartResizeContainer
            className="h-full"
            role="img"
            aria-label="風險報酬散點圖：X 軸波動度、Y 軸區間報酬，四象限以中位波動與 0% 報酬切分"
          >
            {(size) => (
            <ResponsiveContainer width={size.width} height={size.height}>
            <ScatterChart margin={{ top: 24, right: 32, bottom: 24, left: 12 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />

              {/* 四象限淡色背景 + 角落標籤 */}
              <ReferenceArea
                x1={xDomain[0]}
                x2={xMedian}
                y1={0}
                y2={yDomain[1]}
                fill={quadrantFill}
                fillOpacity={1}
                stroke="none"
              >
                <Label
                  value="理想：低波動、正報酬"
                  position="insideTopLeft"
                  fill={labelFill}
                  fontSize={11}
                  offset={8}
                />
              </ReferenceArea>
              <ReferenceArea
                x1={xMedian}
                x2={xDomain[1]}
                y1={0}
                y2={yDomain[1]}
                stroke="none"
              >
                <Label
                  value="激進：高波動、正報酬"
                  position="insideTopRight"
                  fill={labelFill}
                  fontSize={11}
                  offset={8}
                />
              </ReferenceArea>
              <ReferenceArea
                x1={xDomain[0]}
                x2={xMedian}
                y1={yDomain[0]}
                y2={0}
                stroke="none"
              >
                <Label
                  value="防禦：低波動、負報酬"
                  position="insideBottomLeft"
                  fill={labelFill}
                  fontSize={11}
                  offset={8}
                />
              </ReferenceArea>
              <ReferenceArea
                x1={xMedian}
                x2={xDomain[1]}
                y1={yDomain[0]}
                y2={0}
                fill={quadrantFill}
                fillOpacity={1}
                stroke="none"
              >
                <Label
                  value="落後：高波動、負報酬"
                  position="insideBottomRight"
                  fill={labelFill}
                  fontSize={11}
                  offset={8}
                />
              </ReferenceArea>

              {/* 切分軸：0% 報酬 + 中位波動 */}
              <ReferenceLine
                y={0}
                stroke={c.referenceLine}
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
              <ReferenceLine
                x={xMedian}
                stroke={c.referenceLine}
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />

              <XAxis
                type="number"
                dataKey="x"
                name="年化波動度"
                unit="%"
                domain={xDomain}
                tick={{ fontSize: 11, fill: c.tick }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="區間報酬"
                unit="%"
                domain={yDomain}
                tick={{ fontSize: 11, fill: c.tick }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: '1px solid var(--color-border)',
                  boxShadow: c.tooltipShadow,
                  fontSize: '12px',
                  backgroundColor: c.tooltipBg,
                  color: c.tooltipText,
                }}
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value: unknown, name?: string | number) =>
                  typeof value === 'number'
                    ? [`${value.toFixed(2)}%`, name === 'x' ? '年化波動度' : '區間報酬']
                    : [String(value), String(name ?? '')]
                }
                labelFormatter={(_, payload) => payload?.[0]?.payload?.symbol ?? ''}
              />
              <Scatter data={data}>
                {data.map((entry) => (
                  <Cell key={`cell-${entry.symbol}`} fill={entry.color} />
                ))}
                <LabelList
                  dataKey="symbol"
                  position="top"
                  fontSize={11}
                  fill={c.tick}
                  offset={8}
                />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
            )}
          </ChartResizeContainer>
        </div>
        <div className="px-5 pb-4 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)] space-y-0.5">
          <p>解讀：左上＝CP 值最高（少波動換取正報酬）；右上＝高風險換高報酬；右下＝白做工。</p>
          <p>注意：象限的「高/低波動」是<strong>已選樣本之間的相對位置</strong>，非絕對風險評等。</p>
        </div>
      </div>
    </motion.section>
  );
};
