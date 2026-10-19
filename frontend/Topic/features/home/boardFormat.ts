/**
 * 首屏燈質列的加權指數：跟觀測台用同一組格式函式（fmtNum、signedText），兩邊顯示的數字一定一樣。
 * 純函式，不碰 DOM（單元測試在 boardFormat.test.ts）。
 */
import { fmtNum, signedText } from '@/lib/utils/format';
import { getValueTone, type ValueTone } from '@/lib/utils/tone';

/** 大盤（TAIEX）最近一筆已儲存收盤：/stocks/benchmark/history */
export interface HeroBoard {
  close: number;
  change: number | null;
  date: string;
}

/** 還沒有大盤日期時的燈質列 */
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

/** 收盤用 fmtNum（與觀測台、頁首一致），漲跌格式同觀測台大盤列，百分比相對前一筆收盤（close − change） */
export function boardFigures(board: HeroBoard | null): BoardFigures | null {
  if (!board || !Number.isFinite(board.close)) return null;
  const change = board.change != null && Number.isFinite(board.change) ? board.change : null;
  const prev = change != null ? board.close - change : null;
  const pct = change != null && prev ? (change / prev) * 100 : null;
  return {
    close: fmtNum(board.close),
    change: change == null ? null : `${signedText(change)}${pct != null && Number.isFinite(pct) ? `（${signedText(pct, 2, '%')}）` : ''}`,
    tone: getValueTone(change),
    date: board.date,
  };
}
