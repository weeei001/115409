import React from 'react';
import { Toaster } from 'sonner';
import { useTheme } from '@/lib/theme/ThemeContext';

/**
 * sonner 的 richColors 內建紅綠，這裡改接狀態 token（決議 D8），
 * 避免成功／錯誤 toast 看起來像漲跌。2px 圓角（--radius）、放在底部，不蓋住頁首；會自動消失，所以不放小關閉鈕。
 */
const opaque = (token: string) => `color-mix(in srgb, var(${token}) 12%, var(--popover))`;

export function AppToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      richColors
      position="bottom-center"
      toastOptions={{ style: { borderRadius: 'var(--radius)', boxShadow: 'var(--elev-raised)' } }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': opaque('--success'),
          '--success-text': 'var(--success)',
          '--success-border': 'var(--success-border)',
          '--error-bg': opaque('--danger'),
          '--error-text': 'var(--danger)',
          '--error-border': 'var(--danger-border)',
          '--warning-bg': opaque('--warning-icon'),
          '--warning-text': 'var(--warning)',
          '--warning-border': 'var(--warning-border)',
          '--info-bg': 'var(--popover)',
          '--info-text': 'var(--popover-foreground)',
          '--info-border': 'var(--border-strong)',
        } as React.CSSProperties
      }
    />
  );
}
