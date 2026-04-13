import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { KeyRound, Mail, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { SubpageHeader } from '../components/SubpageHeader';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('請輸入電子郵件');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('請輸入有效的電子郵件格式');
      return;
    }

    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 flex flex-col">
      <Head>
        <title>股海明燈｜重設密碼</title>
        <meta name="description" content="重設密碼流程（模擬功能，展示／專題用途）。" />
      </Head>
      <SubpageHeader icon={KeyRound} title="股海明燈" subtitle="重設密碼" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8">
            {sent ? (
              <div className="flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center mb-4">
                  <CheckCircle size={30} className="text-green-500" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">郵件已發送</h1>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                  重設密碼的連結已發送至 <span className="font-medium text-gray-600 dark:text-gray-300">{email}</span>，請至信箱查看。
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
                  （目前為模擬功能，實際上尚未發送郵件）
                </p>
                <button
                  onClick={() => router.push('/login')}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a]
                             text-white font-semibold shadow-lg shadow-[#ffa95a]/20 hover:shadow-xl hover:shadow-[#ffa95a]/30 transition-all cursor-pointer"
                >
                  <ArrowLeft size={16} />
                  返回登入
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20 mb-4">
                    <KeyRound size={26} className="text-white" />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">忘記密碼</h1>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">輸入您的電子郵件，我們將發送重設連結</p>
                </div>

                {error && (
                  <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      電子郵件
                    </label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm dark:text-gray-200
                                   focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white font-semibold
                               shadow-lg shadow-[#ffa95a]/20 hover:shadow-xl hover:shadow-[#ffa95a]/30
                               transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
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
                    onClick={() => router.push('/login')}
                    className="text-sm text-[#ffa95a] hover:text-[#e8953a] font-medium transition-colors flex items-center gap-1 mx-auto cursor-pointer"
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
