import { cn } from '@/lib/cn';

/**
 * 品牌標誌：燈塔與光束。這是商標圖形，不是介面圖示（介面圖示一律用 lucide-react）。
 * 塔身跟著文字色，光束固定是燈色。
 */
export function BrandMark({ className, lit = true }: { className?: string; /** false＝熄燈：不畫光束 */ lit?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      className={cn('size-6 shrink-0', className)}
      aria-hidden
    >
      {lit ? <path d="M3 3.5l6.5 2.4M21 3.5l-6.5 2.4" stroke="var(--brand)" strokeWidth={1.8} /> : null}
      <path d="M9.6 9.2h4.8l1.3 11.3H8.3z" />
      <path d="M9.2 9.2h5.6M10.2 6.2h3.6v3h-3.6z" />
      <path d="M12 3.8v2.4M5.5 20.5h13" />
    </svg>
  );
}
