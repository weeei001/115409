import React, { useCallback, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Lock, Mail, User, UserPlus } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AuthCard, AuthField, AuthIntro, EMAIL_PATTERN, FormError, OrDivider, PasswordField, SubmitButton } from '@/features/auth/AuthForm';
import { GoogleSignInButton, isGoogleSignInConfigured } from '@/features/auth/GoogleSignInButton';
import { authGoogle, authRegister } from '@/lib/api/auth';
import { setAuth } from '@/lib/auth/storage';
import { safeReturnUrl } from '@/lib/utils/returnUrl';
import { userFacingMessage } from '@/lib/api/errorDetail';

const errorText = (err: unknown, fallback: string) => userFacingMessage(err, fallback);

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnUrl = router.isReady ? safeReturnUrl(router.query.returnUrl) : null;
  // 「返回登入」也帶上 returnUrl（決議 c78）
  const loginHref = returnUrl ? `/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/login';
  // 註冊成功（含 Google）依 returnUrl 導向，沒有才回首頁（決議 D9-c19）
  const redirectAfterAuth = useCallback(() => router.push(returnUrl ?? '/'), [router, returnUrl]);

  const validate = (): string | null => {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    // 姓名選填（決議 D9-c19）
    if (!normalizedEmail || !password || !confirmPassword) return '請填寫所有欄位';
    if (normalizedName.length > 255) return '顯示名稱長度過長';
    if (normalizedEmail.length > 254) return '電子郵件長度過長';
    if (!EMAIL_PATTERN.test(normalizedEmail)) return '請輸入有效的電子郵件格式';
    if (password.length < 8) return '密碼至少需要 8 個字元';
    // 上限由 maxLength 擋；後端也會回覆超長錯誤
    if (password !== confirmPassword) return '兩次輸入的密碼不一致';
    return null;
  };

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setLoading(true);
      try {
        const data = await authGoogle({ id_token: credential });
        setAuth(data.access_token, data.user);
        await redirectAfterAuth();
      } catch (err) {
        setError(errorText(err, 'Google 登入失敗'));
      } finally {
        setLoading(false);
      }
    },
    [redirectAfterAuth],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // 防止快速雙擊送出
    const msg = validate();
    if (msg) return setError(msg);
    setError(null);
    setLoading(true);
    try {
      const data = await authRegister({
        email: email.trim().toLowerCase(),
        password,
        display_name: name.trim() || null,
      });
      setAuth(data.access_token, data.user);
      await redirectAfterAuth();
    } catch (err) {
      setError(errorText(err, '註冊失敗'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>股海明燈｜註冊</title>
        <meta name="description" content="建立股海明燈帳號。" />
      </Head>
      <SiteHeader icon={UserPlus} title="股海明燈" subtitle="建立帳號" />

      <AuthCard glass>
        <AuthIntro icon={UserPlus} title="建立帳號" subtitle="開始您的投資旅程" glow />
        <FormError id="register-form-error" message={error} />
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-describedby={error ? 'register-form-error' : undefined}>
          <AuthField
            id="register-name"
            label={
              <>
                姓名 <span className="font-normal text-muted-foreground">（選填）</span>
              </>
            }
            icon={User}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="您的姓名"
            autoComplete="name"
            maxLength={255}
            disabled={loading}
          />
          <AuthField
            id="register-email"
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
            id="register-password"
            label="密碼"
            icon={Lock}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8～128 個字元"
            autoComplete="new-password"
            maxLength={128}
            disabled={loading}
            shown={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
            toggleLabels={['顯示密碼', '隱藏密碼']}
          />
          <PasswordField
            id="register-confirm"
            label="確認密碼"
            icon={Lock}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次輸入密碼"
            autoComplete="new-password"
            maxLength={128}
            disabled={loading}
            shown={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            toggleLabels={['顯示確認密碼', '隱藏確認密碼']}
          />
          <SubmitButton loading={loading} icon={UserPlus}>
            註冊
          </SubmitButton>
        </form>

        {isGoogleSignInConfigured() ? (
          <>
            <OrDivider />
            <GoogleSignInButton onCredential={handleGoogleCredential} />
          </>
        ) : null}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          已有帳號？{' '}
          <Link href={loginHref} className="font-medium text-brand-text transition-colors hover:text-brand-deep">
            返回登入
          </Link>
        </p>
      </AuthCard>
    </>
  );
}
