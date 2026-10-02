import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { OrdersTable } from '@/features/order/OrderTables';
import { useSimulatedIdentity } from '@/features/order/useSimulatedIdentity';
import { fetchSimulatedOrders } from '@/lib/api/simulatedOrder';
import type { SimulatedOrderResponse } from '@/lib/types/api';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { toYmdLocal } from '@/lib/utils/date';

export default function LegacyOrdersPage() {
  const { userId } = useSimulatedIdentity();
  const [result, setResult] = useState<{ owner: string; orders: SimulatedOrderResponse[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true); setError(null);
    void fetchSimulatedOrders(userId, 200).then((data) => { if (active) setResult({ owner: userId, orders: data.data }); })
      .catch((err) => { if (active) setError(userFacingMessage(err, '無法載入舊版紀錄。')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);
  return <><Head><title>股海明燈｜舊版模擬紀錄</title></Head><SiteHeader icon={BookOpen} title="舊版模擬紀錄" subtitle="歷史資料唯讀保存" /><main className="mx-auto w-full max-w-6xl px-4 py-8"><Link href="/order" className="text-brand-text underline">返回模擬投資</Link><p className="my-5 text-sm text-muted-foreground">保留舊版登入身分或本瀏覽器匿名身分的最近 200 筆紀錄，僅供查閱，不計入新帳戶績效。</p>{error ? <p role="alert" className="mb-4 text-danger">{error}</p> : null}<OrdersTable orders={result?.owner === userId ? result.orders : []} loading={loading} today={toYmdLocal()} /></main></>;
}
