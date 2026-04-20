"""
財經新聞 RAG API Server
======================
提供前端 HTML 串接的 REST API。

啟動方式：
    uvicorn api_server:app --reload --port 8000

API 總覽：
    POST /api/ask              → AI 問答（支援 stream / 非 stream）
    GET  /api/stocks           → 取得可選股票清單
    GET  /api/history          → 查詢歷史 QA 紀錄
    GET  /api/history/{id}     → 取得單筆 QA 詳情
    GET  /api/news             → 瀏覽新聞列表（原始資料庫）
    GET  /api/health           → 健康檢查

# ── TODO: 認證機制 ──────────────────────────────────
# 目前所有 API 皆為公開存取，無需 token。
# 未來可加入：
#   1. API Key 驗證（Header: X-API-Key）
#   2. JWT Bearer Token（適合有登入系統時）
#   3. OAuth2（若需第三方登入）
# 建議在 FastAPI 的 Depends() 中加入認證 middleware，
# 例如：
#   from fastapi.security import APIKeyHeader
#   api_key_header = APIKeyHeader(name="X-API-Key")
#   async def verify_key(key: str = Depends(api_key_header)):
#       if key != os.environ["API_SECRET"]: raise HTTPException(403)
# 然後在每個 router 加上 dependencies=[Depends(verify_key)]
# ─────────────────────────────────────────────────────
"""

import os
import re
import time
import json
import sqlite3
import httpx
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

# ── 共用常數 ─────────────────────────────────────────
STOCK_OPTIONS = {
    "2330": "台積電",
    "2317": "鴻海",
    "2454": "聯發科",
    "2881": "富邦金",
    "2408": "南亞",
    "2615": "萬海",
}

STOCK_KEYWORDS = {
    "2330": ["台積電", "TSMC", "2330"],
    "2317": ["鴻海", "富士康", "2317"],
    "2454": ["聯發科", "MediaTek", "2454"],
    "2881": ["富邦金", "富邦", "2881"],
    "2408": ["南亞", "2408"],
    "2615": ["萬海", "2615"],
}

CMONEY_SOURCES = {
    "tpshouse", "cmoney", "newsyoudeservetoknow", "lewis", "coneyresearcher",
    "cmoneyaicurator", "josh", "money", "nico", "cmoneyairesearcher",
    "ruanmuhhwa", "star", "captain", "firebro", "bubuypope", "wealthonebro",
    "emily", "yolandawu", "alansays", "jiahongxlinying", "ugly", "sharon",
    "laochien", "edwin", "jacklai", "ericlu", "stockmantalk", "crawler_csv",
    "p", "so2ym6jh",
}

SOURCE_NAME_MAP = {
    "cnyes": "鉅亨網", "ltn": "自由時報", "moneydj": "MoneyDJ",
    "udn": "聯合新聞網", "chinatimes": "中時新聞網", "yahoo": "Yahoo 財經",
}

ANALYSIS_PROMPT_TEMPLATE = (
    "你是一位專業的台股財經分析師。\n"
    "【目前時間】{current_time}\n"
    "{time_focus}\n\n"
    "以下是從新聞資料庫中撈出的相關新聞片段（片段中的「時間」為該新聞的發布日期）：\n"
    "（標記 ★ 的新聞在使用者關注的時間範圍內，應優先參考）\n\n"
    "{context}\n\n"
    "根據以上新聞內容，請針對使用者的問題進行分析：「{query}」\n\n"
    "注意：\n"
    "1. 請依據新聞發布時間與目前時間的相對關係，適當標注資訊的時效性（例如：「X 個月前報導」、「近期」等）。\n"
    "2. 優先引用 ★ 標記的新聞進行分析，其他新聞可作為背景補充。\n"
    "3. 若使用者詢問的是過去某個時間點，請站在當時的角度分析，不要用之後才發生的事件做判斷。\n"
    "4. 回答時請明確說明你引用的新聞時間範圍（例如：「以下分析基於 2023 年 Q1 的新聞資料」）。\n"
    "5. 若引用資料的時間與使用者詢問的時間不符，請主動告知差異。\n\n"
    "請用繁體中文回答，並以以下格式輸出：\n"
    "【綜合摘要】\n（2-3行簡要說明；若涉及多支股票，請分別說明再整體比較）\n\n"
    "【市場情緒】\n（看漲 📈 / 看跌 📉 / 中性 ➡️，並說明原因；多股時請各自標示）\n\n"
    "【關鍵事件】\n（條列式，3-5個重點；多股時請標明各事件屬於哪支股票）\n\n"
    "【投資提示】\n（基於新聞的客觀觀察，非投資建議）\n\n"
    "【引用來源】\n（列出本次分析引用的新聞標題與連結，格式：- 標題：連結）\n"
)


