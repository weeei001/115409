import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { SubpageHeader } from '../components/SubpageHeader';
import { authChangePassword, authMe } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';
import { clearAuth, getStoredUser, getToken, updateStoredUser } from '../lib/auth/storage';
import type { UserPublic } from '../lib/types';

export default function MePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [checked, setChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirmNew, setShowConfirmNew] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    const token = getToken();
    if (!token) {
      void router.replace({ pathname: '/login', query: { returnUrl: '/me' } });
      setChecked(true);
      return;
    }
    setUser(getStoredUser());
    setChecked(true);
  }, [router, router.isReady]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const me = await authMe();
      updateStoredUser(me);
      setUser(me);
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : '無法重新整理資料';
      setError(msg);
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearAuth();
    setUser(null);
    void router.push('/');
  }, [router]);

  const validatePasswordChange = (): string | null => {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return '請填寫所有欄位';
    }
    if (newPassword.length < 8) {
      return '新密碼至少需要 8 個字元';
    }
    if (newPassword.length > 128) {
      return '新密碼長度過長';
    }
    if (newPassword !== confirmNewPassword) {
      return '兩次輸入的新密碼不一致';
    }
    return null;
  };

  const handleChangePassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setPasswordError(null);
      const msg = validatePasswordChange();
      if (msg) {
        setPasswordError(msg);
        return;
      }
      setPasswordLoading(true);
      try {
        const data = await authChangePassword({
          current_password: currentPassword,
          new_password: newPassword,
        });
        toast.success(data.message);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      } catch (err) {
        const m =
          err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : '變更密碼失敗';
        setPasswordError(m);
      } finally {
        setPasswordLoading(false);
      }
    },
    [currentPassword, newPassword, confirmNewPassword]
  );

  const pwdInputClass =
    'w-full pl-10 pr-11 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a] disabled:opacity-60';

  if (!checked) {
    return (
      <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 flex flex-col">
        <Head>
          <title>股海明燈｜個人中心</title>
        </Head>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={40} className="text-[#ffa95a] animate-spin" />
        </div>
      </div>
    );
  }

  if (!getToken()) {
    return (
      <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 flex flex-col">
        <Head>
          <title>股海明燈｜個人中心</title>
        </Head>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">導向登入中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 flex flex-col">
      <Head>
        <title>股海明燈｜個人中心</title>
        <meta name="description" content="檢視帳號資訊與登出。" />
      </Head>
      <SubpageHeader icon={UserRound} title="個人中心" subtitle="帳號資訊" />

      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 sm:p-8"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ffa95a] to-[#ffd45a] flex items-center justify-center shadow-lg shadow-[#ffa95a]/20">
              <UserRound size={28} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                {user?.display_name?.trim() || '使用者'}
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user?.email ?? '—'}</p>
            </div>
          </div>

          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400 mb-1">電子郵件</dt>
              <dd className="text-gray-900 dark:text-gray-100 break-all">{user?.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400 mb-1">顯示名稱</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {user?.display_name?.trim() ? user.display_name : <span className="text-gray-400">未設定</span>}
              </dd>
            </div>
          </dl>

          <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#ffa95a]/90 to-[#ffd45a]/90 flex items-center justify-center">
                <KeyRound size={18} className="text-white" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">變更密碼</h3>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 leading-relaxed">
              僅適用於以電子郵件註冊並已設定密碼的帳號。若僅以 Google 登入且尚未設定本地密碼，將無法由此變更。
            </p>

            {passwordError && (
              <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
                {passwordError}
              </div>
            )}

            <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">目前密碼</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    className={pwdInputClass}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                    aria-label={showCurrent ? '隱藏密碼' : '顯示密碼'}
                  >
                    {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">新密碼</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className={pwdInputClass}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                    aria-label={showNew ? '隱藏密碼' : '顯示密碼'}
                  >
                    {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">確認新密碼</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showConfirmNew ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className={pwdInputClass}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
                    aria-label={showConfirmNew ? '隱藏密碼' : '顯示密碼'}
                  >
                    {showConfirmNew ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={passwordLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white text-sm font-semibold shadow-lg shadow-[#ffa95a]/20 hover:shadow-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {passwordLoading ? <Loader2 size={18} className="animate-spin" /> : '更新密碼'}
              </button>
            </form>
          </div>

          {error && (
            <div className="mt-5 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200
                         hover:border-[#ffa95a] hover:text-[#ffa95a] transition-colors bg-white dark:bg-gray-700/50 cursor-pointer
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {refreshing ? (
                <Loader2 size={18} className="text-[#ffa95a] animate-spin" />
              ) : (
                <RefreshCw size={18} />
              )}
              重新整理資料
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-rose-200 dark:border-rose-800 text-sm font-medium text-rose-600 dark:text-rose-300
                         hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors cursor-pointer"
            >
              <LogOut size={18} />
              登出
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
