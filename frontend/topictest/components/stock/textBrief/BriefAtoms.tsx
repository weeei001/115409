import React from 'react';
import { AlertTriangle, FileWarning, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import type { Direction } from '../../../lib/types/textBrief';
import { claimTypeMeta, type BriefTone } from '../../../lib/utils/textBriefLabels';
import type { EvidenceIndex, ResolvedEvidence } from '../../../lib/utils/textBriefEvidence';
import { EVIDENCE_CATEGORY } from '../../../lib/utils/textBriefEvidence';

/**
 * AI 投資分析共用的顯示元件。摘要卡與完整分析都吃這一套，
 * 所以標籤樣式、來源標籤的可用性判斷只有一份。
 */

export const TONE_CLASS: Record<BriefTone, string> = {
  ok: 'border-up/25 bg-up-muted text-up-emphasis',
  bad: 'border-down/25 bg-down-muted text-down-emphasis',
  warn: 'ui-alert-warning',
  info: 'border-brand/30 bg-brand/10 text-brand',
  plain:
    'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]',
};

export const Tag: React.FC<{
  tone?: BriefTone;
  title?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'plain', title, className, children }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]} ${className ?? ''}`}
  >
    {children}
  </span>
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
  const cls = positive ? 'text-up' : negative ? 'text-down' : 'text-[var(--color-text-muted)]';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${cls}`}>
      <Icon size={13} aria-hidden />
      {label ? <span>{label}</span> : null}
    </span>
  );
};

export const SectionCard: React.FC<{
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, actions, children }) => (
  <section className="border-t border-[var(--color-border)] py-5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
        {title}
      </h3>
      {actions}
    </div>
    {hint ? <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{hint}</p> : null}
    <div className="mt-3">{children}</div>
  </section>
);

export const Empty: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-[var(--color-text-muted)]">{children ?? '這次沒有這一段內容。'}</p>
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
        <Tag tone="warn" title="媒體轉述的公司展望或財測，不是已實現的財務結果。">
          展望，非已實現數據
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
 * 原始 id 只放在 title 與證據詳情的小字裡。
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
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0 ${className ?? ''}`}>
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
            title={`原始代號 ${id}`}
            className={`inline-flex max-w-full items-center gap-1 px-0.5 py-1 text-xs leading-5 underline underline-offset-4 decoration-[var(--color-border)] transition-colors cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              active
                ? 'font-semibold text-[var(--color-text-primary)] decoration-2'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:decoration-current'
            }`}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}

      {broken.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[11px] leading-5 text-[var(--color-text-muted)]"
          title={
            index.resolve(id)
              ? `原始代號 ${id}：資料日期晚於分析基準日，已停用`
              : `原始代號 ${id}：在證據目錄中找不到對應資料`
          }
        >
          <FileWarning size={11} aria-hidden />
          {index.resolve(id) ? '來源日期異常' : '來源缺漏'}
        </span>
      ))}

      {warnWhenEmpty && !usable.length && !broken.length ? (
        <span className="inline-flex items-center gap-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
          <AlertTriangle size={11} aria-hidden />
          沒有附上來源，僅供參考
        </span>
      ) : null}
    </div>
  );
};
