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
import uuid
import hashlib
import pymysql
import pymysql.cursors
import httpx
import asyncio
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException, Header
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
    "{user_context_block}"
    "根據以上新聞內容，請針對使用者的問題進行分析：「{query}」\n\n"
    "注意：\n"
    "1. 請依據新聞發布時間與目前時間的相對關係，適當標注資訊的時效性（例如：「X 個月前報導」、「近期」等）。\n"
    "2. 優先引用 ★ 標記的新聞進行分析，其他新聞可作為背景補充。\n"
    "3. 若使用者詢問的是過去某個時間點，請站在當時的角度分析，不要用之後才發生的事件做判斷。\n"
    "4. 回答時請明確說明你引用的新聞時間範圍（例如：「以下分析基於 2023 年 Q1 的新聞資料」）。\n"
    "5. 若引用資料的時間與使用者詢問的時間不符，請主動告知差異。\n"
    "6. 若有【使用者個人觀點】，請在分析中明確評估這些觀點是否獲得新聞支持，並說明支持或反駁的依據。\n\n"
    "請用繁體中文回答，並以以下格式輸出：\n"
    "【綜合摘要】\n（2-3行簡要說明；若涉及多支股票，請分別說明再整體比較）\n\n"
    "【市場情緒】\n（看漲 📈 / 看跌 📉 / 中性 ➡️，並說明原因；多股時請各自標示）\n\n"
    "【關鍵事件】\n（條列式，3-5個重點；多股時請標明各事件屬於哪支股票）\n\n"
    "{personal_view_section}"
    "【投資提示】\n（基於新聞的客觀觀察，非投資建議）\n\n"
    "【引用來源】\n（列出本次分析引用的新聞標題與連結，格式：- 標題：連結）\n"
)


def _build_user_context_block(user_token: str | None, query: str) -> tuple[str, str]:
    """
    根據使用者 token 取得個人觀點，回傳 (user_context_block, personal_view_section)
    - user_context_block：注入 prompt 的觀點文字
    - personal_view_section：輸出格式中的【觀點驗證】區塊（有觀點才加）
    """
    if not user_token:
        return "", ""
    user = _get_user_by_token(user_token)
    if not user:
        return "", ""
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT question, personal_view FROM user_views WHERE user_id = %s ORDER BY id DESC",
                    (user["id"],)
                )
                views = cur.fetchall()
    except Exception:
        return "", ""
    if not views:
        return "", ""

    lines = []
    for v in views:
        lines.append(f"- 情境：{v['question']}\n  觀點：{v['personal_view']}")
    block = "【使用者個人觀點】\n以下是使用者預先設定的分析觀點，請在分析中評估這些觀點是否獲得新聞支持：\n" + "\n".join(lines) + "\n\n"
    section = "【觀點驗證】\n（針對上方使用者的每個觀點，說明新聞是否支持 ✅ 或反駁 ❌，並引用具體新聞作為依據）\n\n"
    return block, section


async def _generate_actions(query: str, detected_stocks: list[str], answer: str) -> list[dict]:
    if not openai_client:
        return []
    stock_list = "、".join(detected_stocks) if detected_stocks else "無"
    stocks_json = json.dumps(detected_stocks, ensure_ascii=False)
    prompt = (
        f"根據以下台股問答，決定最多 2 個後續行動按鈕（JSON 陣列）。\n\n"
        f"使用者問題：{query}\n"
        f"偵測到的股票：{stock_list}\n"
        f"回答摘要（前 100 字）：{answer[:100]}\n\n"
        f"規則：\n"
        f"- 幾乎每次都要給一個 follow_up（建議追問，label 用中文，query 為具體問題）\n"
        f"- 第二個從以下擇一：涉及走勢/預測給 chart；涉及新聞/事件給 news；涉及主觀判斷/該不該買給 save_view；"
        f"涉及進出場時機、是否該買賣、且已偵測到股票代號時，可給 order\n"
        f"- order 的 label 要像自然語言的追問句、口吻跟 follow_up 一致，"
        f"例如「根據以上資料，要不要嘗試看看模擬下單？」，不要用生硬的按鈕文字（如「前往模擬下單」）\n"
        f"- 若只有一個合適的就只給一個\n"
        f"- stock_id 只能從 {stocks_json} 中選，沒有偵測到股票時省略 stock_id 欄位\n\n"
        f"只輸出 JSON 陣列，不要其他文字：\n"
        f'[{{"type":"follow_up","label":"...","query":"..."}},'
        f'{{"type":"order","label":"根據以上資料，要不要嘗試看看模擬下單？","stock_id":"XXXX"}}]'
    )
    try:
        resp = openai_client.chat.completions.create(
            model="meta/llama-3.1-8b-instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=256, stream=False,
        )
        raw = resp.choices[0].message.content.strip()
        raw = re.sub(r"^```json\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
        actions = json.loads(raw)
        if isinstance(actions, list):
            return actions[:2]
    except Exception:
        pass
    return []


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
async_openai_client = None
intent_classifier = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """啟動時載入 Qdrant、Embedding、LLM 等重量級元件"""
    global qdrant_client, embeddings, openai_client, async_openai_client, intent_classifier

    from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings, ChatNVIDIA
    from langchain_core.prompts import PromptTemplate
    from langchain_core.output_parsers import StrOutputParser
    from qdrant_client import QdrantClient
    from openai import OpenAI, AsyncOpenAI

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
    async_openai_client = AsyncOpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=os.environ.get("NVIDIA_API_KEY", ""),
        http_client=httpx.AsyncClient(timeout=30.0),
    )

    llm = ChatNVIDIA(model="meta/llama-3.1-8b-instruct", temperature=0)
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

    # ── 初始化 MySQL 資料表 ──
    try:
        from qa_logger import init_db
        init_db()
        print("[startup] MySQL qa_logs 資料表就緒")
    except Exception as e:
        print(f"[startup] MySQL 初始化失敗（不影響 RAG 運行）: {e}")

    try:
        _init_user_db()
        print("[startup] MySQL users/user_views 資料表就緒")
    except Exception as e:
        print(f"[startup] MySQL users 初始化失敗: {e}")

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
    user_token: str | None = Field(None, description="使用者 token（登入後取得），用於帶入個人觀點")


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
    actions: list[dict] = []


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


