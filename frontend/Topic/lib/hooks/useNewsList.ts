import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNews, fetchRelatedNews, type FetchNewsParams } from '../api/news';
import { ApiRequestError } from '../api/client';
import { userFacingMessage } from '../api/errorDetail';
import type { PaginatedNewsResponse } from '../types/api';
import { formatNewsDateTimeParam, validateNewsTimeRange } from '../utils/newsFilters';

export interface NewsListFilters extends Pick<FetchNewsParams,
  'scope' | 'industry' | 'topic' | 'direction' | 'importance' | 'relation'> {
  keyword?: string;
  stock?: string;
  start_time?: string;
  end_time?: string;
}

export interface UseNewsListOptions {
  pageSize?: number;
  defaultSort?: Pick<FetchNewsParams, 'sort_by' | 'sort_order'>;
  /** Fixed stock filter (e.g. stock detail page) */
  fixedStock?: string;
  fixedRelation?: FetchNewsParams['relation'];
  retrieval?: boolean;
  /** Applied route state; draft edits are deliberately excluded. */
  initialState?: { page: number; filters: NewsListFilters };
}

/**
 * 錯誤種類：filter＝篩選條件不合法（前端驗證，或後端回 400／422），換條件才有用，畫面給「清除篩選」；
 * request＝斷線、逾時、5xx 等，重試可能成功，畫面給「重試」。
 */
export type NewsListErrorKind = 'filter' | 'request';

export function newsListErrorKind(err: unknown): NewsListErrorKind {
  return err instanceof ApiRequestError && (err.status === 400 || err.status === 422) ? 'filter' : 'request';
}

type NewsListFilterOverride =
  | Partial<NewsListFilters>
  | ((draft: NewsListFilters) => NewsListFilters);

export function resolveAppliedNewsFilters(
  draft: NewsListFilters,
  override?: NewsListFilterOverride,
  fixedStock?: string,
): NewsListFilters {
  const next =
    typeof override === 'function'
      ? override(draft)
      : {
          ...draft,
          ...(override ?? {}),
        };

  if (fixedStock) next.stock = fixedStock;
  return next;
}

export function buildFetchParams(
  page: number,
  pageSize: number,
  filters: NewsListFilters,
  options: UseNewsListOptions,
  now: Date = new Date(),
): { params: FetchNewsParams; error: string | null } {
  const start_time = formatNewsDateTimeParam(filters.start_time ?? '');
  const end_time = formatNewsDateTimeParam(filters.end_time ?? '');
  const rangeError = validateNewsTimeRange(start_time, end_time, now);
  if (rangeError) return { params: {}, error: rangeError };

  const trimmedKeyword = filters.keyword?.trim();
  // 純數字關鍵字都當代號送給後端（不限 4–6 碼，比 isTaiwanStockCode 寬）
  const isStockCode = trimmedKeyword && /^\d+$/.test(trimmedKeyword);

  const params: FetchNewsParams = {
    page,
    page_size: pageSize,
    sort_by: options.defaultSort?.sort_by ?? 'pub_time',
    sort_order: options.defaultSort?.sort_order ?? 'desc',
    start_time,
    end_time,
    scope: filters.scope,
    industry: filters.industry?.trim() || undefined,
    topic: filters.topic,
    direction: filters.direction,
    importance: filters.importance,
    relation: options.fixedRelation ?? filters.relation,
  };

  if (options.fixedStock) {
    params.stock = options.fixedStock;
  } else {
    if (isStockCode) params.stock = trimmedKeyword;
    else if (trimmedKeyword) params.keyword = trimmedKeyword;
  }

  return { params, error: null };
}

// 沒有固定關聯類型的列表（首頁）保留還原或已套用的 relation，不被 undefined 蓋掉
export function withFixedNewsFilters(base: NewsListFilters | undefined, options: Pick<UseNewsListOptions, 'fixedStock' | 'fixedRelation'>): NewsListFilters {
  return { ...base, stock: options.fixedStock, relation: options.fixedRelation ?? base?.relation };
}

