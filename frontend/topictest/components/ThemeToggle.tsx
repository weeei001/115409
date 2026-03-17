import React from 'react';
import { motion } from 'motion/react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../lib/ThemeContext';

export function ThemeToggle() {
  const { theme, mounted, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  if (!mounted) {
    return (
      <div className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700" />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="relative w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-600
                 bg-white dark:bg-gray-700 flex items-center justify-center
                 hover:border-[#ffa95a] hover:bg-[#fff9e6] dark:hover:bg-gray-600
                 transition-colors"
      aria-label={isDark ? '切換至亮色模式' : '切換至暗色模式'}
    >
      <motion.div
        key={theme}
        initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        {isDark ? (
          <Sun size={18} className="text-amber-400" />
        ) : (
          <Moon size={18} className="text-gray-500" />
        )}
      </motion.div>
    </button>
  );
}
