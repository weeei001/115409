import React, { useContext, useRef } from 'react';
import { useIsPresent } from 'motion/react';
// Pages Router 的 useRouter() 讀這個 context；Next 沒有公開的匯出路徑（addendum 2.10 P1-15）
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';

/**
 * 換頁淡出期間凍結舊頁看到的 router（03-F2／P1-15）。
 * AnimatePresence 淡出舊頁的那 125ms 裡，舊頁仍會重新渲染，但 useRouter() 已經是新路由：
 * 個股頁的 router.query.id 變成 undefined，於是閃出「股票代號格式不正確」。
 * 這裡記住頁面還在場（isPresent）時最後一次的 router，淡出時繼續提供給舊頁；
 * Next 每次換頁都給 context 一個新的 router 物件（makePublicRouterInstance），舊物件的欄位不會被改掉，
 * 方法（push、replace…）仍然呼叫同一個 router。
 */
export function FrozenRouter({ children }: { children: React.ReactNode }) {
  const router = useContext(RouterContext);
  const isPresent = useIsPresent();
  const frozen = useRef(router);
  if (isPresent) frozen.current = router;
  return <RouterContext.Provider value={frozen.current}>{children}</RouterContext.Provider>;
}