def _sse(type: str, **kwargs) -> str:
    return f"data: {json.dumps({'type': type, **kwargs}, ensure_ascii=False)}\n\n"


async def _stream_ask(req):
    """串流模式：所有步驟在 generator 內執行，每步推送 status event"""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue, Range, OrderBy

        current_time_str = datetime.now().strftime("%Y年%m月%d日 %H:%M")

        # Step 1: 意圖分析
        yield _sse("status", content="🔍 正在找尋資料...")
        await asyncio.sleep(0)
        raw_intent = await asyncio.to_thread(
            lambda: intent_classifier.invoke({
                "query": req.query,
                "current_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }).strip()
        )
        try:
            cleaned = re.sub(r"^```json\s*|\s*```$", "", raw_intent, flags=re.MULTILINE).strip()
            intent_data = json.loads(cleaned)
        except (json.JSONDecodeError, TypeError):
            intent_data = {"is_finance": "NO" not in raw_intent.upper(), "stocks": [], "time_from": None, "time_to": None}

        if not intent_data.get("is_finance", True):
            yield _sse("done", answer="🤖 系統提示：我是一個專業的「財經新聞 AI 助理」。您剛剛的發問似乎與財經領域無關，我無法從財經資料庫中為您檢索這類話題。請嘗試問我關於某家公司的營收、股價、或是產業新聞！", detected_stocks=[], time_range=None, sources=[], duration_ms=0, current_time=current_time_str)
            return

        ai_stocks = [s for s in intent_data.get("stocks", []) if s in STOCK_OPTIONS]
        effective_stock_id = req.stock_id
        auto_detected_ids = ai_stocks if ai_stocks else []
        if not effective_stock_id and not auto_detected_ids:
            auto_detected_ids = [sid for sid, kws in STOCK_KEYWORDS.items() if any(kw in req.query for kw in kws)]
        if not effective_stock_id and len(auto_detected_ids) == 1:
            effective_stock_id = auto_detected_ids[0]

        ai_time_from = intent_data.get("time_from")
        ai_time_to = intent_data.get("time_to")
        time_from = ai_time_from if ai_time_from else None
        time_to = ai_time_to if ai_time_to else None
        if not time_from or not time_to:
            time_from, time_to = extract_time_filter(req.query)

        # Step 2: 搜尋新聞
        query_vector = await asyncio.to_thread(embeddings.embed_query, req.query)

        def normalize_time(t):
            if not t: return ""
            t = t.replace("T", " ")
            if "+" in t: t = t[:t.index("+")]
            if len(t) > 19: t = t[:19]
            return t.strip()

        def to_timestamp(t):
            from datetime import datetime as _dt
            s = normalize_time(t)
            if not s: return 0.0
            return _dt.fromisoformat(s).timestamp()

        def is_in_time_range(pub_time):
            if not time_from or not time_to: return True
            nt = normalize_time(pub_time)
            return normalize_time(time_from) <= nt <= normalize_time(time_to)

        def is_before_cutoff(pub_time):
            if not time_to: return True
            return normalize_time(pub_time) <= normalize_time(time_to)

        def time_score(pub_time):
            from datetime import datetime as _dt, timezone as _tz
            if not pub_time: return 0.5
            try:
                pub = _dt.fromisoformat(normalize_time(pub_time))
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=_tz(timedelta(hours=8)))
                if not time_from:
                    now = _dt.now(tz=_tz(timedelta(hours=8)))
                    days_old = (now - pub).days
                    return max(0.1, 1.0 - (days_old // 30) * 0.15)
                t_from = _dt.fromisoformat(normalize_time(time_from))
                t_to = _dt.fromisoformat(normalize_time(time_to)) if time_to else pub
                if t_from <= pub <= t_to: return 1.0
                diff = min(abs((pub - t_from).days), abs((pub - t_to).days))
                return max(0.1, 1.0 - diff / 365)
            except: return 0.5

        def rank_by_time(points):
            for p in points: p._in_time_range = True
            if not time_from and not time_to:
                points.sort(key=lambda p: p.score * 0.7 + time_score(p.payload.get("pub_time", "") or "") * 0.3, reverse=True)
                return points
            filtered = [p for p in points if is_before_cutoff(p.payload.get("pub_time", "") or "")]
            for p in filtered:
                p._in_time_range = is_in_time_range(p.payload.get("pub_time", "") or "")
            filtered.sort(key=lambda p: p.score * 0.7 + time_score(p.payload.get("pub_time", "") or "") * 0.3, reverse=True)
            return filtered

        collection_name = "news_chunks"
        time_fallback = False

        if time_from and time_to:
            count_filter_must = [FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))]
            if effective_stock_id:
                count_filter_must.append(FieldCondition(key="stock_id", match=MatchValue(value=effective_stock_id)))
            count_result = qdrant_client.count(collection_name=collection_name, count_filter=Filter(must=count_filter_must))
            if count_result.count == 0:
                time_from = None; time_to = None; time_fallback = True

        def calc_limit(tf, tt):
            if not tf or not tt: return 10, ""
            from datetime import datetime as _dt
            try:
                days = (_dt.fromisoformat(normalize_time(tt)) - _dt.fromisoformat(normalize_time(tf))).days
            except: return 10, ""
            if days <= 30: return 10, ""
            elif days <= 90: return 15, ""
            elif days <= 365: return 20, ""
            else: return 25, "查詢時間跨度較大（超過一年），分析結果可能較為概括。"

        base_limit, time_warning = calc_limit(time_from, time_to)

        if len(auto_detected_ids) > 1:
            PER_STOCK_LIMIT = max(5, base_limit // len(auto_detected_ids))
            grouped_hits = {}
            for sid in auto_detected_ids:
                stock_must = [FieldCondition(key="stock_id", match=MatchValue(value=sid))]
                if time_from and time_to:
                    in_range_r = qdrant_client.query_points(collection_name=collection_name, query=query_vector, query_filter=Filter(must=stock_must + [FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))]), limit=PER_STOCK_LIMIT, with_payload=True)
                    bg_r = qdrant_client.query_points(collection_name=collection_name, query=query_vector, query_filter=Filter(must=stock_must), limit=max(3, PER_STOCK_LIMIT // 2), with_payload=True)
                    seen = {p.id for p in in_range_r.points}
                    combined = in_range_r.points + [p for p in bg_r.points if p.id not in seen]
                else:
                    r = qdrant_client.query_points(collection_name=collection_name, query=query_vector, query_filter=Filter(must=stock_must), limit=PER_STOCK_LIMIT, with_payload=True)
                    combined = r.points
                grouped_hits[sid] = rank_by_time(combined)[:PER_STOCK_LIMIT]
            hits = [h for pts in grouped_hits.values() for h in pts]
        else:
            stock_must = []
            if effective_stock_id:
                stock_must.append(FieldCondition(key="stock_id", match=MatchValue(value=effective_stock_id)))
            if time_from and time_to:
                in_range_r = qdrant_client.query_points(collection_name=collection_name, query=query_vector, query_filter=Filter(must=stock_must + [FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))]) if stock_must else Filter(must=[FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))]), limit=base_limit, with_payload=True)
                bg_r = qdrant_client.query_points(collection_name=collection_name, query=query_vector, query_filter=Filter(must=stock_must) if stock_must else None, limit=max(5, base_limit // 2), with_payload=True)
                seen = {p.id for p in in_range_r.points}
                combined = in_range_r.points + [p for p in bg_r.points if p.id not in seen]
            else:
                qf = Filter(must=stock_must) if stock_must else None
                r = qdrant_client.query_points(collection_name=collection_name, query=query_vector, query_filter=qf, limit=base_limit, with_payload=True)
                combined = r.points
            hits = rank_by_time(combined)[:base_limit]
            grouped_hits = None

        if not hits:
            yield _sse("error", message="未找到相關新聞，請嘗試其他關鍵字或調整股票篩選。")
            return

        def format_chunk(hit, num):
            p = hit.payload
            star = "★ " if getattr(hit, '_in_time_range', True) else ""
            return (f"[{star}片段{num}] 標題：{p.get('title', '')}\n"
                    f"來源：{get_source_name(p.get('source', ''))} | 時間：{p.get('pub_time', '')}\n"
                    f"內容：{p.get('page_content', '')}\n"
                    f"連結：{p.get('url', '')}")

        context_parts = []
        if grouped_hits and len(auto_detected_ids) > 1:
            chunk_num = 1
            for sid in auto_detected_ids:
                stock_label = STOCK_OPTIONS.get(sid, sid)
                context_parts.append(f"═══ {stock_label} 相關新聞 ═══")
                for hit in grouped_hits[sid]:
                    context_parts.append(format_chunk(hit, chunk_num)); chunk_num += 1
        else:
            for i, hit in enumerate(hits): context_parts.append(format_chunk(hit, i + 1))
        context_str = "\n\n---\n\n".join(context_parts)

        time_focus = ""
        if time_from and time_to:
            time_focus = f"【使用者關注時段】{time_from} ～ {time_to}（請以此時段為分析重點，標記 ★ 的新聞在此範圍內）"
            if time_warning: time_focus += f"\n⚠️ {time_warning}"
        elif time_to:
            time_focus = f"【分析截止時間】{time_to}（請站在此時間點的角度分析，不要參考之後的資訊）"

        user_context_block, personal_view_section = _build_user_context_block(req.user_token, req.query)
        prompt_str = ANALYSIS_PROMPT_TEMPLATE.format(context=context_str, query=req.query, current_time=current_time_str, time_focus=time_focus, user_context_block=user_context_block, personal_view_section=personal_view_section)

        sources = []
        for hit in hits:
            p = hit.payload or {}
            sources.append(SourceChunk(title=p.get("title",""), source=p.get("source",""), source_name=get_source_name(p.get("source","")), pub_time=p.get("pub_time",""), url=p.get("url",""), stock_id=p.get("stock_id",""), content=p.get("page_content",""), score=round(hit.score, 4) if hit.score else 0))

        detected = auto_detected_ids if auto_detected_ids else ([effective_stock_id] if effective_stock_id else [])
        time_range_info = {"from": time_from, "to": time_to} if time_from else None

        # Step 3: 生成回答
        yield _sse("status", content="🤖 大模型思考中...")
        await asyncio.sleep(0)
        start = time.time()
        stream_resp = await async_openai_client.chat.completions.create(
            model="meta/llama-3.1-8b-instruct",
            messages=[{"role": "user", "content": prompt_str}],
            temperature=0.6, top_p=0.7, max_tokens=4096,
            stream=True,
        )
        full_text = ""
        async for chunk in stream_resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                full_text += delta
                yield _sse("text", content=delta)

        duration_ms = int((time.time() - start) * 1000)

        # 提取 thinking tokens
        think_match = re.search(r"<think>(.*?)</think>", full_text, re.DOTALL)
        tokens_thinking = len(think_match.group(1)) // 4 if think_match else None

        clean_text = re.sub(r"<think>.*?</think>\s*", "", full_text, flags=re.DOTALL).strip()
        if time_fallback:
            clean_text += "\n\n⚠️ 因資料庫中找不到符合指定時間範圍的資料，以上分析僅供參考。"

        actions = await _generate_actions(req.query, detected, clean_text)
        yield _sse("done", answer=clean_text, detected_stocks=detected, time_range=time_range_info, sources=[s.model_dump() for s in sources], duration_ms=duration_ms, current_time=current_time_str, actions=actions)

        try:
            from qa_logger import log_qa
        except ImportError:
            import sys, pathlib
            sys.path.insert(0, str(pathlib.Path(__file__).parent))
            from qa_logger import log_qa
        log_qa(query=req.query, prompt=prompt_str, chunks=hits, ai_answer=clean_text, duration_ms=duration_ms, status="success_stream", tokens_input=None, tokens_output=None, tokens_thinking=tokens_thinking)

    except httpx.TimeoutException:
        yield _sse("error", message="LLM 服務超時，請稍後再試")
    except Exception as e:
        yield _sse("error", message=str(e))


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

    if req.stream:
        return StreamingResponse(_stream_ask(req), media_type="text/event-stream")

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
        """
        時間加權分數：
        - 有指定時間範圍：範圍內 1.0，範圍外依距離衰減，最低 0.1
        - 無指定時間：距今越近分數越高，30天內=1.0，每多30天衰減0.15，最低0.1
        """
        from datetime import datetime as _dt, timezone, timedelta as _td
        if not pub_time:
            return 0.5
        try:
            pub = _dt.fromisoformat(normalize_time(pub_time))
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone(timedelta(hours=8)))

            if not time_from:
                # 無指定時間：以今天為基準，越新越好
                now = _dt.now(tz=timezone(timedelta(hours=8)))
                days_old = (now - pub).days
                return max(0.1, 1.0 - (days_old // 30) * 0.15)

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
        1. 有指定時間時，過濾掉「時間點之後」的資料
        2. 向量相似度 70% + 時間加權分數 30% 合併排序
        3. 無指定時間時同樣套用時間加權（越新越優先）
        """
        for p in points:
            p._in_time_range = True

        if not time_from and not time_to:
            # 無指定時間：直接套用時間加權排序，越新越優先
            points.sort(
                key=lambda p: p.score * 0.7 + time_score(p.payload.get("pub_time", "") or "") * 0.3,
                reverse=True
            )
            return points

        # 有指定時間：過濾掉指定時間之後的資料
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
            FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
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
                        FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
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
                    FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
                ]) if stock_must else Filter(must=[
                    FieldCondition(key="pub_ts", range=Range(gte=to_timestamp(time_from), lte=to_timestamp(time_to)))
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

    user_context_block, personal_view_section = _build_user_context_block(req.user_token, req.query)
    prompt_str = ANALYSIS_PROMPT_TEMPLATE.format(
        context=context_str,
        query=req.query,
        current_time=current_time_str,
        time_focus=time_focus,
        user_context_block=user_context_block,
        personal_view_section=personal_view_section,
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

    # 6. 呼叫 LLM（非串流模式，串流模式已在上方由 _stream_ask 處理）
    start = time.time()
    try:
        completion = openai_client.chat.completions.create(
            model="meta/llama-3.1-8b-instruct",
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

        try:
            from qa_logger import log_qa
        except ImportError:
            import sys, pathlib
            sys.path.insert(0, str(pathlib.Path(__file__).parent))
            from qa_logger import log_qa
        log_qa(query=req.query, prompt=prompt_str, chunks=hits,
               ai_answer=answer, duration_ms=duration_ms, status="success",
               tokens_input=tokens_input, tokens_output=tokens_output,
               tokens_thinking=tokens_thinking)

        actions = await _generate_actions(req.query, detected, answer)
        return AskResponse(
            answer=answer,
            detected_stocks=detected,
            time_range=time_range_info,
            sources=sources,
            tokens={"input": tokens_input, "output": tokens_output, "thinking": tokens_thinking},
            duration_ms=duration_ms,
            current_time=current_time_str,
            actions=actions,
        )

    except httpx.TimeoutException:
        duration_ms = int((time.time() - start) * 1000)
        raise HTTPException(status_code=504, detail="LLM 服務超時，請稍後再試")
    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        try:
            from qa_logger import log_qa
        except ImportError:
            import sys, pathlib
            sys.path.insert(0, str(pathlib.Path(__file__).parent))
            from qa_logger import log_qa
        log_qa(query=req.query, prompt=prompt_str, chunks=hits,
               ai_answer=None, duration_ms=duration_ms, status="error", error_msg=str(e))
        raise HTTPException(500, f"LLM 呼叫失敗：{e}")


class StockAnalysisRequest(BaseModel):
    symbols: list[str] = Field(..., description="股票代號列表", examples=[["2330"]])
    as_of: str | None = Field(
        None,
        description="回測用基準時間點（格式 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS），"
                    "抓取範圍為此時間點往前一個月、且不含之後的新聞。不傳則預設為現在。",
        examples=["2026-06-01"],
    )


class NewsSource(BaseModel):
    id: str
    title: str
    summary: str
    timestamp: str
    url: str


class StockAnalysisResponse(BaseModel):
    news_sources: list[NewsSource]


@app.post("/api/analyze", response_model=StockAnalysisResponse)
async def analyze_stocks(req: StockAnalysisRequest):
    """取得指定時間點（預設為現在）往前一個月的相關新聞，供即時查詢或歷史回測使用"""
    if not qdrant_client or not embeddings:
        raise HTTPException(503, "服務尚未就緒")

    # 驗證股票代號
    valid_symbols = [s for s in req.symbols if s in STOCK_OPTIONS]
    if not valid_symbols:
        raise HTTPException(400, f"無效的股票代號，支援：{list(STOCK_OPTIONS.keys())}")

    from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny
    from datetime import datetime as _dt

    if req.as_of:
        try:
            base_time = _dt.fromisoformat(req.as_of)
        except ValueError:
            raise HTTPException(400, "as_of 格式錯誤，請用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS")
    else:
        base_time = _dt.now()
    time_from = (base_time - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
    time_to = base_time.strftime("%Y-%m-%d %H:%M:%S")

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
        # 過濾指定時間範圍（雙邊夾住，避免回測時洩漏未來新聞）
        def normalize_time(t):
            if not t:
                return ""
            t = re.sub(r"\+\d{2}:\d{2}$", "", t.strip())
            return t.replace("T", " ")[:19]

        recent = [
            p for p in results.points
            if time_from <= normalize_time(p.payload.get("pub_time", "")) <= time_to
        ]
        not_future = [
            p for p in results.points
            if normalize_time(p.payload.get("pub_time", "")) <= time_to
        ]
        all_hits.extend(recent[:10] if recent else not_future[:5])

    if not all_hits:
        raise HTTPException(404, "指定時間範圍內無相關新聞資料")

    # 組裝 news_sources（去重，依 title）
    seen_titles = set()
    news_sources = []
    for hit in all_hits:
        p = hit.payload or {}
        title = p.get("title", "")
        if title in seen_titles:
            continue
        seen_titles.add(title)
        news_sources.append(NewsSource(
            id=p.get("chunk_id", str(hit.id)),
            title=title,
            summary=p.get("page_content", ""),
            timestamp=p.get("pub_time", ""),
            url=p.get("url", ""),
        ))

    return StockAnalysisResponse(news_sources=news_sources)


def _mysql_conn():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "localhost"),
        user=os.environ.get("MYSQL_USER", "rag"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE", "rag_logs"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


# ── 使用者系統 ────────────────────────────────────────

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _init_user_db():
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    username   VARCHAR(50) UNIQUE NOT NULL,
                    password   VARCHAR(64) NOT NULL,
                    token      VARCHAR(36),
                    created_at DATETIME NOT NULL
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_views (
                    id           INT AUTO_INCREMENT PRIMARY KEY,
                    user_id      INT NOT NULL,
                    question     TEXT NOT NULL,
                    personal_view TEXT NOT NULL,
                    created_at   DATETIME NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            """)
        conn.commit()


def _get_user_by_token(token: str | None):
    if not token:
        return None
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, username FROM users WHERE token = %s", (token,))
                return cur.fetchone()
    except Exception:
        return None


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=4)


class LoginRequest(BaseModel):
    username: str
    password: str


class UserViewRequest(BaseModel):
    question: str = Field(..., description="問題情境")
    personal_view: str = Field(..., description="個人觀點")


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE username = %s", (req.username,))
                if cur.fetchone():
                    raise HTTPException(400, "使用者名稱已存在")
                token = str(uuid.uuid4())
                cur.execute(
                    "INSERT INTO users (username, password, token, created_at) VALUES (%s, %s, %s, %s)",
                    (req.username, _hash_password(req.password), token, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                )
            conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"註冊失敗：{e}")
    return {"message": "註冊成功", "token": token, "username": req.username}


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, token FROM users WHERE username = %s AND password = %s",
                            (req.username, _hash_password(req.password)))
                user = cur.fetchone()
                if not user:
                    raise HTTPException(401, "帳號或密碼錯誤")
                # 更新 token
                token = str(uuid.uuid4())
                cur.execute("UPDATE users SET token = %s WHERE id = %s", (token, user["id"]))
            conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"登入失敗：{e}")
    return {"message": "登入成功", "token": token, "username": req.username}


