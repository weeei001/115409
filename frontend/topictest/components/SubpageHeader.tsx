import React from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export interface SubpageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** 顯示在 ThemeToggle 左側（例如額外按鈕） */
  rightExtra?: React.ReactNode;
}

export const SubpageHeader: React.FC<SubpageHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  rightExtra,
}) => {
  const router = useRouter();

  return (
    <header className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <motion.div
          className="flex items-center justify-between gap-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="flex-shrink-0 p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400
                         hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors cursor-pointer"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20">
              <Icon size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
              {subtitle ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {rightExtra}
            <ThemeToggle />
          </div>
        </motion.div>
      </div>
    </header>
  );
};
