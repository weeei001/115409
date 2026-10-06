import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import type { EChartsOption } from '@/lib/charts/echarts';
import type { TechnicalDay } from '@/lib/types/view';
import { bollOption, kdOption, plottedSpan, plottedSpanText, rsiMacdOptions } from '@/lib/charts/adapters';
import { fmtPrice } from '@/lib/utils/format';
import { fmtIndicator, kdSignal, MACD_DECIMALS, macdSignal, rsiSignal, rsiZone, type SignalTone } from '@/lib/utils/indicatorSignals';
import { useTheme } from '@/lib/theme/ThemeContext';
import { EChart } from '@/components/charts/EChart';
import { EmptyState, LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { signedText } from '@/components/common/LightEntry';
import { LedgerHeading, LightGlyph } from '@/components/common/Ledger';
import { cn } from '@/lib/cn';
import { EmptyRangeActions } from '../EmptyRangeActions';

interface Actions {
  onRetry: () => void;
  onWidenRange: () => void;
}

const TONE_TEXT: Record<SignalTone, string> = {
  up: 'text-up',
  down: 'text-down',
  warning: 'text-warning',
  neutral: 'text-foreground',
};

/** 一個指標：名稱、判讀（讀數＋一句文字）、圖 */
interface Indicator {
  key: 'rsi' | 'macd' | 'kd' | 'boll';
  title: string;
  option: EChartsOption | null;
  /** 讀數，例如「RSI10 64.2」 */
  reading: string | null;
  /** 判讀標籤，依訊號上色 */
  verdict: string | null;
  tone: SignalTone;
  /** 判讀的一句說明（門檻或位置） */
  note: string;
}

/** 讀數＋判讀：數字用等寬字，判讀詞依訊號上色（RSI 超買超賣用 warning，不是漲跌色） */
function Reading({ item, large = false }: { item: Indicator; large?: boolean }) {
  if (!item.reading) return <p className="text-[13px] text-muted-foreground">最近交易日沒有有效讀數</p>;
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', large ? 'text-base' : 'text-sm')}>
      <span className="font-mono font-semibold whitespace-nowrap tabular-nums">{item.reading}</span>
      {item.verdict ? <span className={cn('font-medium', TONE_TEXT[item.tone])}>{item.verdict}</span> : null}
    </p>
  );
}

function bollNote(latest: TechnicalDay): string {
  const { close, boll_upper20: upper, boll_mid20: mid, boll_lower20: lower } = latest;
  if (upper == null || mid == null || lower == null) return '最近交易日的通道數值不完整。';
  const bands = `上軌 ${fmtPrice(upper)}、下軌 ${fmtPrice(lower)}`;
  if (close == null) return `${bands}。`;
  const where =
    close > upper ? '高於上軌' : close >= mid ? '在中軌與上軌之間' : close >= lower ? '在下軌與中軌之間' : '低於下軌';
  return `${bands}；收盤 ${fmtPrice(close)} ${where}。通道是價格的統計範圍，不是買賣訊號。`;
}

function buildIndicators(rows: TechnicalDay[], isDark: boolean): Indicator[] {
  const latest = rows[rows.length - 1];
  const { rsiOption, macdOption } = rsiMacdOptions(rows, isDark);
  const rsi = rsiSignal(latest.rsi10);
  const zone = rsiZone(latest.rsi10);
  const macd = macdSignal(latest.macd_hist);
  const kd = kdSignal(latest.kd_k9, latest.kd_d9);
  const dea = latest.macd_dea ?? latest.macd_signal;
  return [
    {
      key: 'rsi',
      title: 'RSI 相對強弱（10）',
      option: rsiOption,
      reading: rsi.value != null ? `RSI10 ${fmtIndicator(rsi.value)}` : null,
      verdict: rsi.value != null ? rsi.label : null,
      tone: rsi.tone,
      note:
        zone === 'overbought'
          ? '≥ 70 屬超買區；超買是過熱提醒，不是漲跌方向。'
          : zone === 'oversold'
            ? '≤ 30 屬超賣區；超賣是過冷提醒，不是漲跌方向。'
            : '介於 30 與 70 之間屬中性區；虛線是 70／30 門檻。',
    },
    {
      key: 'macd',
      title: 'MACD（12, 26, 9）',
      option: macdOption,
      reading: macd.value != null ? `柱 ${signedText(macd.value, MACD_DECIMALS)}` : null,
      verdict: macd.value != null ? macd.label : null,
      tone: macd.tone,
      note: `${latest.macd_dif != null && dea != null ? `DIF ${latest.macd_dif.toFixed(2)}、DEA ${dea.toFixed(2)}；` : ''}柱為正值偏多、負值偏空。`,
    },
    {
      key: 'kd',
      title: 'KD 隨機指標（9）',
      option: kdOption(rows, isDark),
      reading: latest.kd_k9 != null && latest.kd_d9 != null ? `K ${fmtIndicator(latest.kd_k9)} / D ${fmtIndicator(latest.kd_d9)}` : null,
      verdict: kd.value != null ? kd.label : null,
      tone: kd.tone,
      note: 'K 在 D 之上偏多、之下偏空；這是兩線的相對位置，不是交叉事件。',
    },
    {
      key: 'boll',
      title: '布林通道（20）',
      option: bollOption(rows, isDark),
      reading: latest.boll_mid20 != null ? `中軌 ${fmtPrice(latest.boll_mid20)}` : null,
      verdict: null,
      tone: 'neutral',
      note: bollNote(latest),
    },
  ];
}