@app.get("/api/profile/views")
async def list_views(x_token: str | None = Header(None, alias="x-token")):
    user = _get_user_by_token(x_token)
    if not user:
        raise HTTPException(401, "請先登入")
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, question, personal_view, created_at FROM user_views WHERE user_id = %s ORDER BY id DESC",
                        (user["id"],))
            rows = cur.fetchall()
    return {"views": [{"id": r["id"], "question": r["question"], "personal_view": r["personal_view"], "created_at": str(r["created_at"])} for r in rows]}


@app.post("/api/profile/views")
async def add_view(req: UserViewRequest, x_token: str | None = Header(None, alias="x-token")):
    user = _get_user_by_token(x_token)
    if not user:
        raise HTTPException(401, "請先登入")
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO user_views (user_id, question, personal_view, created_at) VALUES (%s, %s, %s, %s)",
                (user["id"], req.question, req.personal_view, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            )
        conn.commit()
    return {"message": "新增成功"}


@app.delete("/api/profile/views/{view_id}")
async def delete_view(view_id: int, x_token: str | None = Header(None, alias="x-token")):
    user = _get_user_by_token(x_token)
    if not user:
        raise HTTPException(401, "請先登入")
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_views WHERE id = %s AND user_id = %s", (view_id, user["id"]))
        conn.commit()
    return {"message": "刪除成功"}


