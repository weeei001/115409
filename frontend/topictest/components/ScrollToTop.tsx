import React, { useCallback, useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';

const SHOW_AFTER_PX = 300;

export const ScrollToTop: React.FC = () => {
  const [visible, setVisible] = useState(false);

  const onScroll = useCallback(() => {
    setVisible(window.scrollY > SHOW_AFTER_PX);
  }, []);

  useEffect(() => {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="回到頁面頂部"
      className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full
                 bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] text-white shadow-lg shadow-[#ffa95a]/30
                 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-[#ffa95a] cursor-pointer"
    >
      <ChevronUp size={24} strokeWidth={2.5} aria-hidden />
    </button>
  );
};
