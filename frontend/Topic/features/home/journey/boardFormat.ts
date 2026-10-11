/**
 * 首屏燈質列與 3D 螢幕上的數字：跟觀測台用同一組格式函式（fmtNum、signedText），兩邊顯示的數字一定一樣。
 * 純函式，不碰 DOM（單元測試在 journeyMode.test.ts）。
 */
import { fmtNum, signedText } from '@/lib/utils/format';
import { getValueTone, type ValueTone } from '@/lib/utils/tone';
import type { BeaconJourneyProps } from './types';

/** 還沒有大盤日期時，旅程文案與螢幕上的燈質列 */
export const CLOSE_DATA_NOTE = '最近儲存的收盤資料 · 非即時';

export interface BoardFigures {
  /** 收盤（fmtNum，有千分位） */
  close: string;
  /** 帶正負號的漲跌與百分比，例如「+122.25（+0.25%）」；沒有前一筆時是 null */
  change: string | null;
  /** 漲跌方向：紅漲綠跌，0 是中性 */
  tone: ValueTone;
  date: string;
}

/** 漲跌與相對前一筆的百分比，格式同觀測台大盤列與報價區：「+122.25（+0.25%）」（3D 螢幕也用這個） */
export function changeText(change: number | null, prev: number | null): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const pct = prev ? (change / prev) * 100 : null;
  return `${signedText(change)}${pct != null && Number.isFinite(pct) ? `（${signedText(pct, 2, '%')}）` : ''}`;
}

/** 大盤：收盤用 fmtNum（與觀測台、頁首一致），百分比相對前一筆收盤（close − change） */
export function boardFigures(board: BeaconJourneyProps['board']): BoardFigures | null {
  if (!board || !Number.isFinite(board.close)) return null;
  const change = board.change != null && Number.isFinite(board.change) ? board.change : null;
  return {
    close: fmtNum(board.close),
    change: changeText(change, change != null ? board.close - change : null),
    tone: getValueTone(change),
    date: board.date,
  };
}

/** 報價區的燈質列：「代號 · 產業 · 收盤 日期」，跟觀測台報價區同一個順序；沒有產業就略過 */
export function quoteCharacteristic(symbol: string, industry: string | null, date: string): string {
  return [symbol, industry, `收盤 ${date}`].filter(Boolean).join(' · ');
}
