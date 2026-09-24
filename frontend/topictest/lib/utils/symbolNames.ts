import { useEffect, useState } from 'react';
import { fetchStockInfos } from '../api/stock';

export function getStockDisplayName(symbol: string): string {
  return symbol.trim().toUpperCase();
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
