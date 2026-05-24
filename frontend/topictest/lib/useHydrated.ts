import { useEffect, useState } from 'react';

/** SSR 與首次客戶端繪製皆為 false，mounted 後才 true，避免水合不一致。 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
