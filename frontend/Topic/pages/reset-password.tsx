import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { KeyRound } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { NextStep } from '@/components/common/Ledger';
import { LoadingRows, Notice } from '@/components/common/Notice';
import { AuthLedger, AuthLinkRow, AuthPanel, AuthSteps, FieldRows, FormActions, FormError, PASSWORD_MIN_LENGTH, PasswordField, SubmitButton } from '@/features/auth/AuthForm';
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
    if (password.length < PASSWORD_MIN_LENGTH) return `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`;
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

  let form: React.ReactNode;
  if (!ready) {
    // 載入＝燈質 Q：有線的空白列，並寫出「讀取中」
    form = (
      <AuthPanel id="reset-loading-heading" title="設定新密碼">
        <LoadingRows label="確認重設連結中…" className="h-[132px]" />
      </AuthPanel>
    );
  } else if (!token) {
    form = (
      <AuthPanel
        id="reset-invalid-heading"
        title="連結不完整"
        footer={
          <>
            <NextStep href="/forgot-password">重新申請重設連結</NextStep>
            <AuthLinkRow href="/login">返回登入</AuthLinkRow>
          </>
        }
      >
        <div className="space-y-4 pt-4">
          <Notice tone="danger">這個網址少了重設用的驗證碼，無法設定新密碼。</Notice>
          <p className="text-[13px] leading-relaxed text-muted-foreground">請從重設密碼信件裡的連結開啟此頁；找不到信或連結已失效時，重新申請一次。</p>
        </div>
      </AuthPanel>
    );
  } else if (done) {
    form = (
      <AuthPanel id="reset-done-heading" title="密碼已更新" footer={<NextStep href="/login">用新密碼登入</NextStep>}>
        <div className="pt-4">
          <Notice tone="success">{successMessage ?? '密碼已重設，請使用新密碼登入。'}</Notice>
        </div>
      </AuthPanel>
    );
  } else {
    form = (
      <AuthPanel
        id="reset-form-heading"
        title="設定新密碼"
        footer={
          <AuthLinkRow href="/login" lead="想起密碼了？">
            返回登入
          </AuthLinkRow>
        }
      >
        <FormError id="reset-form-error" message={error} />
        <form onSubmit={(e) => void handleSubmit(e)} aria-describedby={error ? 'reset-form-error' : undefined}>
          <FieldRows>
            <PasswordField
              row
              id="reset-password-new"
              label="新密碼"
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
              row
              id="reset-password-confirm"
              label="確認新密碼"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              maxLength={128}
              disabled={loading}
              shown={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
              toggleLabels={['顯示確認密碼', '隱藏確認密碼']}
            />
          </FieldRows>
          <FormActions>
            <SubmitButton loading={loading} icon={KeyRound} className="sm:w-auto sm:min-w-44">
              重設密碼
            </SubmitButton>
          </FormActions>
        </form>
      </AuthPanel>
    );
  }

  return (
    <>
      <Head>
        <title>股海明燈｜重設密碼</title>
        <meta name="description" content="以電子郵件連結重設登入密碼。" />
      </Head>
      <SiteHeader title="重設密碼" subtitle="從重設信件的連結開啟，設定新的登入密碼" />

      <AuthLedger
        asideOnMobile
        // 沒有驗證碼＝還停在「開啟信中的連結」那一步
        aside={<AuthSteps current={ready && !token ? 2 : 3} done={done} />}
        form={form}
      />
    </>
  );
}
