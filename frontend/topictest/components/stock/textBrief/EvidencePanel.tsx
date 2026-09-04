import React from 'react';
import { ArrowLeft, FileText, Info, X } from 'lucide-react';
import { ExpandableRegion } from '../../ExpandableRegion';
import type { ResolvedEvidence } from '../../../lib/utils/textBriefEvidence';
import { useBriefHighlight } from './BriefHighlight';
import { CategoryTag, Empty } from './BriefAtoms';
import { EvidenceDetail } from './EvidenceDetail';

/** 每組預設顯示幾筆，其餘收在「展開更多」 */
const GROUP_PREVIEW = 3;

const EvidenceRow: React.FC<{ item: ResolvedEvidence }> = ({ item }) => {
  const { isEvidenceOn, toggleEvidence, bindEvidence, hasFocus } = useBriefHighlight();
  const on = isEvidenceOn(item.id);
  return (
    <div
      ref={bindEvidence(item.id)}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      aria-label={`${item.label}：${item.summary}`}
      onClick={() => toggleEvidence(item.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleEvidence(item.id);
      }}
      className={`rounded-lg border border-l-4 px-2.5 py-2 text-sm cursor-pointer transition-[background-color,border-color,opacity] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        on
          ? 'border-brand/40 border-l-brand bg-brand/10'
          : `border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 ${
              hasFocus ? 'opacity-55' : ''
            }`
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-[var(--color-text-primary)]">{item.label}</span>
        {item.futureDated ? (
          <span className="text-[11px] text-[var(--color-text-muted)]">日期異常，已停用</span>
        ) : null}
        {on ? <span className="sr-only">（已選取）</span> : null}
      </div>
      <p className="mt-0.5 line-clamp-2 leading-6 text-[var(--color-text-secondary)] break-words">
        {item.summary}
      </p>
    </div>
  );
};

/** 依 交易資料／法人籌碼／長期位階／基本面／新聞 分組的完整目錄 */
export const EvidenceCatalog: React.FC<{ limitations?: string[] }> = ({ limitations }) => {
  const { evidence } = useBriefHighlight();

  if (!evidence.total) {
    return <Empty>這次沒有引用到任何原始資料。</Empty>;
  }

  return (
    <div className="space-y-5">
      {evidence.groups.map((group) => {
        const preview = group.items.slice(0, GROUP_PREVIEW);
        const rest = group.items.slice(GROUP_PREVIEW);
        return (
          <div key={group.key}>
            <div className="flex items-baseline gap-2">
              <h4 className="text-xs font-bold text-[var(--color-text-muted)]">{group.label}</h4>
              <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                {group.items.length} 筆
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {preview.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </div>
            {rest.length ? (
              <ExpandableRegion
                expandLabel={`展開更多 ${group.label}（${rest.length} 筆）`}
                collapseLabel="收起"
                panelClassName="mt-1.5 space-y-1"
              >
                {rest.map((item) => (
                  <EvidenceRow key={item.id} item={item} />
                ))}
              </ExpandableRegion>
            ) : null}
          </div>
        );
      })}

      {limitations?.length ? (
        <div>
          <h4 className="text-xs font-bold text-[var(--color-text-muted)]">分析限制</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-7 text-[var(--color-text-secondary)]">
            {limitations.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

/**
 * 焦點內容：沒選東西時給提示與目錄，選了結論就列出它的依據，
 * 選了證據就顯示完整詳情。桌機放右欄、手機放底部抽屜，共用這一份。
 */
const FocusBody: React.FC<{ compactCatalog?: boolean; limitations?: string[] }> = ({
  compactCatalog,
  limitations,
}) => {
  const { focus, evidence, claims, claimsUsing, selectEvidence, toggleClaim, clear } =
    useBriefHighlight();

  if (focus?.kind === 'evidence') {
    const item = evidence.resolve(focus.id);
    if (!item) {
      return (
        <p className="text-sm text-[var(--color-text-muted)]">
          這筆引用（{focus.id}）在證據目錄裡找不到對應資料。
        </p>
      );
    }
    return (
      <div>
        <button
          type="button"
          onClick={clear}
          className="mb-3 inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-brand/40 hover:text-brand cursor-pointer"
        >
          <ArrowLeft size={12} aria-hidden />
          回到來源清單
        </button>
        <EvidenceDetail item={item} usedBy={claimsUsing(item.id)} onSelectClaim={toggleClaim} />
      </div>
    );
  }

  if (focus?.kind === 'claim') {
    const ref = claims.get(focus.key);
    const ids = ref?.evidenceIds ?? [];
    const usable = ids.filter((id) => evidence.usable(id));
    const broken = ids.filter((id) => !evidence.usable(id));
    return (
      <div>
        <p className="text-xs text-[var(--color-text-muted)]">{ref?.section}</p>
        <p className="mt-0.5 text-sm font-semibold leading-7 text-[var(--color-text-primary)]">
          {ref?.text}
        </p>
        <p className="mt-3 text-xs font-bold text-[var(--color-text-muted)]">
          這句話的依據（{usable.length}）
        </p>
        <div className="mt-1.5 space-y-1">
          {usable.map((id) => {
            const item = evidence.resolve(id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectEvidence(id)}
                className="w-full rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-left transition-colors hover:border-brand/40 hover:bg-brand/5 cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {item.label}
                  </span>
                  <CategoryTag item={item} />
                </span>
                <span className="mt-0.5 block line-clamp-2 text-sm leading-6 text-[var(--color-text-secondary)] break-words">
                  {item.summary}
                </span>
              </button>
            );
          })}
          {!usable.length ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              這一項沒有可用的來源，只能當成待驗證的說法看。
            </p>
          ) : null}
          {broken.length ? (
            <p className="text-xs leading-6 text-[var(--color-text-muted)]">
              另有 {broken.length} 筆引用無法對應到證據目錄（{broken.join('、')}），已不顯示為來源。
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="inline-flex items-start gap-1.5 text-xs leading-6 text-[var(--color-text-muted)]">
        <Info size={13} aria-hidden className="mt-1 shrink-0" />
        點任一句結論，這裡會列出它的依據；點來源標籤或下面的項目，會反查有哪些結論用到它（Esc 取消）。
      </p>
      {compactCatalog ? (
        <div className="mt-3">
          <EvidenceCatalog limitations={limitations} />
        </div>
      ) : null}
    </div>
  );
};

/** 桌機右欄：跟著捲動、自己有內部滾動，不用在長 Modal 裡找來源 */
export const EvidenceRail: React.FC<{ limitations?: string[]; showCatalog?: boolean }> = ({
  limitations,
  showCatalog = true,
}) => (
  <div className="hidden lg:block lg:sticky lg:top-0">
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-card)]">
      <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
        <FileText size={15} className="text-brand" aria-hidden />
        證據詳情
      </h3>
      <div
        className="mt-3 max-h-[calc(100dvh-16rem)] overflow-y-auto pr-1"
        aria-live="polite"
        aria-atomic="false"
      >
        <FocusBody compactCatalog={showCatalog} limitations={limitations} />
      </div>
    </div>
  </div>
);

/** 手機底部抽屜：只有選了東西才出現，內容與桌機右欄相同 */
export const EvidenceSheet: React.FC = () => {
  const { hasFocus, clear } = useBriefHighlight();
  if (!hasFocus) return null;

  return (
    <div
      role="dialog"
      aria-label="證據詳情"
      className="fixed inset-x-0 bottom-0 z-[70] max-h-[78dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-elevated)] lg:hidden"
    >
      <div className="sticky top-0 -mx-4 mb-2 flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 pb-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)]">
          <FileText size={15} className="text-brand" aria-hidden />
          證據詳情
        </h3>
        <button
          type="button"
          onClick={clear}
          aria-label="關閉證據詳情"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] transition-colors hover:bg-brand/10 hover:text-brand cursor-pointer"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <FocusBody />
    </div>
  );
};
