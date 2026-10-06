import { useEffect } from 'react';
import { toast } from 'sonner';
import { AUTH_CHANGE_EVENT, getToken } from '@/lib/auth/storage';
import { listenForPush, refreshPushRegistration, PUSH_EVENT } from '@/lib/notifications/push';
import { safeReturnUrl } from '@/lib/utils/returnUrl';

/** 視窗取得焦點時，距離上次更新推播註冊多久才再更新一次（註冊會向 Firebase 取 token 並寫入後端） */
const FOCUS_REFRESH_MS = 12 * 60 * 60_000;

export function PushListener() {
  useEffect(() => {
    let lastRefresh: { token: string; at: number } | null = null;
    // 掛載與登入狀態改變時一定更新；切回分頁（focus）時，同一個登入 12 小時內只更新一次
    const setup = (event?: Event) => {
      const token = getToken();
      if (!token) return;
      void listenForPush().catch(() => {});
      if (event?.type === 'focus' && lastRefresh?.token === token && Date.now() - lastRefresh.at < FOCUS_REFRESH_MS) return;
      lastRefresh = { token, at: Date.now() };
      void refreshPushRegistration().catch(() => {});
    };
    const receive = (event: Event) => {
      if (!getToken()) return;
      const { title, body, url } = (event as CustomEvent).detail;
      toast(title || '收藏股通知', { description: body, action: { label: '查看', onClick: () => window.location.assign(safeReturnUrl(url) || '/notifications') } });
    };
    setup();
    window.addEventListener(AUTH_CHANGE_EVENT, setup);
    window.addEventListener(PUSH_EVENT, receive);
    window.addEventListener('focus', setup);
    return () => { window.removeEventListener(AUTH_CHANGE_EVENT, setup); window.removeEventListener(PUSH_EVENT, receive); window.removeEventListener('focus', setup); };
  }, []);
  return null;
}
