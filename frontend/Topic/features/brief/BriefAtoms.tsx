import React from 'react';
import { AlertTriangle, FileWarning, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import type { Brief, Direction } from '@/lib/types/textBrief';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/Notice';
import { cn } from '@/lib/cn';
import { signedText } from '@/lib/utils/format';
import type { BadgeTone } from '@/lib/utils/tone';
import { claimTypeMeta, CONF, STANCE, STANCE_TONE, type BriefTone } from '@/lib/brief/textBriefLabels';
import type { EvidenceIndex, ResolvedEvidence } from '@/lib/brief/textBriefEvidence';
import { EVIDENCE_CATEGORY } from '@/lib/brief/textBriefEvidence';

/**
 * AI 投資分析共用的顯示元件。摘要卡與完整分析都吃這一套，
 * 所以標籤樣式、來源標籤的可用性判斷只有一份。
 */

/** AI 分析標籤的色調對應到全站的徽章色（lib/utils/tone.ts 的 toneBadge） */
const BRIEF_BADGE: Record<BriefTone, { tone: BadgeTone; emphasis?: boolean }> = {
  ok: { tone: 'up', emphasis: true },
  bad: { tone: 'down', emphasis: true },
  warn: { tone: 'warning' },
  info: { tone: 'info' },
  plain: { tone: 'neutral' },
};

export const Tag: React.FC<{
  tone?: BriefTone;
  title?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'plain', title, className, children }) => (
  <Badge tone={BRIEF_BADGE[tone].tone} emphasis={BRIEF_BADGE[tone].emphasis} title={title} className={className}>
    {children}
    {/* title 只有滑鼠停住才看得到；同一句說明也給螢幕報讀 */}
    {title ? <span className="sr-only">（{title}）</span> : null}
  </Badge>
);

export function StanceIcon({ tone, size = 14 }: { tone: BriefTone; size?: number }) {
  if (tone === 'ok') return <TrendingUp size={size} aria-hidden className="shrink-0" />;
  if (tone === 'bad') return <TrendingDown size={size} aria-hidden className="shrink-0" />;
  return <Minus size={size} aria-hidden className="shrink-0" />;
}

/** 結論性質標籤；observation 不加標籤（它本來就該有證據） */
export const ClaimTypeBadge: React.FC<{ claimType?: string }> = ({ claimType }) => {
  const meta = claimTypeMeta(claimType);
  if (!meta) return null;
  return (
    <Tag tone={meta.tone} title={meta.hint}>
      {meta.label}
    </Tag>
  );
};

/**
 * 方向記號。文字（正面／負面）與符號（＋／－）都在，紅綠只是加強，
 * 不是唯一的判讀依據。
 */
export const DirectionMark: React.FC<{ direction?: Direction; label?: string }> = ({
  direction,
  label,
}) => {
  const positive = direction === 'positive';
  const negative = direction === 'negative';
  const Icon = positive ? Plus : Minus;
  const cls = positive ? 'text-up' : negative ? 'text-down' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-semibold', cls)}>
      <Icon size={13} aria-hidden />
      {label ? <span>{label}</span> : null}
    </span>
  );
};

/** 關鍵交易日的漲跌幅：由後端依當日行情回填，不是模型寫的，所以直接照數字上紅漲綠跌；0 與缺值不上色 */
export const KeyDayMove: React.FC<{ move?: number | null }> = ({ move }) => {
  const cls = move != null && move > 0 ? 'text-up' : move != null && move < 0 ? 'text-down' : 'text-muted-foreground';
  return <span className={cn('font-mono text-sm font-semibold tabular-nums', cls)}>{signedText(move, 2, '%')}</span>;
};

