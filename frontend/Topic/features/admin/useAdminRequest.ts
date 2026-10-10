import { useEffect, useRef, useState } from 'react';
import { userFacingMessage } from '@/lib/api/errorDetail';

/**
 * 後台表單送出的請求（訊號檢驗、證據清單、AI 回測共用）：再送一次會中止上一次，卸載時也中止，舊結果不會蓋掉新結果。
 * 401／403 交給頁面的 onAccessError（清掉後台資料、導去登入）；其他錯誤轉成畫面上的訊息，後端沒有可用說明時用 fallback。
 */
export function useAdminRequest<T>(onAccessError: (error: unknown) => boolean, fallback: string) {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const accessError = useRef(onAccessError);
  accessError.current = onAccessError;
  useEffect(() => () => request.current?.abort(), []);

  const run = (job: (signal: AbortSignal) => Promise<T>) => {
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setLoading(true);
    setError(null);
    job(ctrl.signal)
      .then((data) => { if (!ctrl.signal.aborted) setResult(data); })
      .catch((err) => {
        if (ctrl.signal.aborted || accessError.current(err)) return;
        setError(userFacingMessage(err, fallback));
      })
      .finally(() => { if (request.current === ctrl) { setLoading(false); request.current = null; } });
  };

  /** 中止進行中的請求（例如停止回測）；已經有的結果留著 */
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setLoading(false);
  };

  return { result, error, loading, run, cancel };
}