/**
 * 「技術指標明細」抽屜：先放一張全寬的主圖（RSI，和頁面上「指標訊號」卡的第一列一致），
 * 其餘指標排成有線分隔的清單，每列左邊用文字寫判讀、右邊是較小的圖。
 */
export function IndicatorsPanel({ rows, loading, error = null, onRetry, onWidenRange }: { rows: TechnicalDay[] | null; loading: boolean; error?: string | null } & Actions) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const indicators = useMemo(() => (rows?.length ? buildIndicators(rows, isDark) : null), [rows, isDark]);
  // 指標圖畫的是載入的每一列：圖說用這些列的首尾日期與筆數
  const span = useMemo(() => plottedSpanText(plottedSpan(rows?.map((r) => r.date))), [rows]);
  const actions = { onRetry, onWidenRange };

  if (loading) {
    return (
      // 載入＝燈質 Q：有線的空白列，光帶掃過
      <div className="flex flex-col gap-6" aria-busy="true">
        <LoadingRows label="載入技術指標中…" className="h-[320px] border-y" />
        <LoadingRows className="h-[360px] border-y" />
      </div>
    );
  }

  // /technical-indicators 失敗：寫錯誤與重試，不寫「尚無資料」也不叫人拉長區間
  if (error) {
    return (
      <Notice
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={onRetry} className="min-h-11">
            <RefreshCw aria-hidden />
            重試
          </Button>
        }
      >
        {error}
      </Notice>
    );
  }

  const available = indicators?.filter((item) => item.option) ?? [];
  if (!indicators || available.length === 0) {
    return (
      <EmptyState className="border-y py-16" action={<EmptyRangeActions {...actions} />}>
        所選日期區間尚無技術指標資料。
      </EmptyState>
    );
  }

  const [primary, ...others] = [...available, ...indicators.filter((item) => !item.option)];
  const latestDate = rows?.[rows.length - 1]?.date;

  return (
    <div className="flex flex-col gap-8">
      {/* 主圖：全寬，判讀寫在圖上方 */}
      <section aria-labelledby="indicator-primary" className="min-w-0">
        <LedgerHeading
          as="h3"
          title={primary.title}
          headingProps={{ id: 'indicator-primary' }}
          stamp={
            span ? (
              <span className="inline-flex items-center gap-1.5">
                {/* 走到這裡代表指標已載入：燈質 F */}
                <LightGlyph state="ready" />
                <span data-plotted-span>圖上 {span}</span>
              </span>
            ) : null
          }
        />
        <div className="mt-3 space-y-1">
          <Reading item={primary} large />
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {latestDate ? `${latestDate} 的讀數；` : ''}
            {primary.note}
          </p>
        </div>
        <div className="mt-3">
          <EChart title={`${primary.title}走勢`} option={primary.option as EChartsOption} height={280} />
        </div>
      </section>

      {/* 其餘指標：有線分隔的清單，每列「判讀文字｜小圖」 */}
      {others.length ? (
        <section aria-labelledby="indicator-others" className="min-w-0">
          <h3 id="indicator-others" className="border-b border-border-strong pb-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">
            其他指標 · 同一段日期
          </h3>
          <ul className="divide-y border-b">
            {others.map((item) => (
              <li
                key={item.key}
                data-stagger
                className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 py-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-center"
              >
                <div className="min-w-0 space-y-1">
                  <h4 className="text-[15px] font-medium tracking-[0.04em]">{item.title}</h4>
                  <Reading item={item} />
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{item.note}</p>
                </div>
                {item.option ? (
                  <EChart title={`${item.title}走勢`} option={item.option} height={170} />
                ) : (
                  <EmptyState className="py-6" action={<EmptyRangeActions {...actions} />}>
                    此指標在所選日期區間沒有有效數值（其他指標可能有資料）。
                  </EmptyState>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
