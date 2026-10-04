import React from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Expandable } from '@/components/common/CollapsibleSection';
import { LedgerPanel } from '@/components/common/Ledger';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/lib/hooks/useClientEnv';
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
      data-selected={on ? 'true' : undefined}
      aria-label={`${item.label}：${item.summary}`}
      onClick={() => toggleEvidence(item.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleEvidence(item.id);
      }}
      className="lamp-row border-b border-border px-3 py-3 text-sm"
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
              <h4 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{group.label}</h4>
              <span className="characteristic">
                {group.items.length} 筆
              </span>
            </div>
            <div className="mt-1.5 border-t border-border">
              {preview.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </div>
            {rest.length ? (
              <Expandable
                expandLabel={`展開更多 ${group.label}（${rest.length} 筆）`}
                collapseLabel="收起"
                className="mt-3"
                contentClassName="mt-1.5 border-t border-border"
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
          <h4 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">分析限制</h4>
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
          className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-subtle transition-colors duration-(--dur-flash) hover:text-foreground"
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
        <p className="mt-3 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">
          這句話的引用依據（{usable.length}）
        </p>
        <div className="mt-1.5 border-t border-border">
          {usable.map((id) => {
            const item = evidence.resolve(id)!;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectEvidence(id, focus.key)}
                className="lamp-row w-full border-b border-border px-2.5 py-2.5 text-left focus-lamp-inset"
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
    <LedgerPanel framed>
      <h3 className="border-b border-border-strong pb-2 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">
        證據詳情
      </h3>
      <div
        className="mt-3 max-h-[calc(100dvh-16rem)] overflow-y-auto pr-1"
        aria-live="polite"
        aria-atomic="false"
      >
        <FocusBody compactCatalog={showCatalog} limitations={limitations} />
      </div>
    </LedgerPanel>
  </div>
);

/**
 * 手機底部抽屜（lg 以下）：只有選了東西才出現，內容與桌機右欄相同。
 * 用 ui/sheet：焦點鎖定、Esc、捲動鎖定與關閉後焦點回原處都交給 Radix（疊在 AI 分析抽屜上方）。
 */
export const EvidenceSheet: React.FC = () => {
  const { hasFocus, clear } = useBriefHighlight();
  const isMobile = useIsMobile();
  return (
    <Sheet open={hasFocus && isMobile} onOpenChange={(open) => { if (!open) clear(); }}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[78dvh] gap-0 overflow-y-auto border-border-strong bg-card px-4 pt-3 pb-[calc(1rem+var(--app-safe-area-bottom))] lg:hidden"
      >
        <div className="sticky top-0 -mx-4 mb-2 flex items-center justify-between gap-2 border-b bg-card px-4 pb-2">
          <SheetTitle className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">證據詳情</SheetTitle>
          <SheetClose asChild>
            <Button type="button" variant="outline" size="icon" aria-label="關閉證據詳情" className="text-subtle hover:text-foreground">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">所選論點或來源的原始資料</SheetDescription>
        <FocusBody />
      </SheetContent>
    </Sheet>
  );
};
