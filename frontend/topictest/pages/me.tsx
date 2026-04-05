import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { LogOut, Loader2, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { SubpageHeader } from '../components/SubpageHeader';
import { authMe } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';
import { clearAuth, getStoredUser, getToken, updateStoredUser } from '../lib/auth/storage';
import type { UserPublic } from '../lib/types';

export default function MePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [checked, setChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

          {error && (
            <div className="mt-5 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <p className="mt-6 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            帳號安全相關功能（例如變更密碼）將於後端就緒後開放。
          </p>

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
