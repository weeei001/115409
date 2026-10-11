import type { Brief, NewsSupport } from '../types/textBrief';
import type { EvidenceGroup, EvidenceIndex } from './textBriefEvidence';

interface Cites {
  evidence_ids?: string[];
  news_support?: NewsSupport[];
}

function citing(brief: Brief): Cites[] {
  return [
    ...(brief.current_status ?? []), ...(brief.positive_factors ?? []), ...(brief.negative_factors ?? []),
    ...(brief.source_divergences ?? []), ...(brief.risks ?? []), ...(brief.watch_points ?? []),
    ...(brief.key_days ?? []), ...Object.values(brief.forward_views ?? {}).filter((view) => view != null),
  ];
}

/** 報告裡每一項的依據：可用證據的名稱，加上引用了卻不能用的筆數（目錄查不到或日期晚於基準日） */
export function citationLabels(ids: string[] | undefined, evidence: EvidenceIndex): { labels: string[]; unusable: number } {
  const unique = [...new Set(ids ?? [])];
  return {
    labels: unique.filter((id) => evidence.usable(id)).map((id) => evidence.resolve(id)!.label),
    unusable: unique.filter((id) => !evidence.usable(id)).length,
  };
}

export interface ReportAppendix {
  /** 被引用、而且可用的證據，照證據來源分頁的分組順序 */
  groups: EvidenceGroup[];
  /** 目錄裡可用、但這份分析沒有引用的筆數 */
  uncited: number;
  /** 引用了卻不能用的筆數 */
  unusable: number;
}

/** 紙本報告只附被引用的資料；完整目錄（例如 40 個交易日）留在網頁版的「證據來源」 */
export function reportAppendix(brief: Brief, evidence: EvidenceIndex): ReportAppendix {
  const cited = new Set(citing(brief).flatMap((item) => [
    ...(item.evidence_ids ?? []), ...(item.news_support ?? []).map((support) => support.evidence_id),
  ]));
  const groups = evidence.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => cited.has(item.id) && evidence.usable(item.id)) }))
    .filter((group) => group.items.length > 0);
  const shown = groups.reduce((sum, group) => sum + group.items.length, 0);
  const usable = evidence.groups.reduce((sum, group) => sum + group.items.filter((item) => evidence.usable(item.id)).length, 0);
  return { groups, uncited: usable - shown, unusable: [...cited].filter((id) => !evidence.usable(id)).length };
}
