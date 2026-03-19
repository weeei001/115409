import React from 'react';
import { Calendar } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  onStartChange: (val: string) => void;
  onEndChange: (val: string) => void;
}

export const DateRangePicker: React.FC<Props> = ({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}) => {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Calendar size={16} className="text-[#ffa95a]" />
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 dark:text-gray-500">從</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300
                     focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                     bg-white dark:bg-gray-700"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 dark:text-gray-500">至</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300
                     focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                     bg-white dark:bg-gray-700"
        />
      </label>
    </div>
  );
};
