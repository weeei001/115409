import { useStockInfos } from '../hooks/useStockInfos';

/** 公司名稱（來自 /stocks/info）；查不到或還沒載入時回傳代號 */
export function useStockDisplayName(symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const { data } = useStockInfos({ enabled: Boolean(normalizedSymbol) });
  return data?.find((stock) => stock.symbol === normalizedSymbol)?.name ?? normalizedSymbol;
}

/** 股票代號的顯示形式（去空白、轉大寫）；公司名稱另由 useStockDisplayName 取得。 */
export function formatStockLabel(symbol: string): string {
  return symbol.trim().toUpperCase();
}
