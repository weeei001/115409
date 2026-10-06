import { formatStockLabel } from './utils/symbolNames';
import { isTaiwanStockCode } from './utils/stockValidation';
import type { ChatAction } from './types/chat';

/** 主選單／頁尾共用導覽（路徑與標籤唯一來源） */
export const PRIMARY_NAV = [
  { path: '/', label: '首頁' },
  { path: '/favorites', label: '收藏股' },
  { path: '/notifications', label: '通知中心' },
  { path: '/ai', label: 'AI 對話' },
  { path: '/order', label: '模擬投資' },
  { path: '/compare', label: '多股比較' },
] as const;

export function isChatNavigationAction(value: unknown): value is Extract<ChatAction, { type: 'navigate' }> {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<ChatAction>;
  return action.type === 'navigate' &&
    typeof action.label === 'string' && action.label.trim().length > 0 &&
    typeof action.path === 'string' &&
    (PRIMARY_NAV.some((item) => item.path === action.path) || (action.path.startsWith('/stock/') && isTaiwanStockCode(action.path.slice('/stock/'.length))));
}

export function isChatFollowUpAction(value: unknown): value is Extract<ChatAction, { type: 'follow_up' }> {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<Extract<ChatAction, { type: 'follow_up' }>>;
  return action.type === 'follow_up' &&
    typeof action.label === 'string' && action.label.trim().length > 0 && action.label.length <= 200 &&
    typeof action.query === 'string' && action.query.trim().length > 0 && action.query.length <= 6000;
}

export function isChatAction(value: unknown): value is ChatAction {
  return isChatNavigationAction(value) || isChatFollowUpAction(value) || isPaperOrderDraftAction(value);
}

export function isPaperOrderDraftAction(value: unknown): value is Extract<ChatAction, { type: 'paper_order_draft' }> {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<Extract<ChatAction, { type: 'paper_order_draft' }>>;
  const positive = (number: unknown) => number == null || (typeof number === 'number' && Number.isFinite(number) && number > 0);
  return action.type === 'paper_order_draft' && typeof action.draft_id === 'string'
    && /^[a-zA-Z0-9-]{1,100}$/.test(action.draft_id)
    && typeof action.label === 'string' && action.label.length <= 200
    // 模擬下單草稿收英數 1–10 碼，和 compareQuery 同一條，比 isTaiwanStockCode 寬
    && typeof action.symbol === 'string' && /^[0-9A-Z]{1,10}$/.test(action.symbol)
    && (action.side === 'buy' || action.side === 'sell')
    && positive(action.budget) && positive(action.quantity)
    && (action.quantity == null || Number.isSafeInteger(action.quantity))
    && typeof action.reason === 'string' && action.reason.length <= 2000
    && typeof action.observation === 'string' && action.observation.length <= 2000
    && typeof action.review_after_days === 'number' && Number.isInteger(action.review_after_days)
    && action.review_after_days >= 1 && action.review_after_days <= 250
    && (action.conversation_id == null || (typeof action.conversation_id === 'string' && action.conversation_id.length <= 100));
}

/** 主導覽、選單抽屜、頁尾共用的「目前頁」判斷：首頁只認 /，其他頁含子路徑 */
export function isNavPathActive(path: string, pathname: string): boolean {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

/** 頁尾連結（與主選單一致，避免遺漏項目） */
export const FOOTER_NAV = PRIMARY_NAV;

/** 靜態路由 → 頁面標題（麵包屑與文件標題對照） */
export const ROUTE_PAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PRIMARY_NAV.map((item) => [item.path, item.label])),
  '/login': '登入',
  '/register': '註冊',
  '/forgot-password': '忘記密碼',
  '/reset-password': '重設密碼',
  '/me': '個人中心',
  '/admin': '管理後台',
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
  return isTaiwanStockCode(code);
}

export function breadcrumbsForStock(symbol: string, stockName?: string): BreadcrumbItem[] {
  const code = symbol.trim();
  if (!isRoutableStockSymbol(code)) return breadcrumbsTrail('個股');
  const name = stockName?.trim();
  return breadcrumbsTrail(name ? `${code} ${name}` : formatStockLabel(code));
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
