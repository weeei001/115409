import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { KeyRound, Lock, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AnimatedSection } from '@/components/common/AnimatedSection';
import { Ledger, LedgerPanel, LightGlyph, type LightState } from '@/components/common/Ledger';
import { LoadingRows, Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { FormError, PASSWORD_MIN_LENGTH, PasswordField, SubmitButton } from '@/features/auth/AuthForm';
import { authChangePassword, authMe } from '@/lib/api/auth';
import { ApiRequestError } from '@/lib/api/client';
import { clearAuth, getStoredUser, getToken, updateStoredUser } from '@/lib/auth/storage';
import { authAccountChange, authAccountSnapshot, useAuthAccount } from '@/lib/auth/account';
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
  /** 進頁面時 /auth/me 沒確認成功（非 401）：顯示的是暫存資料 */
  const [profileUnconfirmed, setProfileUnconfirmed] = useState(false);

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
  /** 畫面上正在顯示哪個登入身分（authAccountSnapshot）；空字串＝還沒顯示帳號資料 */
  const shownAccountRef = useRef('');
  /** 共用的登入狀態：本分頁與其他分頁的登入、登出、換帳號都會更新（02-F1） */
  const account = useAuthAccount();
  /** /auth/me 結束時加一：確認期間略過的登入狀態變動，結束後再判斷一次 */
  const [checkSettled, setCheckSettled] = useState(0);

  useEffect(() => {
    if (!router.isReady) return;
    // 舊連結 /me#notifications：通知設定已搬到 /notifications。hash 只有瀏覽器端讀得到，在 effect 裡判斷，render 不讀
    if (window.location.hash === '#notifications') {
      void router.replace('/notifications');
      return;
    }
    if (!getToken()) {
      void router.replace(LOGIN_FOR_ME);
      setChecked(true);
      return;
    }
    setHasToken(true);
    setUser(getStoredUser());
    shownAccountRef.current = authAccountSnapshot();
    let active = true;
    checkingRef.current += 1;
    authMe()
      .then((me) => {
        // 確認期間別的分頁已登出或換帳號：這份回應屬於舊身分，不顯示
        if (!active || authAccountChange(shownAccountRef.current, authAccountSnapshot()) !== 'same') return;
        updateStoredUser(me);
        setUser(me);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          leavingRef.current = true;
          clearAuth();
          void router.replace(LOGIN_FOR_ME);
          return;
        }
        // 其他錯誤：畫面沿用這台瀏覽器暫存的帳號資料，燈質記號標成熄燈
        setProfileUnconfirmed(true);
      })
      .finally(() => {
        checkingRef.current -= 1;
        if (active) setChecked(true);
        setCheckSettled((n) => n + 1);
      });
    return () => {
      active = false;
    };
    // Recheck only when the route is ready.
  }, [router.isReady]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    checkingRef.current += 1;
    try {
      const me = await authMe();
      if (authAccountChange(shownAccountRef.current, authAccountSnapshot()) !== 'same') return;
      updateStoredUser(me);
      setUser(me);
      setProfileUnconfirmed(false);
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
      setCheckSettled((n) => n + 1);
    }
  }, [router]);

  // 登入狀態變了（本分頁從主選單登出，或另一個分頁登出、換帳號）：
  // 登出就清掉畫面上的資料並回首頁，跟本頁「登出」一致（決議 D9-c18）；換成別的帳號就改顯示新帳號並重新確認。
  // /auth/me 進行中的變動多半是 API 收到 401 造成的，交給各自的 catch；結束後（checkSettled）再判斷一次
  useEffect(() => {
    if (leavingRef.current || checkingRef.current > 0) return;
    const change = authAccountChange(shownAccountRef.current, account);
    if (change === 'logout') {
      leavingRef.current = true;
      shownAccountRef.current = '';
      setHasToken(false);
      setUser(null);
      void router.push('/');
    } else if (change === 'switch') {
      shownAccountRef.current = account;
      setUser(getStoredUser());
      setError(null);
      setProfileUnconfirmed(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordError(null);
      void handleRefresh();
    } else if (shownAccountRef.current && account) {
      // 同一個人重新登入（token 換了）：記住新的快照
      shownAccountRef.current = account;
    }
  }, [account, checkSettled, router, handleRefresh]);

  const handleLogout = useCallback(() => {
    leavingRef.current = true;
    shownAccountRef.current = '';
    clearAuth();
    setUser(null);
    void router.push('/');
  }, [router]);

  const validatePasswordChange = (): string | null => {
    if (!currentPassword || !newPassword || !confirmNewPassword) return '請填寫所有欄位';
    if (newPassword.length < PASSWORD_MIN_LENGTH) return `新密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`;
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
      <meta name="description" content="檢視帳號資訊、變更密碼與管理登入狀態。" />
    </Head>
  );
  const header = <SiteHeader title="個人中心" subtitle="帳號資訊與安全設定" />;
  /** 帳號資料的燈質：重新整理中 Q、確認失敗熄燈、其餘 F */
  const profileState: LightState = refreshing ? 'loading' : error || profileUnconfirmed ? 'error' : 'ready';
  const pageClass ='mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10';

  if (!checked) {
    // 載入＝燈質 Q：有線的空白列
    return (
      <>
        {head}
        {header}
        <main className={pageClass}>
          <div className="border-t border-border-strong">
            <LoadingRows label="載入帳號資料中…" className="h-[176px]" />
          </div>
        </main>
      </>
    );
  }

  if (!hasToken || !getToken()) {
    return (
      <>
        {head}
        {header}
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <p className="text-sm text-muted-foreground">導向登入中…</p>
        </main>
      </>
    );
  }

  return (
    <>
      {head}
      {header}
      <main aria-label="個人中心" className={pageClass}>
        {/* 手機依序：帳號資料 → 變更密碼；桌機左右並排。收藏股在獨立的 /favorites 頁 */}
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-x-16">
          <AnimatedSection className="min-w-0 lg:col-span-5">
            <Ledger
              title="帳號資料"
              stamp={
                <span className="inline-flex items-center gap-1.5">
                  <LightGlyph state={profileState} />
                  {profileState === 'loading' ? '更新中' : profileState === 'error' ? '無法更新，顯示上次資料' : '已更新'}
                </span>
              }
            >
              <LedgerPanel>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center border text-muted-foreground" aria-hidden>
                    <UserRound size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{user?.display_name?.trim() || '使用者'}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{user?.email ?? '—'}</p>
                  </div>
                </div>
                {/* 帳號資料是一張有線的定義表 */}
                <dl className="grid gap-px border-y bg-border text-sm">
                  <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card py-2.5">
                    <dt className="text-muted-foreground">電子郵件</dt>
                    <dd className="min-w-0 font-mono text-[13.5px] break-all">{user?.email ?? '—'}</dd>
                  </div>
                  <div className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 bg-card py-2.5">
                    <dt className="text-muted-foreground">顯示名稱</dt>
                    <dd className="min-w-0 break-all">{user?.display_name?.trim() ? user.display_name : <span className="text-muted-foreground">未設定</span>}</dd>
                  </div>
                </dl>

                {error ? (
                  <div className="mt-4">
                    <Notice tone="danger">{error}</Notice>
                  </div>
                ) : null}

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Button type="button" variant="outline" disabled={refreshing} aria-busy={refreshing || undefined} onClick={() => void handleRefresh()}>
                    <RefreshCw size={18} aria-hidden />
                    {refreshing ? '更新中…' : '重新整理資料'}
                  </Button>
                  <Button type="button" variant="destructive" onClick={handleLogout}>
                    <LogOut size={18} aria-hidden />
                    登出
                  </Button>
                </div>
              </LedgerPanel>
            </Ledger>
          </AnimatedSection>

          <AnimatedSection delay={0.05} className="min-w-0 lg:col-span-7">
            <Ledger aria-labelledby="me-password-heading" title={<span id="me-password-heading">變更密碼</span>}>
              <LedgerPanel>
                <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                  僅適用於以電子郵件註冊並已設定密碼的帳號。只用 Google 登入的帳號沒有密碼，無法在這裡變更。
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
                  <SubmitButton loading={passwordLoading} icon={KeyRound}>
                    更新密碼
                  </SubmitButton>
                </form>
              </LedgerPanel>
            </Ledger>
          </AnimatedSection>
        </div>
      </main>
    </>
  );
}
