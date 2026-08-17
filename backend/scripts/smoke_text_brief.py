"""text-first-v2 端到端煙霧測試：真實 DB + 真實 RAG + 真實 LLM 各跑一次。

只跑單一 symbol，用來確認 prompt 改動後模型仍吐得出可解析的 v2 JSON；
批次品質量測請用 scripts/run_brief_eval.py。
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import date
from pathlib import Path
import sys
from time import perf_counter


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from database import SessionLocal
from schemas.stock_behavior import StockBehaviorTextBriefRequest
from stock_behavior.evidence import build_evidence_bundle
from stock_behavior.llm import build_text_brief_messages
from stock_behavior.orchestrator import NEWS_SUMMARY_CHARS, StockBehaviorOrchestrator


async def _measure_prompt(
    orchestrator: StockBehaviorOrchestrator,
    symbol: str,
    as_of: date,
) -> None:
    """實際組一次 messages 並回報字元數，方便盯住輸入膨脹。"""
    news, fallback = await orchestrator._fetch_text_brief_news(
        symbol=symbol, as_of_date=as_of
    )
    bundle = build_evidence_bundle(
        orchestrator._db,
        symbol=symbol,
        as_of_date=as_of,
        news_sources=news,
        news_summary_chars=NEWS_SUMMARY_CHARS,
        rag_fallback_mode=fallback,
    )
    packet = orchestrator._build_text_brief_task_packet(
        symbol=symbol, as_of_date_text=as_of.isoformat(), bundle=bundle
    )
    messages = build_text_brief_messages(packet)
    print(f"news_count={len(bundle.news)} rag_fallback={fallback}")
    print(f"missing_fields={bundle.missing_fields}")
    print(f"timeline_rows={len(bundle.daily_timeline)}")
    print(f"payload_chars={len(json.dumps(packet, ensure_ascii=False, default=str))}")
    print(
        f"messages={len(messages)} "
        f"prompt_chars={sum(len(content) for _, content in messages)}"
    )


async def run(symbol: str, as_of: date, *, dry_run: bool, dump: str | None) -> None:
    db = SessionLocal()
    try:
        orchestrator = StockBehaviorOrchestrator(db=db, settings=get_settings())
        if dry_run:
            # 只有乾跑才需要自己組一次；正式跑的 payload 大小已經由
            # text_brief.evidence / text_brief.llm 的 log 印出來，重複組會多打一次 RAG。
            await _measure_prompt(orchestrator, symbol, as_of)
            print("dry_run=true（未呼叫 LLM）")
            return

        started_at = perf_counter()
        response = await orchestrator.generate_text_brief(
            StockBehaviorTextBriefRequest(
                symbol=symbol, as_of_date=as_of, force_refresh=True
            )
        )
        latency_ms = round((perf_counter() - started_at) * 1000)

        if dump:
            Path(dump).write_text(
                json.dumps(response.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        verification = response.verification
        print(f"model={response.generated_by}")
        print(f"status={response.status}")
        print(f"latency_ms={latency_ms}")
        print(f"limitations={response.limitations}")
        print(f"filtered_evidence_ids={verification.filtered_evidence_ids}")
        print(f"compliance_violations={verification.compliance_violations}")
        print(f"soft_compliance_hits={verification.soft_compliance_hits}")
        print(f"unverified_numbers={verification.unverified_numbers}")
        print(f"undercount_sections={verification.undercount_sections}")
        print(f"simplified_chars={verification.simplified_chars}")
        if response.brief is None:
            return

        brief = response.brief
        print(f"headline={brief.headline}")
        print(f"overall_stance={brief.overall_stance} confidence={brief.confidence}")
        print(
            f"key_days={len(brief.key_days)} positives={len(brief.positive_factors)} "
            f"negatives={len(brief.negative_factors)} risks={len(brief.risks)} "
            f"watch_points={len(brief.watch_points)}"
        )
        for item in brief.key_days:
            print(
                f"  {item.date} move={item.move_pct} vol_ratio={item.volume_ratio} {item.what}"
            )
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test text-first-v2 end to end")
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD，預設今天")
    parser.add_argument("--dry-run", action="store_true", help="只組 prompt、不呼叫 LLM")
    parser.add_argument("--dump", default=None, help="把完整回應寫成 JSON 檔")
    args = parser.parse_args()
    as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
    asyncio.run(
        run(args.symbol.strip().upper(), as_of, dry_run=args.dry_run, dump=args.dump)
    )


if __name__ == "__main__":
    main()
