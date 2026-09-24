import React, { useState } from 'react';
import Head from 'next/head';
import { ArrowLeft, CheckCircle, KeyRound, Mail } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AuthCard, AuthField, AuthIntro, AuthStatusIcon, BackToLogin, BrandLinkButton, EMAIL_PATTERN, FormError, SubmitButton } from '@/features/auth/AuthForm';
import { authForgotPassword } from '@/lib/api/auth';
import { userFacingMessage } from '@/lib/api/errorDetail';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // 防止快速雙擊送出
    setError(null);
    const normalized = email.trim().toLowerCase();
    if (!normalized) return setError('請輸入電子郵件');
    if (!EMAIL_PATTERN.test(normalized)) return setError('請輸入有效的電子郵件格式');

    setLoading(true);
    try {
      const data = await authForgotPassword({ email: normalized });
      setSuccessMessage(data.message);
      setSent(true);
    } catch (err) {
      setError(userFacingMessage(err, '申請失敗，請稍後再試'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>股海明燈｜忘記密碼</title>
        <meta name="description" content="申請重設密碼連結至您的電子郵件。" />
      </Head>
      <SiteHeader icon={KeyRound} title="股海明燈" subtitle="重設密碼" />

      <AuthCard>
        {sent ? (
          <div className="flex flex-col items-center text-center" role="status">
            <AuthStatusIcon icon={CheckCircle} tone="success" />
            <h2 className="mb-2 text-2xl font-bold">申請已送出</h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{successMessage ?? '若此 email 已註冊且可重設密碼，您將收到重設連結。'}</p>
            <BrandLinkButton href="/login" icon={ArrowLeft}>
              返回登入
            </BrandLinkButton>
          </div>
        ) : (
          <>
            <AuthIntro icon={KeyRound} title="忘記密碼" subtitle="輸入您的電子郵件，我們將發送重設連結" />
            <FormError id="forgot-form-error" message={error} />
            <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-describedby={error ? 'forgot-form-error' : undefined}>
              <AuthField
                id="forgot-email"
                label="電子郵件"
                icon={Mail}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={loading}
              />
              <SubmitButton loading={loading} icon={Mail}>
                發送重設連結
              </SubmitButton>
            </form>
            <BackToLogin />
          </>
        )}
      </AuthCard>
    </>
  );
}
