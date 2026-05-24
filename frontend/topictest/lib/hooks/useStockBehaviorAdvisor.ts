import { useCallback, useRef, useState } from 'react';
import { fetchDateRange, fetchLatestPrice } from '../api/stock';
import { postStockBehaviorAiWithRetry, postStockBehaviorRag } from '../api/stockBehaviorAnalyze';
import { formatAdvisorError } from '../api/userFacingError';
import type {
  AdvisorReport,
  AdvisorStepKey,
  AdvisorStepStatus,
  AdvisorStepUpdate,
  AITrendAnalysis,
} from '../types';
import type { AdvisorFetchProgress } from '../utils/advisorSignals';
import { createInitialAdvisorReport } from '../utils/dashboardToAdvisorPartial';
import type { UseStockDashboardResult } from './useStockDashboard';
import {
  mapAiToAdvisorReport,
  mergeRagIntoReport,
  stockBehaviorToAiTrend,
} from '../utils/stockBehaviorMappers';

export type StockBehaviorAdvisorDashboardSlice = Pick<
  UseStockDashboardResult,
  'institutionalRange' | 'indicatorsRange' | 'priceChart' | 'endDate'
>;

export interface StockBehaviorAdvisorRunOptions {
  as_of_date?: string;
  dashboard?: StockBehaviorAdvisorDashboardSlice;
  /** 略過同 symbol+as_of 已成功快取（手動「重新分析」時設 true） */
  force?: boolean;
}

function createInitialSteps(): Array<{
  key: AdvisorStepKey;
  title: string;
  status: AdvisorStepStatus;
  message?: string;
}> {
  return [
    { key: 'institutional', title: '查看法人買賣方向', status: 'pending' },
    { key: 'cross_check', title: '檢查股價與技術面', status: 'pending' },
    { key: 'news', title: '整理近期市場消息', status: 'pending' },
    { key: 'final', title: '產生投資觀點', status: 'pending' },
  ];
}

export function useStockBehaviorAdvisor() {
  const requestSeq = useRef(0);
  const lastSuccessKeyRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [progress, setProgress] = useState<AdvisorFetchProgress | null>(null);
  const [steps, setSteps] = useState(createInitialSteps);
  const [aiTrendAnalysis, setAiTrendAnalysis] = useState<AITrendAnalysis | null>(null);

  const patchStep = useCallback((update: Pick<AdvisorStepUpdate, 'step_key' | 'status' | 'message'>) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.key === update.step_key
          ? { ...step, status: update.status, message: update.message ?? step.message }
          : step
      )
    );
  }, []);

  const run = useCallback(
    async (symbol: string, options?: StockBehaviorAdvisorRunOptions) => {
      const trimmed = symbol.trim().toUpperCase();
      if (!trimmed) {
        setError('請先輸入股票代號');
        return;
      }

      const seq = ++requestSeq.current;

      let as_of_date = options?.as_of_date;
      if (!as_of_date) {
        try {
          const range = await fetchDateRange(trimmed);
          as_of_date = range.max_date;
        } catch {
          const latest = await fetchLatestPrice(trimmed);
          as_of_date = latest.date;
        }
      }
      if (!as_of_date) throw new Error('無法決定分析基準日');
      if (seq !== requestSeq.current) return;

      const runKey = `${trimmed}:${as_of_date}`;
      if (!options?.force && lastSuccessKeyRef.current === runKey) {
        return;
      }

      setLoading(true);
      setError(null);
      setReport(null);
      setAiTrendAnalysis(null);
      setProgress({ pendingInstitutional: true, pendingFinal: true });
      setSteps(createInitialSteps());

      const dashboard = options?.dashboard;

      let ragCompleted = false;

      try {
        if (dashboard) {
          setReport(createInitialAdvisorReport(trimmed, as_of_date));
          setProgress({ pendingInstitutional: false, pendingFinal: true });
          patchStep({
            step_key: 'institutional',
            status: 'done',
            message: '法人買賣資料整理完成。',
          });
          patchStep({
            step_key: 'cross_check',
            status: 'done',
            message: '股價與技術資料交叉檢查完成。',
          });
        } else {
          patchStep({
            step_key: 'institutional',
            status: 'running',
            message: '整理法人與技術資料…',
          });
        }

        patchStep({ step_key: 'news', status: 'running', message: '正在整理新聞與市場脈絡…' });

        const rag = await postStockBehaviorRag({ symbols: [trimmed] });
        if (seq !== requestSeq.current) return;
        ragCompleted = true;

        const baseReport = createInitialAdvisorReport(trimmed, as_of_date);
        setReport((prev) =>
          mergeRagIntoReport(prev ?? baseReport, rag)
        );
        patchStep({ step_key: 'news', status: 'done', message: '新聞與市場脈絡整理完成。' });
        patchStep({ step_key: 'final', status: 'running', message: '正在產生 AI 投資觀點（後端 LLM，常需 1～3 分鐘）…' });

        const ai = await postStockBehaviorAiWithRetry({
          symbol: trimmed,
          news_sources: rag.news_sources ?? [],
          fallback_mode: rag.fallback_mode ?? false,
          raw_answer: rag.raw_answer ?? '',
        });
        if (seq !== requestSeq.current) return;

        const finalReport = mapAiToAdvisorReport(ai, rag);
        setReport(finalReport);
        setAiTrendAnalysis(stockBehaviorToAiTrend(ai, rag));
        setProgress({ pendingInstitutional: false, pendingFinal: false });
        patchStep({ step_key: 'final', status: 'done', message: '最終投資觀點生成完成。' });
        lastSuccessKeyRef.current = runKey;
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const phase = ragCompleted ? 'ai' : 'rag';
        const msg = formatAdvisorError(err, { phase, ragCompleted });
        if (!ragCompleted) {
          setReport(null);
        } else {
          setProgress({ pendingInstitutional: false, pendingFinal: false });
        }
        setAiTrendAnalysis(null);
        setError(msg);
        patchStep({
          step_key: ragCompleted ? 'final' : 'news',
          status: 'error',
          message: msg,
        });
        throw err;
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [patchStep]
  );

  const reset = useCallback(() => {
    requestSeq.current += 1;
    lastSuccessKeyRef.current = null;
    setLoading(false);
    setError(null);
    setReport(null);
    setProgress(null);
    setSteps(createInitialSteps());
    setAiTrendAnalysis(null);
  }, []);

  return {
    loading,
    error,
    setError,
    report,
    progress,
    steps,
    aiTrendAnalysis,
    run,
    reset,
  };
}
