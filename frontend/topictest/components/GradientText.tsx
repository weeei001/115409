import React from 'react';

interface GradientTextProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
}

export function GradientText({
  children,
  className = '',
  glow = false,
  as: Tag = 'span',
}: GradientTextProps) {
  return (
    <Tag className={`gradient-text ${glow ? 'text-glow' : ''} ${className}`}>
      {children}
    </Tag>
  );
}