def get_source_name(source_raw: str) -> str:
    if source_raw in SOURCE_NAME_MAP:
        return SOURCE_NAME_MAP[source_raw]
    if source_raw in CMONEY_SOURCES or source_raw.isdigit():
        return "CMoney 財經社群"
    return source_raw


def extract_time_filter(query: str):
    """從使用者問題中偵測時間意圖，回傳 (from_str, to_str) 或 (None, None)"""
    today = datetime.now()
    fmt = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")

    if re.search(r"今[天日]", query):
        return fmt(today.replace(hour=0, minute=0, second=0)), fmt(today)
    if re.search(r"昨[天日]", query):
        y = today - timedelta(days=1)
        return fmt(y.replace(hour=0, minute=0, second=0)), fmt(y.replace(hour=23, minute=59, second=59))
    if re.search(r"這[週周]|本[週周]", query):
        start = today - timedelta(days=today.weekday())
        return fmt(start.replace(hour=0, minute=0, second=0)), fmt(today)
    if re.search(r"上[週周]", query):
        end = today - timedelta(days=today.weekday())
        start = end - timedelta(days=7)
        return fmt(start.replace(hour=0, minute=0, second=0)), fmt(end.replace(hour=23, minute=59, second=59))
    if re.search(r"這個月|本月", query):
        return fmt(today.replace(day=1, hour=0, minute=0, second=0)), fmt(today)
    if re.search(r"上個月", query):
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        first_prev = last_prev.replace(day=1)
        return fmt(first_prev.replace(hour=0, minute=0, second=0)), fmt(last_prev.replace(hour=23, minute=59, second=59))
    if re.search(r"最近|近期", query):
        return fmt(today - timedelta(days=30)), fmt(today)
    if re.search(r"近一個月|近1個月", query):
        return fmt(today - timedelta(days=30)), fmt(today)
    if re.search(r"近三個月|近3個月|近一季", query):
        return fmt(today - timedelta(days=90)), fmt(today)
    if re.search(r"近半年|近六個月", query):
        return fmt(today - timedelta(days=180)), fmt(today)

    m = re.search(r"(\d{4})[年]", query)
    if m:
        y = int(m.group(1))
        qm = re.search(r"第?([一二三四1-4])季|Q([1-4])", query)
        if qm:
            q = qm.group(1) or qm.group(2)
            q_map = {"一": 1, "二": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4}
            q_num = q_map.get(q, 1)
            sm = (q_num - 1) * 3 + 1
            em = sm + 2
            import calendar
            ld = calendar.monthrange(y, em)[1]
            return f"{y}-{sm:02d}-01 00:00:00", f"{y}-{em:02d}-{ld:02d} 23:59:59"
        if re.search(r"上半年", query):
            return f"{y}-01-01 00:00:00", f"{y}-06-30 23:59:59"
        if re.search(r"下半年", query):
            return f"{y}-07-01 00:00:00", f"{y}-12-31 23:59:59"
        return f"{y}-01-01 00:00:00", f"{y}-12-31 23:59:59"

    return None, None


# ── 全域資源（啟動時載入）────────────────────────────
qdrant_client = None
embeddings = None
openai_client = None
intent_classifier = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """啟動時載入 Qdrant、Embedding、LLM 等重量級元件"""
    global qdrant_client, embeddings, openai_client, intent_classifier

    from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings, ChatNVIDIA
    from langchain_core.prompts import PromptTemplate
    from langchain_core.output_parsers import StrOutputParser
    from qdrant_client import QdrantClient
    from openai import OpenAI

    qdrant_host = os.environ.get("QDRANT_HOST", "")
    qdrant_url = os.environ.get("QDRANT_URL", "")
    if qdrant_host:
        qdrant_client = QdrantClient(host=qdrant_host, port=6333)
    elif qdrant_url:
        qdrant_client = QdrantClient(url=qdrant_url)
    else:
        qdrant_path = "./qdrant_db"
        if os.path.exists(qdrant_path):
            qdrant_client = QdrantClient(path=qdrant_path)
    if qdrant_client:
        embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")

    openai_client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=os.environ.get("NVIDIA_API_KEY", ""),
        http_client=httpx.Client(timeout=30.0),
    )

    llm = ChatNVIDIA(model="meta/llama3-70b-instruct", temperature=0)
    prompt = PromptTemplate.from_template(
        "你是一個財經意圖分析器。當前時間: {current_time}\n"
        "使用者輸入一句話，你必須分析三件事並回傳 JSON：\n\n"
        "1. is_finance: 是否與台股、財經、股票、營收、財報、AI發展、總體經濟、具體公司(鴻海,台積電,聯發科等)有關\n"
        "2. stocks: 提到的股票代號列表，對應表：台積電=2330, 鴻海=2317, 聯發科=2454, 富邦金=2881, 南亞=2408, 萬海=2615\n"
        "3. time_from / time_to: 從問題中解讀的時間範圍（格式 YYYY-MM-DD HH:MM:SS），沒有提到時間就填 null\n\n"
        "範例：\n"
        '使用者: 台積電最近一週的新聞 → {{"is_finance":true,"stocks":["2330"],"time_from":"2026-03-17 00:00:00","time_to":"2026-03-24 23:59:59"}}\n'
        '使用者: 鴻海跟聯發科三月的表現 → {{"is_finance":true,"stocks":["2317","2454"],"time_from":"2026-03-01 00:00:00","time_to":"2026-03-31 23:59:59"}}\n'
        '使用者: 今天天氣如何 → {{"is_finance":false,"stocks":[],"time_from":null,"time_to":null}}\n'
        '使用者: 台積電 → {{"is_finance":true,"stocks":["2330"],"time_from":null,"time_to":null}}\n\n'
        "使用者輸入: {query}\n"
        "請只回傳 JSON，不要加任何說明文字："
    )
    intent_classifier = prompt | llm | StrOutputParser()

    # ── Warmup：預熱 embedding 模型，消除首次查詢延遲 ──
    if embeddings:
        try:
            embeddings.embed_query("warmup")
            print("[startup] embedding warmup 完成")
        except Exception as e:
            print(f"[startup] embedding warmup 失敗（不影響運行）: {e}")

    yield  # app 運行中

    if qdrant_client:
        qdrant_client.close()


