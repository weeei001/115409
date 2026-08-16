import type { Brief } from '../types/textBrief';
import { FORWARD_VIEWS } from './textBriefLabels';

/** 未來看法沒有自己的 id，另外編一組 key */
export function forwardViewKey(key: string): string {
  return `fv:${key}`;
}

/**
 * 走訪 brief 收集每個結論引用的證據，得到「結論 key → 證據 id」對照表。
 * Map 的插入順序＝畫面上的先後順序，反查時可直接取第一個命中的節點。
 */
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
