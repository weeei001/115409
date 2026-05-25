import React, { useCallback, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { UserPlus, Mail, Lock, Eye, EyeOff, User, Loader2 } from 'lucide-react';
import { SubpageHeader } from '../components/SubpageHeader';
import { GoogleSignInButton, isGoogleSignInConfigured } from '../components/GoogleSignInButton';
import { authGoogle, authRegister } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';
import { setAuth } from '../lib/auth/storage';

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

  const validate = (): string | null => {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName || !normalizedEmail || !password || !confirmPassword) {
      return '請填寫所有欄位';
    }
    if (normalizedName.length > 255) {
      return '顯示名稱長度過長';
    }
    if (normalizedEmail.length > 254) {
      return '電子郵件長度過長';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return '請輸入有效的電子郵件格式';
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

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setLoading(true);
      try {
        const data = await authGoogle({ id_token: credential });
        setAuth(data.access_token, data.user);
        await router.push('/');
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Google 登入失敗'
        );
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();
    setLoading(true);
    try {
      const data = await authRegister({
        email: normalizedEmail,
        password,
        display_name: normalizedName || null,
      });
      setAuth(data.access_token, data.user);
      await router.push('/');
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : '註冊失敗'
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand focus:shadow-[0_0_16px_rgba(255,169,90,0.12)] transition-shadow disabled:opacity-60';

  const reduceMotion = usePrefersReducedMotionClient();

  return (
    <div className="min-h-[100dvh] flex flex-col relative">
      <Head>
        <title>股海明燈｜註冊</title>
        <meta name="description" content="建立股海明燈帳號。" />
      </Head>

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        <SubpageHeader icon={UserPlus} title="股海明燈" subtitle="建立帳號" />

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <motion.div
            className="w-full max-w-md"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }
            }
          >
            <div className="glass rounded-2xl shadow-xl shadow-black/10 dark:shadow-brand/5 p-8">
              <div className="flex flex-col items-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand to-brand-light flex items-center justify-center shadow-lg shadow-brand/20 mb-4" style={{ animation: 'glow-pulse 3s ease-in-out infinite' }}>
                  <UserPlus size={26} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold gradient-text">建立帳號</h2>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">開始您的投資旅程</p>
              </div>

            {error && (
              <div
                id="register-form-error"
                role="alert"
                className="mb-5 px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up"
              >
                {error}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-5"
              aria-describedby={error ? 'register-form-error' : undefined}
            >
              <div>
                <label htmlFor="register-name" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  姓名
                </label>
                <div className="relative">
                  <User size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    id="register-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="您的姓名"
                    autoComplete="name"
                    maxLength={255}
                    disabled={loading}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-email" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  電子郵件
                </label>
                <div className="relative">
                  <Mail size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    id="register-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    disabled={loading}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-password" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  密碼
                </label>
                <div className="relative">
                  <Lock size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    id="register-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="8～128 個字元"
                    autoComplete="new-password"
                    maxLength={128}
                    disabled={loading}
                    className="w-full pl-10 pr-11 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="register-confirm" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  確認密碼
                </label>
                <div className="relative">
                  <Lock size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    id="register-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次輸入密碼"
                    autoComplete="new-password"
                    maxLength={128}
                    disabled={loading}
                    className="w-full pl-10 pr-11 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? '隱藏確認密碼' : '顯示確認密碼'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
                  >
                    {showConfirm ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="relative w-full py-3 rounded-xl bg-gradient-to-r from-brand to-brand-light text-white font-semibold
                           shadow-lg shadow-brand/20 hover:shadow-[0_0_24px_var(--glow-brand-strong)]
                           transition-[opacity,box-shadow,transform] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer overflow-hidden"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <UserPlus size={18} />
                    註冊
                  </>
                )}
              </button>
            </form>

            {isGoogleSignInConfigured() ? (
              <>
                <div className="relative my-8">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--color-border)]" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-[var(--color-bg-elevated)]/60 rounded text-[var(--color-text-muted)] backdrop-blur-sm">
                      或使用
                    </span>
                  </div>
                </div>
                <GoogleSignInButton onCredential={handleGoogleCredential} />
              </>
            ) : null}

            <div className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
              已有帳號？{' '}
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="text-brand hover:text-brand-deep font-medium transition-colors cursor-pointer"
              >
                返回登入
              </button>
            </div>
          </div>
        </motion.div>
        </main>
      </div>
    </div>
  );
}