app = FastAPI(title="財經新聞 RAG API", version="1.0.0", lifespan=lifespan)

# CORS：允許本地前端跨域存取
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: 上線時限縮為前端實際域名
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ────────────────────────

class AskRequest(BaseModel):
    query: str = Field(..., description="使用者問題", examples=["台積電最近表現如何"])
    stock_id: str | None = Field(None, description="手動指定股票代號（如 2330），null 則自動偵測")
    stream: bool = Field(False, description="是否使用 SSE 串流回傳")


class SourceChunk(BaseModel):
    title: str
    source: str
    source_name: str
    pub_time: str
    url: str
    stock_id: str
    content: str
    score: float


class AskResponse(BaseModel):
    answer: str
    detected_stocks: list[str]
    time_range: dict | None
    sources: list[SourceChunk]
    tokens: dict
    duration_ms: int
    current_time: str


# ── API Endpoints ────────────────────────────────────

@app.get("/api/health")
async def health():
    """健康檢查：確認 Qdrant 與模型是否就緒"""
    return {
        "status": "ok",
        "qdrant_ready": qdrant_client is not None,
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/stocks")
async def list_stocks():
    """取得可選股票清單"""
    return {
        "stocks": [
            {"id": sid, "name": name} for sid, name in STOCK_OPTIONS.items()
        ]
    }


@app.post("/api/ask")
async def ask(req: AskRequest):
    """
    AI 問答主端點。

    - stream=false → 回傳完整 JSON（AskResponse）
    - stream=true  → 回傳 SSE（text/event-stream），每個 event 的 data 為一段文字，
                      最後一個 event 為 JSON，包含 sources、tokens 等 metadata
    """
    if not qdrant_client or not embeddings:
        raise HTTPException(503, "向量資料庫未就緒，請先執行 build_vector_db.py")

    # 1. AI 意圖分析（一次取得：是否財經、股票、時間範圍）
    current_time_str = datetime.now().strftime("%Y年%m月%d日 %H:%M")
    raw_intent = intent_classifier.invoke({
        "query": req.query,
        "current_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }).strip()

    # 解析 LLM 回傳的 JSON
    try:
        # 移除可能的 markdown code block 包裝
        cleaned = re.sub(r"^```json\s*|\s*```$", "", raw_intent, flags=re.MULTILINE).strip()
        intent_data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        # LLM 回傳格式異常，fallback 為舊邏輯
        intent_data = {"is_finance": "NO" not in raw_intent.upper(), "stocks": [], "time_from": None, "time_to": None}

    if not intent_data.get("is_finance", True):
        return AskResponse(
            answer="🤖 系統提示：我是一個專業的「財經新聞 AI 助理」。您剛剛的發問似乎與財經領域無關，我無法從財經資料庫中為您檢索這類話題。請嘗試問我關於某家公司的營收、股價、或是產業新聞！",
            detected_stocks=[],
            time_range=None,
            sources=[],
            tokens={"input": 0, "output": 0, "thinking": None},
            duration_ms=0,
            current_time=current_time_str,
        )

    # 2. 從 AI 結果取得股票 & 時間，regex 作為 fallback
    ai_stocks = [s for s in intent_data.get("stocks", []) if s in STOCK_OPTIONS]
    ai_time_from = intent_data.get("time_from")
    ai_time_to = intent_data.get("time_to")

    # 股票：優先用使用者手動指定 > AI 偵測 > regex fallback
    effective_stock_id = req.stock_id
    auto_detected_ids = ai_stocks if ai_stocks else []
    if not effective_stock_id and not auto_detected_ids:
        # AI 沒偵測到，用 regex fallback
        auto_detected_ids = [
            sid for sid, kws in STOCK_KEYWORDS.items()
            if any(kw in req.query for kw in kws)
        ]
    if not effective_stock_id and len(auto_detected_ids) == 1:
        effective_stock_id = auto_detected_ids[0]

    # 時間：優先用 AI 偵測，fallback 用 regex
    time_from = ai_time_from if ai_time_from else None
    time_to = ai_time_to if ai_time_to else None
    if not time_from or not time_to:
        time_from, time_to = extract_time_filter(req.query)

    # 3. Qdrant 檢索
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    def normalize_time(t: str) -> str:
        """統一時間格式為 YYYY-MM-DD HH:MM:SS，方便字串比較"""
        if not t:
            return ""
        t = t.replace("T", " ")
        if "+" in t:
            t = t[:t.index("+")]
        if len(t) > 19:
            t = t[:19]
        return t.strip()

    def to_timestamp(t: str) -> float:
        """將時間字串轉為 Unix timestamp（Qdrant Range filter 只接受數字）"""
        from datetime import datetime
        s = normalize_time(t)
        if not s:
            return 0.0
        return datetime.fromisoformat(s).timestamp()

    def is_in_time_range(pub_time: str) -> bool:
        """判斷新聞是否在使用者關注的時間範圍內"""
        if not time_from or not time_to:
            return True
        nt = normalize_time(pub_time)
        return normalize_time(time_from) <= nt <= normalize_time(time_to)

    def is_before_cutoff(pub_time: str) -> bool:
        """判斷新聞是否在截止時間之前（不用未來資料分析過去）"""
        if not time_to:
            return True
        return normalize_time(pub_time) <= normalize_time(time_to)

    def time_score(pub_time: str) -> float:
        """時間加權分數：範圍內 1.0，範圍外依距離衰減，最低 0.1"""
        if not pub_time or not time_from:
            return 1.0
        from datetime import datetime as _dt
        try:
            pub = _dt.fromisoformat(normalize_time(pub_time))
            t_from = _dt.fromisoformat(normalize_time(time_from))
            t_to = _dt.fromisoformat(normalize_time(time_to)) if time_to else pub
            if t_from <= pub <= t_to:
                return 1.0
            days_off = min(abs((pub - t_from).days), abs((pub - t_to).days))
            return max(0.1, 1.0 - days_off / 365)
        except Exception:
            return 0.5

    def rank_by_time(points):
        """
        時間加權排序：
        1. 有指定時間時，過濾掉「時間點之後」的資料（不能用未來資料分析過去）
        2. 向量相似度 70% + 時間加權分數 30% 合併排序
        3. 為每個 point 標記是否在時間範圍內（供 prompt 標 ★）
        """
        if not time_from and not time_to:
            for p in points:
                p._in_time_range = True
            return points

        # 過濾掉指定時間之後的資料
        filtered = [p for p in points if is_before_cutoff(p.payload.get("pub_time", "") or "")]

        # 標記是否在範圍內（供 ★ 使用）
        for p in filtered:
            p._in_time_range = is_in_time_range(p.payload.get("pub_time", "") or "")

        # 合併排序：向量相似度 70% + 時間分數 30%
        filtered.sort(
            key=lambda p: p.score * 0.7 + time_score(p.payload.get("pub_time", "") or "") * 0.3,
            reverse=True
        )
        return filtered

    query_vector = embeddings.embed_query(req.query)
    collection_name = "news_chunks"
    from qdrant_client.models import Range, OrderBy

    # ── 步驟一：確認時間範圍內真的有資料（用 count 查資料庫，不依賴向量搜尋結果）──
    if time_from and time_to:
        count_filter_must = [
            FieldCondition(key="pub_time", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
        ]
        if effective_stock_id:
            count_filter_must.append(FieldCondition(key="stock_id", match=MatchValue(value=effective_stock_id)))
        count_result = qdrant_client.count(
            collection_name=collection_name,
            count_filter=Filter(must=count_filter_must)
        )
        if count_result.count == 0:
            time_from = None
            time_to = None
            time_fallback = True
        else:
            time_fallback = False
    else:
        time_fallback = False

    # ── 步驟三：動態 limit（根據時間跨度調整）──
    def calc_limit(tf: str, tt: str) -> tuple:
        if not tf or not tt:
            return 10, ""
        from datetime import datetime as _dt
        try:
            days = (_dt.fromisoformat(normalize_time(tt)) - _dt.fromisoformat(normalize_time(tf))).days
        except Exception:
            return 10, ""
        if days <= 30:
            return 10, ""
        elif days <= 90:
            return 15, ""
        elif days <= 365:
            return 20, ""
        else:
            return 25, "查詢時間跨度較大（超過一年），分析結果可能較為概括。"

    base_limit, time_warning = calc_limit(time_from, time_to)

    if len(auto_detected_ids) > 1:
        # 多股分組檢索
        PER_STOCK_LIMIT = max(5, base_limit // len(auto_detected_ids))
        grouped_hits = {}
        for sid in auto_detected_ids:
            stock_must = [FieldCondition(key="stock_id", match=MatchValue(value=sid))]
            # 雙層搜尋：先抓時間範圍內，再補背景
            if time_from and time_to:
                in_range_r = qdrant_client.query_points(
                    collection_name=collection_name,
                    query=query_vector,
                    query_filter=Filter(must=stock_must + [
                        FieldCondition(key="pub_time", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
                    ]),
                    limit=PER_STOCK_LIMIT,
                    with_payload=True,
                )
                bg_r = qdrant_client.query_points(
                    collection_name=collection_name,
                    query=query_vector,
                    query_filter=Filter(must=stock_must),
                    limit=max(3, PER_STOCK_LIMIT // 2),
                    with_payload=True,
                )
                seen = {p.id for p in in_range_r.points}
                combined = in_range_r.points + [p for p in bg_r.points if p.id not in seen]
            else:
                r = qdrant_client.query_points(
                    collection_name=collection_name,
                    query=query_vector,
                    query_filter=Filter(must=stock_must),
                    limit=PER_STOCK_LIMIT,
                    with_payload=True,
                )
                combined = r.points
            grouped_hits[sid] = rank_by_time(combined)[:PER_STOCK_LIMIT]
        hits = [h for pts in grouped_hits.values() for h in pts]
    else:
        stock_must = []
        if effective_stock_id:
            stock_must.append(FieldCondition(key="stock_id", match=MatchValue(value=effective_stock_id)))
        # 雙層搜尋：先抓時間範圍內，再補背景
        if time_from and time_to:
            in_range_r = qdrant_client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=Filter(must=stock_must + [
                    FieldCondition(key="pub_time", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
                ]) if stock_must else Filter(must=[
                    FieldCondition(key="pub_time", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
                ]),
                limit=base_limit,
                with_payload=True,
            )
            bg_r = qdrant_client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=Filter(must=stock_must) if stock_must else None,
                limit=max(5, base_limit // 2),
                with_payload=True,
            )
            seen = {p.id for p in in_range_r.points}
            combined = in_range_r.points + [p for p in bg_r.points if p.id not in seen]
        else:
            qf = Filter(must=stock_must) if stock_must else None
            r = qdrant_client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=qf,
                limit=base_limit,
                with_payload=True,
            )
            combined = r.points

        hits = rank_by_time(combined)[:base_limit]
        grouped_hits = None

    if not hits:
        raise HTTPException(404, "未找到相關新聞，請嘗試其他關鍵字或調整股票篩選。")

    # 4. 組裝 context（★ 標記時間範圍內的新聞）
    def format_chunk(hit, num):
        p = hit.payload
        star = "★ " if getattr(hit, '_in_time_range', True) else ""
        return (
            f"[{star}片段{num}] 標題：{p.get('title', '')}\n"
            f"來源：{get_source_name(p.get('source', ''))} | 時間：{p.get('pub_time', '')}\n"
            f"內容：{p.get('page_content', '')}\n"
            f"連結：{p.get('url', '')}"
        )

    context_parts = []
    if grouped_hits and len(auto_detected_ids) > 1:
        chunk_num = 1
        for sid in auto_detected_ids:
            stock_label = STOCK_OPTIONS.get(sid, sid)
            context_parts.append(f"═══ {stock_label} 相關新聞 ═══")
            for hit in grouped_hits[sid]:
                context_parts.append(format_chunk(hit, chunk_num))
                chunk_num += 1
    else:
        for i, hit in enumerate(hits):
            context_parts.append(format_chunk(hit, i + 1))
    context_str = "\n\n---\n\n".join(context_parts)

    # 組裝時間提示
    time_focus = ""
    if time_from and time_to:
        time_focus = f"【使用者關注時段】{time_from} ～ {time_to}（請以此時段為分析重點，標記 ★ 的新聞在此範圍內）"
        if time_warning:
            time_focus += f"\n⚠️ {time_warning}"
    elif time_to:
        time_focus = f"【分析截止時間】{time_to}（請站在此時間點的角度分析，不要參考之後的資訊）"

    prompt_str = ANALYSIS_PROMPT_TEMPLATE.format(
        context=context_str,
        query=req.query,
        current_time=current_time_str,
        time_focus=time_focus,
    )

    # 5. 組裝 sources 回傳
    sources = []
    for hit in hits:
        p = hit.payload or {}
        sources.append(SourceChunk(
            title=p.get("title", ""),
            source=p.get("source", ""),
            source_name=get_source_name(p.get("source", "")),
            pub_time=p.get("pub_time", ""),
            url=p.get("url", ""),
            stock_id=p.get("stock_id", ""),
            content=p.get("page_content", ""),
            score=round(hit.score, 4) if hit.score else 0,
        ))

    detected = auto_detected_ids if auto_detected_ids else ([effective_stock_id] if effective_stock_id else [])
    time_range_info = {"from": time_from, "to": time_to} if time_from else None

    # 6. 呼叫 LLM
    if req.stream:
        # ── SSE 串流模式 ──
        async def event_generator():
            start = time.time()
            try:
                stream = openai_client.chat.completions.create(
                    model="meta/llama-3.3-70b-instruct",
                    messages=[{"role": "user", "content": prompt_str}],
                    temperature=0.6, top_p=0.7, max_tokens=4096,
                    stream=True,
                )
                full_text = ""
                for chunk in stream:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        full_text += delta
                        yield f"data: {json.dumps({'type': 'text', 'content': delta}, ensure_ascii=False)}\n\n"

                duration_ms = int((time.time() - start) * 1000)

                # 清除 <think> 區塊
                clean_text = re.sub(r"<think>.*?</think>\s*", "", full_text, flags=re.DOTALL).strip()
                if time_fallback:
                    clean_text += "\n\n⚠️ 因資料庫中找不到符合指定時間範圍的資料，以上分析僅供參考。"

                # 最終 metadata event
                yield f"data: {json.dumps({'type': 'done', 'answer': clean_text, 'detected_stocks': detected, 'time_range': time_range_info, 'sources': [s.model_dump() for s in sources], 'duration_ms': duration_ms, 'current_time': current_time_str}, ensure_ascii=False)}\n\n"

                # 記錄 QA log（stream 模式無法取得 token 數，記為 None）
                from qa_logger import log_qa
                log_qa(query=req.query, prompt=prompt_str, chunks=hits,
                       ai_answer=clean_text, duration_ms=duration_ms, status="success_stream",
                       tokens_input=None, tokens_output=None, tokens_thinking=None)

            except httpx.TimeoutException:
                yield f"data: {json.dumps({'type': 'error', 'message': 'LLM 服務超時，請稍後再試'}, ensure_ascii=False)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    else:
        # ── 非串流模式 ──
        start = time.time()
        try:
            completion = openai_client.chat.completions.create(
                model="meta/llama-3.3-70b-instruct",
                messages=[{"role": "user", "content": prompt_str}],
                temperature=0.6, top_p=0.7, max_tokens=4096,
                stream=False,
            )
            full_content = completion.choices[0].message.content
            tokens_input = completion.usage.prompt_tokens
            tokens_output = completion.usage.completion_tokens

            # 清除 <think>
            think_match = re.search(r"<think>(.*?)</think>", full_content, re.DOTALL)
            tokens_thinking = len(think_match.group(1)) // 4 if think_match else None
            answer = re.sub(r"<think>.*?</think>\s*", "", full_content, flags=re.DOTALL).strip()
            if time_fallback:
                answer += "\n\n⚠️ 因資料庫中找不到符合指定時間範圍的資料，以上分析僅供參考。"

            duration_ms = int((time.time() - start) * 1000)

            from qa_logger import log_qa
            log_qa(query=req.query, prompt=prompt_str, chunks=hits,
                   ai_answer=answer, duration_ms=duration_ms, status="success",
                   tokens_input=tokens_input, tokens_output=tokens_output,
                   tokens_thinking=tokens_thinking)

            return AskResponse(
                answer=answer,
                detected_stocks=detected,
                time_range=time_range_info,
                sources=sources,
                tokens={"input": tokens_input, "output": tokens_output, "thinking": tokens_thinking},
                duration_ms=duration_ms,
                current_time=current_time_str,
            )

        except httpx.TimeoutException:
            duration_ms = int((time.time() - start) * 1000)
            raise HTTPException(status_code=504, detail="LLM 服務超時，請稍後再試")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            from qa_logger import log_qa
            log_qa(query=req.query, prompt=prompt_str, chunks=hits,
                   ai_answer=None, duration_ms=duration_ms, status="error", error_msg=str(e))
            raise HTTPException(500, f"LLM 呼叫失敗：{e}")


class StockAnalysisRequest(BaseModel):
    symbols: list[str] = Field(..., description="股票代號列表", examples=[["2330"]])


class NewsSource(BaseModel):
    id: str
    title: str
    summary: str
    timestamp: str
    url: str


class StockAnalysisResponse(BaseModel):
    news_sources: list[NewsSource]
    fallback_mode: bool
    raw_answer: str


STOCK_ANALYSIS_PROMPT = (
    "你是一位專業的台股財經分析師。\n"
    "【目前時間】{current_time}\n"
    "【分析對象】{stock_names}（{symbols}）\n"
    "【資料時間範圍】{time_from} ～ {time_to}\n\n"
    "以下是近一個月的相關新聞片段：\n\n"
    "{context}\n\n"
    "請根據以上新聞，用繁體中文輸出以下格式，文字簡潔：\n\n"
    "市場情緒：看漲 📈 / 中性 ➡️ / 看跌 📉（擇一）\n"
    "一句話結論：（50字以內，說明判斷原因）\n"
    "風險提醒：（一句話，說明主要下行風險）\n"
)


@app.post("/api/analyze", response_model=StockAnalysisResponse)
async def analyze_stocks(req: StockAnalysisRequest):
    """根據股票代號，取得近一個月新聞並進行 AI 分析"""
    if not qdrant_client or not embeddings:
        raise HTTPException(503, "服務尚未就緒")

    # 驗證股票代號
    valid_symbols = [s for s in req.symbols if s in STOCK_OPTIONS]
    if not valid_symbols:
        raise HTTPException(400, f"無效的股票代號，支援：{list(STOCK_OPTIONS.keys())}")

    from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny
    from datetime import datetime as _dt

    now = _dt.now()
    time_from = (now - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
    time_to = now.strftime("%Y-%m-%d %H:%M:%S")
    current_time_str = now.strftime("%Y年%m月%d日 %H:%M")

    # 每支股票取最相關的 10 筆
    all_hits = []
    stock_names = "、".join(STOCK_OPTIONS[s] for s in valid_symbols)
    query_text = f"{stock_names} 近期表現 營收 股價 財報"
    query_vector = embeddings.embed_query(query_text)

    for sid in valid_symbols:
        results = qdrant_client.query_points(
            collection_name="news_chunks",
            query=query_vector,
            query_filter=Filter(must=[FieldCondition(key="stock_id", match=MatchValue(value=sid))]),
            limit=20,
            with_payload=True,
        )
        # 過濾近一個月
        def normalize_time(t):
            if not t:
                return ""
            t = re.sub(r"\+\d{2}:\d{2}$", "", t.strip())
            return t.replace("T", " ")[:19]

        recent = [p for p in results.points if normalize_time(p.payload.get("pub_time", "")) >= time_from]
        all_hits.extend(recent[:10] if recent else results.points[:5])

    if not all_hits:
        raise HTTPException(404, "近一個月無相關新聞資料")

    # 組裝 news_sources（去重，依 title）
    seen_titles = set()
    news_sources = []
    for hit in all_hits:
        p = hit.payload or {}
        title = p.get("title", "")
        if title in seen_titles:
            continue
        seen_titles.add(title)
        content = p.get("page_content", "")
        news_sources.append(NewsSource(
            id=p.get("chunk_id", str(hit.id)),
            title=title,
            summary=content[:100] + "..." if len(content) > 100 else content,
            timestamp=p.get("pub_time", ""),
            url=p.get("url", ""),
        ))

    # 組裝 context 給 LLM
    context_lines = []
    for i, hit in enumerate(all_hits, 1):
        p = hit.payload or {}
        context_lines.append(
            f"[片段{i}] 標題：{p.get('title', '')}\n"
            f"來源：{get_source_name(p.get('source', ''))} | 時間：{p.get('pub_time', '')}\n"
            f"內容：{p.get('page_content', '')}\n"
            f"連結：{p.get('url', '')}"
        )
    context_str = "\n\n".join(context_lines)

    prompt_str = STOCK_ANALYSIS_PROMPT.format(
        current_time=current_time_str,
        stock_names=stock_names,
        symbols="、".join(valid_symbols),
        time_from=time_from[:10],
        time_to=time_to[:10],
        context=context_str,
    )

    # 呼叫 LLM
    fallback_mode = False
    raw_answer = ""
    try:
        completion = openai_client.chat.completions.create(
            model="meta/llama-3.3-70b-instruct",
            messages=[{"role": "user", "content": prompt_str}],
            temperature=0.6, top_p=0.7, max_tokens=4096,
            stream=False,
        )
        full_content = completion.choices[0].message.content
        raw_answer = re.sub(r"<think>.*?</think>\s*", "", full_content, flags=re.DOTALL).strip()
    except Exception:
        fallback_mode = True
        raw_answer = f"LLM 服務暫時無法使用，以下為原始新聞摘要：\n\n" + "\n".join(
            f"- {ns.title}（{ns.timestamp[:10]}）" for ns in news_sources
        )

    return StockAnalysisResponse(
        news_sources=news_sources,
        fallback_mode=fallback_mode,
        raw_answer=raw_answer,
    )


@app.get("/api/history")
async def list_history(
    page: int = Query(1, ge=1, description="頁碼"),
    page_size: int = Query(20, ge=1, le=100, description="每頁筆數"),
):
    """查詢歷史 QA 紀錄（分頁）"""
    db_path = "./qa_logs.db"
    if not os.path.exists(db_path):
        return {"total": 0, "page": page, "records": []}

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        total = conn.execute("SELECT COUNT(*) FROM qa_logs").fetchone()[0]
        offset = (page - 1) * page_size
        rows = conn.execute(
            "SELECT id, timestamp, query, ai_answer, llm_model, duration_ms, status, "
            "tokens_input, tokens_output FROM qa_logs ORDER BY id DESC LIMIT ? OFFSET ?",
            (page_size, offset),
        ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "records": [
            {
                "id": r["id"],
                "timestamp": r["timestamp"],
                "query": r["query"],
                "answer_preview": (r["ai_answer"] or "")[:200],
                "model": r["llm_model"],
                "duration_ms": r["duration_ms"],
                "status": r["status"],
                "tokens_input": r["tokens_input"],
                "tokens_output": r["tokens_output"],
            }
            for r in rows
        ],
    }


@app.get("/api/history/{record_id}")
async def get_history_detail(record_id: int):
    """取得單筆 QA 詳情（含完整 answer 與 chunks）"""
    db_path = "./qa_logs.db"
    if not os.path.exists(db_path):
        raise HTTPException(404, "無歷史紀錄")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM qa_logs WHERE id = ?", (record_id,)).fetchone()

    if not row:
        raise HTTPException(404, f"找不到紀錄 id={record_id}")

    chunks = json.loads(row["chunks_json"]) if row["chunks_json"] else []
    # 補上 source_name
    for c in chunks:
        c["source_name"] = get_source_name(c.get("source", ""))

    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "query": row["query"],
        "answer": row["ai_answer"],
        "model": row["llm_model"],
        "duration_ms": row["duration_ms"],
        "status": row["status"],
        "error_msg": row["error_msg"],
        "tokens": {
            "input": row["tokens_input"],
            "output": row["tokens_output"],
            "thinking": row["tokens_thinking"],
        },
        "sources": chunks,
    }


@app.get("/api/news")
async def list_news(
    stock_id: str = Query(..., description="股票代號，如 2330"),
    keyword: str = Query("", description="搜尋關鍵字（標題 + 內文）"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """瀏覽原始新聞列表（從 crawler CSV 讀取）"""
    import pandas as pd
    import glob as glob_mod
    from pathlib import Path

    # 嘗試找清洗後 → 原始
    for suffix in ["_news_cleaned.csv", "_news.csv"]:
        fpath = os.path.join("crawler", f"{stock_id}{suffix}")
        if os.path.exists(fpath):
            break
    else:
        raise HTTPException(404, f"找不到股票 {stock_id} 的新聞資料")

    df = pd.read_csv(fpath)

    # 統一欄位名稱
    col_title = "標題" if "標題" in df.columns else "title"
    col_content = "內文" if "內文" in df.columns else "content"
    col_time = "發布時間" if "發布時間" in df.columns else "pub_time"
    col_url = "網址" if "網址" in df.columns else "url"

    if keyword:
        mask = (
            df[col_title].astype(str).str.contains(keyword, case=False, na=False) |
            df[col_content].astype(str).str.contains(keyword, case=False, na=False)
        )
        df = df[mask]

    # 排序
    if col_time in df.columns:
        df[col_time] = pd.to_datetime(df[col_time], errors="coerce")
        df = df.sort_values(col_time, ascending=False)

    total = len(df)
    start = (page - 1) * page_size
    page_df = df.iloc[start:start + page_size]

    records = []
    for _, row in page_df.iterrows():
        records.append({
            "title": str(row.get(col_title, "")),
            "pub_time": str(row.get(col_time, "")),
            "url": str(row.get(col_url, "")),
            "content_preview": str(row.get(col_content, ""))[:300],
        })

    return {
        "stock_id": stock_id,
        "stock_name": STOCK_OPTIONS.get(stock_id, stock_id),
        "total": total,
        "page": page,
        "page_size": page_size,
        "records": records,
    }


# ── 前端頁面 ─────────────────────────────────────────
@app.get("/")
async def serve_frontend():
    return FileResponse("index.html", media_type="text/html")
