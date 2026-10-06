import React, { useState } from 'react';
import { ExternalLink, Quote } from 'lucide-react';
import { EVIDENCE_CATEGORY, type ResolvedEvidence } from '@/lib/brief/textBriefEvidence';
import type { ClaimRef } from '@/lib/brief/textBriefClaims';
import { ClaimTypeBadge } from './BriefAtoms';
import { taipeiDateTime } from '@/lib/utils/date';
import { textLinkClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const EXCERPT_LIMIT = 180;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-1.5 text-sm">
    <dt className="text-xs leading-6 text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words leading-6 text-foreground">{children}</dd>
  </div>
);

/**
 * 一筆證據的詳情：可讀名稱、來源類型、發布者、日期、原始數值與單位、
 * 新聞標題與摘錄、原始網址，以及哪些結論引用它。原始 id 不顯示。
 *
 * 只顯示有資料的欄位；缺少的來源資訊不顯示佔位提示。
 */
export const EvidenceDetail: React.FC<{
  item: ResolvedEvidence;
  selectedClaim?: ClaimRef;
  usedBy: ClaimRef[];
  onSelectClaim?: (key: string) => void;
}> = ({ item, selectedClaim, usedBy, onSelectClaim }) => {
  const [showFullExcerpt, setShowFullExcerpt] = useState(false);
  const category = EVIDENCE_CATEGORY[item.category];
  const excerpt = item.excerpt ?? '';
  const longExcerpt = excerpt.length > EXCERPT_LIMIT;
  const shownExcerpt =
    longExcerpt && !showFullExcerpt ? `${excerpt.slice(0, EXCERPT_LIMIT)}…` : excerpt;

  return (
    <div className="min-w-0">
      {selectedClaim ? <div className="mb-5 border-l-2 border-border-strong pl-3">
        <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">目前核對的結論 · {selectedClaim.section}</p>
        <p className="mt-1 text-sm leading-7">{selectedClaim.text}</p>
        <ClaimTypeBadge claimType={selectedClaim.claimType} />
        <p className="mt-1 text-xs text-muted-foreground">以下是這句話引用的資料；引用關係不代表結論已被證實。</p>
      </div> : null}
      <h4 className="text-base font-bold leading-7 text-foreground break-words">
        {item.label}
      </h4>
      {item.computed ? <p className="mt-1 text-xs text-muted-foreground">本站計算</p> : null}
      {item.kind === 'guidance' ? <p className="mt-1 text-xs text-muted-foreground">公司展望，非實際財報</p> : null}

      {item.futureDated ? (
        <p className="border-warning-border bg-warning-muted text-warning mt-3 border border-l-2 px-3 py-2 text-xs leading-6">
          這筆資料的日期晚於分析基準日，系統已不把它當成可用來源。
        </p>
      ) : null}

      {excerpt ? (
        <div className="mt-4 border-l-2 border-border pl-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Quote size={12} aria-hidden />
            來源摘要
          </p>
          <p className="mt-1.5 text-sm leading-7 text-subtle break-words">
            {shownExcerpt}
          </p>
          {longExcerpt ? (
            <button
              type="button"
              onClick={() => setShowFullExcerpt((v) => !v)}
              aria-expanded={showFullExcerpt}
              className={cn('inline-flex min-h-11 items-center text-xs font-semibold text-foreground', textLinkClass)}
            >
              {showFullExcerpt ? '收起摘錄' : '展開更多'}
            </button>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-3 divide-y divide-border">
        {item.metrics.length ? (
          <Row label={item.computed ? "計算結果" : "原始數值"}>
            <ul className="space-y-0.5">
              {item.metrics.map((metric) => (
                <li key={metric.name} className="flex flex-wrap gap-x-2">
                  <span className="text-muted-foreground">{metric.name}</span>
                  <span className="font-mono tabular-nums">{metric.value}</span>
                </li>
              ))}
            </ul>
          </Row>
        ) : null}

        <Row label="來源類型">
          {category.label}
          <span className="block text-xs leading-5 text-muted-foreground">
            {category.origin}
          </span>
        </Row>
        {item.dateText ? <Row label="日期／期間">{item.dateText}</Row> : null}
        {item.collectedAt ? <Row label="快照取得時間">{taipeiDateTime(item.collectedAt)}</Row> : null}
        {item.publishedAt ? <Row label="發布時間">{taipeiDateTime(item.publishedAt)}</Row> : null}
        {item.publicationBasis ? <Row label="時間判定">{item.publicationBasis}</Row> : null}
        {item.publisher ? <Row label="發布者">{item.publisher}</Row> : null}

        {item.title ? <Row label="新聞標題">{item.title}</Row> : null}

        {item.computed && item.calculation ? <Row label="計算依據">
          <p>{item.calculation.formula}，單位：{item.calculation.unit}</p>
          <ul>{item.calculation.inputs.map((input) => <li key={input.date}>{input.date}：{input.value}</li>)}</ul>
        </Row> : null}
        {item.savedVersionUrl ? <Row label="保存的原文">
          <a href={item.savedVersionUrl} target="_blank" rel="noopener noreferrer"
            className={cn('text-foreground', textLinkClass)}>
            查看此證據保存的新聞版本
          </a>
          <p className="text-xs text-muted-foreground">保存版本可供追溯，不代表現在仍為有效來源。</p>
        </Row> : null}
        {item.url ? <Row label="原始網址">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('inline-flex max-w-full items-center gap-1 text-foreground break-all', textLinkClass)}
          >
            <ExternalLink size={13} aria-hidden className="shrink-0 text-muted-foreground" />
            <span className="truncate">{item.url}</span>
          </a>
        </Row> : null}
      </dl>

      {usedBy.length ? <div className="mt-4">
        <p className="text-xs font-semibold text-muted-foreground">
          引用這筆資料的結論（{usedBy.length}）
        </p>
          <ul className="mt-1.5 space-y-1">
            {usedBy.map((ref) => (
              <li key={ref.key}>
                {onSelectClaim ? <button
                  type="button"
                  onClick={() => onSelectClaim?.(ref.key)}
                  className="lamp-row w-full border-b border-border px-2 py-3 text-left text-sm leading-6 focus-lamp-inset"
                >
                  <span className="block text-xs text-muted-foreground">{ref.section}</span>
                  <span className="line-clamp-2 text-foreground">{ref.text}</span>
                </button> : <p className="text-sm leading-6"><span className="block text-xs text-muted-foreground">{ref.section}</span>{ref.text}</p>}
              </li>
            ))}
          </ul>
      </div> : null}


    </div>
  );
};
