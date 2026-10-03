import React, { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/common/Notice';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Google 按鈕寬度上限（renderButton 需要數字寬度） */
const MAX_WIDTH = 320;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
          renderButton: (el: HTMLElement, config: { type?: string; theme?: string; size?: string; text?: string; width?: number }) => void;
        };
      };
    };
  }
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google 腳本載入失敗')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google 腳本載入失敗'));
    document.head.appendChild(s);
  });
}

const clientId = () => process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? '';

export function isGoogleSignInConfigured(): boolean {
  return Boolean(clientId());
}

/**
 * Google Identity Services「使用 Google 帳戶登入」按鈕（需設定 NEXT_PUBLIC_GOOGLE_CLIENT_ID）。
 * 寬度跟著容器，最寬 320，窄螢幕不會撐破面板。放在帳號頁表單下方的「或用 Google 帳號」列（AuthAltRow）。
 */
export function GoogleSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;
  const [loadError, setLoadError] = useState<string | null>(null);
  const id = clientId();

  useEffect(() => {
    const el = divRef.current;
    if (!id || !el) return;
    let cancelled = false;
    loadGisScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        setLoadError(null);
        window.google.accounts.id.initialize({
          client_id: id,
          callback: (resp) => {
            if (resp.credential) callbackRef.current(resp.credential);
          },
        });
        el.innerHTML = '';
        window.google.accounts.id.renderButton(el, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: Math.min(MAX_WIDTH, Math.floor(el.parentElement?.clientWidth ?? MAX_WIDTH)),
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError('無法載入 Google 登入腳本，請檢查網路或稍後再試');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) return null;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-80">
      {loadError ? (
        <Notice tone="danger" className="w-full text-xs">
          {loadError}
        </Notice>
      ) : null}
      <div ref={divRef} className="flex min-h-10 justify-start" />
    </div>
  );
}
