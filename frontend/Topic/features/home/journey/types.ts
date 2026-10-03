/** 首頁旅程需要的真實資料；都來自現有的 lib/api 呼叫，載入前或失敗時是 null */
export interface BeaconJourneyProps {
  /** 旅程終點（觀測台）的元素 id；「直接看觀測台」捲到這裡並把焦點移過去 */
  terminalId: string;
  /** /stocks/info 的檔數與產業數 */
  stockCount: number | null;
  industryCount: number | null;
  /** 大盤（TAIEX）最近一筆已儲存收盤：/stocks/benchmark/history */
  board: { close: number; change: number | null; date: string } | null;
  /** 觀測室螢幕要畫的收盤序列（由舊到新）：/stocks/compare/multiple */
  monitor: { symbol: string; name: string; closes: number[]; date: string } | null;
}
