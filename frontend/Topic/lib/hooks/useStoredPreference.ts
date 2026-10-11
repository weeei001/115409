import { useCallback, useEffect, useState } from 'react';
import { browserStorage } from '@/lib/riskNotice';

/**
 * 這個瀏覽器的版面偏好（localStorage，例如欄寬、收合）。只放方便用的設定，不放要保存的資料。
 * SSR 與第一次繪製是 null（沒有偏好），mounted 後才讀；讀不到或格式不對也是 null。
 * 寫不進去（無痕、封鎖網站資料）時只在這次瀏覽有效，不丟錯。
 */
export function useStoredPreference<T>(key: string, parse: (raw: string) => T | null, serialize: (value: T) => string = String): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    try {
      const raw = browserStorage()?.getItem(key);
      setValue(raw == null ? null : parse(raw));
    } catch {
      setValue(null);
    }
    // parse 是純函式，只在換 key 時重讀
  }, [key]);

  const store = useCallback((next: T) => {
    setValue(next);
    try {
      browserStorage()?.setItem(key, serialize(next));
    } catch {
      // 儲存空間不可用：這次瀏覽照樣生效
    }
  }, [key, serialize]);

  return [value, store];
}

/** 開關類偏好（收合、暫停）存成 '1'／'0'；其他值當作沒有偏好 */
export function parseFlag(raw: string): boolean | null {
  return raw === '1' ? true : raw === '0' ? false : null;
}

export const serializeFlag = (value: boolean) => (value ? '1' : '0');
