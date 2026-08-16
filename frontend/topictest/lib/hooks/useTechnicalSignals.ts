import { useMemo } from 'react';
import type { PriceChartData } from '../types/priceChart';
import {
  getMaStructureLabel,
  getVolumeConfirmLabel,
  getVolumeInsight,
  summarizePricePosition,
} from '../utils/technicalSignals';

/** Hero 卡片的均線／量能 chip：純由價量資料算出來，不等 AI */
export function useTechnicalSignals(priceChart: PriceChartData | null) {
  return useMemo(() => {
    const pricePosition = summarizePricePosition(priceChart);
    const volume = getVolumeInsight(priceChart);
    return {
      pricePosition,
      maStructureLabel: getMaStructureLabel(pricePosition),
      volumeConfirmLabel: getVolumeConfirmLabel(volume.status),
    };
  }, [priceChart]);
}

export type UseTechnicalSignalsResult = ReturnType<typeof useTechnicalSignals>;
