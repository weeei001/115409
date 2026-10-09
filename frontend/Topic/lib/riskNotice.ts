/**
 * 首次造訪的投資風險提示：按「我已了解」後記在這個瀏覽器，不再出現。
 * 聲明內容有實質修改時改版本號，所有人會再看到一次。
 */
export const RISK_NOTICE_KEY = 'tei:risk-notice-ack:v1';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** 讀不到儲存空間（無痕模式、封鎖網站資料）時照樣顯示：寧可多提示一次 */
export function hasAcknowledgedRiskNotice(storage: ReadableStorage | null | undefined): boolean {
  try {
    return storage?.getItem(RISK_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 寫不進去時只在這次瀏覽關掉，不丟錯 */
export function acknowledgeRiskNotice(storage: WritableStorage | null | undefined): void {
  try {
    storage?.setItem(RISK_NOTICE_KEY, '1');
  } catch {
    // 儲存空間不可用：提示下次造訪會再出現
  }
}

/** window.localStorage 本身在部分瀏覽器設定下讀取就會丟錯 */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
