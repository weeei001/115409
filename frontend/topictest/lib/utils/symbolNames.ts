/** 常用台股代號中文名（symbols API 未提供名稱時的 fallback） */
export const STOCK_NAMES: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2408': '南亞科',
  '2454': '聯發科',
  '2615': '萬海',
  '2881': '富邦金',
  '2882': '國泰金',
  '2303': '聯電',
  '2308': '台達電',
  '3711': '日月光投控',
  '2412': '中華電',
  '2886': '兆豐金',
  '2301': '光寶科',
  '2884': '玉山金',
  '2891': '中信金',
  '2892': '第一金',
  '3008': '大立光',
  '2382': '廣達',
  '2357': '華碩',
};

export function getStockDisplayName(symbol: string): string {
  return STOCK_NAMES[symbol] ?? symbol;
}
