import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNews, type FetchNewsParams } from '../api/news';
import type { PaginatedNewsResponse } from '../types';
import { formatNewsDateTimeParam, validateNewsTimeRange } from '../utils/newsFilters';

export interface NewsListFilters {
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

function buildFetchParams(
  page: number,
  pageSize: number,
  filters: NewsListFilters,
  options: UseNewsListOptions
): { params: FetchNewsParams; error: string | null } {
  const start_time = formatNewsDateTimeParam(filters.start_time ?? '');
  const end_time = formatNewsDateTimeParam(filters.end_time ?? '');
  const rangeError = validateNewsTimeRange(start_time, end_time);
  if (rangeError) return { params: {}, error: rangeError };

  const trimmedKeyword = filters.keyword?.trim();
  const isStockCode = trimmedKeyword && /^\d+$/.test(trimmedKeyword);

  const params: FetchNewsParams = {
    page,
    page_size: pageSize,
    sort_by: options.defaultSort?.sort_by ?? 'publish_time',
    sort_order: options.defaultSort?.sort_order ?? 'desc',
    start_time,
    end_time,
  };

  if (options.fixedStock) {
    params.stock = options.fixedStock;
  } else {
    if (isStockCode) params.stock = trimmedKeyword;
    else if (trimmedKeyword) params.keyword = trimmedKeyword;
  }

  return { params, error: null };
}

export function useNewsList(options: UseNewsListOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const pageSize = options.pageSize ?? 20;
  const [data, setData] = useState<PaginatedNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<NewsListFilters>({
    stock: options.fixedStock,
  });
  const [draft, setDraft] = useState<NewsListFilters>({
    stock: options.fixedStock,
  });
  const requestIdRef = useRef(0);

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
        setData(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      fetchNews(params)
        .then((res) => {
          if (id !== requestIdRef.current) return;
          setData(res);
          setPage(targetPage);
        })
        .catch((err) => {
          if (id !== requestIdRef.current) return;
          setError(err instanceof Error ? err.message : '無法載入新聞');
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
    const initial: NewsListFilters = { stock: options.fixedStock };
    setFilters(initial);
    setDraft(initial);
    load(1, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only
  }, [options.fixedStock]);

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
      keyword: draft.keyword,
      stock: options.fixedStock,
    };
    setDraft(cleared);
    setFilters(cleared);
    load(1, cleared);
  }, [draft.keyword, load, options.fixedStock]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return {
    data,
    loading,
    error,
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
