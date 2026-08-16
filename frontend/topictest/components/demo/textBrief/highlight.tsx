import clsx from 'clsx';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { Brief } from '../../../lib/demo/textBriefTypes';
import styles from '../../../styles/textBriefDemo.module.css';
import { FORWARD_VIEWS } from './constants';

/**
 * 證據互相對照：
 *   點結論 → 亮出它引用的證據
 *   點證據 → 反向亮出所有引用它的結論
 *   Esc    → 取消
 *
 * 原本的單檔 DEMO 是邊 render 邊把節點註冊進陣列；這裡改成先從 brief 算出
 * 「結論 key → 證據 id」的對照表，highlight 只是這張表加上目前焦點的純函式結果。
 */

export type Focus = { kind: 'claim'; key: string } | { kind: 'evidence'; id: string } | null;

/** 走訪 brief 收集每個結論引用的證據；Map 的插入順序＝畫面上的先後順序 */
export function buildClaimMap(brief: Brief | null | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!brief) return map;

  const add = (key: string, ids?: string[]) => map.set(key, ids ?? []);
  const addAll = (items?: { id: string; evidence_ids?: string[] }[]) =>
    (items ?? []).forEach((it) => add(it.id, it.evidence_ids));

  addAll(brief.key_days);
  addAll(brief.current_status);
  addAll(brief.positive_factors);
  addAll(brief.negative_factors);
  addAll(brief.source_divergences);
  addAll(brief.risks);
  addAll(brief.watch_points);
  FORWARD_VIEWS.forEach(([key]) => {
    const view = brief.forward_views?.[key];
    if (view) add(forwardViewKey(key), view.evidence_ids);
  });
  return map;
}

/** 未來看法沒有自己的 id，另外編一組 key */
export function forwardViewKey(key: string): string {
  return `fv:${key}`;
}

interface HighlightValue {
  isClaimOn(key: string): boolean;
  isEvidenceOn(id: string): boolean;
  toggleClaim(key: string): void;
  toggleEvidence(id: string): void;
  bindClaim(key: string): (node: HTMLElement | null) => void;
  bindEvidence(id: string): (node: HTMLElement | null) => void;
}

const HighlightContext = createContext<HighlightValue | null>(null);

export function useHighlight(): HighlightValue {
  const ctx = useContext(HighlightContext);
  if (!ctx) throw new Error('useHighlight 必須放在 <HighlightProvider> 內');
  return ctx;
}

export function HighlightProvider({
  brief,
  children,
}: {
  brief: Brief | null | undefined;
  children: ReactNode;
}) {
  const claimMap = useMemo(() => buildClaimMap(brief), [brief]);
  const [focus, setFocus] = useState<Focus>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  // 換一份分析就把 highlight 收乾淨
  useEffect(() => setFocus(null), [claimMap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // 捲到第一個對應的節點，維持原本點擊後不用自己找的體驗
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
    [],
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
      // 再點一次已經亮著的東西就收起來，跟原本的行為一致
      toggleClaim: (key) => setFocus(isClaimOn(key) ? null : { kind: 'claim', key }),
      toggleEvidence: (id) => setFocus(isEvidenceOn(id) ? null : { kind: 'evidence', id }),
      bindClaim: bind('claim'),
      bindEvidence: bind('ev'),
    };
  }, [focus, claimMap, bind]);

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

/** 結論引用到的證據 id，點下去可反查 */
export function EvidenceChips({ ids }: { ids: string[] }) {
  const { toggleEvidence } = useHighlight();
  if (!ids.length) return null;
  return (
    <div className={styles.chips}>
      {ids.map((id) => (
        <span
          key={id}
          className={styles.chip}
          onClick={(e) => {
            e.stopPropagation();
            toggleEvidence(id);
          }}
        >
          {id}
        </span>
      ))}
    </div>
  );
}

/** 可點擊、會亮出對應證據的條目 */
export function ClaimItem({
  claimKey,
  ids,
  className,
  children,
}: {
  claimKey: string;
  ids?: string[];
  /** 預設 `.item`；關鍵交易日改用 `.kd` 的格線版面 */
  className?: string;
  children: ReactNode;
}) {
  const { isClaimOn, toggleClaim, bindClaim } = useHighlight();
  return (
    <div
      ref={bindClaim(claimKey)}
      className={clsx(className ?? styles.item, isClaimOn(claimKey) && styles.on)}
      onClick={() => toggleClaim(claimKey)}
    >
      {children}
      <EvidenceChips ids={ids ?? []} />
    </div>
  );
}
