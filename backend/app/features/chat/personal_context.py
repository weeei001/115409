"""Read authenticated personal evidence and prepare non-executing paper drafts."""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from .knowledge import reference_source
from .schemas import PaperOrderDraft, PaperOrderIntent


def read_personal_context(session_factory, user_id, scopes, query=""):
    from app.features.favorites.repository import favorites
    from app.core.errors import ServiceUnavailable

    if session_factory is None:
        raise ServiceUnavailable("個人資料暫時無法讀取")
    payload = {}
    with session_factory() as db:
        if "favorites" in scopes:
            payload["favorites"] = [{"symbol": row.symbol, "name": row.name} for row in favorites(db, user_id)]
        if "portfolio" in scopes:
            from app.features.paper_portfolio.service import snapshot
            portfolio = snapshot(db, user_id)
            requested_ids = set(re.findall(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", query))
            records, reviews = portfolio.get("orders", []), portfolio.get("reviews", [])
            relevant_reviews = [row for row in reviews if row.get("id") in requested_ids or row.get("order_id") in requested_ids]
            relevant_ids = requested_ids | {row["order_id"] for row in relevant_reviews}
            pending_orders = [row for row in records if row.get("status") == "pending"]
            historical_orders = [row for row in records if row.get("status") != "pending"]
            selected_orders = [row for row in records if row.get("id") in relevant_ids]
            selected_orders.extend(row for row in pending_orders if row not in selected_orders)
            selected_orders.extend(row for row in historical_orders[:20] if row not in selected_orders)
            selected_reviews = list(relevant_reviews)
            selected_reviews.extend(row for row in reviews if row.get("status") == "due" and row not in selected_reviews)
            selected_reviews.extend(row for row in reviews[:20] if row not in selected_reviews)
            # Keep explicitly requested reviews first, then at most 20 additional reviews.
            selected_reviews = selected_reviews[:len(relevant_reviews) + 20]
            portfolio["orders"] = selected_orders
            portfolio["reviews"] = selected_reviews
            movements = portfolio.get("fund_movements", [])
            portfolio["fund_movements"] = movements[:20]
            portfolio["context_counts"] = {
                "orders_total": len(records), "orders_shown": len(selected_orders),
                "pending_orders_total": len(pending_orders), "pending_orders_shown": len(pending_orders),
                "historical_orders_total": len(historical_orders),
                "historical_orders_shown": len(selected_orders) - len(pending_orders),
                "reviews_total": len(reviews), "reviews_shown": len(selected_reviews),
                "fund_movements_total": len(movements), "fund_movements_shown": len(movements[:20]),
            }
            portfolio["context_coverage"] = {
                "pending_orders": "complete",
                "historical_orders": "complete" if len(selected_orders) == len(records) else "partial",
            }
            portfolio["context_note"] = (
                "完整提供所有未成交委託，不受歷史紀錄筆數限制。"
                "歷史委託提供最近 20 筆非未成交紀錄及本次指定紀錄。"
                "資金紀錄提供最近 20 筆；回顧提供最多 20 筆優先紀錄及本次指定回顧。"
                "未列出的歷史紀錄不代表不存在。帳戶數字仍由完整帳本計算。"
            )
            if portfolio.get("initialized") is False:
                portfolio["setup_note"] = "使用者尚未設定模擬投資預算；零值僅表示尚未建立帳戶，不能解讀為沒有存款或沒有投資能力。請引導使用者至模擬投資頁設定想投入的練習金額。"
            payload["portfolio"] = portfolio
    symbols = [row["symbol"] for row in payload.get("favorites", [])]
    portfolio = payload.get("portfolio", {})
    if portfolio.get("as_of"):
        moment = datetime.fromisoformat(portfolio["as_of"])
        if moment.tzinfo is not None:
            # Preserve the original instant and expose its local display time;
            # the UTC date can differ from the user's account snapshot date.
            portfolio["as_of_taipei"] = moment.astimezone(ZoneInfo("Asia/Taipei")).isoformat()
    symbols.extend(row["symbol"] for row in portfolio.get("positions", []) if row.get("symbol"))
    symbols = list(dict.fromkeys(symbols))
    payload["analysis_limit"] = "未明確指定股票時，每題最多分析三檔收藏或持股的行情與新聞，依收藏順序，再接續其餘持股。配置檢查仍使用完整帳戶快照。"
    source = reference_source("本次登入使用者的收藏與模擬投資資料", json.dumps(payload, ensure_ascii=False, default=str), category="personal")
    source.pub_time = portfolio.get("as_of_taipei", "")
    source.stock_ids = symbols
    return symbols[:3], source


def _paper_reason(request):
    prior = next((turn.content for turn in reversed(request.history) if turn.role == "assistant"), "")
    reason = request.query[:800]
    if prior:
        reason += "\n\n先前分析摘錄（請確認是否作為本次理由）：\n" + prior[:1100]
    return reason


def paper_draft(order_intent: PaperOrderIntent, symbols, request):
    """Prepare a non-executing draft from the validated semantic classification."""
    if (not request._user_id or order_intent.mode != "draft" or order_intent.side is None
            or len(symbols) != 1 or not re.fullmatch(r"[0-9]{4,6}", symbols[0])):
        return None
    return PaperOrderDraft(symbol=symbols[0], side=order_intent.side,
                          budget=order_intent.budget if order_intent.side == "buy" else None,
                          quantity=order_intent.quantity if order_intent.side == "sell" else None,
                          reason=_paper_reason(request), conversation_id=request._conversation_id)


def paper_draft_offers(order_intent: PaperOrderIntent, symbols, request):
    """Offer editable drafts without adopting model-suggested order sizes."""
    if (not request._user_id or order_intent.mode == "none"
            or (order_intent.mode == "draft" and order_intent.side is None)):
        return []
    candidates = list(dict.fromkeys(symbol for symbol in symbols if re.fullmatch(r"[0-9]{4,6}", symbol)))[:3]
    return [PaperOrderDraft(symbol=symbol, side=order_intent.side or "buy", reason=_paper_reason(request),
                            conversation_id=request._conversation_id) for symbol in candidates]
