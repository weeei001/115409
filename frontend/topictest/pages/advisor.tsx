import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import { BrainCircuit, Search, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { SubpageHeader } from '../components/SubpageHeader';
import { fetchAdvisorReport } from '../lib/api/advisor';
import type { AdvisorAction, AdvisorReport } from '../lib/types';

function recommendationText(action: AdvisorAction): string {
  if (action === 'buy') return '建議買進';
  if (action === 'sell') return '建議賣出';
  return '建議觀望';
}

function formatNetShares(value: number | null | undefined): string {
  if (value === null || value === undefined) return '資料不足';
  return `${value.toLocaleString('zh-TW')} 股`;
}

function recommendationClass(action: AdvisorAction): string {
  if (action === 'buy') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300';
  }
  if (action === 'sell') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300';
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300';
}

export default function AdvisorPage() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdvisorReport | null>(null);

  const generatedAtLabel = useMemo(() => {
    if (!report?.generated_at) return '--';
    const date = new Date(report.generated_at);
    return Number.isNaN(date.getTime()) ? report.generated_at : date.toLocaleString('zh-TW');
  }, [report?.generated_at]);

  const handleGenerate = async () => {
    const trimmed = symbol.trim();
    if (!trimmed) {
      setError('請先輸入股票代號');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdvisorReport({ symbol: trimmed });
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : '取得投資顧問結果失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/60 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Head>
        <title>股海明燈｜投資顧問</title>
        <meta
          name="description"
          content="整合新聞、股價與三大法人資訊，產生投資建議與資料來源。"
        />
      </Head>

      <SubpageHeader
        icon={BrainCircuit}
        title="投資顧問"
        subtitle="整合 RAG/LLM 分析，提供買進、賣出或觀望建議"
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col gap-6">
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                placeholder="輸入股票代號（例如：2330）"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700
                           text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white text-sm font-semibold
                         shadow-lg shadow-[#ffa95a]/20 hover:shadow-xl hover:shadow-[#ffa95a]/30 transition-all
                         disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? '分析中...' : '產生建議'}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {loading && symbol.trim() ? (
              <p className="text-[#ffa95a] text-sm font-medium flex items-center gap-2">
                <Loader2 size={14} className="animate-spin shrink-0" />
                正在分析 {symbol.trim().toUpperCase()}…（AI 整理中，約需數十秒）
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-[#ffa95a]/45 bg-gradient-to-r from-[#fff9f0] to-[#fff3e0]
                               dark:from-[#ffa95a]/18 dark:to-[#ffa95a]/10 dark:border-[#ffa95a]/40
                               px-3 py-1.5 text-xs sm:text-sm shadow-sm text-gray-800 dark:text-gray-100"
              >
                <span className="text-gray-500 dark:text-gray-400 shrink-0">分析時間</span>
                <span className="font-semibold tabular-nums">{generatedAtLabel}</span>
              </span>
              {report?.date_start && report?.date_end ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#ffa95a]/45 bg-gradient-to-r from-[#fff9f0] to-[#fff3e0]
                                 dark:from-[#ffa95a]/18 dark:to-[#ffa95a]/10 dark:border-[#ffa95a]/40
                                 px-3 py-1.5 text-xs sm:text-sm shadow-sm text-gray-800 dark:text-gray-100"
                >
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">資料區間</span>
                  <span className="font-semibold tabular-nums">
                    {report.date_start} ～ {report.date_end}
                  </span>
                </span>
              ) : null}
              {typeof report?.sentiment_score === 'number' && !Number.isNaN(report.sentiment_score) ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#ffa95a]/45 bg-gradient-to-r from-[#fff9f0] to-[#fff3e0]
                                 dark:from-[#ffa95a]/18 dark:to-[#ffa95a]/10 dark:border-[#ffa95a]/40
                                 px-3 py-1.5 text-xs sm:text-sm shadow-sm text-gray-800 dark:text-gray-100"
                >
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">多空情緒</span>
                  <span className="font-semibold tabular-nums">{report.sentiment_score.toFixed(2)}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-[0.65rem] sm:text-xs whitespace-nowrap">
                    （-1 極空～1 極多）
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {error ? (
          <section className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl p-4 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5" />
            <span>{error}</span>
          </section>
        ) : null}

        {loading ? (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 sm:p-10">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <Loader2 size={40} className="text-[#ffa95a] animate-spin" aria-hidden />
              <div>
                <p className="text-base font-semibold text-gray-800 dark:text-gray-100">分析中</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-md">
                  正在整合新聞、三大法人與技術面，請稍候勿關閉頁面。
                </p>
              </div>
              <div className="w-full max-w-md space-y-2.5 mt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse"
                    style={{ width: `${85 - i * 12}%` }}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {!loading && !report ? (
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            輸入股票代號後，即可產生投資顧問分析報告。
          </section>
        ) : null}

        {!loading && report ? (
          <>
            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold">總結摘要</h2>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${recommendationClass(report.recommendation)}`}
                >
                  {recommendationText(report.recommendation)}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-gray-700 dark:text-gray-300">{report.summary}</p>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">技術指標重點</h2>
              <div className="mt-3 space-y-3">
                {report.technical_signals?.length ? (
                  report.technical_signals.map((signal) => (
                    <div
                      key={`${signal.name}-${String(signal.value ?? '')}`}
                      className="rounded-xl border border-gray-100 dark:border-gray-700 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{signal.name}</p>
                        {signal.value !== undefined && signal.value !== null ? (
                          <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            {String(signal.value)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{signal.interpretation}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">技術指標資料不足</p>
                )}
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">三大法人資訊</h2>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                {report.institutional_flow?.summary || '暫無法人綜合說明'}
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {report.institutional_flow?.items?.length ? (
                  report.institutional_flow.items.map((item) => (
                    <div
                      key={item.name}
                      className="rounded-xl border border-gray-100 dark:border-gray-700 p-3"
                    >
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                        淨買賣：{formatNetShares(item.net_amount)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {item.trend || '無趨勢補充'}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">法人資料不足</p>
                )}
              </div>
              {report.institutional_rows && report.institutional_rows.length > 0 ? (
                <div className="mt-5 overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
                  <table className="min-w-full text-sm text-left">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                      <tr>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap">日期</th>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">外資</th>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">投信</th>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">自營商</th>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">合計</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {report.institutional_rows.map((row) => (
                        <tr key={row.date} className="text-gray-700 dark:text-gray-300">
                          <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNetShares(row.foreign_net ?? null)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNetShares(row.trust_net ?? null)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNetShares(row.dealer_net ?? null)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {formatNetShares(row.total_net ?? null)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">最終建議</h2>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${recommendationClass(report.recommendation)}`}
                >
                  {recommendationText(report.recommendation)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">標的：{report.symbol}</span>
              </div>
              {report.recommendation_text ? (
                <p className="mt-3 text-sm leading-6 text-gray-800 dark:text-gray-200 font-medium">
                  操作建議：{report.recommendation_text}
                </p>
              ) : null}
              <p className="mt-3 text-sm leading-6 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {report.reasoning}
              </p>
              {report.risk_notes ? (
                <p className="mt-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3">
                  風險提醒：{report.risk_notes}
                </p>
              ) : null}
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h2 className="text-base sm:text-lg font-bold">資料來源</h2>
              <div className="mt-3 space-y-2">
                {report.sources?.length ? (
                  report.sources.map((source, index) => (
                    <div
                      key={`${source.title}-${index}`}
                      className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 text-sm"
                    >
                      <p className="font-semibold">{source.title}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {source.publisher || '未知來源'}
                        {source.type ? ` ｜ ${source.type}` : ''}
                        {source.published_at ? ` ｜ ${source.published_at}` : ''}
                      </p>
                      {source.summary ? (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                          {source.summary}
                        </p>
                      ) : null}
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-[#ffa95a] hover:underline"
                        >
                          前往來源
                          <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">暫無資料來源</p>
                )}
              </div>
            </section>
          </>
        ) : null}

        <section className="text-xs text-gray-400 dark:text-gray-500 pb-2">
          本頁內容由模型整理提供，僅供研究與資訊參考，不構成任何投資建議。請自行評估風險並審慎決策。
        </section>
      </main>
    </div>
  );
}
