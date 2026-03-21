import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { TrendingUp, LogIn, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    alert('登入功能尚未開放，待 API 串接後即可使用。');
  };

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 flex flex-col">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20">
              <TrendingUp size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-gray-100">股海明燈</span>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8">
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20 mb-4">
                <LogIn size={26} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">歡迎回來</h1>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">登入您的帳號以繼續</p>
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
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm dark:text-gray-200
                               focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  密碼
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="請輸入密碼"
                    autoComplete="current-password"
                    maxLength={128}
                    className="w-full pl-10 pr-11 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm dark:text-gray-200
                               focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => router.push('/forgot-password')}
                  className="text-xs text-[#ffa95a] hover:text-[#e8953a] transition-colors"
                >
                  忘記密碼？
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white font-semibold
                           shadow-lg shadow-[#ffa95a]/20 hover:shadow-xl hover:shadow-[#ffa95a]/30
                           transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn size={18} />
                    登入
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-gray-400 dark:text-gray-500">
              還沒有帳號？{' '}
              <button
                onClick={() => router.push('/register')}
                className="text-[#ffa95a] hover:text-[#e8953a] font-medium transition-colors"
              >
                立即註冊
              </button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
