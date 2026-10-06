import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { addFavorite, fetchFavorites, removeFavorite } from '@/lib/api/favorites';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { AUTH_CHANGE_EVENT, getToken } from '@/lib/auth/storage';
import type { FavoriteStockResponse } from '@/lib/types/api';

/** idle：還沒在瀏覽器確認登入狀態（SSR 與第一次 render） */
export type FavoritesStatus = 'idle' | 'anonymous' | 'loading' | 'ready' | 'error';

type PendingOp = 'add' | 'remove';

interface FavoritesContextValue {
  status: FavoritesStatus;
  /** 新到舊；已套用進行中的加入／移除（加入中的那筆在最前面，name 等後端回應才補上） */
  items: FavoriteStockResponse[];
  loadError: string | null;
  reload: () => void;
  isFavorite: (symbol: string) => boolean;
  /** 該檔的加入／移除還在等後端回應 */
  isPending: (symbol: string) => boolean;
  /** 清單載入完成（或載入失敗）才可切換；同一檔處理中時忽略 */
  canToggle: boolean;
  /** 回傳後端是否確認成功（被忽略或失敗都是 false），呼叫端用來決定要不要顯示成功提示 */
  toggle: (symbol: string) => Promise<boolean>;
  remove: (symbol: string) => Promise<boolean>;
  /** 「復原」用：不看目前狀態，直接加回收藏（PUT 冪等） */
  add: (symbol: string) => Promise<boolean>;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error('useFavorites must be used inside FavoritesProvider');
  return value;
}

const newestFirst = (a: FavoriteStockResponse, b: FavoriteStockResponse) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

/**
 * Account-owned favorites shared by stock pages, the favorites page and home.
 * saved 只放後端確認過的資料，pending 是樂觀更新：失敗時丟掉 pending 就等於回滾。
 */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<FavoritesStatus>('idle');
  const [saved, setSaved] = useState<FavoriteStockResponse[]>([]);
  const [pending, setPending] = useState<Record<string, PendingOp>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  /** undefined＝還沒同步過；換 token（登入、登出、換帳號）時整份重來 */
  const tokenRef = useRef<string | null | undefined>(undefined);
  /** 換帳號就遞增，舊帳號的回應一律丟掉 */
  const sessionRef = useRef(0);
  const loadRef = useRef(0);

  const load = useCallback(() => {
    const session = sessionRef.current;
    const request = ++loadRef.current;
    setStatus('loading');
    setLoadError(null);
    fetchFavorites()
      .then((data) => {
        if (session !== sessionRef.current || request !== loadRef.current) return;
        setSaved(data.items);
        setStatus('ready');
      })
      .catch((err) => {
        if (session !== sessionRef.current || request !== loadRef.current) return;
        setLoadError(userFacingMessage(err, '無法載入收藏清單，請稍後再試。'));
        setStatus('error');
      });
  }, []);

  const reload = useCallback(() => {
    if (tokenRef.current) load();
  }, [load]);

  useEffect(() => {
    const sync = () => {
      const token = getToken();
      if (token === tokenRef.current) return;
      tokenRef.current = token;
      sessionRef.current += 1;
      setSaved([]);
      setPending({});
      setLoadError(null);
      if (token) load();
      else setStatus('anonymous');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage) sync();
    };
    sync();
    window.addEventListener(AUTH_CHANGE_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [load]);

  const items = useMemo(() => {
    const adding = Object.keys(pending)
      .filter((symbol) => pending[symbol] === 'add')
      .map((symbol) => ({ symbol, name: '', created_at: '' }));
    return [...adding, ...saved.filter((item) => !pending[item.symbol])];
  }, [saved, pending]);

  const favoriteSymbols = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);

  const mutate = useCallback(async (symbol: string, op: PendingOp): Promise<boolean> => {
    const session = sessionRef.current;
    setPending((current) => ({ ...current, [symbol]: op }));
    try {
      if (op === 'add') {
        const stored = await addFavorite(symbol);
        if (session === sessionRef.current) {
          setSaved((current) => [stored, ...current.filter((item) => item.symbol !== symbol)].sort(newestFirst));
        }
      } else {
        await removeFavorite(symbol);
        if (session === sessionRef.current) setSaved((current) => current.filter((item) => item.symbol !== symbol));
      }
      return session === sessionRef.current;
    } catch (err) {
      const action = op === 'add' ? '加入收藏失敗' : '取消收藏失敗';
      toast.error(`${action}：${userFacingMessage(err, '請稍後再試。')}`);
      return false;
    } finally {
      if (session === sessionRef.current) {
        setPending(({ [symbol]: _done, ...rest }) => rest);
      }
    }
  }, []);

  const canToggle = status === 'ready' || status === 'error';

  const toggle = useCallback(
    (symbol: string) => {
      if (!canToggle || pending[symbol]) return Promise.resolve(false);
      return mutate(symbol, favoriteSymbols.has(symbol) ? 'remove' : 'add');
    },
    [canToggle, pending, favoriteSymbols, mutate],
  );

  const remove = useCallback(
    (symbol: string) => {
      if (!canToggle || pending[symbol] || !favoriteSymbols.has(symbol)) return Promise.resolve(false);
      return mutate(symbol, 'remove');
    },
    [canToggle, pending, favoriteSymbols, mutate],
  );

  const add = useCallback((symbol: string) => mutate(symbol, 'add'), [mutate]);

  const value = useMemo<FavoritesContextValue>(
    () => ({
      status,
      items,
      loadError,
      reload,
      isFavorite: (symbol) => favoriteSymbols.has(symbol),
      isPending: (symbol) => Boolean(pending[symbol]),
      canToggle,
      toggle,
      remove,
      add,
    }),
    [status, items, loadError, reload, favoriteSymbols, pending, canToggle, toggle, remove, add],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}
