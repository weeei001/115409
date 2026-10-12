/*
 * 表格匯出 CSV（專業版工具）：開頭幾列寫資料名稱、來源、期間與匯出時間，空一列後才是表格。
 * 數字照原始值輸出（不加千分位、負號用半形 -），試算表才能直接計算；單位寫在欄名。
 * UTF-8 加 BOM，Excel 開啟中文才不會亂碼。
 */

export type CsvCell = string | number | null | undefined;

export interface ExportMeta {
  /** 資料名稱，例如「台積電 2330 月營收」 */
  title: string;
  /** 資料來源 */
  source: string;
  /** 資料期間，例如「2024-10 → 2026-09」；沒有就省略 */
  period?: string | null;
}

export interface CsvTable extends ExportMeta {
  columns: string[];
  rows: CsvCell[][];
  /** 表格下方的說明（口徑、單位） */
  notes?: string[];
}

export const EXPORT_DISCLAIMER = '展示用途，非投資建議';

/** 試算表會把開頭是 = + - @ 的文字當公式執行：文字前面補一個單引號（數字不受影響） */
function escapeCell(cell: CsvCell): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  let text = cell;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const TAIPEI_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 「2026-10-12 14:30（台北時間）」 */
export const exportedAtText = (now: Date): string => `${TAIPEI_TIME.format(now)}（台北時間）`;

export function buildCsv(table: CsvTable, now = new Date()): string {
  const lines: CsvCell[][] = [
    ['股海明燈', table.title],
    ['資料來源', table.source],
    ...(table.period ? [['資料期間', table.period]] : []),
    ['匯出時間', exportedAtText(now)],
    ['說明', EXPORT_DISCLAIMER],
    [],
    table.columns,
    ...table.rows,
    ...(table.notes?.length ? [[], ...table.notes.map((note) => ['註', note])] : []),
  ];
  return `﻿${lines.map((line) => line.map(escapeCell).join(',')).join('\r\n')}\r\n`;
}

/** 檔名：去掉 Windows 不接受的字元，空白換底線 */
export function exportFileName(parts: Array<string | null | undefined>, extension: 'csv' | 'png'): string {
  const base = parts
    .filter((part): part is string => !!part && !!part.trim())
    .map((part) => part.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_'))
    .join('_');
  return `${base || '股海明燈'}.${extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 下載是非同步開始的，稍後才釋放
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(table: CsvTable, fileName: string): void {
  downloadBlob(new Blob([buildCsv(table)], { type: 'text/csv;charset=utf-8' }), fileName);
}
