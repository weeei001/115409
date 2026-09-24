import React, { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Lock, LogIn, Mail } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AuthCard, AuthField, AuthIntro, EMAIL_PATTERN, FormError, OrDivider, PasswordField, SubmitButton } from '@/features/auth/AuthForm';
import { GoogleSignInButton, isGoogleSignInConfigured } from '@/features/auth/GoogleSignInButton';
import { authGoogle, authLogin } from '@/lib/api/auth';
import { setAuth } from '@/lib/auth/storage';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { userFacingMessage } from '@/lib/api/errorDetail';

const errorText = (err: unknown, fallback: string) => userFacingMessage(err, fallback);

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

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setLoading(true);
      try {
        const data = await authGoogle({ id_token: credential });
        setAuth(data.access_token, data.user);
        await redirectAfterLogin();
      } catch (err) {
        setError(errorText(err, 'Google 登入失敗'));
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
    if (!EMAIL_PATTERN.test(normalizedEmail)) return setError('請輸入有效的電子郵件格式');
    // 密碼長度上限由 maxLength 擋；下限交給後端，登入頁不透露密碼規則

    setLoading(true);
    try {
      const data = await authLogin({ email: normalizedEmail, password });
      setAuth(data.access_token, data.user);
      await redirectAfterLogin();
    } catch (err) {
      setError(errorText(err, '登入失敗'));
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
      <SiteHeader icon={LogIn} title="股海明燈" subtitle="登入帳號" />

      <AuthCard glass>
        <AuthIntro icon={LogIn} title="歡迎回來" subtitle="登入您的帳號以繼續" glow />
        <FormError id="login-form-error" message={error} />
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-describedby={error ? 'login-form-error' : undefined}>
          <AuthField
            id="login-email"
            label="電子郵件"
            icon={Mail}
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
            id="login-password"
            label="密碼"
            icon={Lock}
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
          <div className="-my-2 flex justify-end">
            <Link href="/forgot-password" className="inline-flex min-h-9 items-center text-xs text-brand-text transition-colors hover:text-brand-deep">
              忘記密碼？
            </Link>
          </div>
          <SubmitButton loading={loading} icon={LogIn}>
            登入
          </SubmitButton>
        </form>

        {isGoogleSignInConfigured() ? (
          <>
            <OrDivider />
            <GoogleSignInButton onCredential={handleGoogleCredential} />
          </>
        ) : null}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          還沒有帳號？{' '}
          <Link href={registerHref} className="font-medium text-brand-text transition-colors hover:text-brand-deep">
            立即註冊
          </Link>
        </p>
      </AuthCard>
    </>
  );
}
