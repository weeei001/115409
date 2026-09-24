import React from 'react';
import { correlationColor, correlationGradient, getChartPalette } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { CorrelationMatrix } from '@/lib/types/compare';
import { cn } from '@/lib/cn';

interface Props {
  symbols: string[];
  matrix: CorrelationMatrix;
  /** 共同交易日數 */
  alignedDays: number;
}

/** 依標準閾值（|ρ| ≥ 0.7 高、0.3–0.7 中度、< 0.3 低）回傳解讀 */
function interpretRho(rho: number): string {
  const abs = Math.abs(rho);
  if (abs < 0.3) return '低相關';
  const dir = rho >= 0 ? '正相關' : '負相關';
  return abs >= 0.7 ? `高度${dir}` : `中度${dir}`;
}

type VerdictTone = 'good' | 'mid' | 'weak';

function diversificationVerdict(rho: number): { label: string; tone: VerdictTone; detail: string } {
  const abs = Math.abs(rho);
  if (abs < 0.3) return { label: '分散效果佳', tone: 'good', detail: '兩檔走勢相對獨立，同時持有可分散個股風險。' };
  if (abs < 0.7) {
    return {
      label: '分散效果有限',
      tone: 'mid',
      detail: rho >= 0 ? '兩檔多數時候同向波動，分散效果打折。' : '兩檔多數時候反向波動，可部分對沖、但波動仍互有牽動。',
    };
  }
  return {
    label: rho >= 0 ? '走勢高度連動' : '走勢高度互沖',
    tone: rho >= 0 ? 'weak' : 'good',
    detail: rho >= 0 ? '兩檔多半同漲同跌，等同集中持有單一風險來源。' : '兩檔幾乎相反，可作為避險配對。',
  };
}

/** 好壞評價不用漲跌色（決議 D8-c4）：好用品牌色，其餘用警示色 */
const VERDICT_TONE: Record<VerdictTone, string> = {
  good: 'border-brand/30 bg-accent text-accent-foreground',
  mid: 'border-warning-border bg-warning-muted text-warning',
  weak: 'border-warning-border bg-warning-muted text-warning',
};

function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-1 border-b px-5 py-4">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </div>
  );
}

/** 報酬相關性：2 檔顯示單一 ρ 與分散效果結論，3 檔以上顯示矩陣 */
export function CorrelationPanel({ symbols, matrix, alignedDays }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const textColor = getChartPalette(isDark).text;

  if (symbols.length < 2) {
    return (
      <section className="rounded-2xl border bg-card px-5 py-12 text-center shadow-card">
        <p className="text-sm text-muted-foreground">資料不足，至少需要 2 檔股票才能計算相關性</p>
      </section>
    );
  }

  if (symbols.length === 2) {
    const [a, b] = symbols;
    const rho = matrix[a]?.[b] ?? null;
    const verdict = rho == null ? null : diversificationVerdict(rho);
    const barPct = rho == null ? null : Math.round(((Math.max(-1, Math.min(1, rho)) + 1) / 2) * 100);
    return (
      <section className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-card">
        <Header title="報酬率相關性">
          <p className="text-xs text-muted-foreground">共同交易日的日報酬 Pearson ρ；用來判斷兩檔同向程度與分散風險效果。</p>
        </Header>
        <div className="flex flex-1 flex-col gap-4 px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm text-subtle">{a}</span>
              <span className="text-xs text-muted-foreground">×</span>
              <span className="font-mono text-sm text-subtle">{b}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">ρ =</span>
              <span className="font-mono text-4xl leading-none font-bold tabular-nums">{rho == null ? '—' : rho.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="relative h-2 rounded-full" style={{ background: correlationGradient(isDark) }} aria-hidden>
              {barPct != null ? (
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-card shadow-sm"
                  style={{ left: `${barPct}%` }}
                />
              ) : null}
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
              <span>-1 反向</span>
              <span>0 獨立</span>
              <span>+1 同向</span>
            </div>
          </div>

          {verdict && rho != null ? (
            <div className={cn('rounded-xl border px-3.5 py-3', VERDICT_TONE[verdict.tone])}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-sm font-semibold">{interpretRho(rho)}</span>
                <span className="text-[11px] opacity-80">→ {verdict.label}</span>
              </div>
              <p className="text-xs leading-snug">{verdict.detail}</p>
            </div>
          ) : (
            <div className="rounded-xl border px-3.5 py-3 text-xs text-muted-foreground">此區間無共同交易日資料，無法計算相關係數。</div>
          )}

          <p className="mt-auto text-[11px] text-muted-foreground">
            樣本：共同交易日 {alignedDays} 天{alignedDays < 20 ? '（樣本偏少，係數穩定性較低）' : ''}；|ρ| ≥ 0.7 高相關、0.3–0.7 中度、&lt; 0.3 低相關。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <Header title="報酬率相關性矩陣">
        <p className="text-[11px] text-muted-foreground">
          共同交易日 {alignedDays} 天{alignedDays < 20 ? '（樣本不足，相關係數穩定性較低）' : ''}
        </p>
      </Header>
      <div className="space-y-4 overflow-auto p-4">
        <table className="border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-12 bg-card" />
              {symbols.map((sym) => (
                <th key={sym} scope="col" className="w-14 px-2 py-1 text-center font-mono text-subtle">
                  {sym}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSym) => (
              <tr key={rowSym}>
                <th scope="row" className="sticky left-0 z-10 w-12 bg-card px-2 py-1 text-left font-mono text-subtle">
                  {rowSym}
                </th>
                {symbols.map((colSym) => {
                  const val = matrix[rowSym]?.[colSym] ?? null;
                  const diagonal = rowSym === colSym;
                  const title = diagonal
                    ? '對角線：股票對自身相關性恆為 1'
                    : val == null
                      ? '無共同交易日資料'
                      : `相關性 ρ = ${val.toFixed(4)}；樣本約 ${alignedDays} 天`;
                  const colored = !diagonal && val != null;
                  return (
                    <td
                      key={colSym}
                      title={title}
                      className={cn('h-10 w-14 rounded-md px-2 py-2 text-center font-mono', !colored && 'bg-muted text-muted-foreground', diagonal && 'opacity-60')}
                      style={colored ? { backgroundColor: correlationColor(val, isDark), color: textColor } : undefined}
                    >
                      {val == null ? '--' : val.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="max-w-xs space-y-1.5">
          <div className="h-1.5 rounded-full" style={{ background: correlationGradient(isDark) }} aria-hidden />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>負相關 (-1)</span>
            <span>低相關 (0)</span>
            <span>正相關 (+1)</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          解讀建議：|ρ| ≥ 0.7 為高相關、0.3–0.7 為中度相關、&lt; 0.3 為低相關。對角線為股票對自身，恆為 1.00。
        </p>
      </div>
    </section>
  );
}
