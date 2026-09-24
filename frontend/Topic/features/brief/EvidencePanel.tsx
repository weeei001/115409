import React, { useEffect, useRef } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Expandable } from '@/components/common/CollapsibleSection';
import type { ResolvedEvidence } from '@/lib/brief/textBriefEvidence';
import { useBriefHighlight } from './BriefHighlight';
import { CategoryTag, Empty } from './BriefAtoms';
import { EvidenceDetail } from './EvidenceDetail';

/** 每組預設顯示幾筆，其餘收在「展開更多」 */
const GROUP_PREVIEW = 3;

const EvidenceRow: React.FC<{ item: ResolvedEvidence }> = ({ item }) => {
  const { isEvidenceOn, toggleEvidence, bindEvidence } = useBriefHighlight();
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
      className={`border-b border-l-2 px-3 py-3 text-sm transition-[background-color,border-color,opacity] focus-visible:outline-2 focus-visible:outline-brand ${
        on
          ? 'border-border border-l-brand bg-muted'
          : `border-transparent hover:border-border hover:bg-muted/50`
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-foreground">{item.label}</span>
        {item.futureDated ? (
          <span className="text-[11px] text-muted-foreground">日期異常，已停用</span>
        ) : null}
        {on ? <span className="sr-only">（已選取）</span> : null}
      </div>
      <p className="mt-0.5 line-clamp-2 leading-6 text-subtle break-words">
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
              <h4 className="text-xs font-bold text-muted-foreground">{group.label}</h4>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {group.items.length} 筆
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {preview.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </div>
            {rest.length ? (
              <Expandable
                expandLabel={`展開更多 ${group.label}（${rest.length} 筆）`}
                collapseLabel="收起"
                className="mt-3"
                contentClassName="mt-1.5 space-y-1"
              >
                {rest.map((item) => (
                  <EvidenceRow key={item.id} item={item} />
                ))}
              </Expandable>
            ) : null}
          </div>
        );
      })}

      {limitations?.length ? (
        <div>
          <h4 className="text-xs font-bold text-muted-foreground">分析限制</h4>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-7 text-subtle">
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
        <p className="text-sm text-muted-foreground">
          這筆引用（{focus.id}）在證據目錄裡找不到對應資料。
        </p>
      );
    }
    return (
      <div>
        <button
          type="button"
          onClick={clear}
          className="mb-4 inline-flex items-center gap-1 py-1 text-xs font-semibold text-subtle transition-colors hover:border-brand/40 hover:text-brand-text"
        >
          <ArrowLeft size={12} aria-hidden />
          回到來源清單
        </button>
        <EvidenceDetail item={item} selectedClaim={focus.claimKey ? claims.get(focus.claimKey) : undefined} usedBy={claimsUsing(item.id)} onSelectClaim={toggleClaim} />
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
        <p className="text-xs text-muted-foreground">{ref?.section}</p>
        <p className="mt-0.5 text-sm font-semibold leading-7 text-foreground">
          {ref?.text}
        </p>
        <p className="mt-3 text-xs font-bold text-muted-foreground">
          這句話的引用依據（{usable.length}）
        </p>
        <div className="mt-1.5 space-y-1">
          {usable.map((id) => {
            const item = evidence.resolve(id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectEvidence(id, focus.key)}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-left transition-colors hover:border-brand/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-brand"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-foreground">
                    {item.label}
                  </span>
                  <CategoryTag item={item} />
                </span>
                <span className="mt-0.5 block line-clamp-2 text-sm leading-6 text-subtle break-words">
                  {item.summary}
                </span>
              </button>
            );
          })}
          {!usable.length ? (
            <p className="text-sm text-muted-foreground">
              這一項沒有可用的來源，只能當成待驗證的說法看。
            </p>
          ) : null}
          {broken.length ? (
            <p className="text-xs leading-6 text-muted-foreground">
              另有 {broken.length} 筆引用無法對應到證據目錄（{broken.join('、')}），已不顯示為來源。
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="inline-flex items-start gap-1.5 text-xs leading-6 text-muted-foreground">

        選取結論或來源，在這裡核對資料。
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
    <div className="rounded-lg bg-muted/50 p-5">
      <h3 className="inline-flex items-center gap-2 text-sm font-bold text-foreground">

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
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasFocus) return;
    const sheet = sheetRef.current;
    if (!sheet || !window.matchMedia('(max-width: 1023px)').matches) return;
    const previous = document.activeElement as HTMLElement | null;
    const parentDialog = sheet.parentElement?.closest('[role="dialog"]');
    const timer = window.setTimeout(() => sheet.querySelector<HTMLButtonElement>('button')?.focus(), 75);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !sheet.getClientRects().length) return;
      const controls = [...sheet.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')]
        .filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      event.stopPropagation();
      if (!sheet.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected && parentDialog?.contains(previous)) previous.focus();
      else parentDialog?.querySelector<HTMLButtonElement>('button')?.focus();
    };
  }, [hasFocus]);
  if (!hasFocus) return null;

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="證據詳情"
      className="fixed inset-x-0 bottom-0 z-[70] max-h-[78dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-[calc(1rem+var(--app-safe-area-bottom))] pt-3 shadow-raised lg:hidden"
    >
      <div className="sticky top-0 -mx-4 mb-2 flex items-center justify-between gap-2 border-b border-border bg-card px-4 pb-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-foreground">

          證據詳情
        </h3>
        <button
          type="button"
          onClick={clear}
          aria-label="關閉證據詳情"
          className="flex size-11 items-center justify-center rounded-full bg-muted text-subtle transition-colors hover:bg-accent hover:text-brand-text"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <FocusBody />
    </div>
  );
};
