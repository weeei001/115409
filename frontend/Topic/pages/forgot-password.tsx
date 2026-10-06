import React, { useState } from 'react';
import Head from 'next/head';
import { KeyRound, Mail } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { NextStep } from '@/components/common/Ledger';
import { Notice } from '@/components/common/Notice';
import { AuthField, AuthLedger, AuthLinkRow, AuthPanel, AuthSteps, EMAIL_INVALID_MESSAGE, EMAIL_PATTERN, FieldRows, FormActions, FormError, SubmitButton } from '@/features/auth/AuthForm';
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
    if (!EMAIL_PATTERN.test(normalized)) return setError(EMAIL_INVALID_MESSAGE);

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

  const backToLogin = (
    <AuthLinkRow href="/login" lead="想起密碼了？">
      返回登入
    </AuthLinkRow>
  );

  return (
    <>
      <Head>
        <title>股海明燈｜忘記密碼</title>
        <meta name="description" content="申請重設連結，寄到註冊用的電子郵件。" />
      </Head>
      <SiteHeader icon={KeyRound} title="忘記密碼" subtitle="填寫註冊用的電子郵件，系統會寄出重設連結" />

      <AuthLedger
        asideOnMobile
        aside={<AuthSteps current={sent ? 2 : 1} />}
        form={
          sent ? (
            <AuthPanel
              id="forgot-sent-heading"
              title="申請已送出"
              footer={
                <NextStep href="/login">返回登入</NextStep>
              }
            >
              <div className="space-y-4 pt-4">
                <Notice tone="success">{successMessage ?? '如果這個電子郵件已註冊，你會收到重設連結。'}</Notice>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  申請的地址：<span className="font-mono break-all text-foreground">{email.trim().toLowerCase()}</span>
                  <br />
                  開啟信中的連結就會回到本站設定新密碼；沒看到信時，先檢查垃圾郵件匣。
                </p>
              </div>
            </AuthPanel>
          ) : (
            <AuthPanel id="forgot-form-heading" title="申請重設連結" footer={backToLogin}>
              <FormError id="forgot-form-error" message={error} />
              <form onSubmit={handleSubmit} aria-describedby={error ? 'forgot-form-error' : undefined}>
                <FieldRows>
                  <AuthField
                    row
                    id="forgot-email"
                    label="電子郵件"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    disabled={loading}
                  />
                </FieldRows>
                <FormActions>
                  <SubmitButton loading={loading} icon={Mail} className="sm:w-auto sm:min-w-44">
                    發送重設連結
                  </SubmitButton>
                </FormActions>
              </form>
            </AuthPanel>
          )
        }
      />
    </>
  );
}
