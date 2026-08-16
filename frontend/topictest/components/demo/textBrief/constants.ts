import type { VerificationKey } from '../../../lib/demo/textBriefTypes';

/** 列舉值的中文標籤與分組已移到 lib/utils/textBriefLabels，與個股頁的 AI 分析抽屜共用 */
export {
  CONF,
  FIELD,
  FORWARD_VIEWS,
  GROUP,
  STANCE,
  STANCE_TONE,
  STATUS,
} from '../../../lib/utils/textBriefLabels';

/** 下拉選單裡的股票；`name` 供「新聞有沒有提到本檔」的字面比對使用 */
export const SYMBOLS: { value: string; name: string }[] = [
  { value: '2330', name: '台積電' },
  { value: '2317', name: '鴻海' },
  { value: '2454', name: '聯發科' },
  { value: '2881', name: '富邦金' },
  { value: '2408', name: '南亞科' },
  { value: '2615', name: '萬海' },
];

export const SYM_NAME: Record<string, string> = Object.fromEntries(
  SYMBOLS.map((s) => [s.value, s.name]),
);

export const STATUS_TONE: Record<string, string> = {
  verified: 'ok',
  limited: 'warn',
  unavailable: 'bad',
  unknown: 'plain',
};

/** 系統檢查結果的十個項目：全部為空才是 `verified` */
export const VERIFY: [VerificationKey, string][] = [
  ['filtered_evidence_ids', '引用了不存在的資料，已刪掉'],
  ['removed_item_ids', '違反法規限制，整項拿掉'],
  ['compliance_violations', '寫出不能講的話'],
  ['soft_compliance_hits', '用字太接近不能講的話'],
  ['unverified_numbers', '數字跟原始資料對不起來'],
  ['future_dated_items', '日期比分析日還晚，已剔除'],
  ['undercount_sections', '寫得比預期少'],
  ['truncated_sections', '寫太多，超過的已截掉'],
  ['simplified_chars', '出現簡體字'],
  ['jargon_hits', '出現難懂的術語'],
];

/** 進度提示的四個階段；依實測耗時推估，不是後端即時回報 */
export const STAGES = ['找新聞', '整理資料', 'AI 撰寫', '系統檢查'];

/** 固定的模型配色；依「本次載入到的模型名稱排序後的位置」指派，同一批資料每次都一樣 */
export const MODEL_COLORS = [
  '#1d4ed8',
  '#0f7b4f',
  '#b3261e',
  '#8a5300',
  '#7c3aed',
  '#0e7490',
  '#be185d',
  '#4d7c0f',
];

export const UNKNOWN_MODEL = '未知';
