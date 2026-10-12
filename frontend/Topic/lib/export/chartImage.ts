import { getChartPalette } from '../charts/theme';
import { EXPORT_DISCLAIMER, exportedAtText, type ExportMeta } from './csv';

/*
 * 圖表存成圖片（專業版工具）：把圖表畫面加上標題、資料期間、來源與匯出時間，輸出 PNG。
 * 底色與字色跟著目前的晨海／夜海主題（取自 lib/charts/theme.ts）。
 */

export type ChartImageSource = HTMLCanvasElement | HTMLImageElement;

/** ECharts 圖表 → 加上標題與來源的 PNG（getDataURL 以 2 倍像素輸出） */
export async function echartsImage(chart: { getDataURL: (opts: { type: 'png'; pixelRatio: number; backgroundColor: string }) => string }, meta: ExportMeta, isDark: boolean): Promise<Blob> {
  const image = await loadImage(chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: getChartPalette(isDark).tooltipBg }));
  return composeChartImage(image, meta, { isDark, scale: 2 });
}

/** ECharts 的 getDataURL 結果 → 可畫進 canvas 的圖 */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Chart image failed to load'));
    image.src = dataUrl;
  });
}

/** 依可用寬度把「a · b · c」斷成數行，只在分隔點換行 */
export function wrapSegments(segments: string[], maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const segment of segments) {
    const next = current ? `${current} · ${segment}` : segment;
    if (current && measure(next) > maxWidth) {
      lines.push(current);
      current = segment;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 頁面實際用的介面字族（next/font 產生的名稱），canvas 才畫得出同一套字 */
function pageFontFamily(): string {
  try {
    return getComputedStyle(document.body).fontFamily || "'Noto Sans TC', sans-serif";
  } catch {
    return "'Noto Sans TC', sans-serif";
  }
}

export async function composeChartImage(
  source: ChartImageSource,
  meta: ExportMeta,
  { isDark, scale = 2, now = new Date() }: { isDark: boolean; scale?: number; now?: Date },
): Promise<Blob> {
  const palette = getChartPalette(isDark);
  const family = pageFontFamily();
  const pad = 24 * scale;
  const chartWidth = source.width;
  const chartHeight = source.height;
  const width = chartWidth + pad * 2;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');

  const titleFont = `700 ${18 * scale}px ${family}`;
  const noteFont = `400 ${12 * scale}px ${family}`;
  context.font = noteFont;
  const footer = wrapSegments(
    [`資料來源：${meta.source}`, `匯出 ${exportedAtText(now)}`, `股海明燈 · ${EXPORT_DISCLAIMER}`],
    width - pad * 2,
    (text) => context.measureText(text).width,
  );
  const titleHeight = 26 * scale;
  const lineHeight = 18 * scale;
  const header = titleHeight + (meta.period ? lineHeight : 0) + 12 * scale;
  const footerHeight = 12 * scale + footer.length * lineHeight;
  canvas.width = width;
  canvas.height = pad + header + chartHeight + footerHeight + pad;

  context.fillStyle = palette.tooltipBg;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'top';

  let y = pad;
  context.fillStyle = palette.text;
  context.font = titleFont;
  context.fillText(meta.title, pad, y);
  y += titleHeight;
  if (meta.period) {
    context.font = noteFont;
    context.fillStyle = palette.tickMuted;
    context.fillText(`資料期間 ${meta.period}`, pad, y);
    y += lineHeight;
  }
  y += 12 * scale;

  context.drawImage(source, pad, y, chartWidth, chartHeight);
  y += chartHeight + 6 * scale;

  context.fillStyle = palette.grid;
  context.fillRect(pad, y, width - pad * 2, Math.max(1, scale / 2));
  y += 6 * scale;
  context.font = noteFont;
  context.fillStyle = palette.tickMuted;
  for (const line of footer) {
    context.fillText(line, pad, y);
    y += lineHeight;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Chart image export failed'))), 'image/png');
  });
}
