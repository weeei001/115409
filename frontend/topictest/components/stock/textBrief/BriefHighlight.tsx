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
import { buildClaimMap } from '../../../lib/utils/textBriefClaims';

/**
 * 證據互相對照，也就是「為什麼」那一層：
 *   點結論 → 亮出它根據的原始資料
 *   點原始資料 → 反向亮出所有引用它的結論
 *   Esc → 取消
 *
 * highlight 狀態只是「結論 key → 證據 id」對照表加上目前焦點的純函式結果。
 */

export type Focus = { kind: 'claim'; key: string } | { kind: 'evidence'; id: string } | null;

interface HighlightValue {
  isClaimOn(key: string): boolean;
  isEvidenceOn(id: string): boolean;
  toggleClaim(key: string): void;
  toggleEvidence(id: string): void;
  bindClaim(key: string): (node: HTMLElement | null) => void;
  bindEvidence(id: string): (node: HTMLElement | null) => void;
  /** 目前是否有任何東西被選中，用來讓沒被選中的項目淡出 */
  hasFocus: boolean;
}

const HighlightContext = createContext<HighlightValue | null>(null);

export function useBriefHighlight(): HighlightValue {
  const ctx = useContext(HighlightContext);
  if (!ctx) throw new Error('useBriefHighlight 必須放在 <BriefHighlightProvider> 內');
  return ctx;
}

export const BriefHighlightProvider: React.FC<{
  brief: Brief | null | undefined;
  children: ReactNode;
}> = ({ brief, children }) => {
  const claimMap = useMemo(() => buildClaimMap(brief), [brief]);
  const [focus, setFocus] = useState<Focus>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  // 換一份分析就把 highlight 收乾淨
  useEffect(() => setFocus(null), [claimMap]);

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
      for (const id of claimMap.get(focus.key) ?? []) {
        const node = nodes.current.get(`ev:${id}`);
        if (node) {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
      }
      return;
    }
    for (const [key, ids] of claimMap) {
      if (!ids.includes(focus.id)) continue;
      const node = nodes.current.get(`claim:${key}`);
      if (node) {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
  }, [focus, claimMap]);

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
      return (claimMap.get(key) ?? []).includes(focus.id);
    };
    const isEvidenceOn = (id: string) => {
      if (!focus) return false;
      if (focus.kind === 'evidence') return focus.id === id;
      return (claimMap.get(focus.key) ?? []).includes(id);
    };
    return {
      isClaimOn,
      isEvidenceOn,
      // 再點一次已經亮著的東西就收起來
      toggleClaim: (key) => setFocus(isClaimOn(key) ? null : { kind: 'claim', key }),
      toggleEvidence: (id) => setFocus(isEvidenceOn(id) ? null : { kind: 'evidence', id }),
      bindClaim: bind('claim'),
      bindEvidence: bind('ev'),
      hasFocus: focus != null,
    };
  }, [focus, claimMap, bind]);

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
};

/** 結論引用到的證據 id，點下去反查那筆原始資料 */
export const EvidenceChips: React.FC<{ ids: string[] }> = ({ ids }) => {
  const { toggleEvidence, isEvidenceOn } = useBriefHighlight();
  if (!ids.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleEvidence(id);
          }}
          aria-label={`查看資料 ${id}`}
          className={`rounded px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors cursor-pointer ${
            isEvidenceOn(id)
              ? 'bg-brand text-white'
              : 'bg-brand/10 text-brand hover:bg-brand/20'
          }`}
        >
          {id}
        </button>
      ))}
    </div>
  );
};

/** 可點擊、會亮出對應原始資料的結論條目 */
export const ClaimRow: React.FC<{
  claimKey: string;
  ids?: string[];
  /** 排版由外部決定（關鍵交易日用格線），這裡只負責互動與選中樣式 */
  className?: string;
  children: ReactNode;
}> = ({ claimKey, ids, className, children }) => {
  const { isClaimOn, toggleClaim, bindClaim, hasFocus } = useBriefHighlight();
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
      className={`rounded-xl border px-3 py-2.5 cursor-pointer transition-[background-color,border-color,opacity] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        on
          ? 'border-brand/40 bg-brand/10'
          : `border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]/50 ${
              hasFocus ? 'opacity-55' : ''
            }`
      } ${className ?? ''}`}
    >
      {children}
      <EvidenceChips ids={ids ?? []} />
    </div>
  );
};
