import type { NewsListFilters } from '../hooks/useNewsList';
import { parseNewsViewFilters } from './stockNewsView';

/**
 * 首頁「最新財經新聞」的頁碼與已套用的篩選，寫在網址的 `newsView` 參數（03-F14）：
 * 進新聞頁再按上一頁，會回到原本那一頁。第 1 頁、沒有篩選時不寫參數，首頁網址維持乾淨。
 */
export interface HomeNewsView {
  version: 1;
  page: number;
  filters: NewsListFilters;
}

export const HOME_NEWS_VIEW_PARAM = 'newsView';

export function parseHomeNewsView(raw: unknown): HomeNewsView | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 100000) return null;
    const filters = parseNewsViewFilters(value.filters, {}, true);
    return filters ? { version: 1, page: value.page, filters } : null;
  } catch {
    return null;
  }
}

export function homeNewsViewHref(asPath: string, view: { page: number; filters: NewsListFilters }): string {
  const url = new URL(asPath, 'http://home-news.local');
  // 經過 parser 再寫回：只留公開的篩選欄位，不合法就整個拿掉
  const clean = parseHomeNewsView(JSON.stringify({ version: 1, page: view.page, filters: { ...view.filters, stock: undefined } }));
  const empty = !clean || (clean.page === 1 && Object.keys(clean.filters).length === 0);
  if (empty) url.searchParams.delete(HOME_NEWS_VIEW_PARAM);
  else url.searchParams.set(HOME_NEWS_VIEW_PARAM, JSON.stringify(clean));
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * 要不要把首頁新聞的狀態寫回網址：回傳要 replace 的網址，不用寫時回 null。
 * 換頁退場動畫期間舊頁還掛著、router 已經是下一頁（pathname 不同），這時不能寫，不然參數會接到下一頁的網址。
 */
export function homeNewsSyncHref(
  router: { pathname: string; asPath: string },
  ownPathname: string,
  view: { page: number; filters: NewsListFilters },
): string | null {
  if (router.pathname !== ownPathname) return null;
  const href = homeNewsViewHref(router.asPath, view);
  return href === router.asPath ? null : href;
}