@app.get("/api/history")
async def list_history(
    page: int = Query(1, ge=1, description="頁碼"),
    page_size: int = Query(20, ge=1, le=100, description="每頁筆數"),
):
    """查詢歷史 QA 紀錄（分頁）"""
    try:
        conn = _mysql_conn()
    except Exception:
        return {"total": 0, "page": page, "records": []}

    with conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) as cnt FROM qa_logs")
            total = cursor.fetchone()["cnt"]
            offset = (page - 1) * page_size
            cursor.execute(
                "SELECT id, timestamp, query, ai_answer, llm_model, duration_ms, status, "
                "tokens_input, tokens_output FROM qa_logs ORDER BY id DESC LIMIT %s OFFSET %s",
                (page_size, offset),
            )
            rows = cursor.fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "records": [
            {
                "id": r["id"],
                "timestamp": str(r["timestamp"]),
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
    try:
        conn = _mysql_conn()
    except Exception:
        raise HTTPException(404, "無歷史紀錄")

    with conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM qa_logs WHERE id = %s", (record_id,))
            row = cursor.fetchone()

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


# ── 股價走勢 ─────────────────────────────────────────
@app.get("/api/stock_price")
async def get_stock_price(
    stock_id: str = Query(..., description="股票代號，如 2330"),
    start_date: str = Query(None, description="開始日期 YYYY-MM-DD"),
    end_date: str = Query(None, description="結束日期 YYYY-MM-DD，預設今天"),
    trading_days: int = Query(None, description="最近 N 個交易日，優先於 start_date"),
):
    """拉取台股日收盤價（yfinance）"""
    from datetime import date, timedelta

    if not end_date:
        end_date = date.today().strftime("%Y-%m-%d")
    if trading_days:
        # 多抓 1.5 倍日曆天確保足夠，再截取最後 N 個交易日
        start_date = (date.today() - timedelta(days=int(trading_days * 1.5))).strftime("%Y-%m-%d")
    elif not start_date:
        start_date = (date.today() - timedelta(days=180)).strftime("%Y-%m-%d")

    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{stock_id}.TW")
        df = await asyncio.to_thread(ticker.history, start=start_date, end=end_date, interval="1d")
    except Exception as e:
        raise HTTPException(502, f"股價取得失敗：{e}")

    if df is None or df.empty:
        raise HTTPException(404, f"找不到股票 {stock_id} 的價格資料")

    records = [
        {
            "date": str(idx.date()),
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low": round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
            "volume": int(row["Volume"]),
        }
        for idx, row in df.iterrows()
    ]

    if trading_days:
        records = records[-trading_days:]

    return {
        "stock_id": stock_id,
        "stock_name": STOCK_OPTIONS.get(stock_id, stock_id),
        "records": records,
    }


@app.get("/api/news_timeline")
async def get_news_timeline(
    stock_id: str = Query(..., description="股票代號，如 2330"),
    start_date: str = Query(None, description="開始日期 YYYY-MM-DD"),
    end_date: str = Query(None, description="結束日期 YYYY-MM-DD"),
):
    """從 Qdrant 拉指定股票新聞的時間點 + 標題（供圖表標記用）"""
    from qdrant_client.models import Filter, FieldCondition, MatchValue, Range
    from datetime import date, timedelta

    if not qdrant_client:
        raise HTTPException(503, "向量資料庫未就緒")

    if not end_date:
        end_date = date.today().strftime("%Y-%m-%d")
    if not start_date:
        start_date = (date.today() - timedelta(days=180)).strftime("%Y-%m-%d")

    results = await asyncio.to_thread(
        qdrant_client.scroll,
        collection_name="news_chunks",
        scroll_filter=Filter(must=[FieldCondition(key="stock_id", match=MatchValue(value=stock_id))]),
        limit=2000,
        with_payload=True,
        with_vectors=False,
    )

    seen_titles = set()
    news = []
    for point in results[0]:
        p = point.payload or {}
        title = p.get("title", "")
        pub_time = p.get("pub_time", "")
        if not pub_time or title in seen_titles:
            continue
        date_str = pub_time[:10]
        if date_str < start_date or date_str > end_date:
            continue
        seen_titles.add(title)
        news.append({
            "date": date_str,
            "title": title,
            "source": get_source_name(p.get("source", "")),
            "url": p.get("url", ""),
        })

    news.sort(key=lambda x: x["date"])
    return {
        "stock_id": stock_id,
        "stock_name": STOCK_OPTIONS.get(stock_id, stock_id),
        "news": news,
    }


@app.get("/api/trend_predict")
async def get_trend_predict(
    stock_id: str = Query(..., description="股票代號，如 2330"),
):
    """線性回歸趨勢 + AI 新聞情緒預測（未來 10 交易日）"""
    from datetime import date, timedelta

    # ── 1. 取最近 30 交易日價格 ──
    fetch_start = (date.today() - timedelta(days=60)).strftime("%Y-%m-%d")
    fetch_end   = date.today().strftime("%Y-%m-%d")
    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{stock_id}.TW")
        df = await asyncio.to_thread(ticker.history, start=fetch_start, end=fetch_end, interval="1d")
    except Exception as e:
        raise HTTPException(502, f"股價取得失敗：{e}")

    if df is None or df.empty:
        raise HTTPException(404, f"找不到股票 {stock_id} 的價格資料")

    records = [
        {"date": str(idx.date()), "close": round(float(row["Close"]), 2)}
        for idx, row in df.iterrows()
    ]
    records = records[-30:]  # 最多 30 個交易日

    closes = [r["close"] for r in records]
    last_date_str = records[-1]["date"]
    last_price = closes[-1]
    n = len(closes)

    # ── 2. 加權線性回歸（指數衰減權重，近期資料影響力較高） ──
    import math as _math
    from prediction_core import compute_weighted_regression
    regression_history, slope, intercept = compute_weighted_regression(closes, lam=0.1)

    # ── 3. 產生未來 20 個交易日日期（約 1 個月） ──
    def next_trading_days(from_str: str, n: int):
        from datetime import date as _date
        d = _date.fromisoformat(from_str) + timedelta(days=1)
        days = []
        while len(days) < n:
            if d.weekday() < 5:
                days.append(d.isoformat())
            d += timedelta(days=1)
        return days

    future_dates = next_trading_days(last_date_str, 20)

    # ── 短期動能 + 均值回歸曲線預測 ──
    from prediction_core import compute_momentum_meanreversion_curve
    regression_future = compute_momentum_meanreversion_curve(closes, horizon_days=20)

    # ── 4. 取最近 20 則新聞 ──
    recent_news_titles = []
    if qdrant_client:
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            news_start = (date.today() - timedelta(days=30)).strftime("%Y-%m-%d")
            scroll_res = await asyncio.to_thread(
                qdrant_client.scroll,
                collection_name="news_chunks",
                scroll_filter=Filter(must=[FieldCondition(key="stock_id", match=MatchValue(value=stock_id))]),
                limit=500,
                with_payload=True,
                with_vectors=False,
            )
            seen = set()
            for pt in scroll_res[0]:
                p = pt.payload or {}
                title = p.get("title", "")
                pub_time = p.get("pub_time", "")
                if not pub_time or not title or title in seen:
                    continue
                if pub_time[:10] >= news_start:
                    seen.add(title)
                    recent_news_titles.append(title)
            recent_news_titles = recent_news_titles[:20]
        except Exception:
            pass

    # ── 5. LLM 預測（透過共用預測核心，與回測腳本共用同一套邏輯） ──
    from prediction_core import StrategyConfig, generate_prediction
    stock_name = STOCK_OPTIONS.get(stock_id, stock_id)
    live_strategy = StrategyConfig(name="live_default", news_window_days=30, news_limit=20)
    prediction = await generate_prediction(
        stock_id=stock_id,
        stock_name=stock_name,
        price_records=records,
        news_titles=recent_news_titles,
        strategy=live_strategy,
        openai_client=openai_client,
    )
    ai_direction = prediction["direction"]
    ai_change_pct = prediction["change_pct_total"]
    ai_confidence = prediction["confidence"]
    ai_summary = prediction["summary"]

    # ── 6. 計算歷史日波動率（σ） ──
    import math
    daily_returns = [
        (closes[i] - closes[i - 1]) / closes[i - 1]
        for i in range(1, len(closes))
    ]
    mean_ret = sum(daily_returns) / len(daily_returns) if daily_returns else 0
    variance = sum((r - mean_ret) ** 2 for r in daily_returns) / len(daily_returns) if daily_returns else 0
    daily_sigma = math.sqrt(variance)

    # 回歸通道上下界（±1σ，以回歸殘差為基準）
    residuals = [closes[i] - regression_history[i] for i in range(n)]
    resid_std = math.sqrt(sum(r ** 2 for r in residuals) / n) if n else 0
    regression_upper = [round(regression_history[i] + resid_std, 2) for i in range(n)]
    regression_lower = [round(regression_history[i] - resid_std, 2) for i in range(n)]

    # ── 7. AI 預測線：從最後價格線性插值到目標價（20 天） ──
    target_price = round(last_price * (1 + ai_change_pct / 100), 2)
    ai_future = [
        round(last_price + (target_price - last_price) * (i + 1) / 20, 2)
        for i in range(20)
    ]

    return {
        "stock_id": stock_id,
        "stock_name": stock_name,
        "history_dates": [r["date"] for r in records],
        "regression_history": regression_history,
        "regression_upper": regression_upper,
        "regression_lower": regression_lower,
        "future_dates": future_dates,
        "regression_future": regression_future,
        "ai_future": ai_future,
        "ai_direction": ai_direction,
        "ai_change_pct": ai_change_pct,
        "ai_confidence": ai_confidence,
        "ai_summary": ai_summary,
        "last_price": last_price,
        "target_price": target_price,
        "daily_sigma_pct": round(daily_sigma * 100, 2),
    }


@app.get("/api/trend_predict_stream")
async def trend_predict_stream(
    stock_id: str = Query(..., description="股票代號，如 2330"),
):
    """逐週預測 SSE 串流：4 次獨立 LLM 呼叫，每算完一週就推送一個節點"""
    from datetime import date, timedelta
    import math as _math

    # ── 1. 取最近 30 交易日價格 ──
    fetch_start = (date.today() - timedelta(days=60)).strftime("%Y-%m-%d")
    fetch_end   = date.today().strftime("%Y-%m-%d")
    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{stock_id}.TW")
        df = await asyncio.to_thread(ticker.history, start=fetch_start, end=fetch_end, interval="1d")
    except Exception as e:
        async def err():
            yield f"data: {json.dumps({'type':'error','message':str(e)})}\n\n"
        return StreamingResponse(err(), media_type="text/event-stream")

    records = [
        {"date": str(idx.date()), "close": round(float(row["Close"]), 2)}
        for idx, row in df.iterrows()
    ]
    records = records[-30:]
    closes = [r["close"] for r in records]
    last_date_str = records[-1]["date"]
    last_price = closes[-1]
    n = len(closes)

    # ── 2. 加權線性回歸 ──
    lam = 0.1
    weights = [_math.exp(lam * i) for i in range(n)]
    w_sum = sum(weights)
    x_vals = list(range(n))
    x_mean_w = sum(weights[i] * x_vals[i] for i in range(n)) / w_sum
    y_mean_w = sum(weights[i] * closes[i]  for i in range(n)) / w_sum
    num_w    = sum(weights[i] * (x_vals[i] - x_mean_w) * (closes[i] - y_mean_w) for i in range(n))
    den_w    = sum(weights[i] * (x_vals[i] - x_mean_w) ** 2 for i in range(n))
    slope     = num_w / den_w if den_w else 0
    intercept = y_mean_w - slope * x_mean_w

    regression_history = [round(slope * i + intercept, 2) for i in x_vals]

    # 回歸通道
    residuals = [closes[i] - regression_history[i] for i in range(n)]
    resid_std = _math.sqrt(sum(r ** 2 for r in residuals) / n) if n else 0
    regression_upper = [round(regression_history[i] + resid_std, 2) for i in range(n)]
    regression_lower = [round(regression_history[i] - resid_std, 2) for i in range(n)]

    # ── 3. 未來 20 個交易日日期 ──
    def next_trading_days(from_str, cnt):
        from datetime import date as _d
        d = _d.fromisoformat(from_str) + timedelta(days=1)
        days = []
        while len(days) < cnt:
            if d.weekday() < 5:
                days.append(d.isoformat())
            d += timedelta(days=1)
        return days

    future_dates = next_trading_days(last_date_str, 20)

    # 短期動能 + 均值回歸曲線
    n5 = min(5, n)
    closes5 = closes[-n5:]
    x5 = list(range(n5))
    w5 = [_math.exp(0.2 * i) for i in range(n5)]
    w5s = sum(w5)
    x5mw = sum(w5[i] * x5[i] for i in range(n5)) / w5s
    y5mw = sum(w5[i] * closes5[i] for i in range(n5)) / w5s
    n5d  = sum(w5[i] * (x5[i]-x5mw)**2 for i in range(n5))
    short_slope = sum(w5[i]*(x5[i]-x5mw)*(closes5[i]-y5mw) for i in range(n5)) / n5d if n5d else slope
    ma20 = sum(closes[-20:]) / min(20, n)
    mean_pull_per_day = (ma20 - last_price) / 20

    regression_future = []
    price = last_price
    for i in range(20):
        decay = _math.exp(-0.18 * i)
        daily_move = decay * short_slope + (1 - decay) * mean_pull_per_day
        price = round(price + daily_move, 2)
        regression_future.append(price)

    # ── 4. 取近期新聞 ──
    recent_news_titles = []
    if qdrant_client:
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            news_start = (date.today() - timedelta(days=30)).strftime("%Y-%m-%d")
            scroll_res = await asyncio.to_thread(
                qdrant_client.scroll,
                collection_name="news_chunks",
                scroll_filter=Filter(must=[FieldCondition(key="stock_id", match=MatchValue(value=stock_id))]),
                limit=500, with_payload=True, with_vectors=False,
            )
            seen = set()
            for pt in scroll_res[0]:
                p = pt.payload or {}
                title = p.get("title", "")
                pub_time = p.get("pub_time", "")
                if not pub_time or not title or title in seen:
                    continue
                if pub_time[:10] >= news_start:
                    seen.add(title)
                    recent_news_titles.append(title)
            recent_news_titles = recent_news_titles[:20]
        except Exception:
            pass

    stock_name = STOCK_OPTIONS.get(stock_id, stock_id)
    price_change_pct = round((closes[-1] - closes[0]) / closes[0] * 100, 2) if closes[0] else 0
    price_trend_desc = f"最近 {n} 個交易日，收盤價從 {closes[0]} 到 {closes[-1]} 元（{price_change_pct:+.2f}%），加權回歸斜率每日 {slope:+.2f} 元。"
    news_desc = "\n".join(f"- {t}" for t in recent_news_titles) if recent_news_titles else "（無近期新聞）"

    # ── 5. SSE 串流：逐週呼叫 LLM ──
    async def generate():
        # 先推送初始化資料
        init_payload = {
            "type": "init",
            "stock_id": stock_id,
            "stock_name": stock_name,
            "last_price": last_price,
            "history_dates": [r["date"] for r in records],
            "regression_history": regression_history,
            "regression_upper": regression_upper,
            "regression_lower": regression_lower,
            "future_dates": future_dates,
            "regression_future": regression_future,
        }
        yield f"data: {json.dumps(init_payload, ensure_ascii=False)}\n\n"

        prior_nodes = []  # 累積已預測週次，作為後續週的 context

        for week in range(1, 5):
            day_idx = week * 5 - 1  # 第 4、9、14、19 天（0-indexed）
            prior_ctx = ""
            if prior_nodes:
                lines = [f"  第{w}週末：{p:+.2f}%，{r}" for w, p, r, _ in prior_nodes]
                prior_ctx = "\n\n## 前幾週已預測結果\n" + "\n".join(lines)

            prompt = f"""你是台股分析師。請根據以下資訊，獨立預測 {stock_name}（{stock_id}）第 {week} 週末（未來第 {week*5} 個交易日）的漲跌幅。

## 當前資訊
- 最新收盤價：{last_price} 元
- {price_trend_desc}

## 近期相關新聞
{news_desc}{prior_ctx}

請只回答 JSON，不要其他文字：
{{"pct": 漲跌幅數字（例如 1.5 或 -2.0）, "reason": "一句話說明本週關鍵判斷依據"}}"""

            pct = 0.0
            reason = ""
            try:
                resp = await asyncio.to_thread(
                    openai_client.chat.completions.create,
                    model="meta/llama-3.3-70b-instruct",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                    max_tokens=120,
                )
                raw = resp.choices[0].message.content.strip()
                import re as _re
                m = _re.search(r'\{.*\}', raw, _re.DOTALL)
                if m:
                    parsed = json.loads(m.group())
                    pct    = float(parsed.get("pct", 0))
                    reason = parsed.get("reason", "")
            except Exception as e:
                reason = f"預測失敗：{e}"

            # 累積價格（以前一週節點為基準）
            base_price = prior_nodes[-1][3] if prior_nodes else last_price
            node_price = round(base_price * (1 + pct / 100), 2)
            prior_nodes.append((week, pct, reason, node_price))

            node_payload = {
                "type": "node",
                "week": week,
                "day_idx": day_idx,
                "price": node_price,
                "pct": pct,
                "reason": reason,
            }
            yield f"data: {json.dumps(node_payload, ensure_ascii=False)}\n\n"

        # 推送完成訊號
        total_pct = round((prior_nodes[-1][3] - last_price) / last_price * 100, 2)
        direction = "up" if total_pct > 0 else "down"
        done_payload = {
            "type": "done",
            "total_pct": total_pct,
            "direction": direction,
            "target_price": prior_nodes[-1][3],
            "nodes": [{"week": w, "pct": p, "reason": r, "price": pr} for w, p, r, pr in prior_nodes],
        }
        yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 前端頁面 ─────────────────────────────────────────
@app.get("/")
async def serve_frontend():
    return FileResponse("index.html", media_type="text/html")

@app.get("/chart_demo")
async def serve_chart_demo():
    return FileResponse("chart_demo.html", media_type="text/html")
