-- 移除個股 AI 分析回測系統的三張表（功能已下架）。
-- llm_responses 由 Base.metadata.create_all 自動建立，不需要在這裡處理。
-- 先刪子表：sb_projection_scores 有 FK 指向 sb_analysis_snapshots。
DROP TABLE IF EXISTS sb_projection_scores;
DROP TABLE IF EXISTS sb_analysis_snapshots;
DROP TABLE IF EXISTS sb_backtest_runs;
