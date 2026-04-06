import React, { useEffect, useRef, useState } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (resp: { credential?: string }) => void;
          }) => void;
          renderButton: (
            el: HTMLElement,
            config: {
              type?: string;
              theme?: string;
              size?: string;
              text?: string;
              width?: string | number;
            }
          ) => void;
        };
      };
    };
  }
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
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

export interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
}

/**
 * Google Identity Services「使用 Google 帳戶登入」按鈕。需設定 NEXT_PUBLIC_GOOGLE_CLIENT_ID。
 */
export function GoogleSignInButton({ onCredential }: GoogleSignInButtonProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;
  const [loadError, setLoadError] = useState<string | null>(null);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !divRef.current) return;
    let cancelled = false;
    const el = divRef.current;

    loadGisScript()
      .then(() => {
        if (cancelled || !el || !window.google?.accounts?.id) return;
        setLoadError(null);
        window.google.accounts.id.initialize({
          client_id: clientId,
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
          width: 320,
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError('無法載入 Google 登入腳本，請檢查網路或稍後再試');
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) {
    return (
      <p className="text-xs text-center text-amber-600 dark:text-amber-400">
        未設定 NEXT_PUBLIC_GOOGLE_CLIENT_ID，無法使用 Google 登入
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      {loadError && (
        <p className="text-xs text-center text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      <div ref={divRef} className="flex justify-center min-h-[40px]" />
    </div>
  );
}
