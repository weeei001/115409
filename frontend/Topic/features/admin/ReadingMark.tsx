import { READING_LABEL } from '@/lib/signals/signalCheck';
import type { SignalReading } from '@/lib/types/api';
import { cn } from '@/lib/cn';

/** 訊號的一般解讀（訊號檢驗與證據清單共用）：方向用紅漲綠跌的語意色；文字本身就寫出偏多／偏空，不只靠顏色 */
export const ReadingMark = ({ reading }: { reading: SignalReading }) => (
  <span className={cn('text-xs font-semibold', reading === 'bullish' ? 'text-up' : 'text-down')}>一般解讀{READING_LABEL[reading]}</span>
);
