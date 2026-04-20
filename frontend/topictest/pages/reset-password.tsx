import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, useReducedMotion } from 'motion/react';
import { KeyRound, Lock, Eye, EyeOff, Loader2, LogIn, CheckCircle, ArrowLeft } from 'lucide-react';
import { SubpageHeader } from '../components/SubpageHeader';
import { authResetPassword } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';

/** 後端 FRONTEND_PASSWORD_RESET_URL 應指向此頁完整 URL（無 query），例如 http://localhost:3000/reset-password */

function tokenFromQuery(q: string | string[] | undefined): string | null {
  if (q === undefined) return null;
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

  const token = useMemo(
    () => (router.isReady ? tokenFromQuery(router.query.token) : null),
    [router.isReady, router.query.token]
  );

  const validate = (): string | null => {
    if (!password || !confirmPassword) {
      return '請填寫所有欄位';
    }
    if (password.length < 8) {
      return '密碼至少需要 8 個字元';
    }
    if (password.length > 128) {
      return '密碼長度過長';
    }
    if (password !== confirmPassword) {
      return '兩次輸入的密碼不一致';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('連結無效，請重新申請重設密碼。');
      return;
    }
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }

    setLoading(true);
    try {
      const data = await authResetPassword({ token, new_password: password });
      setSuccessMessage(data.message);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : '重設失敗，請稍後再試'
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full pl-10 pr-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-60';

  const ready = router.isReady;
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen flex flex-col">
      <Head>
        <title>股海明燈｜設定新密碼</title>
        <meta name="description" content="以電子郵件連結重設登入密碼。" />
      </Head>
      <SubpageHeader icon={KeyRound} title="股海明燈" subtitle="設定新密碼" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          className="w-full max-w-md"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5 }}
        >
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm p-8">
            {!ready ? (
              <div className="flex justify-center py-12" aria-busy aria-live="polite">
                <Loader2 size={40} className="text-brand animate-spin" aria-hidden />
                <span className="sr-only">載入中</span>
              </div>
            ) : !token ? (
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-brand/8 dark:bg-brand/15 flex items-center justify-center mx-auto mb-4">
                  <KeyRound size={26} className="text-brand-deep dark:text-brand" />
                </div>
                <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">連結不完整</h2>
                <p className="text-sm text-[var(--color-text-muted)] mb-6">
                  請從重設密碼信件開啟此頁，或重新申請重設連結。
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    type="button"
                    onClick={() => void router.push('/forgot-password')}
                    className="px-5 py-2.5 rounded-xl border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-secondary)] hover:border-brand/40 transition-colors cursor-pointer"
                  >
                    忘記密碼
                  </button>
                  <button
                    type="button"
                    onClick={() => void router.push('/login')}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold shadow-lg shadow-brand/20 cursor-pointer"
                    style={{ background: 'var(--brand-gradient)' }}
                  >
                    <LogIn size={16} />
                    前往登入
                  </button>
                </div>
              </div>
            ) : done ? (
              <div className="flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-down-muted flex items-center justify-center mb-4">
                  <CheckCircle size={30} className="text-down" />
                </div>
                <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">密碼已更新</h2>
                <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">
                  {successMessage ?? '密碼已重設，請使用新密碼登入。'}
                </p>
                <button
                  type="button"
                  onClick={() => void router.push('/login')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold shadow-lg shadow-brand/20 hover:shadow-xl transition-all cursor-pointer"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  <LogIn size={16} />
                  前往登入
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center mb-8">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-brand/20 mb-4" style={{ background: 'var(--brand-gradient)' }}>
                    <KeyRound size={26} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">設定新密碼</h2>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">請輸入 8～128 個字元的新密碼</p>
                </div>

                {error && (
                  <div
                    id="reset-form-error"
                    role="alert"
                    className="mb-5 px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up"
                  >
                    {error}
                  </div>
                )}

                <form
                  onSubmit={(e) => void handleSubmit(e)}
                  className="flex flex-col gap-5"
                  aria-describedby={error ? 'reset-form-error' : undefined}
                >
                  <div>
                    <label htmlFor="reset-password-new" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                      新密碼
                    </label>
                    <div className="relative">
                      <Lock size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <input
                        id="reset-password-new"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={loading}
                        className={`${inputClass} pr-12 rounded-xl`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
                        aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                      >
                        {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="reset-password-confirm" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                      確認新密碼
                    </label>
                    <div className="relative">
                      <Lock size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <input
                        id="reset-password-confirm"
                        type={showConfirm ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        disabled={loading}
                        className={`${inputClass} pr-12 rounded-xl`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
                        aria-label={showConfirm ? '隱藏確認密碼' : '顯示密碼'}
                      >
                        {showConfirm ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    aria-busy={loading}
                    className="w-full py-3 rounded-xl text-white font-semibold shadow-lg shadow-brand/20 hover:shadow-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    style={{ background: 'var(--brand-gradient)' }}
                  >
                    {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : '重設密碼'}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => void router.push('/login')}
                    className="text-sm text-brand hover:text-brand-deep font-medium transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft size={14} />
                    返回登入
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
