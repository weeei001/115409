import { getStockDisplayName } from './utils/symbolNames';

/** 主選單／頁尾共用導覽（路徑與標籤唯一來源） */
export const PRIMARY_NAV = [
  { path: '/', label: '首頁' },
  { path: '/ai', label: 'AI 對話' },
  { path: '/order', label: '模擬下單' },
  { path: '/compare', label: '多股比較' },
  { path: '/demo/text-brief', label: '個股分析' },
] as const;

/** 頁尾連結（與主選單一致，避免遺漏項目） */
export const FOOTER_NAV = PRIMARY_NAV;

/** 靜態路由 → 頁面標題（麵包屑與文件標題對照） */
export const ROUTE_PAGE_LABELS: Record<string, string> = {
  '/': '首頁',
  '/ai': 'AI 對話',
  '/order': '模擬下單',
  '/compare': '多股比較',
  '/demo/text-brief': 'AI 個股分析',
  '/login': '登入',
  '/register': '註冊',
  '/forgot-password': '忘記密碼',
  '/reset-password': '重設密碼',
  '/me': '個人中心',
};

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const HOME_CRUMB: BreadcrumbItem = { label: '首頁', href: '/' };

/** 建立「首頁 > … > 目前頁」麵包屑；最後一項預設無 href（目前頁） */
export function breadcrumbsTrail(...segments: Array<string | BreadcrumbItem>): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [HOME_CRUMB];
  for (const seg of segments) {
    if (typeof seg === 'string') {
      items.push({ label: seg });
    } else {
      items.push(seg);
    }
  }
  return items;
}

function isRoutableStockSymbol(symbol: string): boolean {
  const code = symbol.trim();
  if (!code || code === '[id]') return false;
  return /^\d{4,6}$/.test(code);
}

export function breadcrumbsForStock(symbol: string): BreadcrumbItem[] {
  const code = symbol.trim();
  if (!isRoutableStockSymbol(code)) return breadcrumbsTrail('個股');
  const name = getStockDisplayName(code);
  const label = name !== code ? `${code} ${name}` : code;
  return breadcrumbsTrail(label);
}

export function breadcrumbsForPath(pathname: string, asPath?: string): BreadcrumbItem[] {
  if (pathname === '/' || pathname === '') return [];

  const stockPath = asPath?.split('?')[0] ?? '';
  if (pathname === '/stock/[id]' || stockPath.startsWith('/stock/')) {
    const symbol = decodeURIComponent(
      stockPath.replace(/^\/stock\//, '').split('/')[0] ?? '',
    );
    return breadcrumbsForStock(symbol);
  }

  const label = ROUTE_PAGE_LABELS[pathname];
  if (label) return breadcrumbsTrail(label);

  return [HOME_CRUMB];
}
