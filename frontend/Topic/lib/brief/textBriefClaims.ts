import type { Brief, ClaimType } from '../types/textBrief';
import { FORWARD_VIEWS } from './textBriefLabels';

/** 未來看法沒有自己的 id，另外編一組 key */
export function forwardViewKey(key: string): string {
  return `fv:${key}`;
}

export interface ClaimRef {
  /** highlight 用的節點 key；除了未來看法之外都等於後端的 claim id */
  key: string;
  /** 所屬區塊的中文名，反查時要告訴使用者「這筆資料被哪一段用到」 */
  section: string;
  /** 摘要文字，反查列表用（不是完整句子時取最有辨識度的那一段） */
  text: string;
  claimType?: ClaimType | string;
  evidenceIds: string[];
}

/**
 * 走訪 brief 收集每個結論引用的證據，得到「結論 key → 結論資訊」對照表。
 * Map 的插入順序＝畫面上的先後順序，反查時可直接取第一個命中的節點。
 */
export function buildClaimIndex(brief: Brief | null | undefined): Map<string, ClaimRef> {
  const index = new Map<string, ClaimRef>();
  if (!brief) return index;

  const add = (ref: ClaimRef) => index.set(ref.key, ref);

  (brief.key_days ?? []).forEach((it) =>
    add({
      key: it.id,
      section: '關鍵交易日',
      text: `${it.date}　${it.what}`,
      evidenceIds: it.evidence_ids ?? [],
    })
  );
  const claimSections: [string, Brief['current_status']][] = [
    ['現在狀態', brief.current_status],
    ['正面因素', brief.positive_factors],
    ['負面因素', brief.negative_factors],
    ['資料矛盾', brief.source_divergences],
  ];
  claimSections.forEach(([section, items]) =>
    (items ?? []).forEach((it) =>
      add({
        key: it.id,
        section,
        text: it.text,
        claimType: it.claim_type,
        evidenceIds: it.evidence_ids ?? [],
      })
    )
  );
  (brief.risks ?? []).forEach((it) =>
    add({
      key: it.id,
      section: '情境風險',
      text: it.description,
      evidenceIds: it.evidence_ids ?? [],
    })
  );
  (brief.watch_points ?? []).forEach((it) =>
    add({
      key: it.id,
      section: '後續觀察',
      text: it.what_to_watch,
      evidenceIds: it.evidence_ids ?? [],
    })
  );
  FORWARD_VIEWS.forEach(([key, label]) => {
    const view = brief.forward_views?.[key];
    if (!view) return;
    if (view.invalidation) add({ key: `iv:${key}`, section: `${label}・重新評估條件`,
      text: view.invalidation, claimType: 'inference', evidenceIds: view.evidence_ids ?? [] });
    add({
      key: forwardViewKey(key),
      section: label,
      text: view.reason,
      evidenceIds: view.evidence_ids ?? [],
    });
  });
  return index;
}

/** 反查：這筆證據被哪些結論引用（順序＝畫面順序） */
export function claimsUsingEvidence(
  index: Map<string, ClaimRef>,
  evidenceId: string
): ClaimRef[] {
  return [...index.values()].filter((ref) => ref.evidenceIds.includes(evidenceId));
}
