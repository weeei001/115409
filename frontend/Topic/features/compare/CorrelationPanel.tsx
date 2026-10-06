import { LedgerPanel } from '@/components/common/Ledger';
import { EmptyState } from '@/components/common/Notice';
import { correlationColor, correlationGradient, getChartPalette } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { CorrelationMatrix } from '@/lib/types/compare';
import { uMinus } from '@/lib/utils/format';
import { cn } from '@/lib/cn';

interface Props {
  symbols: string[];
  matrix: CorrelationMatrix;
  sampleCounts: Record<string, Record<string, number>>;
}

/** ρ 一律 2 位小數（P2-104），負號用 U+2212（P2-105） */
export function signedRho(rho: number): string {
  return uMinus(rho.toFixed(2));
}

/** 依標準閾值（|ρ| ≥ 0.7 高、0.3–0.7 中度、< 0.3 低）回傳解讀 */
function interpretRho(rho: number): string {
  const abs = Math.abs(rho);
  if (abs < 0.3) return '低相關';
  const dir = rho >= 0 ? '正相關' : '負相關';
  return abs >= 0.7 ? `高度${dir}` : `中度${dir}`;
}

/** 色階刻度：方角色帶，下方標 −1／0／+1 */
function Scale({ isDark, marker, labels }: { isDark: boolean; marker?: number | null; labels: [string, string, string] }) {
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 border" style={{ background: correlationGradient(isDark) }} aria-hidden>
        {marker != null ? (
          <span className="absolute -top-1.5 h-5 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${marker}%` }} />
        ) : null}
      </div>
      <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground tabular-nums">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
        <span>{labels[2]}</span>
      </div>
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
      <LedgerPanel>
        <EmptyState>資料不足，至少需要 2 檔股票才能計算相關性</EmptyState>
      </LedgerPanel>
    );
  }

  if (symbols.length === 2) {
    const [a, b] = symbols;
    const rho = matrix[a]?.[b] ?? null;
    const count = sampleCounts[a]?.[b] ?? 0;
    const barPct = rho == null ? null : Math.round(((Math.max(-1, Math.min(1, rho)) + 1) / 2) * 100);
    return (
        <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-12">
        <LedgerPanel title={`${a} × ${b}`} className="flex flex-col gap-4 lg:col-span-7">
          <p className="text-[13px] leading-relaxed text-muted-foreground">以兩檔同一天的日漲跌幅計算相關係數 ρ，描述期間內同漲同跌的程度。</p>
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">ρ =</span>
            <span className="font-mono text-[clamp(30px,3vw,40px)] leading-none font-semibold tabular-nums">{rho == null ? '--' : signedRho(rho)}</span>
          </div>
          <Scale isDark={isDark} marker={barPct} labels={['−1 反向', '0 無線性相關', '+1 同向']} />
        </LedgerPanel>
        <LedgerPanel title="解讀" className="flex flex-col gap-3 lg:col-span-5">
          {rho != null ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{interpretRho(rho)}</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">係數接近 +1 表示同向線性連動較強，接近 −1 表示反向連動較強；接近 0 不代表彼此獨立。</p>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted-foreground">有效配對樣本不足 2 筆，或其中一檔日漲跌幅沒有變異，無法計算相關係數。</p>
          )}
          <p className="mt-auto border-t pt-3 text-xs leading-relaxed text-muted-foreground">
            有效配對樣本：{count} 筆{count < 20 ? '（樣本少於 20 筆，係數穩定性較低）' : ''}；|ρ| ≥ 0.7 高相關、0.3–0.7 中度、&lt; 0.3 低相關。歷史相關性無法保證未來分散風險效果。
          </p>
        </LedgerPanel>
        </div>
    );
  }

  const pairs = (symbols.length * (symbols.length - 1)) / 2;
  return (
      <LedgerPanel className="space-y-4">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {symbols.length} 檔、{pairs} 組配對；每格列出相關係數 ρ 與該配對的有效樣本數，各配對的樣本數可能不同。
        </p>
        <div className="overflow-x-auto overscroll-x-contain">
          {/* 有線的格線矩陣：格子之間 1px 細線，不留間距、不做圓角 */}
          <table className="border-collapse border text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-14 border-r border-b border-b-border-strong bg-card" />
                {symbols.map((sym) => (
                  <th key={sym} scope="col" className="h-11 w-20 border-b border-b-border-strong px-2 text-center font-mono text-[13px] font-medium text-muted-foreground tabular-nums not-last:border-r">
                    {sym}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((rowSym) => (
                <tr key={rowSym}>
                  <th scope="row" className="sticky left-0 z-10 w-14 border-r border-b bg-card px-2 text-left font-mono text-[13px] font-medium text-muted-foreground tabular-nums">
                    {rowSym}
                  </th>
                  {symbols.map((colSym) => {
                    const val = matrix[rowSym]?.[colSym] ?? null;
                    const count = sampleCounts[rowSym]?.[colSym] ?? 0;
                    const diagonal = rowSym === colSym;
                    const title = `${val == null ? '樣本不足 2 筆或日漲跌幅無變異，無法計算' : `相關性 ρ = ${signedRho(val)}`}；有效配對樣本 ${count} 筆${count < 20 ? '，樣本偏少' : ''}`;
                    const colored = !diagonal && val != null;
                    return (
                      <td
                        key={colSym}
                        title={title}
                        className={cn('h-14 w-20 border-b px-2 py-2 text-center font-mono tabular-nums not-last:border-r', !colored && 'bg-muted text-muted-foreground')}
                        style={colored ? { backgroundColor: correlationColor(val, isDark), color: textColor } : undefined}
                      >
                        <span className="text-[13.5px] font-medium">{val == null ? '--' : signedRho(val)}</span>
                        <span className="block text-[11px] whitespace-nowrap">{count} 筆{count < 20 ? '＊' : ''}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="max-w-xs">
          <Scale isDark={isDark} labels={['負相關（−1）', '低相關（0）', '正相關（+1）']} />
        </div>
        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          |ρ| ≥ 0.7 為高相關、0.3–0.7 為中度相關、&lt; 0.3 為低相關。＊少於 20 筆，係數穩定性較低；-- 表示樣本不足 2 筆或無變異。對角線只在可計算時為 1.00。低相關不代表獨立，歷史相關性無法保證未來分散風險效果。
        </p>
      </LedgerPanel>
  );
}
