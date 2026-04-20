import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion, useReducedMotion } from 'motion/react';
import { KeyRound, Mail, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { SubpageHeader } from '../components/SubpageHeader';
import { authForgotPassword } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const reduceMotion = useReducedMotion();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError('請輸入電子郵件');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError('請輸入有效的電子郵件格式');
      return;
    }

    setLoading(true);
    try {
      const data = await authForgotPassword({ email: normalized });
      setSuccessMessage(data.message);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : '申請失敗，請稍後再試'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Head>
        <title>股海明燈｜重設密碼</title>
        <meta name="description" content="申請重設密碼連結至您的電子郵件。" />
      </Head>
      <SubpageHeader icon={KeyRound} title="股海明燈" subtitle="重設密碼" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          className="w-full max-w-md"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5 }}
        >
          <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm p-8">
            {sent ? (
              <div className="flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-down-muted flex items-center justify-center mb-4">
                  <CheckCircle size={30} className="text-down" />
                </div>
                <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">申請已送出</h2>
                <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed">
                  {successMessage ?? '若此 email 已註冊且可重設密碼，您將收到重設連結。'}
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold shadow-lg shadow-brand/20 hover:shadow-xl transition-all cursor-pointer"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  <ArrowLeft size={16} />
                  返回登入
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center mb-8">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shadow-brand/20 mb-4" style={{ background: 'var(--brand-gradient)' }}>
                    <KeyRound size={26} className="text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">忘記密碼</h2>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">輸入您的電子郵件，我們將發送重設連結</p>
                </div>

                {error && (
                  <div
                    id="forgot-form-error"
                    role="alert"
                    className="mb-5 px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up"
                  >
                    {error}
                  </div>
                )}

                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-5"
                  aria-describedby={error ? 'forgot-form-error' : undefined}
                >
                  <div>
                    <label htmlFor="forgot-email" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                      電子郵件
                    </label>
                    <div className="relative">
                      <Mail size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <input
                        id="forgot-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        disabled={loading}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-sm text-[var(--color-text-primary)]
                                   focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    aria-busy={loading}
                    className="w-full py-3 rounded-xl text-white font-semibold
                               shadow-lg shadow-brand/20 hover:shadow-xl
                               transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    style={{ background: 'var(--brand-gradient)' }}
                  >
                    {loading ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <>
                        <Mail size={18} />
                        發送重設連結
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => router.push('/login')}
                    className="text-sm text-brand hover:text-brand-deep font-medium transition-colors flex items-center gap-1 mx-auto cursor-pointer"
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