export function useNewsList(options: UseNewsListOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const pageSize = options.pageSize ?? 20;
  const [data, setData] = useState<PaginatedNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<NewsListErrorKind | null>(null);
  const initialFilters = withFixedNewsFilters(options.initialState?.filters, options);
  const [page, setPage] = useState(options.initialState?.page ?? 1);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [filters, setFilters] = useState<NewsListFilters>(initialFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [draft, setDraft] = useState<NewsListFilters>(initialFilters);
  const requestIdRef = useRef(0);
  const lastStockRef = useRef(options.fixedStock);
  const initializedRef = useRef(false);
  const contextRef = useRef<string | null>(null);

  const load = useCallback(
    (targetPage: number, activeFilters: NewsListFilters) => {
      const id = ++requestIdRef.current;
      const { params, error: validationError } = buildFetchParams(
        targetPage,
        pageSize,
        activeFilters,
        optionsRef.current,
      );
      if (validationError) {
        setError(validationError);
        setErrorKind('filter');
        setData(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setErrorKind(null);
      setData(null);

      const currentOptions = optionsRef.current;
      const requestPage = async () => {
        let requestedPage = Math.max(1, targetPage);
        while (id === requestIdRef.current) {
          const pageParams = { ...params, page: requestedPage };
          const res = currentOptions.retrieval && currentOptions.fixedStock
            ? await fetchRelatedNews({ ...pageParams, symbol: currentOptions.fixedStock, limit: pageSize })
            : await fetchNews(pageParams);
          if (id !== requestIdRef.current) return;
          const lastPage = Math.max(1, Math.ceil(res.total / pageSize));
          if (requestedPage > lastPage) {
            requestedPage = lastPage;
            continue;
          }
          setData(res);
          setPage(requestedPage);
          return;
        }
      };

      void requestPage()
        .catch((err) => {
          if (id !== requestIdRef.current) return;
          setError(userFacingMessage(err, '無法載入新聞'));
          setErrorKind(newsListErrorKind(err));
          setData(null);
        })
        .finally(() => {
          if (id === requestIdRef.current) setLoading(false);
        });
    },
    [pageSize]
  );

  const applyFilters = useCallback((override?: NewsListFilterOverride) => {
    const next = resolveAppliedNewsFilters(draft, override, options.fixedStock);
    setDraft(next);
    setFilters(next);
    load(1, next);
  }, [draft, load, options.fixedStock]);

  useEffect(() => {
    const firstLoad = !initializedRef.current;
    const context = JSON.stringify([options.fixedStock, options.fixedRelation, options.defaultSort?.sort_by, options.retrieval]);
    const initialPage = firstLoad ? options.initialState?.page ?? 1 : contextRef.current === context ? pageRef.current : 1;
    const sameStock = lastStockRef.current === options.fixedStock;
    const initial = withFixedNewsFilters(firstLoad ? options.initialState?.filters : sameStock ? filtersRef.current : {}, options);
    initializedRef.current = true;
    contextRef.current = context;
    lastStockRef.current = options.fixedStock;
    setFilters(initial);
    setDraft(initial);
    setPage(initialPage);
    load(initialPage, initial);
    return () => { requestIdRef.current += 1; };
    // 依賴刻意省略 load 與篩選值：路由狀態只在這幾個條件改變時重新初始化，relation 改變時保留已套用的篩選
  }, [options.fixedStock, options.fixedRelation, options.defaultSort?.sort_by, options.retrieval]);

  const reload = useCallback(() => {
    load(page, filters);
  }, [filters, load, page]);

  const goToPage = useCallback(
    (p: number) => {
      load(p, filters);
    },
    [filters, load]
  );

  const clearAdvanced = useCallback(() => {
    const cleared: NewsListFilters = {
      keyword: filters.keyword,
      stock: options.fixedStock,
      relation: options.fixedRelation,
    };
    setDraft(cleared);
    setFilters(cleared);
    load(1, cleared);
  }, [filters.keyword, load, options.fixedStock, options.fixedRelation]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return {
    data,
    loading,
    error,
    errorKind,
    page,
    filters,
    draft,
    setDraft,
    applyFilters,
    reload,
    goToPage,
    clearAdvanced,
    totalPages,
    pageSize,
  };
}
