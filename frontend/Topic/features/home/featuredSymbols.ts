export interface FeaturedPick {
  symbol: string;
  /** 因為收藏而排在前面的卡片 */
  favorite: boolean;
}

/**
 * 首頁「最近儲存收盤行情」要顯示哪些股票。
 * 收藏股（呼叫端給新到舊）排最前面，最多佔 count 格；剩下的格子從其餘股票照輪播補滿。
 * 每輪前進「剩下的格數」，第 tick 輪從 (tick × 剩下格數) % 其餘股票數 開始；
 * 沒有收藏時就是原本的輪播：每輪前進 count 檔，股票數不超過 count 時不輪播。
 */
export function pickFeaturedSymbols(
  symbols: readonly string[],
  favorites: readonly string[],
  tick: number,
  count: number,
): FeaturedPick[] {
  const pinned = [...new Set(favorites)].slice(0, Math.max(0, count));
  const pinnedSet = new Set(pinned);
  const rest = symbols.filter((symbol) => !pinnedSet.has(symbol));
  const slots = Math.min(count - pinned.length, rest.length);
  const start = slots > 0 && rest.length > slots ? (tick * slots) % rest.length : 0;
  return [
    ...pinned.map((symbol) => ({ symbol, favorite: true })),
    ...Array.from({ length: Math.max(0, slots) }, (_, i) => ({ symbol: rest[(start + i) % rest.length], favorite: false })),
  ];
}
