import { useEffect } from 'react';
import { toast } from 'sonner';
import { AUTH_CHANGE_EVENT, getToken } from '@/lib/auth/storage';
import { listenForPush, refreshPushRegistration, PUSH_EVENT } from '@/lib/notifications/push';
import { safeReturnUrl } from '@/lib/utils/returnUrl';

export function PushListener() {
  useEffect(() => {
    const setup = () => {
      if (!getToken()) return;
      void listenForPush().catch(() => {});
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
