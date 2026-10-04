import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { StockSearch } from '@/components/common/StockSearch';
import { HomeHeader } from '@/features/home/HomeHeader';
import { BeaconJourney } from '@/features/home/journey/BeaconJourney';
import { ObservationTerminal } from '@/features/home/terminal/ObservationTerminal';
import { useTerminalData } from '@/features/home/terminal/useTerminalData';
import { parseBulkSymbolInput } from '@/lib/utils/stockSelection';

const TERMINAL_ID = 'terminal';

/** 首頁：燈塔旅程（海面 → 燈塔 → 觀測室）之後接上用真實資料的觀測台 */
export default function HomePage() {
  const router = useRouter();
  const data = useTerminalData();
  const symbols = useMemo(() => data.stockInfos.map((s) => s.symbol), [data.stockInfos]);

  const goToStock = useCallback((symbol: string) => void router.push(`/stock/${symbol}`), [router]);

  // 輸入或貼上多個代號時，取第一個存在於清單的代號
  const handleBulkSelect = useCallback(
    (input: string) => {
      const first = parseBulkSymbolInput(input).find((symbol) => symbols.includes(symbol));
      if (first) goToStock(first);
    },
    [symbols, goToStock],
  );

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <HomeHeader
        terminalId={TERMINAL_ID}
        symbols={symbols}
        stockInfos={data.stockInfos}
        boardDate={data.board?.date ?? null}
        onSelect={goToStock}
        onBulkSelect={handleBulkSelect}
      />

      <BeaconJourney
        terminalId={TERMINAL_ID}
        stockCount={data.stockInfos.length || null}
        industryCount={data.industryCount}
        board={data.board}
        monitor={data.monitor}
      />

      <main aria-label="觀測台">
        <ObservationTerminal
          id={TERMINAL_ID}
          data={data}
          toolbar={
            symbols.length ? (
              <StockSearch symbols={symbols} stockInfos={data.stockInfos} onSelect={goToStock} onBulkSelect={handleBulkSelect} placeholder="搜尋代號或公司名稱" />
            ) : null
          }
        />
      </main>
    </div>
  );
}
