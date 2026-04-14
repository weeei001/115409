import React, { useCallback, useRef } from 'react';
import { clsx } from 'clsx';

interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  tilt?: boolean;
  glowColor?: string;
  as?: 'div' | 'button' | 'article';
  onClick?: () => void;
}

export function GlowCard({
  children,
  className = '',
  tilt = true,
  glowColor = 'var(--glow-brand)',
  as: Tag = 'div',
  onClick,
}: GlowCardProps) {
  const ref = useRef<HTMLElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!tilt || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 8;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * -8;
      ref.current.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg) scale3d(1.02,1.02,1.02)`;
    },
    [tilt],
  );

  const handleMouseLeave = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.transform = 'perspective(600px) rotateY(0deg) rotateX(0deg) scale3d(1,1,1)';
    ref.current.style.boxShadow = '';
    ref.current.style.willChange = 'auto';
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.willChange = 'transform';
    ref.current.style.boxShadow = `0 0 24px ${glowColor}, 0 8px 32px rgba(0,0,0,0.06)`;
  }, [glowColor]);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement> & React.Ref<HTMLButtonElement> & React.Ref<HTMLElement>}
      className={clsx(
        'bento-cell',
        onClick && 'cursor-pointer',
        className,
      )}
      style={{
        transition: 'transform 0.18s ease-out, box-shadow 0.3s ease, border-color 0.3s ease',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onClick={onClick}
    >
      {children}
    </Tag>
  );
}
