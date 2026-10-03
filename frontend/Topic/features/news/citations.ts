import type { NewsEventAnalysis } from '@/lib/types/api';
import { groupImpactsByTarget } from './impactGroups';

/**
 * 內文引用句 ↔ 事件影響面板的對應，全部由既有的 evidence.quote 推得，不新增任何欄位。
 * 面板項目的 id：單筆影響 impact-<在 impacts 中的索引>、影響對象 group-<target_type:target_id>、未連到影響的事件 event-<key>。
 */
export const impactCitationId = (index: number) => `impact-${index}`;
export const groupCitationId = (key: string) => `group-${key}`;
export const eventCitationId = (key: string) => `event-${key}`;

export interface CitationIndex {
  /** 這個面板項目引用的原文句（單筆影響＝自己的原文依據＋所屬事件的原文依據） */
  quotesOf: (id: string) => string[];
  /** 內文某句引用屬於哪個面板項目：先找直接引用它的影響，再找事件被影響引用的，最後是未連到影響的事件 */
  ownerOf: (quote: string) => string | null;
}

const clean = (quotes: (string | null | undefined)[]) => Array.from(new Set(quotes.map((quote) => (quote ?? '').trim()).filter(Boolean)));

export function buildCitationIndex(analysis: NewsEventAnalysis | null | undefined): CitationIndex {
  const quotes = new Map<string, string[]>();
  const direct: [string, string[]][] = [];
  const viaEvent: [string, string[]][] = [];
  const events: [string, string[]][] = [];

  if (analysis && analysis.status === 'success') {
    const eventQuotes = (key: string) => clean(analysis.events.find((event) => event.key === key)?.evidence.map((item) => item.quote) ?? []);
    analysis.impacts.forEach((impact, index) => {
      const id = impactCitationId(index);
      const own = clean(impact.evidence.map((item) => item.quote));
      const context = eventQuotes(impact.event_key);
      quotes.set(id, clean([...own, ...context]));
      direct.push([id, own]);
      viaEvent.push([id, context]);
    });
    for (const group of groupImpactsByTarget(analysis.impacts)) {
      quotes.set(groupCitationId(group.key), clean(group.impacts.flatMap((impact) => quotes.get(impactCitationId(analysis.impacts.indexOf(impact))) ?? [])));
    }
    for (const event of analysis.events) {
      const id = eventCitationId(event.key);
      const own = clean(event.evidence.map((item) => item.quote));
      quotes.set(id, own);
      events.push([id, own]);
    }
  }

  return {
    quotesOf: (id) => quotes.get(id) ?? [],
    ownerOf: (quote) => {
      const target = quote.trim();
      for (const list of [direct, viaEvent, events]) {
        const hit = list.find(([, items]) => items.includes(target));
        if (hit) return hit[0];
      }
      return null;
    },
  };
}
