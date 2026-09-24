import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { KeyRound, Loader2, Lock, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Notice } from '@/components/common/Notice';
import { FormError, PasswordField, SubmitButton } from '@/features/auth/AuthForm';
import { authChangePassword, authMe } from '@/lib/api/auth';
import { ApiRequestError } from '@/lib/api/client';
import { AUTH_CHANGE_EVENT, clearAuth, getStoredUser, getToken, updateStoredUser } from '@/lib/auth/storage';
import type { UserPublic } from '@/lib/types/api';
import { userFacingMessage } from '@/lib/api/errorDetail';

const LOGIN_FOR_ME = { pathname: '/login', query: { returnUrl: '/me' } };
const errorText = (err: unknown, fallback: string) => userFacingMessage(err, fallback);

export default function MePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [checked, setChecked] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirmNew, setShowConfirmNew] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  /** 進行中的 /auth/me 請求數：這段期間的登出事件是 API 收到 401 造成的，交給各自的 catch 處理。
   *  用計數而不是布林值：開發模式的 StrictMode 會讓初次確認跑兩次，請求會重疊 */
  const checkingRef = useRef(0);
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!getToken()) {
      void router.replace(LOGIN_FOR_ME);
      setChecked(true);
      return;
    }
    setHasToken(true);
    setUser(getStoredUser());
    let active = true;
    checkingRef.current += 1;
    authMe()
      .then((me) => {
        if (!active) return;
        updateStoredUser(me);
        setUser(me);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          leavingRef.current = true;
          clearAuth();
          void router.replace(LOGIN_FOR_ME);
        }
      })
      .finally(() => {
        checkingRef.current -= 1;
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
    // router 物件每次 render 都是新的；只在 isReady 變化時確認一次
  }, [router.isReady]);

  // 在這頁從主選單登出：清掉畫面上的資料並回首頁，跟本頁「登出」一致（決議 D9-c18）
  useEffect(() => {
    const onAuthChange = () => {
      if (getToken() || leavingRef.current || checkingRef.current > 0) return;
      leavingRef.current = true;
      setHasToken(false);
      setUser(null);
      void router.push('/');
    };
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
  }, [router]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    checkingRef.current += 1;
    try {
      const me = await authMe();
      updateStoredUser(me);
      setUser(me);
    } catch (err) {
      // 登入過期：跟一進頁面就 401 一樣，清除登入後回登入頁（決議 c80）
      if (err instanceof ApiRequestError && err.status === 401) {
        leavingRef.current = true;
        clearAuth();
        void router.replace(LOGIN_FOR_ME);
        return;
      }
      const msg = errorText(err, '無法重新整理資料');
      setError(msg);
      toast.error(msg);
    } finally {
      checkingRef.current -= 1;
      setRefreshing(false);
    }
  }, [router]);

  const handleLogout = useCallback(() => {
    leavingRef.current = true;
    clearAuth();
    setUser(null);
    void router.push('/');
  }, [router]);

  const validatePasswordChange = (): string | null => {
    if (!currentPassword || !newPassword || !confirmNewPassword) return '請填寫所有欄位';
    if (newPassword.length < 8) return '新密碼至少需要 8 個字元';
    if (newPassword.length > 128) return '新密碼長度過長';
    if (newPassword !== confirmNewPassword) return '兩次輸入的新密碼不一致';
    return null;
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    const msg = validatePasswordChange();
    if (msg) return setPasswordError(msg);
    setPasswordLoading(true);
    try {
      const data = await authChangePassword({ current_password: currentPassword, new_password: newPassword });
      toast.success(data.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setPasswordError(errorText(err, '變更密碼失敗'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const fieldA11y = {
    'aria-invalid': passwordError ? true : undefined,
    'aria-describedby': passwordError ? 'me-password-error' : undefined,
  } as const;

  const head = (
    <Head>
      <title>股海明燈｜個人中心</title>
      <meta name="description" content="檢視帳號資訊與登出。" />
    </Head>
  );
  const header = <SiteHeader icon={UserRound} title="個人中心" subtitle="帳號資訊" />;

  if (!checked) {
    return (
      <>
        {head}
        {header}
        <main className="flex flex-1 items-center justify-center py-20" aria-busy>
          <Loader2 size={40} className="animate-spin text-brand" aria-hidden />
          <span className="sr-only">載入中</span>
        </main>
      </>
    );
  }

  if (!hasToken || !getToken()) {
    return (
      <>
        {head}
        {header}
        <main className="flex flex-1 items-center justify-center px-4 py-20">
          <p className="text-sm text-muted-foreground">導向登入中…</p>
        </main>
      </>
    );
  }

  return (
    <>
      {head}
      {header}
      <main aria-label="個人中心" className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
        <AnimatedSection>
          <div className="rounded-2xl border bg-card p-6 shadow-card sm:p-8">
            <div className="mb-6 flex items-center gap-4">
              <div className="bg-brand-gradient flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-brand/20">
                <UserRound size={28} className="text-on-brand" aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold">{user?.display_name?.trim() || '使用者'}</h2>
                <p className="truncate text-xs text-muted-foreground">{user?.email ?? '—'}</p>
              </div>
            </div>

            <dl className="space-y-4 text-sm">
              <div>
                <dt className="mb-1 text-muted-foreground">電子郵件</dt>
                <dd className="break-all">{user?.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="mb-1 text-muted-foreground">顯示名稱</dt>
                <dd>{user?.display_name?.trim() ? user.display_name : <span className="text-muted-foreground">未設定</span>}</dd>
              </div>
            </dl>

            <section aria-labelledby="me-password-heading" className="mt-8 border-t pt-8">
              <div className="mb-4 flex items-center gap-2">
                <div className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl">
                  <KeyRound size={18} className="text-on-brand" aria-hidden />
                </div>
                <h3 id="me-password-heading" className="text-base font-semibold">
                  變更密碼
                </h3>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                僅適用於以電子郵件註冊並已設定密碼的帳號。若僅以 Google 登入且尚未設定本地密碼，將無法由此變更。
              </p>

              <FormError id="me-password-error" message={passwordError} />

              <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-4">
                <PasswordField
                  id="me-current-password"
                  label="目前密碼"
                  icon={Lock}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  shown={showCurrent}
                  onToggle={() => setShowCurrent((v) => !v)}
                  toggleLabels={['顯示目前密碼', '隱藏目前密碼']}
                  {...fieldA11y}
                />
                <PasswordField
                  id="me-new-password"
                  label="新密碼"
                  icon={Lock}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  shown={showNew}
                  onToggle={() => setShowNew((v) => !v)}
                  toggleLabels={['顯示新密碼', '隱藏新密碼']}
                  {...fieldA11y}
                />
                <PasswordField
                  id="me-confirm-password"
                  label="確認新密碼"
                  icon={Lock}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  shown={showConfirmNew}
                  onToggle={() => setShowConfirmNew((v) => !v)}
                  toggleLabels={['顯示確認新密碼', '隱藏確認新密碼']}
                  {...fieldA11y}
                />
                <SubmitButton loading={passwordLoading}>更新密碼</SubmitButton>
              </form>
            </section>

            {error ? (
              <div className="mt-5">
                <Notice tone="danger">{error}</Notice>
              </div>
            ) : null}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium text-subtle transition-colors hover:border-brand/40 hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? <Loader2 size={18} className="animate-spin text-brand" aria-hidden /> : <RefreshCw size={18} aria-hidden />}
                重新整理資料
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-danger-border px-4 py-3 text-sm font-medium text-danger transition-colors hover:bg-danger-muted"
              >
                <LogOut size={18} aria-hidden />
                登出
              </button>
            </div>
          </div>
        </AnimatedSection>
      </main>
    </>
  );
}
