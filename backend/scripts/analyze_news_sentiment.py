from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
import sys
from typing import Any

# Ensure backend root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from models.news_article import NewsArticle
from news_sentiment.batch_runner import SentimentBatchRunner, acquire_batch_lock, BatchLockError
from news_sentiment.cleaner import extract_candidate_stocks
from news_sentiment.constants import DEFAULT_MODEL, TARGET_STOCKS


def generate_manifest(
    output_path: Path,
    stocks: list[str],
    limit: int = 100,
    seed: int = 42,
    dev_split: int = 20,
) -> None:
    """從資料庫抽樣六檔股票的新聞生成可追溯的 Manifest"""
    db = SessionLocal()
    try:
        print(f"從資料庫查詢指定股票的新聞候選: {stocks}")
        articles = (
            db.query(NewsArticle)
            .filter(NewsArticle.content.isnot(None))
            .order_by(NewsArticle.pub_time.desc())
            .all()
        )

        pairs: list[dict[str, Any]] = []
        for art in articles:
            candidates = extract_candidate_stocks(art.stock_id, art.tags)
            for c in candidates:
                if c in stocks:
                    pairs.append(
                        {
                            "article_id": art.article_id,
                            "symbol": c,
                            "target_stock_name": TARGET_STOCKS.get(c, ""),
                            "date": str(art.pub_time)[:10] if art.pub_time else "",
                            "title": art.title or "",
                            "url": art.url or "",
                            "source": art.source or "",
                        }
                    )

        # 去除重複 (article_id, symbol)
        seen: set[tuple[str, str]] = set()
        unique_pairs: list[dict[str, Any]] = []
        for p in pairs:
            key = (p["article_id"], p["symbol"])
            if key not in seen:
                seen.add(key)
                unique_pairs.append(p)

        print(f"找到 {len(unique_pairs)} 個有效股票配對。")
        random.seed(seed)
        # 依股票分組抽樣，確保每檔皆有樣本
        by_stock: dict[str, list[dict[str, Any]]] = {s: [] for s in stocks}
        for p in unique_pairs:
            by_stock[p["symbol"]].append(p)

        sampled: list[dict[str, Any]] = []
        # 每檔先取至多 limit // len(stocks)
        per_stock = max(1, limit // len(stocks))
        for s, items in by_stock.items():
            random.shuffle(items)
            sampled.extend(items[:per_stock])

        # 不足 limit 則補充
        remaining = [p for p in unique_pairs if p not in sampled]
        random.shuffle(remaining)
        needed = limit - len(sampled)
        if needed > 0:
            sampled.extend(remaining[:needed])

        # 隨機打散並切分 dev / test
        random.shuffle(sampled)
        final_list = sampled[:limit]
        for idx, item in enumerate(final_list):
            item["split"] = "dev" if idx < dev_split else "test"

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(final_list, f, ensure_ascii=False, indent=2)

        print(
            f"成功生成 Manifest 至 {output_path}，共 {len(final_list)} 筆（{dev_split} dev / {len(final_list) - dev_split} test）。"
        )
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="新聞情緒分類批次執行與評估腳本")
    parser.add_argument("--manifest", type=str, help="Manifest JSON 檔案路徑")
    parser.add_argument("--limit", type=int, default=100, help="最多處理配對數（預設 100）")
    parser.add_argument("--max-cost-usd", type=float, default=0.50, help="批次保護預算上限（美元，預設 0.50）")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help=f"指定 LLM 模型（預設 {DEFAULT_MODEL}）")
    parser.add_argument("--execute", action="store_true", help="明確指定此參數才會真正呼叫 API 並寫入資料庫（預設為預覽模式）")
    parser.add_argument("--generate-manifest", type=str, help="從資料庫抽樣生成 Manifest 檔案路徑")
    parser.add_argument("--stocks", type=str, default="2330,2317,2454,2408,2881,2615", help="逗號分隔股票代號")
    parser.add_argument("--seed", type=int, default=42, help="抽樣隨機種子")

    args = parser.parse_args()

    # 生成 Manifest 模式
    if args.generate_manifest:
        target_stocks = [s.strip() for s in args.stocks.split(",") if s.strip()]
        generate_manifest(
            output_path=Path(args.generate_manifest),
            stocks=target_stocks,
            limit=args.limit,
            seed=args.seed,
        )
        return

    if not args.manifest:
        parser.print_help()
        print("\n錯誤：請提供 --manifest <path> 或使用 --generate-manifest <path>。")
        sys.exit(1)

    manifest_file = Path(args.manifest)
    if not manifest_file.exists():
        print(f"錯誤：Manifest 檔案不存在：{manifest_file}")
        sys.exit(1)

    with open(manifest_file, "r", encoding="utf-8") as f:
        manifest_items = json.load(f)

    if not isinstance(manifest_items, list):
        print("錯誤：Manifest 格式必須為 JSON 陣列。")
        sys.exit(1)

    print("=" * 60)
    print("新聞情緒分析批次處理")
    print(f"Manifest: {manifest_file} (總筆數: {len(manifest_items)})")
    print(f"處理上限: {args.limit} 筆 | 預算上限: ${args.max_cost_usd:.4f} USD")
    print(f"模型: {args.model}")
    print(f"模式: {'【正式執行 (API 呼叫與寫入 DB)】' if args.execute else '【預覽模式 (不呼叫 API)】'}")
    print("=" * 60)

    try:
        with acquire_batch_lock():
            runner = SentimentBatchRunner(
                max_cost_usd=args.max_cost_usd,
                limit=args.limit,
                model=args.model,
                execute=args.execute,
            )
            summary = runner.run_manifest(manifest_items)

            print("\n執行完成摘要：")
            print(f"- Run ID: {summary['run_id']}")
            print(f"- 處理總筆數: {summary['total_items']}")
            print(f"- 成功筆數: {summary['success']}")
            print(f"- 重用筆數: {summary['reused']}")
            print(f"- 失敗筆數: {summary['failed']}")
            print(f"- 跳過筆數: {summary['skipped']} (細項: {summary['skip_reasons']})")
            print(f"- API 呼叫次數: {summary['api_calls']}")
            print(f"- Token 總計: 輸入 {summary['total_input_tokens']} / 輸出 {summary['total_output_tokens']}")
            print(f"- 估算成本: ${summary['total_cost_usd']} USD (約 NT$ {summary['total_cost_twd']})")
            if summary["latency_p50_ms"] > 0:
                print(f"- 延遲: p50 = {summary['latency_p50_ms']} ms | p95 = {summary['latency_p95_ms']} ms")
            print("=" * 60)

    except BatchLockError as e:
        print(f"\n[錯誤] {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
