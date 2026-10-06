/**
 * 新聞來源代碼 → 中文名稱，照抄後端 `backend/app/features/retrieval/common.py` 的 SOURCE_NAME_MAP、CMONEY_SOURCES
 * （openapi 的 News.source 是自由字串，沒有 enum）。比對前先轉小寫。
 */
const SOURCE_NAMES: Record<string, string> = {
  cnyes: '鉅亨網', ltn: '自由時報', moneydj: 'MoneyDJ',
  udn: '聯合新聞網', chinatimes: '中時新聞網', yahoo: 'Yahoo 財經',
};

const CMONEY_SOURCES = new Set([
  'tpshouse', 'cmoney', 'newsyoudeservetoknow', 'lewis', 'coneyresearcher',
  'cmoneyaicurator', 'josh', 'money', 'nico', 'cmoneyairesearcher',
  'ruanmuhhwa', 'star', 'captain', 'firebro', 'bubuypope', 'wealthonebro',
  'emily', 'yolandawu', 'alansays', 'jiahongxlinying', 'ugly', 'sharon',
  'laochien', 'edwin', 'jacklai', 'ericlu', 'stockmantalk', 'crawler_csv',
  'p', 'so2ym6jh',
]);

/** 對照不到就回 null：卡片與內文的 meta 列不顯示來源，副標改寫「新聞」 */
export function newsSourceName(source: string | null | undefined): string | null {
  const key = source?.trim().toLowerCase();
  if (!key) return null;
  if (SOURCE_NAMES[key]) return SOURCE_NAMES[key];
  return CMONEY_SOURCES.has(key) || /^\d+$/.test(key) ? 'CMoney 財經社群' : null;
}
