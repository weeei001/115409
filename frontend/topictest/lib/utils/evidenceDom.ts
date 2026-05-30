/** 統一產生 data_inventory 證據卡的 DOM id，供 scroll/highlight 對應使用。 */
export function evidenceDomId(id: string): string {
  return `evidence-${id}`;
}
