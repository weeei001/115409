import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Brief } from '../../../lib/types/textBrief';
import { buildClaimIndex, claimsUsingEvidence, type ClaimRef } from '../../../lib/utils/textBriefClaims';
import type { EvidenceIndex } from '../../../lib/utils/textBriefEvidence';
import { EvidenceTagList } from './BriefAtoms';

/**
 * 雙向反查，也就是「為什麼」那一層：
 *   點結論 → 亮出它引用的證據
 *   點證據 → 反向亮出所有引用它的結論
 *   Esc / 再點一次 → 取消
 *
 * highlight 狀態只是「結論 → 證據」對照表加上目前焦點的純函式結果。
 */

export type Focus = { kind: 'claim'; key: string } | { kind: 'evidence'; id: string } | null;

interface HighlightValue {
  evidence: EvidenceIndex;
  claims: Map<string, ClaimRef>;
  focus: Focus;
  isClaimOn(key: string): boolean;
  isEvidenceOn(id: string): boolean;
  toggleClaim(key: string): void;
  toggleEvidence(id: string): void;
  /** 直接切到某筆證據（列表點選用，不做 toggle） */
  selectEvidence(id: string): void;
  clear(): void;
  bindClaim(key: string): (node: HTMLElement | null) => void;
  bindEvidence(id: string): (node: HTMLElement | null) => void;
  /** 目前是否有任何東西被選中，用來讓沒被選中的項目淡出 */
  hasFocus: boolean;
  activeEvidenceId: string | null;
  claimsUsing(id: string): ClaimRef[];
}

const HighlightContext = createContext<HighlightValue | null>(null);

export function useBriefHighlight(): HighlightValue {
  const ctx = useContext(HighlightContext);
  if (!ctx) throw new Error('useBriefHighlight 必須放在 <BriefHighlightProvider> 內');
  return ctx;
}

export const BriefHighlightProvider: React.FC<{
  brief: Brief | null | undefined;
  evidence: EvidenceIndex;
  /** 從摘要卡點來源標籤進來時，先亮那一筆 */
  initialEvidenceId?: string | null;
  children: ReactNode;
}> = ({ brief, evidence, initialEvidenceId, children }) => {
  const claims = useMemo(() => buildClaimIndex(brief), [brief]);
  // 摘要卡帶進來的證據要在第一次 render 就亮著，不要先閃一下沒選中的樣子
  const [focus, setFocus] = useState<Focus>(() =>
    initialEvidenceId && evidence.usable(initialEvidenceId)
      ? { kind: 'evidence', id: initialEvidenceId }
      : null
  );
  const nodes = useRef(new Map<string, HTMLElement>());

  // 換一份分析就把 highlight 收乾淨
  useEffect(() => setFocus(null), [claims]);

  // 之後 id 再變動（同一個抽屜再從摘要卡點別筆）也要跟著切
  const lastInitial = useRef(initialEvidenceId);
  useEffect(() => {
    if (initialEvidenceId === lastInitial.current) return;
    lastInitial.current = initialEvidenceId;
    if (initialEvidenceId && evidence.usable(initialEvidenceId)) {
      setFocus({ kind: 'evidence', id: initialEvidenceId });
    }
  }, [initialEvidenceId, evidence]);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      // 抽屜本身也吃 Esc（關閉），所以有 highlight 時先攔下來只收 highlight
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFocus(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [focus]);

  // 捲到第一個對應的節點，點完不用自己找
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === 'claim') {
      for (const id of claims.get(focus.key)?.evidenceIds ?? []) {
        const node = nodes.current.get(`ev:${id}`);
        if (node) {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
      }
      return;
    }
    for (const ref of claims.values()) {
      if (!ref.evidenceIds.includes(focus.id)) continue;
      const node = nodes.current.get(`claim:${ref.key}`);
      if (node) {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
  }, [focus, claims]);

  const bind = useCallback(
    (prefix: string) => (key: string) => (node: HTMLElement | null) => {
      if (node) nodes.current.set(`${prefix}:${key}`, node);
      else nodes.current.delete(`${prefix}:${key}`);
    },
    []
  );

  const value = useMemo<HighlightValue>(() => {
    const isClaimOn = (key: string) => {
      if (!focus) return false;
      if (focus.kind === 'claim') return focus.key === key;
      return (claims.get(key)?.evidenceIds ?? []).includes(focus.id);
    };
    const isEvidenceOn = (id: string) => {
      if (!focus) return false;
      if (focus.kind === 'evidence') return focus.id === id;
      return (claims.get(focus.key)?.evidenceIds ?? []).includes(id);
    };
    return {
      evidence,
      claims,
      focus,
      isClaimOn,
      isEvidenceOn,
      // 再點一次已經亮著的東西就收起來
      toggleClaim: (key) => setFocus(isClaimOn(key) ? null : { kind: 'claim', key }),
      toggleEvidence: (id) =>
        setFocus(focus?.kind === 'evidence' && focus.id === id ? null : { kind: 'evidence', id }),
      selectEvidence: (id) => setFocus({ kind: 'evidence', id }),
      clear: () => setFocus(null),
      bindClaim: bind('claim'),
      bindEvidence: bind('ev'),
      hasFocus: focus != null,
      activeEvidenceId: focus?.kind === 'evidence' ? focus.id : null,
      claimsUsing: (id) => claimsUsingEvidence(claims, id),
    };
  }, [focus, claims, evidence, bind]);

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
};

/**
 * 可點擊、會亮出對應證據的結論條目。
 * 選中狀態同時有左側色條（形狀）與底色，不只靠顏色表示。
 */
export const ClaimRow: React.FC<{
  claimKey: string;
  ids?: string[];
  /** 沒有任何來源時要不要提醒（observation 一定要提醒） */
  warnWhenEmpty?: boolean;
  className?: string;
  children: ReactNode;
}> = ({ claimKey, ids, warnWhenEmpty, className, children }) => {
  const { isClaimOn, toggleClaim, bindClaim, hasFocus, evidence, activeEvidenceId, selectEvidence } =
    useBriefHighlight();
  const on = isClaimOn(claimKey);
  return (
    <div
      ref={bindClaim(claimKey)}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={() => toggleClaim(claimKey)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleClaim(claimKey);
      }}
      className={`rounded-xl border border-l-4 px-3 py-2.5 cursor-pointer transition-[background-color,border-color,opacity] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        on
          ? 'border-brand/40 border-l-brand bg-brand/10'
          : `border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 ${
              hasFocus ? 'opacity-55' : ''
            }`
      } ${className ?? ''}`}
    >
      {children}
      <EvidenceTagList
        ids={ids}
        index={evidence}
        activeId={activeEvidenceId}
        onSelect={selectEvidence}
        warnWhenEmpty={warnWhenEmpty}
        className="mt-2"
      />
      {on ? <span className="sr-only">（已選取，右側顯示這句話的依據）</span> : null}
    </div>
  );
};
