import type {
  InstitutionalTradeApiRow,
  InstitutionalTradeListApiResponse,
  TechnicalIndicatorListApiResponse,
} from '../types';
import { normalizeTechnicalIndicatorRow } from './technicalIndicatorRowMapper';
import type { IntegratedChartResponse } from '../types/integratedChart';
import type { ChipsVolumeChartRow } from '../types';
import {
  mapInstitutionalLatestFromList,
  mapInstitutionalTradesApi,
  mapTechnicalIndicatorsApi,
  mapTechnicalLatestFromList,
} from './openapiStockMappers';
import type {
  InstitutionalTradeListResponse,
  InstitutionalTradeResponse,
  TechnicalIndicatorListResponse,
  TechnicalIndicatorResponse,
} from '../types/stockDashboard';
import { toNum } from './parseNumber';

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function mapIntegratedInstitutionalRows(
  symbol: string,
  start_date: string,
  end_date: string,
  rows: Record<string, unknown>[]
): InstitutionalTradeListApiResponse {
  const data: InstitutionalTradeApiRow[] = rows
    .map((row) => ({
      date: toStr(row.date) ?? '',
      symbol: toStr(row.symbol) ?? symbol,
      foreign_buy: toNum(row.foreign_buy),
      foreign_sell: toNum(row.foreign_sell),
      foreign_net: toNum(row.foreign_net ?? row.foreign_excl_dealer_net),
      investment_trust_buy: toNum(row.investment_trust_buy),
      investment_trust_sell: toNum(row.investment_trust_sell),
      investment_trust_net: toNum(row.investment_trust_net),
      dealer_buy: toNum(row.dealer_buy),
      dealer_sell: toNum(row.dealer_sell),
      dealer_net: toNum(row.dealer_net ?? row.dealer_net_total),
      total_institutional_buy: toNum(row.total_institutional_buy),
      total_institutional_sell: toNum(row.total_institutional_sell),
      total_institutional_net: toNum(row.total_institutional_net ?? row.total_net),
    }))
    .filter((r) => r.date);

  return {
    symbol,
    start_date,
    end_date,
    total: data.length,
    data,
  };
}

export function mapIntegratedTechnicalRows(
  symbol: string,
  start_date: string,
  end_date: string,
  rows: Record<string, unknown>[]
): TechnicalIndicatorListApiResponse {
  const data = rows
    .map((row) => normalizeTechnicalIndicatorRow(row, symbol))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  return {
    symbol,
    start_date,
    end_date,
    total: data.length,
    data,
  };
}

export interface IntegratedChipsDashboardSlice {
  institutionalRange: InstitutionalTradeListResponse | null;
  institutionalLatest: InstitutionalTradeResponse | null;
  indicatorsRange: TechnicalIndicatorListResponse | null;
  indicatorLatest: TechnicalIndicatorResponse | null;
  chipsVolumeRows: ChipsVolumeChartRow[] | null;
}

export function mapIntegratedChartToDashboard(
  symbol: string,
  integrated: IntegratedChartResponse
): IntegratedChipsDashboardSlice {
  const instApi = mapIntegratedInstitutionalRows(
    symbol,
    integrated.start_date,
    integrated.end_date,
    integrated.institutional_trades ?? []
  );
  const techApi = mapIntegratedTechnicalRows(
    symbol,
    integrated.start_date,
    integrated.end_date,
    integrated.technical_indicators ?? []
  );

  const institutionalRange = instApi.data.length ? mapInstitutionalTradesApi(symbol, instApi) : null;
  const indicatorsRange = techApi.data.length ? mapTechnicalIndicatorsApi(symbol, techApi) : null;

  return {
    institutionalRange,
    institutionalLatest: mapInstitutionalLatestFromList(symbol, institutionalRange),
    indicatorsRange,
    indicatorLatest: mapTechnicalLatestFromList(symbol, indicatorsRange),
    chipsVolumeRows: integrated.volume_with_chips?.length ? integrated.volume_with_chips : null,
  };
}
