import apiClient from './client';

export interface MonthlyRevenueRow {
  symbol: string;
  date: string;
  revenue: number | null;
  revenue_year: number | null;
  revenue_month: number | null;
  create_time: string | null;
}

export interface ValuationRow {
  symbol: string;
  date: string;
  per: string | number | null;
  pbr: string | number | null;
  dividend_yield: string | number | null;
}

export interface FinancialStatementRow {
  symbol: string;
  date: string;
  statement: string;
  item_type: string;
  origin_name: string;
  value: string | number | null;
}

export interface CompareFundamentalsData {
  revenues: MonthlyRevenueRow[];
  valuations: ValuationRow[];
  statements: FinancialStatementRow[];
  warnings: string[];
}

export async function fetchCompareFundamentals(symbol: string, endDate: string): Promise<CompareFundamentalsData> {
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== endDate) throw new Error('Invalid comparison end date');
  // Start at the month boundary to retain the matching prior-year period.
  const start_date = new Date(Date.UTC(end.getUTCFullYear() - 2, end.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const params = { start_date, end_date: endDate };
  const base = `/stocks/${encodeURIComponent(symbol)}/fundamentals`;
  const fetchRows = async <T,>(path: string, extra = {}) => {
    const { data } = await apiClient.get<{ data: T[] }>(`${base}/${path}`, { params: { ...params, ...extra } });
    if (!Array.isArray(data.data)) throw new Error('Invalid fundamental response');
    return data.data;
  };
  const [revenue, valuation, statement] = await Promise.allSettled([
    fetchRows<MonthlyRevenueRow>('monthly-revenues'),
    fetchRows<ValuationRow>('valuations'),
    fetchRows<FinancialStatementRow>('financial-statements', { statement: 'income' }),
  ]);
  return {
    revenues: revenue.status === 'fulfilled' ? revenue.value : [],
    valuations: valuation.status === 'fulfilled' ? valuation.value : [],
    statements: statement.status === 'fulfilled' ? statement.value : [],
    warnings: [revenue.status === 'rejected' ? `${symbol} 月營收未提供或載入失敗` : '',
      valuation.status === 'rejected' ? `${symbol} 估值未提供或載入失敗` : '',
      statement.status === 'rejected' ? `${symbol} 財報未提供或載入失敗` : ''].filter(Boolean),
  };
}
