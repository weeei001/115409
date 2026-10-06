import React from 'react';
import { AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BadgeTone } from '@/lib/utils/tone';
import type { StockInfo } from '@/lib/types/api';

interface Props {
  symbols: string[];
  symbolColors: Record<string, string>;
  stockInfos: Record<string, StockInfo>;
  requestedRange: { startDate: string; endDate: string };
  analysisRange: { startDate: string; endDate: string } | null;
  alignedDays: number;
  /** 實際比較期間內的交易日數（主圖畫出的點數） */
  tradingDays?: number | null;
  onJumpToControls: () => void;
  /** 主圖（航跡圖）面板；放在帳頁最上方，是整個比較結果的主體 */
  chart?: React.ReactNode;
  /** 主圖下方的條目（個股快照）；省略時列出代號、名稱與產業 */
  entries?: React.ReactNode;
  /** 燈質記號：重新比較中＝Q、已載入＝F（寫在「實際比較期間」旁） */
  state?: LightState;
}

function summarize(symbols: string[]): string {
  if (symbols.length === 0) return '尚未選擇股票';
  if (symbols.length <= 3) return symbols.join('、');
  return `${symbols.slice(0, 3).join('、')} 等 ${symbols.length} 檔`;
}

type AlignedTone = 'ok' | 'warn' | 'danger';

const alignedTone = (days: number): AlignedTone => (days < 5 ? 'danger' : days < 20 ? 'warn' : 'ok');

function alignedHint(tone: AlignedTone, days: number): string {
  if (tone === 'danger') return `共同日漲跌樣本僅 ${days} 筆，波動與相關係數可能極不穩定`;
  if (tone === 'warn') return `共同日漲跌樣本 ${days} 筆，相關係數穩定性較低`;
  return `共同日漲跌樣本 ${days} 筆`;
}

const TONE_TAG: Record<AlignedTone, BadgeTone> = { ok: 'neutral', warn: 'warning', danger: 'danger' };

/**
 * 比較結果帳頁：最上方是航跡圖（本頁唯一的圖廓），緊接著參與比較的條目，最後一格是產業背景與實際比較期間。
 */
export function CompareHero({ symbols, symbolColors, stockInfos, requestedRange, analysisRange, alignedDays, tradingDays = null, onJumpToControls, chart, entries, state = 'ready' }: Props) {
  const tone = alignedTone(alignedDays);
  const industries = symbols.map((symbol) => stockInfos[symbol]?.industry?.trim());
  const context = symbols.length < 2
    ? '請選擇至少兩檔股票，再比較產業背景與價格表現。'
    : industries.some((industry) => !industry)
      ? '部分股票產業未提供，暫時無法判斷是否為同產業比較。'
      : new Set(industries).size === 1
        ? '同產業比較：可觀察價格表現與風險差異；相同產業分類不代表商業模式相同。'
        : '跨產業比較：先看價格表現與風險差異；產業背景不同，不能據此判斷公司經營優劣。';
  return (
    <Ledger
      title={`${summarize(symbols)} 的${symbols.length >= 2 ? '價格表現比較' : '價格表現'}`}
      actions={(
        <Button type="button" variant="outline" onClick={onJumpToControls} className="-my-1.5">
          <RotateCcw aria-hidden />
          修改條件
        </Button>
      )}
      aria-label="比較結果"
    >
      {chart}

      {entries ?? (
        <LedgerPanel padded={false}>
          <ul className="divide-y" aria-label="比較標的">
            {symbols.map((sym) => (
              <li key={sym} className="relative flex min-h-14 items-center gap-3 py-2 pr-4 pl-5 sm:pr-5 sm:pl-6">
                <span aria-hidden className="absolute inset-y-2 left-0 w-[3px]" style={{ backgroundColor: symbolColors[sym] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium tabular-nums">{sym} {stockInfos[sym]?.name?.trim() || ''}</span>
                  <span className="block truncate text-xs text-muted-foreground">{stockInfos[sym]?.industry?.trim() || '產業未提供'}</span>
                </span>
              </li>
            ))}
          </ul>
        </LedgerPanel>
      )}

      <LedgerPanel title="比較概覽">
        <div className="grid gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-2">
          <p className="text-[15px] leading-[1.8]">{context}</p>
          <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
            <Info size={14} className="mt-1 shrink-0" aria-hidden />
            <span>個股價格漲跌不含股息，未調整除權息與分割；各項資料期間另行標示。資料為市場資訊呈現，非投資建議。</span>
          </p>
        </div>
        <div className="space-y-2 lg:border-l lg:pl-8">
          {/* 主要的日期是資料實際涵蓋的期間；查詢條件（可能是沒有儲存資料的日子）放在下面小字 */}
          {analysisRange ? (
            <div>
              <p className="flex items-center gap-1.5 text-[13px] tracking-[0.04em] text-muted-foreground">
                實際比較期間
                <LightGlyph state={state} />
              </p>
              <p className="mt-0.5 font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums">
                <span className="sr-only">實際比較期間 </span>
                {analysisRange.startDate} → {analysisRange.endDate}
              </p>
              {tradingDays ? <p className="characteristic mt-0.5">共 {tradingDays} 個交易日 · 各檔皆有收盤的共同起訖日</p> : null}
            </div>
          ) : (
            <p className="text-[13px] text-subtle">共同價格資料不足，無法建立實際比較期間或計算期間漲跌。</p>
          )}
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            查詢條件：{requestedRange.startDate} → {requestedRange.endDate}
          </p>
          <p>
            <Badge tone={TONE_TAG[tone]} className="gap-1.5 px-2 font-normal whitespace-normal tabular-nums">
              {tone !== 'ok' ? <AlertTriangle size={12} aria-hidden /> : null}
              {analysisRange ? alignedHint(tone, alignedDays) : '共同日漲跌樣本不足'}
            </Badge>
          </p>
        </div>
        </div>
      </LedgerPanel>
    </Ledger>
  );
}
