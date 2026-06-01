import type {
  StockBehaviorDataInventory,
  StockBehaviorInventoryItem,
} from '../types/stockBehavior';
import {
  fmtInstitutionalShares,
  fmtPrice,
  fmtVolumeShort,
} from './format';

export type InventoryCategory = 'price_volume' | 'chip' | 'technical' | 'news';

const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  price_volume: '股價量能',
  chip: '法人籌碼',
  technical: '技術指標',
  news: '新聞參考',
};

export function categoryLabel(category: InventoryCategory): string {
  return CATEGORY_LABELS[category];
}

/** field → 中文標籤；涵蓋本期 JSON 出現的所有 field，找不到時保留原 key。 */
export const INVENTORY_FIELD_LABELS: Record<string, string> = {
  // price_volume
  close: '收盤價',
  open: '開盤價',
  high: '最高價',
  low: '最低價',
  volume_shares: '成交量',
  volume_ma5: '五日均量',
  volume_ma20: '二十日均量',
  // chip
  foreign_net: '外資單日淨買賣',
  foreign_net_10d_sum: '外資近 10 日累計',
  trust_net: '投信單日淨買賣',
  dealer_net: '自營商單日淨買賣',
  // technical
  rsi_5: '五日 RSI',
  rsi_10: '十日 RSI',
  kd_k: 'KD-K',
  kd_d: 'KD-D',
  macd_diff: 'MACD DIF',
  macd_dea: 'MACD DEA',
  macd_histogram: 'MACD 柱狀',
  ma5: '五日均線',
  ma10: '十日均線',
  ma20: '二十日均線',
  ma60: '六十日均線',
  ma120: '一二〇日均線',
  boll_mid20: '布林中線',
  boll_upper20: '布林上緣',
  boll_lower20: '布林下緣',
  // news
  title: '新聞標題',
};

export function inventoryFieldLabel(field: string): string {
  return INVENTORY_FIELD_LABELS[field] ?? field;
}

/** 判斷某 field 屬於哪種數值格式。 */
type ValueKind = 'shares' | 'price' | 'percent' | 'number' | 'text';

function detectValueKind(category: InventoryCategory, field: string): ValueKind {
  if (category === 'news') return 'text';
  if (field.startsWith('volume') || field === 'foreign_net' || field === 'trust_net' || field === 'dealer_net' || field.endsWith('_net') || field.endsWith('_sum')) {
    return field.startsWith('volume') ? 'shares' : 'shares';
  }
  if (field.startsWith('rsi') || field.startsWith('kd_')) return 'number';
  if (field.startsWith('macd')) return 'number';
  if (field.startsWith('ma') || field.startsWith('boll')) return 'price';
  if (field === 'close' || field === 'open' || field === 'high' || field === 'low') return 'price';
  return 'number';
}

export function formatInventoryValue(
  category: InventoryCategory,
  item: StockBehaviorInventoryItem,
): string {
  const value = item.value;
  if (category === 'news') {
    return typeof value === 'string' ? value : value == null ? '--' : String(value);
  }
  if (value == null) return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return typeof value === 'string' ? value : '--';
  const kind = detectValueKind(category, item.field);
  switch (kind) {
    case 'shares':
      return fmtInstitutionalShares(n);
    case 'price':
      return fmtPrice(n);
    case 'number':
      return n.toFixed(2);
    default:
      return String(n);
  }
}

/** 推演卡 chip 用的緊湊版顯示（field 標籤 + 短值）。 */
export function formatInventoryValueShort(
  category: InventoryCategory,
  item: StockBehaviorInventoryItem,
): string {
  const value = item.value;
  if (category === 'news') {
    if (typeof value !== 'string') return '--';
    return value.length > 16 ? `${value.slice(0, 14)}…` : value;
  }
  if (value == null) return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const kind = detectValueKind(category, item.field);
  switch (kind) {
    case 'shares':
      return `${n < 0 ? '-' : ''}${fmtVolumeShort(Math.abs(n))}`;
    case 'price':
      return n.toFixed(2);
    case 'number':
      return n.toFixed(2);
    default:
      return String(n);
  }
}

export type EvidenceIndexEntry = StockBehaviorInventoryItem & {
  category: InventoryCategory;
};

export function buildEvidenceIndex(
  inventory?: StockBehaviorDataInventory,
): Map<string, EvidenceIndexEntry> {
  const map = new Map<string, EvidenceIndexEntry>();
  if (!inventory) return map;
  const push = (category: InventoryCategory, items?: StockBehaviorInventoryItem[]) => {
    for (const item of items ?? []) {
      if (!item?.id) continue;
      map.set(item.id, { ...item, category });
    }
  };
  push('price_volume', inventory.price_volume);
  push('chip', inventory.chip);
  push('technical', inventory.technical);
  push('news', inventory.news);
  return map;
}
