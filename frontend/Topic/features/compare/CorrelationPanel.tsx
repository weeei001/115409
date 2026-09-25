import React from 'react';
import { correlationColor, correlationGradient, getChartPalette } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { CorrelationMatrix } from '@/lib/types/compare';
import { cn } from '@/lib/cn';

interface Props {
  symbols: string[];
  matrix: CorrelationMatrix;
  sampleCounts: Record<string, Record<string, number>>;
}

/** 依標準閾值（|ρ| ≥ 0.7 高、0.3–0.7 中度、< 0.3 低）回傳解讀 */
function interpretRho(rho: number): string {
  const abs = Math.abs(rho);
  if (abs < 0.3) return '低相關';
  const dir = rho >= 0 ? '正相關' : '負相關';
  return abs >= 0.7 ? `高度${dir}` : `中度${dir}`;
}

function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-1 border-b px-5 py-4">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </div>
  );
}

/** Show pairwise daily price correlation and its exact sample count. */
export function CorrelationPanel({ symbols, matrix, sampleCounts }: Props) {
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
    const count = sampleCounts[a]?.[b] ?? 0;
    const barPct = rho == null ? null : Math.round(((Math.max(-1, Math.min(1, rho)) + 1) / 2) * 100);
    return (
      <section className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-card">
        <Header title="日漲跌幅相關性">
          <p className="text-xs text-muted-foreground">以兩檔同日有效的日漲跌幅計算 Pearson ρ，描述期間內的線性連動程度。</p>
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
              <span>0 無線性相關</span>
              <span>+1 同向</span>
            </div>
          </div>

          {rho != null ? (
            <div className="rounded-xl border bg-muted/40 px-3.5 py-3">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-sm font-semibold">{interpretRho(rho)}</span>
              </div>
              <p className="text-xs leading-snug text-muted-foreground">係數接近 +1 表示同向線性連動較強，接近 −1 表示反向連動較強；接近 0 不代表彼此獨立。</p>
            </div>
          ) : (
            <div className="rounded-xl border px-3.5 py-3 text-xs text-muted-foreground">有效配對樣本不足 2 筆，或其中一檔日漲跌幅沒有變異，無法計算相關係數。</div>
          )}

          <p className="mt-auto text-[11px] text-muted-foreground">
            有效配對樣本：{count} 筆{count < 20 ? '（樣本少於 20 筆，係數穩定性較低）' : ''}；|ρ| ≥ 0.7 高相關、0.3–0.7 中度、&lt; 0.3 低相關。歷史相關性無法保證未來分散風險效果。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <Header title="日漲跌幅相關性矩陣">
        <p className="text-[11px] text-muted-foreground">
          每格列出 Pearson ρ 與該配對的有效樣本數；各配對的樣本數可能不同。
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
                  const count = sampleCounts[rowSym]?.[colSym] ?? 0;
                  const diagonal = rowSym === colSym;
                  const title = `${val == null ? '樣本不足 2 筆或日漲跌幅無變異，無法計算' : `相關性 ρ = ${val.toFixed(4)}`}；有效配對樣本 ${count} 筆${count < 20 ? '，樣本偏少' : ''}`;
                  const colored = !diagonal && val != null;
                  return (
                    <td
                      key={colSym}
                      title={title}
                      className={cn('h-10 w-14 rounded-md px-2 py-2 text-center font-mono', !colored && 'bg-muted text-muted-foreground', diagonal && 'opacity-60')}
                      style={colored ? { backgroundColor: correlationColor(val, isDark), color: textColor } : undefined}
                    >
                      {val == null ? '--' : val.toFixed(2)}
                      <span className="block whitespace-nowrap text-[10px]">{count} 筆{count < 20 ? '＊' : ''}</span>
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
          |ρ| ≥ 0.7 為高相關、0.3–0.7 為中度相關、&lt; 0.3 為低相關。＊少於 20 筆，係數穩定性較低；-- 表示樣本不足 2 筆或無變異。對角線只在可計算時為 1.00。低相關不代表獨立，歷史相關性無法保證未來分散風險效果。
        </p>
      </div>
    </section>
  );
}
