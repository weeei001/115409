import { useEffect, useState } from 'react';
import { fetchStockInfos } from '../api/stock';

const STOCK_NAMES: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2408': '南亞科',
  '2454': '聯發科',
  '2615': '萬海',
  '2881': '富邦金',
  '2882': '國泰金',
  '2303': '聯電',
  '2308': '台達電',
  '3711': '日月光投控',
  '2412': '中華電',
  '2886': '兆豐金',
  '2301': '光寶科',
  '2884': '玉山金',
  '2891': '中信金',
  '2892': '第一金',
  '3008': '大立光',
  '2382': '廣達',
  '2357': '華碩',
};

export function getStockDisplayName(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  return STOCK_NAMES[normalized] ?? normalized;
}

export function useStockDisplayName(symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [displayName, setDisplayName] = useState(normalizedSymbol);

  useEffect(() => {
    let active = true;
    setDisplayName(normalizedSymbol);

    if (!normalizedSymbol) return () => { active = false; };

    fetchStockInfos()
      .then((stocks) => {
        if (!active) return;
        setDisplayName(stocks.find((stock) => stock.symbol === normalizedSymbol)?.name ?? normalizedSymbol);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [normalizedSymbol]);

  return displayName;
}

/** 查不到中文名回 null（決議 c47） */
export function getStockName(symbol: string): string | null {
  return STOCK_NAMES[symbol.trim().toUpperCase()] ?? null;
}

/** 「2330 台積電」；查不到中文名只顯示代號，不會變成「1101 1101」（決議 D13） */
export function formatStockLabel(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  const name = getStockName(normalized);
  return name ? `${normalized} ${name}` : normalized;
}
