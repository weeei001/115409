import type { NewsImpact, NewsImpactDirection } from '@/lib/types/api';
import { impactTarget } from '@/lib/utils/newsImpact';

/** 同一個影響對象（大盤／某產業／某公司）底下的所有事件影響，只做畫面上的歸併，不改任何資料 */
export interface ImpactGroup {
  key: string;
  targetType: NewsImpact['target_type'];
  targetId: string;
  label: string;
  /** 依原始順序保留該對象的每一筆影響，一筆都不丟 */
  impacts: NewsImpact[];
  /**
   * 列表只顯示一個方向標籤：
   * - 全部同方向：就是那個方向
   * - 同時有正向與負向（或任一筆本身是正負並存）：mixed（正負並存，中性色）
   * - 方向不同但沒有正負對立（例如正向＋中性）：uncertain（方向未明，中性色）
   */
  direction: NewsImpactDirection;
  /** 該對象各筆影響中最高的重要性 */
  importance: NewsImpact['importance'];
  /** 不重複的事件數（event_key） */
  eventCount: number;
}

const IMPORTANCE_RANK: Record<NewsImpact['importance'], number> = { high: 3, medium: 2, low: 1 };

export function summarizeDirection(directions: NewsImpactDirection[]): NewsImpactDirection {
  const unique = Array.from(new Set(directions));
  if (unique.length === 1) return unique[0];
  if (unique.includes('mixed') || (unique.includes('positive') && unique.includes('negative'))) return 'mixed';
  return 'uncertain';
}

/** 依影響對象歸併（保留第一次出現的順序），供新聞列與事件影響面板共用 */
export function groupImpactsByTarget(impacts: NewsImpact[]): ImpactGroup[] {
  const groups = new Map<string, NewsImpact[]>();
  for (const impact of impacts) {
    const key = `${impact.target_type}:${impact.target_id}`;
    const list = groups.get(key);
    if (list) list.push(impact);
    else groups.set(key, [impact]);
  }
  return Array.from(groups, ([key, list]) => {
    const first = list[0];
    return {
      key,
      targetType: first.target_type,
      targetId: first.target_id,
      label: list.find((impact) => impact.target_name)?.target_name || impactTarget(first),
      impacts: list,
      direction: summarizeDirection(list.map((impact) => impact.direction)),
      importance: list.reduce((top, impact) => (IMPORTANCE_RANK[impact.importance] > IMPORTANCE_RANK[top] ? impact.importance : top), first.importance),
      eventCount: new Set(list.map((impact) => impact.event_key)).size,
    };
  });
}
