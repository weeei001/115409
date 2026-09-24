import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CheckCircle, KeyRound, Loader2, Lock, LogIn } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AuthCard, AuthIntro, AuthStatusIcon, BackToLogin, BrandLinkButton, FormError, PasswordField, SubmitButton } from '@/features/auth/AuthForm';
import { authResetPassword } from '@/lib/api/auth';
import { useHydrated } from '@/lib/hooks/useClientEnv';
import { userFacingMessage } from '@/lib/api/errorDetail';

/** 後端 FRONTEND_PASSWORD_RESET_URL 指向此頁（不含 query），信件連結會帶 ?token= */
function tokenFromQuery(q: string | string[] | undefined): string | null {
  const s = Array.isArray(q) ? q[0] : q;
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > 0 ? t : null;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 沒有 query 時，Next 在瀏覽器第一次渲染就是 isReady，伺服器卻不是；等 hydration 完再判斷，兩邊畫面才一致
  const hydrated = useHydrated();
  const ready = hydrated && router.isReady;
  const token = useMemo(() => (ready ? tokenFromQuery(router.query.token) : null), [ready, router.query.token]);

  const validate = (): string | null => {
    if (!password || !confirmPassword) return '請填寫所有欄位';
    if (password.length < 8) return '密碼至少需要 8 個字元';
    if (password.length > 128) return '密碼長度過長';
    if (password !== confirmPassword) return '兩次輸入的密碼不一致';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // 防止快速雙擊送出
    setError(null);
    if (!token) return setError('連結無效，請重新申請重設密碼。');
    const msg = validate();
    if (msg) return setError(msg);

    setLoading(true);
    try {
      const data = await authResetPassword({ token, new_password: password });
      setSuccessMessage(data.message);
      setDone(true);
    } catch (err) {
      setError(userFacingMessage(err, '重設失敗，請稍後再試'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>股海明燈｜設定新密碼</title>
        <meta name="description" content="以電子郵件連結重設登入密碼。" />
      </Head>
      <SiteHeader icon={KeyRound} title="股海明燈" subtitle="設定新密碼" />

      <AuthCard>
        {!ready ? (
          <div className="flex justify-center py-12" aria-busy aria-live="polite">
            <Loader2 size={40} className="animate-spin text-brand" aria-hidden />
            <span className="sr-only">載入中</span>
          </div>
        ) : !token ? (
          <div className="text-center">
            <AuthStatusIcon icon={KeyRound} tone="brand" />
            <h2 className="mb-2 text-xl font-bold">連結不完整</h2>
            <p className="mb-6 text-sm text-muted-foreground">請從重設密碼信件開啟此頁，或重新申請重設連結。</p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/forgot-password"
                className="flex min-h-11 items-center justify-center rounded-xl border px-5 py-2.5 text-sm font-medium text-subtle transition-colors hover:border-brand/40"
              >
                忘記密碼
              </Link>
              <BrandLinkButton href="/login" icon={LogIn}>
                前往登入
              </BrandLinkButton>
            </div>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center text-center" role="status">
            <AuthStatusIcon icon={CheckCircle} tone="success" />
            <h2 className="mb-2 text-2xl font-bold">密碼已更新</h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{successMessage ?? '密碼已重設，請使用新密碼登入。'}</p>
            <BrandLinkButton href="/login" icon={LogIn}>
              前往登入
            </BrandLinkButton>
          </div>
        ) : (
          <>
            <AuthIntro icon={KeyRound} title="設定新密碼" subtitle="請輸入 8～128 個字元的新密碼" />
            <FormError id="reset-form-error" message={error} />
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5" aria-describedby={error ? 'reset-form-error' : undefined}>
              <PasswordField
                id="reset-password-new"
                label="新密碼"
                icon={Lock}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
                disabled={loading}
                shown={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
                toggleLabels={['顯示密碼', '隱藏密碼']}
              />
              <PasswordField
                id="reset-password-confirm"
                label="確認新密碼"
                icon={Lock}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
                disabled={loading}
                shown={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                toggleLabels={['顯示確認密碼', '隱藏確認密碼']}
              />
              <SubmitButton loading={loading}>重設密碼</SubmitButton>
            </form>
            <BackToLogin />
          </>
        )}
      </AuthCard>
    </>
  );
}
