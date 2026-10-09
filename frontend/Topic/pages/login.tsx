import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LogIn } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Notice } from '@/components/common/Notice';
import {
  AuthAltRow,
  AuthField,
  AuthLedger,
  AuthLinkRow,
  AuthPanel,
  AuthPlate,
  EMAIL_INVALID_MESSAGE,
  EMAIL_PATTERN,
  FieldRows,
  FormActions,
  FormError,
  PasswordField,
  SubmitButton,
  authLinkClass,
} from '@/features/auth/AuthForm';
import { GoogleSignInButton, isGoogleSignInConfigured } from '@/features/auth/GoogleSignInButton';
import { authGoogle, authLogin } from '@/lib/api/auth';
import { getStoredUser, getToken, setAuth } from '@/lib/auth/storage';
import { useAuthAccount } from '@/lib/auth/account';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { ROUTE_PAGE_LABELS } from '@/lib/nav';
import { cn } from '@/lib/cn';
import { userFacingMessage } from '@/lib/api/errorDetail';


/** 登入後要回到的頁面名稱：用導覽的頁名，沒有對應時直接寫路徑 */
function returnPageName(url: string): string {
  const path = url.split(/[?#]/)[0] || '/';
  return ROUTE_PAGE_LABELS[path] ?? path;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnUrl = router.isReady ? safeReturnUrl(router.query.returnUrl) : null;
  // 有 returnUrl 時，「立即註冊」也帶上（決議 D9-c19）
  const registerHref = useMemo(() => (returnUrl ? `/register?returnUrl=${encodeURIComponent(returnUrl)}` : '/register'), [returnUrl]);

  const redirectAfterLogin = useCallback(() => router.push(returnUrl ?? '/'), [router, returnUrl]);

  // 已登入時打開登入頁（例如另一個分頁還停在未登入的收藏頁，按了「登入」）：
  // 有 returnUrl 就直接回去（03-F17）；returnUrl 已先經過 safeReturnUrl（P1-33），只會是站內路徑。
  // 只在頁面就緒時判斷一次，在這頁登入成功後的導頁由 redirectAfterLogin 負責
  const checkedSignedIn = useRef(false);
  useEffect(() => {
    if (!router.isReady || checkedSignedIn.current) return;
    checkedSignedIn.current = true;
    if (getToken() && returnUrl) void router.replace(returnUrl);
  }, [router, returnUrl]);
  const account = useAuthAccount();
  const signedInEmail = account ? getStoredUser()?.email ?? null : null;

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setLoading(true);
      try {
        const data = await authGoogle({ id_token: credential });
        setAuth(data.access_token, data.user);
        await redirectAfterLogin();
      } catch (err) {
        setError(userFacingMessage(err, 'Google 登入失敗'));
      } finally {
        setLoading(false);
      }
    },
    [redirectAfterLogin],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // 防止快速雙擊送出
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password.trim()) return setError('請填寫所有欄位');
    if (normalizedEmail.length > 254) return setError('電子郵件長度過長');
    if (!EMAIL_PATTERN.test(normalizedEmail)) return setError(EMAIL_INVALID_MESSAGE);
    // 密碼長度上限由 maxLength 擋；下限交給後端，登入頁不透露密碼規則

    setLoading(true);
    try {
      const data = await authLogin({ email: normalizedEmail, password });
      setAuth(data.access_token, data.user);
      await redirectAfterLogin();
    } catch (err) {
      setError(userFacingMessage(err, '登入失敗'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>股海明燈｜登入</title>
        <meta name="description" content="登入股海明燈帳號。" />
      </Head>
      <SiteHeader title="登入" subtitle="登入後可以保存 AI 對話、收藏股與模擬投資" />

      <AuthLedger
        aside={
          // 亮著燈的那扇窗：有人在值班。說明寫副標沒說的事——登入狀態留在哪裡
          <AuthPlate poster={3} caption="觀測台的窗" ratio="photo">
            登入狀態存在這台瀏覽器，關掉分頁也還在；共用電腦用完記得從選單登出。
          </AuthPlate>
        }
        form={
          <AuthPanel
            id="login-form-heading"
            title="電子郵件登入"
            footer={
              <>
                {isGoogleSignInConfigured() ? (
                  <AuthAltRow>
                    <GoogleSignInButton onCredential={handleGoogleCredential} />
                  </AuthAltRow>
                ) : null}
                <AuthLinkRow href={registerHref} lead="還沒有帳號？">
                  建立新帳號
                </AuthLinkRow>
              </>
            }
          >
            {account && !returnUrl ? (
              <Notice className="mt-3 mb-1">
                你目前已登入{signedInEmail ? `（${signedInEmail}）` : ''}。在這裡登入其他帳號，會取代目前的登入。
              </Notice>
            ) : returnUrl ? (
              <Notice className="mt-3 mb-1">登入後會回到「{returnPageName(returnUrl)}」。</Notice>
            ) : null}
            <FormError id="login-form-error" message={error} />
            <form onSubmit={handleSubmit} aria-describedby={error ? 'login-form-error' : undefined}>
              <FieldRows>
                <AuthField
                  row
                  id="login-email"
                  label="電子郵件"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  disabled={loading}
                />
                <PasswordField
                  row
                  id="login-password"
                  label="密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={loading}
                  shown={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  toggleLabels={['顯示密碼', '隱藏密碼']}
                />
              </FieldRows>
              <FormActions>
                <SubmitButton loading={loading} icon={LogIn} className="sm:w-auto sm:min-w-44">
                  登入
                </SubmitButton>
                <Link href="/forgot-password" className={cn('inline-flex min-h-11 items-center text-sm', authLinkClass)}>
                  忘記密碼？
                </Link>
              </FormActions>
            </form>
          </AuthPanel>
        }
      />
    </>
  );
}
