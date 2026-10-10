"""Read authenticated personal evidence and prepare non-executing paper drafts."""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from .knowledge import reference_source
from .schemas import PaperOrderDraft, PaperOrderIntent


def personal_scopes(query, needs):
    scopes = set(needs) & {"favorites", "portfolio"}
    if re.search(r"我的收藏|我收藏|收藏股|收藏清單|my (?:watchlist|favorites)", query, re.I):
        scopes.add("favorites")
    if re.search(r"我的持股|我持有|我的投資|我的模擬|模擬持股|模擬帳戶|剩餘資金|可用資金|我的.{0,12}(?:股票|訂單|委託)|回顧|模擬.{0,20}(?:買|賣)|my (?:portfolio|positions)", query, re.I):
        scopes.add("portfolio")
    if re.search(r"(?:我|目前|現在).{0,12}(?:預算|本金|資金|買得起|能買多少|可以買多少)|(?:增加|減少|調整|設定|投入|取回).{0,8}(?:模擬資金|投資預算)|my (?:budget|cash)|can I afford", query, re.I):
        scopes.add("portfolio")
    if "favorites" in scopes and re.search(r"買|賣|投入|分配|配置|預算|本金|資金|投資|buy|sell|allocat|invest|afford", query, re.I):
        scopes.add("portfolio")
    return scopes


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
            selected_orders = [row for row in records if row.get("id") in relevant_ids]
            selected_orders.extend(row for row in records[:20] if row not in selected_orders)
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
                "reviews_total": len(reviews), "reviews_shown": len(selected_reviews),
                "fund_movements_total": len(movements), "fund_movements_shown": len(movements[:20]),
            }
            portfolio["context_note"] = "僅提供最近 20 筆委託與資金紀錄、最多 20 筆優先待回顧紀錄及本次指定紀錄；未列出的紀錄不代表不存在。帳戶數字仍由完整帳本計算。"
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
    payload["analysis_limit"] = "Unless stocks are explicitly selected, market/news analysis covers at most the first 3 personal symbols per question, in favorites order followed by remaining portfolio positions. The complete account snapshot remains available for allocation checks."
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
