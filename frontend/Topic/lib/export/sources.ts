/** 匯出檔與圖片上標示的資料來源（後端抓取的官方來源，見 backend app/jobs/market/） */
const EXCHANGES = '臺灣證券交易所、證券櫃檯買賣中心';

export const DATA_SOURCES = {
  price: EXCHANGES,
  institutional: EXCHANGES,
  margin: EXCHANGES,
  foreignHolding: EXCHANGES,
  holdingLevels: '臺灣集中保管結算所',
  revenue: '公開資訊觀測站',
  statements: '公開資訊觀測站',
  valuation: EXCHANGES,
  dividend: EXCHANGES,
  indicators: '股海明燈依交易所收盤價計算',
} as const;

/** 匯出檔名與標題用的股票名稱：「台積電 2330」，查不到中文名只寫代號 */
export const stockExportLabel = (symbol: string, name: string | null | undefined): string => (name ? `${name} ${symbol}` : symbol);
