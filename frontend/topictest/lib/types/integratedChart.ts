import type { ChipsVolumeChartRow } from './index';

/** openapi: IntegratedChartResponse */
export interface IntegratedChartResponse {
  symbol: string;
  start_date: string;
  end_date: string;
  price_volume: Record<string, unknown>[];
  institutional_trades: Record<string, unknown>[];
  volume_with_chips: ChipsVolumeChartRow[];
  technical_indicators: Record<string, unknown>[];
}
