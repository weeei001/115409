import type { TextBriefResponse } from '../types/textBrief';
import { taipeiDateTime } from '../utils/date';
import type { EvidenceIndex } from './textBriefEvidence';

export interface ProvenanceRow {
  label: string;
  value: string;
  /** 長的文字（資料清單、新聞來源）佔兩欄 */
  wide?: boolean;
  /** 模型名稱、版本這類代碼用等寬字 */
  mono?: boolean;
}

/**
 * 這份分析怎麼產生的：日期、模型、分析版本、用了哪些資料、有沒有參考過去的檢討。
 * 全部取自後端回應與證據目錄，沒有的項目寫「未提供」，不另外推測。
 */
export function briefProvenance(data: TextBriefResponse, evidence: EvidenceIndex): ProvenanceRow[] {
  const used = evidence.groups
    .map((group) => `${group.label} ${group.items.length} ${group.key === 'news' ? '則' : '筆'}`)
    .join('、');
  const news = evidence.groups.find((group) => group.key === 'news')?.items ?? [];
  const publishers = [...new Set(news.map((item) => item.publisher).filter((name): name is string => Boolean(name)))];
  const rows: ProvenanceRow[] = [
    { label: '分析基準日', value: data.as_of_date },
    { label: '行情截至', value: data.price_as_of_date ?? '未提供' },
    { label: '新聞截止', value: data.news_cutoff_date ?? data.as_of_date },
    { label: '產生時間', value: data.generated_at ? taipeiDateTime(data.generated_at) : '未提供' },
    { label: '模型', value: data.generated_by || '未提供', mono: true },
    { label: '分析版本', value: data.analysis_revision || '未提供', mono: true },
    { label: '使用資料', value: used || '未提供', wide: true },
  ];
  if (news.length) rows.push({ label: '新聞來源', value: publishers.length ? publishers.join('、') : '未標示媒體', wide: true });
  if (data.past_review_count != null) {
    rows.push({
      label: '過去檢討',
      value: data.past_review_count > 0 ? `參考 ${data.past_review_count} 則已到期判斷的檢討` : '還沒有已到期判斷的檢討',
      wide: true,
    });
  }
  return rows;
}
