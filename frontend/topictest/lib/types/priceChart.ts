export interface ChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartPoint {
  time: string;
  value: number | null;
}

export interface PriceChartData {
  candles: ChartCandle[];
  volume: Array<{ time: string; value: number; color: string }>;
  overlays: {
    MA20: ChartPoint[];
    MA60: ChartPoint[];
  };
  markers: Array<{
    time: string;
    position: 'aboveBar' | 'belowBar';
    shape: string;
    color: string;
    text: string;
    type: string;
  }>;
}
