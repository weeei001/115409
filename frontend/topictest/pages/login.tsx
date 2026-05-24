import React, { useCallback, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';
import { LogIn, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { SubpageHeader } from '../components/SubpageHeader';
import { GoogleSignInButton, isGoogleSignInConfigured } from '../components/GoogleSignInButton';
import { authGoogle, authLogin } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';
import { setAuth } from '../lib/auth/storage';
import { safeReturnUrl } from '../lib/utils/returnUrl';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const postLoginPath = useMemo(() => {
    if (!router.isReady) return '/';
    return safeReturnUrl(router.query.returnUrl) ?? '/';
  }, [router.isReady, router.query.returnUrl]);

  const redirectAfterLogin = useCallback(async () => {
    await router.push(postLoginPath);
  }, [router, postLoginPath]);

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setLoading(true);
      try {
        const data = await authGoogle({ id_token: credential });
        setAuth(data.access_token, data.user);
        await redirectAfterLogin();
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
    [redirectAfterLogin]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password;
    if (!normalizedEmail || !normalizedPassword.trim()) {
      setError('請填寫所有欄位');
      return;
    }
    if (normalizedEmail.length > 254) {
      setError('電子郵件長度過長');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('請輸入有效的電子郵件格式');
      return;
    }
    if (normalizedPassword.length > 128) {
      setError('密碼長度過長');
      return;
    }

    setLoading(true);
    try {
      const data = await authLogin({ email: normalizedEmail, password: normalizedPassword });
      setAuth(data.access_token, data.user);
      await redirectAfterLogin();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : '登入失敗'
      );
    } finally {
      setLoading(false);
    }
  };

  const reduceMotion = usePrefersReducedMotionClient();

  return (
    <div className="min-h-[100dvh] flex flex-col relative">
      <Head>
        <title>股海明燈｜登入</title>
        <meta name="description" content="登入股海明燈帳號。" />
      </Head>

      <div className="relative z-10 flex flex-col min-h-[100dvh]">
        <SubpageHeader icon={LogIn} title="股海明燈" subtitle="登入帳號" />

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <motion.div
            className="w-full max-w-md"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="glass rounded-2xl shadow-[var(--shadow-elevated)] p-8">
              <div className="flex flex-col items-center mb-8">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg mb-4"
                     style={{ background: 'var(--brand-gradient)', animation: 'glow-pulse 3s ease-in-out infinite' }}>
                  <LogIn size={26} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold gradient-text">歡迎回來</h2>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">登入您的帳號以繼續</p>
              </div>

            {error && (
              <div
                id="login-form-error"
                role="alert"
                className="mb-5 px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up"
              >
                {error}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-5"
              aria-describedby={error ? 'login-form-error' : undefined}
            >
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  電子郵件
                </label>
                <div className="relative">
                  <Mail size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    disabled={loading}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--color-border)]
                               bg-[var(--color-bg-elevated)]/60 text-sm text-[var(--color-text-primary)]
                               focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                               transition-shadow disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                  密碼
                </label>
                <div className="relative">
                  <Lock size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="請輸入密碼"
                    autoComplete="current-password"
                    maxLength={128}
                    disabled={loading}
                    className="w-full pl-10 pr-11 py-2.5 rounded-xl border border-[var(--color-border)]
                               bg-[var(--color-bg-elevated)]/60 text-sm text-[var(--color-text-primary)]
                               focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand
                               transition-shadow disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => router.push('/forgot-password')}
                  className="text-xs text-brand hover:text-brand-deep transition-colors cursor-pointer"
                >
                  忘記密碼？
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="relative w-full py-3 rounded-xl text-white font-semibold
                           shadow-lg hover:shadow-[0_0_24px_var(--glow-brand-strong)]
                           transition-[opacity,box-shadow,transform] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer overflow-hidden"
                style={{ background: 'var(--brand-gradient)' }}
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    <LogIn size={18} />
                    登入
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
                    <span className="px-3 bg-[var(--color-bg-card)]/80 rounded text-[var(--color-text-muted)] backdrop-blur-sm">
                      或使用
                    </span>
                  </div>
                </div>
                <GoogleSignInButton onCredential={handleGoogleCredential} />
              </>
            ) : null}

            <div className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
              還沒有帳號？{' '}
              <button
                type="button"
                onClick={() => router.push('/register')}
                className="text-brand hover:text-brand-deep font-medium transition-colors cursor-pointer"
              >
                立即註冊
              </button>
            </div>
          </div>
        </motion.div>
        </main>
      </div>
    </div>
  );
}
