/**
 * 海報版面「看板」的數字：跟觀測台用同一組格式函式（fmtNum、fmtPrice、signedText），兩邊顯示的數字一定一樣。
 * 純函式，不碰 DOM（單元測試在 journeyMode.test.ts）。
 */
import { signedText } from '@/components/common/LightEntry';
import { fmtNum, fmtPrice } from '@/lib/utils/format';
import { getValueTone, type ValueTone } from '@/lib/utils/tone';
import type { BeaconJourneyProps } from './types';

/** 還沒有大盤日期時，旅程文案與螢幕上的燈質列 */
export const CLOSE_DATA_NOTE = '最近儲存的收盤資料 · 非即時';

export interface BoardFigures {
  /** 收盤（加權指數用 fmtNum，有千分位；個股用 fmtPrice，兩位小數） */
  close: string;
  /** 帶正負號的漲跌與百分比，例如「+122.25（+0.25%）」；沒有前一筆時是 null */
  change: string | null;
  /** 漲跌方向：紅漲綠跌，0 是中性 */
  tone: ValueTone;
  date: string;
}

export interface MonitorFigures extends BoardFigures {
  name: string;
  symbol: string;
  /** 收盤序列（只留有限數值），給迷你走勢線 */
  closes: number[];
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

/** 選中的個股：收盤用 fmtPrice，漲跌是最後兩筆收盤相減（單日漲跌，跟觀測台報價面板同一個算法） */
export function monitorFigures(monitor: BeaconJourneyProps['monitor']): MonitorFigures | null {
  if (!monitor) return null;
  const closes = monitor.closes.filter((v) => Number.isFinite(v));
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const change = last - prev;
  return {
    name: monitor.name,
    symbol: monitor.symbol,
    close: fmtPrice(last),
    change: changeText(change, prev),
    tone: getValueTone(change),
    date: monitor.date,
    closes,
  };
}

/** 「40 檔 · 20 個產業」；任一個還沒載入時是 null */
export function countsText(stockCount: number | null, industryCount: number | null): string | null {
  if (stockCount == null || industryCount == null) return null;
  return `${stockCount.toLocaleString('zh-TW')} 檔 · ${industryCount.toLocaleString('zh-TW')} 個產業`;
}

/** 報價區的燈質列：「代號 · 產業 · 收盤 日期」，跟觀測台報價區同一個順序；沒有產業就略過 */
export function quoteCharacteristic(symbol: string, industry: string | null, date: string): string {
  return [symbol, industry, `收盤 ${date}`].filter(Boolean).join(' · ');
}
