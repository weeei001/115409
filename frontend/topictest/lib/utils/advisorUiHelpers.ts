import type { AdvisorAction, AdvisorPartialDataEvent, AdvisorReport } from '../types';
import type { PriceChartData } from '../types/priceChart';
import type { PricePositionSummary } from './advisorSignals';

export type DisplayDataset = 'institutional' | 'prices' | 'indicators';

export const DATASET_TITLES: Record<DisplayDataset, string> = {
  institutional: '法人籌碼',
  prices: '股價表現',
  indicators: '技術指標',
};

export const SNAPSHOT_SECTION_TITLE = '關鍵資料整理';

export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function getSummaryRows(dataset: DisplayDataset, card: AdvisorPartialDataEvent | null) {
  const summary = card?.summary ?? {};
  switch (dataset) {
    case 'institutional':
      return [
        { label: '統計天數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: '法人合計買賣超', value: summary.latest_total_net },
      ];
    case 'prices':
      return [
        { label: '統計天數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: '最新收盤價', value: summary.latest_close },
        { label: '單日漲跌', value: summary.latest_change },
      ];
    case 'indicators':
      return [
        { label: '統計天數', value: summary.rows },
        { label: '最新日期', value: summary.latest_date },
        { label: 'RSI 強弱指標', value: summary.latest_rsi10 },
        { label: 'MACD 動能', value: summary.latest_macd_hist },
      ];
  }
}

export function getColumns(dataset: DisplayDataset): Array<{ key: string; label: string }> {
  if (dataset === 'institutional') {
    return [
      { key: 'date', label: '日期' },
      { key: 'foreign_net', label: '外資買賣超' },
      { key: 'trust_net', label: '投信買賣超' },
      { key: 'dealer_net', label: '自營商買賣超' },
      { key: 'total_net', label: '法人合計' },
    ];
  }
  if (dataset === 'prices') {
    return [
      { key: 'date', label: '日期' },
      { key: 'close', label: '收盤價' },
      { key: 'change', label: '漲跌' },
      { key: 'volume', label: '成交量' },
    ];
  }
  return [
    { key: 'date', label: '日期' },
    { key: 'ma5', label: '5 日均線' },
    { key: 'ma20', label: '20 日均線' },
    { key: 'rsi10', label: 'RSI' },
    { key: 'macd_hist', label: 'MACD 動能' },
  ];
}

export function actionHintText(action: AdvisorAction): string {
  if (action === 'buy') return '買入｜趨勢轉強，可考慮分批布局';
  if (action === 'sell') return '賣出｜趨勢轉弱，建議降低部位';
  return '持平｜建議先觀察，不急著進場';
}

export function recommendationClass(action: AdvisorAction): string {
  if (action === 'buy') return 'bg-up-muted text-up border border-up/30';
  if (action === 'sell') return 'bg-down-muted text-down border border-down/30';
  return 'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]';
}

export function recommendationText(action: AdvisorAction): string {
  if (action === 'buy') return '買入';
  if (action === 'sell') return '賣出';
  return '觀望';
}

export function buildReasonList(report: AdvisorReport): string[] {
  const raw = [report.reasoning, report.summary, report.recommendation_text]
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
  const picked = raw.slice(0, 3);
  if (picked.length >= 2) return picked;
  if (picked.length === 1) return [picked[0], '—'];
  return ['—', '—'];
}

export function buildMaPositionSummary(params: {
  relativeToMA20: 'above' | 'below' | 'equal' | 'unknown';
  relativeToMA60: 'above' | 'below' | 'equal' | 'unknown';
}): string {
  const toText = (target: string, relation: 'above' | 'below' | 'equal' | 'unknown'): string => {
    if (relation === 'above') return `站上 ${target}`;
    if (relation === 'below') return `低於 ${target}`;
    if (relation === 'equal') return `等於 ${target}`;
    return `${target} 資料不足`;
  };
  const t20 = toText('MA20', params.relativeToMA20);
  const t60 = toText('MA60', params.relativeToMA60);
  return `目前收盤相對均線：${t20}，${t60}`;
}

export function getTrendSummaryText(summary: PricePositionSummary): string {
  if (summary.relativeToMA20 === 'above' && summary.relativeToMA60 === 'above') {
    return '股價 > MA20 > MA60，短中期趨勢偏多。';
  }
  if (summary.relativeToMA20 === 'below' && summary.relativeToMA60 === 'below') {
    return '股價 < MA20 < MA60，短中期趨勢偏空。';
  }
  return '股價與均線位置交錯，短中期趨勢偏整理。';
}

export function getMaStructureSummary(summary: PricePositionSummary): string {
  if (summary.relativeToMA20 === 'above' && summary.relativeToMA60 === 'above') {
    return '股價 > MA20 > MA60';
  }
  if (summary.relativeToMA20 === 'below' && summary.relativeToMA60 === 'below') {
    return '股價 < MA20 < MA60';
  }
  return '股價與均線交錯';
}

export function getVolumeInsight(priceChart: PriceChartData | null): {
  latest: number | null;
  ma20: number | null;
  ma60: number | null;
  ma20DiffPct: number | null;
  status: string;
} {
  if (!priceChart?.volume?.length || !priceChart.candles.length) {
    return { latest: null, ma20: null, ma60: null, ma20DiffPct: null, status: '無資料' };
  }
  const latestTime = priceChart.candles[priceChart.candles.length - 1].time;
  const volumePoint = priceChart.volume.find((item) => item.time === latestTime);
  const latest = volumePoint && Number.isFinite(volumePoint.value) ? volumePoint.value : null;
  const volumes = priceChart.volume.map((item) => item.value).filter((value) => Number.isFinite(value));
  const avg = (windowSize: number): number | null => {
    const segment = volumes.slice(-windowSize);
    if (!segment.length) return null;
    return segment.reduce((acc, curr) => acc + curr, 0) / segment.length;
  };
  const ma20 = avg(20);
  const ma60 = avg(60);
  const ma20DiffPct = latest !== null && ma20 !== null && ma20 > 0 ? ((latest - ma20) / ma20) * 100 : null;
  let status = '無資料';
  if (ma20DiffPct !== null) {
    if (Math.abs(ma20DiffPct) <= 5) status = '接近均量';
    else status = ma20DiffPct >= 0 ? '量增' : '量縮';
  }
  return { latest, ma20, ma60, ma20DiffPct, status };
}

export function normalizeReasonText(text: string): string {
  if (text.includes('型態分數是否達標未通過')) return '目前突破力道不足，趨勢還沒有明確延續。';
  if (text.includes('綜合趨勢分數是否達標未通過')) return '訊號信心偏低，價格可能仍在盤整區間。';
  if (text.includes('有效趨勢訊號不足')) return '尚未出現明確買盤確認，建議先觀察。';
  if (text.includes('尚未成有效突破結構')) return '尚未形成明確突破，建議等待更清楚的趨勢訊號。';
  return text;
}

export function getRiskToneText(
  report: AdvisorReport,
  summary: PricePositionSummary
): string {
  if (report.risk_notes && report.risk_notes.trim()) return normalizeReasonText(report.risk_notes);
  const maRisk =
    summary.relativeToMA20 === 'below' && summary.relativeToMA60 === 'below'
      ? '目前已跌破 MA20 與 MA60，中期結構轉弱風險較高。'
      : '若股價跌破 MA20，短線可能轉弱；若進一步跌破 MA60，代表中期結構轉差。';
  if (report.recommendation === 'buy') {
    return `訊號雖偏多，但仍需留意追價風險。${maRisk}因此建議分批布局，不宜一次重倉。`;
  }
  if (report.recommendation === 'sell') {
    return `目前結構偏弱，反彈若無法站回 MA20，弱勢延續機率較高。${maRisk}`;
  }
  return `目前訊號信心偏低，價格可能仍在盤整區間。${maRisk}因此目前不建議重倉，較適合觀察或小部位測試。`;
}