/** 整體結論的標題句與兩個標籤（整體立場、分析信心）：完整分析與可列印報告共用，說明文字各自排 */
export const BriefHeadline: React.FC<{ brief: Brief }> = ({ brief }) => {
  const tone: BriefTone = STANCE_TONE[brief.overall_stance ?? ''] ?? 'plain';
  return (
    <>
      <p className="max-w-3xl border-l-2 border-border-strong pl-3 text-xl font-semibold leading-relaxed text-foreground sm:text-2xl">{brief.headline}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Tag tone={tone}><StanceIcon tone={tone} />整體 {STANCE[brief.overall_stance ?? ''] ?? brief.overall_stance}</Tag>
        <Tag>分析信心 {CONF[brief.confidence ?? ''] ?? brief.confidence}</Tag>
      </div>
    </>
  );
};

export const SectionCard: React.FC<{
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, actions, children }) => (
  <section className="border-t border-border-strong py-5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <h3 className="inline-flex items-center gap-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">
        {title}
      </h3>
      {actions}
    </div>
    {hint ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    <div className="mt-3">{children}</div>
  </section>
);

export const Empty: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <EmptyState className="py-6">{children ?? '這次沒有這一段內容。'}</EmptyState>
);

/** 來源分類標籤：文字為主，圖示輔助，不靠顏色分辨 */
export const CategoryTag: React.FC<{ item: ResolvedEvidence }> = ({ item }) => {
  const meta = EVIDENCE_CATEGORY[item.category];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Tag tone="plain" title={meta.origin}>
        {meta.label}
      </Tag>
      {item.computed ? (
        <Tag tone="plain" title="這個數字是由原始資料再計算一次得到的，不是機構直接發布的值。">
          本站計算
        </Tag>
      ) : null}
      {item.kind === 'guidance' ? (
        <Tag tone="warn" title="媒體轉述的公司展望或財測，不是公司實際公布的財務結果。">
          展望，非實際數字
        </Tag>
      ) : null}
    </span>
  );
};

interface EvidenceTagListProps {
  ids?: string[];
  index: EvidenceIndex;
  /** 目前亮著的證據 id */
  activeId?: string | null;
  onSelect?: (id: string) => void;
  /** 沒有任何可用來源時要不要顯示提醒 */
  warnWhenEmpty?: boolean;
  className?: string;
}

/**
 * 結論後面的來源標籤。顯示文字一律是可讀名稱（例如「09/03 交易資料」），
 * 原始 id 不顯示給使用者。
 *
 * 解析不到、或日期晚於基準日的引用不會變成可點擊來源，改成明確的缺漏標記。
 */
export const EvidenceTagList: React.FC<EvidenceTagListProps> = ({
  ids,
  index,
  activeId,
  onSelect,
  warnWhenEmpty,
  className,
}) => {
  const list = ids ?? [];
  const usable = list.filter((id) => index.usable(id));
  const broken = list.filter((id) => !index.usable(id));

  if (!list.length && !warnWhenEmpty) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-0', className)}>
      {usable.map((id) => {
        const item = index.resolve(id)!;
        const active = activeId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(id);
            }}
            aria-pressed={active}
            aria-label={`查看來源：${item.label}`}
            className={cn(
              'inline-flex min-h-11 max-w-full items-center gap-1 px-0.5 py-1 text-xs leading-5 underline underline-offset-4 decoration-border transition-colors duration-(--dur-flash)',
              active ? 'font-semibold text-foreground decoration-2' : 'text-muted-foreground hover:text-foreground hover:decoration-current',
            )}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}

      {broken.map((id) => {
        // 原始 id 是內部代號，不放進 title 或報讀文字
        const reason = index.resolve(id)
          ? '這筆來源的日期晚於分析基準日，已停用'
          : '在證據來源裡找不到這筆資料';
        return (
          <Badge key={id} tone="outline" className="border-dashed border-input leading-5 font-normal text-muted-foreground" title={reason}>
            <FileWarning size={11} aria-hidden />
            {index.resolve(id) ? '來源日期異常' : '來源缺漏'}
            <span className="sr-only">（{reason}）</span>
          </Badge>
        );
      })}

      {warnWhenEmpty && !usable.length && !broken.length ? (
        <span className="inline-flex items-center gap-1 text-xs leading-5 text-muted-foreground">
          <AlertTriangle size={11} aria-hidden />
          沒有附上來源，僅供參考
        </span>
      ) : null}
    </div>
  );
};
