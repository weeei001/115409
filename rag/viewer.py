import streamlit as st
import pandas as pd
import glob
import os
import re
import time
from datetime import datetime, timedelta, date
from pathlib import Path
from dotenv import load_dotenv

# 新增 RAG 相關套件
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from qdrant_client import QdrantClient

# Intent Classifier 使用 ChatNVIDIA（llama3），分析模型使用 OpenAI SDK 呼叫 deepseek-r1
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from openai import OpenAI

# 載入環境變數 (API Key)
load_dotenv()

# 設定網頁標題與寬度為滿版 (緊湊畫面)
st.set_page_config(page_title="財經新聞 RAG 系統", layout="wide", page_icon="📈")

# 新聞來源對應表 (source field → 顯示名稱)
# CMoney 社群作者帳號統一顯示為「CMoney 財經社群」
CMONEY_SOURCES = {
    "tpshouse", "cmoney", "newsyoudeservetoknow", "lewis", "coneyresearcher",
    "cmoneyaicurator", "josh", "money", "nico", "cmoneyairesearcher",
    "ruanmuhhwa", "star", "captain", "firebro", "bubuypope", "wealthonebro",
    "emily", "yolandawu", "alansays", "jiahongxlinying", "ugly", "sharon",
    "laochien", "edwin", "jacklai", "ericlu", "stockmantalk", "crawler_csv",
    "p", "so2ym6jh",
}

SOURCE_NAME_MAP = {
    "cnyes":      "鉅亨網",
    "ltn":        "自由時報",
    "moneydj":    "MoneyDJ",
    "udn":        "聯合新聞網",
    "chinatimes": "中時新聞網",
    "yahoo":      "Yahoo 財經",
}

def extract_time_filter(query: str):
    """
    從查詢字串中偵測時間意圖，回傳 (date_from_str, date_to_str) 或 (None, None)。
    日期格式：'YYYY-MM-DD 00:00:00'（與 pub_time 相容）
    """
    today = datetime.now()

    def fmt(d: datetime) -> str:
        return d.strftime("%Y-%m-%d %H:%M:%S")

    # ── 相對時間詞 ──────────────────────────────────────
    if re.search(r"今天|今日", query):
        return fmt(today.replace(hour=0, minute=0, second=0)), fmt(today)

    if re.search(r"昨天|昨日", query):
        yd = today - timedelta(days=1)
        return fmt(yd.replace(hour=0, minute=0, second=0)), fmt(yd.replace(hour=23, minute=59, second=59))

    if re.search(r"本週|這週|這周|本周", query):
        monday = today - timedelta(days=today.weekday())
        return fmt(monday.replace(hour=0, minute=0, second=0)), fmt(today)

    if re.search(r"上週|上星期|上周", query):
        last_monday = today - timedelta(days=today.weekday() + 7)
        last_sunday = last_monday + timedelta(days=6)
        return fmt(last_monday.replace(hour=0, minute=0, second=0)), fmt(last_sunday.replace(hour=23, minute=59, second=59))

    if re.search(r"本月|這個月|這月", query):
        start = today.replace(day=1, hour=0, minute=0, second=0)
        return fmt(start), fmt(today)

    if re.search(r"上個月|上月", query):
        first_this = today.replace(day=1)
        last_month_end = first_this - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0)
        return fmt(last_month_start), fmt(last_month_end.replace(hour=23, minute=59, second=59))

    if re.search(r"今年|本年度", query):
        start = today.replace(month=1, day=1, hour=0, minute=0, second=0)
        return fmt(start), fmt(today)

    if re.search(r"去年|上一年", query):
        y = today.year - 1
        return f"{y}-01-01 00:00:00", f"{y}-12-31 23:59:59"

    if re.search(r"近[一1]週|最近[一1]週|近7天|最近7天", query):
        return fmt(today - timedelta(days=7)), fmt(today)

    if re.search(r"近[一1三3]十天|近30天|最近30天|近一個月|最近一個月|最近|近期|近來", query):
        return fmt(today - timedelta(days=30)), fmt(today)

    if re.search(r"近[三3]個月|近90天|最近三個月", query):
        return fmt(today - timedelta(days=90)), fmt(today)

    if re.search(r"近半年|近六個月", query):
        return fmt(today - timedelta(days=180)), fmt(today)

    # ── 年度（如 2024年、2023年）──────────────────────
    m = re.search(r"(\d{4})[年]", query)
    if m:
        y = int(m.group(1))
        # ── 季度（如 2024年Q1、2024年第1季）──
        qm = re.search(r"第?([一二三四1-4])季|Q([1-4])", query)
        if qm:
            q = qm.group(1) or qm.group(2)
            q_map = {"一": 1, "二": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4}
            q_num = q_map.get(q, 1)
            start_month = (q_num - 1) * 3 + 1
            end_month = start_month + 2
            import calendar
            last_day = calendar.monthrange(y, end_month)[1]
            return f"{y}-{start_month:02d}-01 00:00:00", f"{y}-{end_month:02d}-{last_day:02d} 23:59:59"

        # 上下半年
        if re.search(r"上半年", query):
            return f"{y}-01-01 00:00:00", f"{y}-06-30 23:59:59"
        if re.search(r"下半年", query):
            return f"{y}-07-01 00:00:00", f"{y}-12-31 23:59:59"

        # 整年
        return f"{y}-01-01 00:00:00", f"{y}-12-31 23:59:59"

    # 未偵測到時間意圖
    return None, None


def get_source_name(source_raw):
    if source_raw in SOURCE_NAME_MAP:
        return SOURCE_NAME_MAP[source_raw]
    if source_raw in CMONEY_SOURCES or source_raw.isdigit():
        return "CMoney 財經社群"
    return source_raw  # 未知來源直接顯示原始值

st.title("📈 財經新聞 RAG 與資料預覽庫")

# 建立兩個分頁
tab1, tab2 = st.tabs(["🔍 AI 語意搜尋 (RAG)", "📊 原始資料庫預覽"])

# ==========================================
# Tab 1: AI 語意搜尋 (RAG)
# ==========================================
with tab1:
    st.markdown("### 🤖 使用 NVIDIA AI 模型進行語意搜尋")
    st.caption("直接輸入您想問的財經問題，系統會透過 Qdrant 向量資料庫，為您從海量新聞中精準撈出最相關的片段。")

    # 股票篩選 + 搜尋框
    STOCK_OPTIONS = {
        "全部（不限股票）": None,
        "2330 台積電": "2330",
        "2317 鴻海": "2317",
        "2454 聯發科": "2454",
        "2881 富邦金": "2881",
        "2408 南亞": "2408",
        "2615 萬海": "2615",
    }

    col_stock, col_query = st.columns([1, 3])
    with col_stock:
        selected_stock_label = st.selectbox("股票篩選", list(STOCK_OPTIONS.keys()), key="stock_filter")
    with col_query:
        query = st.text_input("請輸入您的提問 (例如：「近期在 AI 伺服器的表現如何？」)：", key="rag_search")

    selected_stock_id = STOCK_OPTIONS[selected_stock_label]

    # 初始化 RAG 檢索器（使用 Qdrant 原生查詢以取得完整 payload）
    @st.cache_resource
    def load_rag_components():
        qdrant_path = "./qdrant_db"
        collection_name = "news_chunks"
        if not os.path.exists(qdrant_path):
            return None, None, None
        embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")
        client = QdrantClient(path=qdrant_path)
        return embeddings, client, collection_name

    rag_components = load_rag_components()

    # 建立一個法官模型 (Intent Classifier) - 判斷詢問是否跟這 6 檔股票或財經有關
    @st.cache_resource
    def get_intent_classifier():
        # 使用 NVIDIA 免費提供的 Llama 3 大腦來判斷
        llm = ChatNVIDIA(model="meta/llama3-70b-instruct", temperature=0)
        prompt = PromptTemplate.from_template(
            "你是一個嚴格的意圖分類器。使用者會輸入一句話。\n"
            "如果這句話跟『台股、財經、股票、營收、財報、伺服器、AI發展、總體經濟、或者具體公司(如鴻海,台積電,聯發科等)』有關，請只回答 'YES'。\n"
            "如果這句話是日常問候 (如你好、早安)、閒聊、或是跟財經投資毫無關係的話題 (如昨天晚餐吃什麼)，請只回答 'NO'。\n"
            "使用者輸入: {query}\n"
            "你的回答 (YES或NO): "
        )
        return prompt | llm | StrOutputParser()

    # AI 分析：使用 OpenAI SDK 直接呼叫 deepseek-r1-distill-qwen-14b（取得完整 usage）
    @st.cache_resource
    def get_openai_client():
        return OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=os.environ.get("NVIDIA_API_KEY", ""),
        )

    ANALYSIS_PROMPT_TEMPLATE = (
        "你是一位專業的台股財經分析師。\n"
        "【目前時間】{current_time}\n\n"
        "以下是從新聞資料庫中撈出的相關新聞片段（片段中的「時間」為該新聞的發布日期）：\n\n"
        "{context}\n\n"
        "根據以上新聞內容，請針對使用者的問題進行分析：「{query}」\n\n"
        "注意：請依據新聞發布時間與目前時間的相對關係，適當標注資訊的時效性（例如：「X 個月前報導」、「近期」等）。\n\n"
        "請用繁體中文回答，並以以下格式輸出：\n"
        "【綜合摘要】\n（2-3行簡要說明；若涉及多支股票，請分別說明再整體比較）\n\n"
        "【市場情緒】\n（看漲 📈 / 看跌 📉 / 中性 ➡️，並說明原因；多股時請各自標示）\n\n"
        "【關鍵事件】\n（條列式，3-5個重點；多股時請標明各事件屬於哪支股票）\n\n"
        "【投資提示】\n（基於新聞的客觀觀察，非投資建議）\n\n"
        "【引用來源】\n（列出本次分析引用的新聞標題與連結，格式：- 標題：連結）\n"
    )

    intent_classifier = get_intent_classifier()

    if query:
        if rag_components[0] is None:
            st.error("⚠️ 找不到 Qdrant 向量資料庫，請先執行 `build_vector_db.py` 進行建庫！")
        else:
            embeddings, qdrant_client, collection_name = rag_components
            with st.spinner("🕵️‍♂️ 系統正在分析您的語意意圖..."):
                intent = intent_classifier.invoke({"query": query}).strip().upper()

            if "NO" in intent:
                st.warning("🤖 系統提示：我是一個專業的「財經新聞 AI 助理」。您剛剛的發問或問候似乎與財經領域無關，我無法從財經資料庫中為您檢索這類閒聊或無關話題。請嘗試問我關於某家公司的營收、股價、或是產業新聞！")
            else:
                STOCK_KEYWORDS = {
                    "2330": ["台積電", "TSMC", "2330"],
                    "2317": ["鴻海", "富士康", "2317"],
                    "2454": ["聯發科", "MediaTek", "2454"],
                    "2881": ["富邦金", "富邦", "2881"],
                    "2408": ["南亞", "2408"],
                    "2615": ["萬海", "2615"],
                }

                # 決定實際使用的 stock_id filter：手動選 > 自動偵測
                effective_stock_id = selected_stock_id
                auto_detected_ids = []
                if not effective_stock_id:
                    auto_detected_ids = [sid for sid, kws in STOCK_KEYWORDS.items() if any(kw in query for kw in kws)]
                    if len(auto_detected_ids) == 1:
                        effective_stock_id = auto_detected_ids[0]

                label_map = {v: k for k, v in STOCK_OPTIONS.items() if v}

                # 偵測查詢中的時間意圖
                time_from, time_to = extract_time_filter(query)
                current_time_str = datetime.now().strftime("%Y年%m月%d日 %H:%M")

                with st.spinner("NVIDIA 模型正以光速為您檢索財經資料庫中..."):
                    from qdrant_client.models import Filter, FieldCondition, MatchValue, Range

                    def build_date_conditions():
                        """回傳日期 range 條件清單（空白則回傳 []）"""
                        if time_from and time_to:
                            return [FieldCondition(key="pub_time", range=Range(gte=time_from, lte=time_to))]
                        return []

                    query_vector = embeddings.embed_query(query)

                    # 多股分組檢索：每支股票各別查詢 top-5，再合併
                    # 單股 / 無股：維持原本 top-10
                    if len(auto_detected_ids) > 1:
                        PER_STOCK_LIMIT = 5
                        grouped_hits = {}  # {stock_id: [hits]}
                        for sid in auto_detected_ids:
                            must_conditions = [FieldCondition(key="stock_id", match=MatchValue(value=sid))]
                            must_conditions.extend(build_date_conditions())
                            f = Filter(must=must_conditions)
                            r = qdrant_client.query_points(
                                collection_name=collection_name,
                                query=query_vector,
                                query_filter=f,
                                limit=PER_STOCK_LIMIT,
                                with_payload=True
                            )
                            grouped_hits[sid] = r.points
                        hits = [h for pts in grouped_hits.values() for h in pts]
                    else:
                        must_conditions = []
                        if effective_stock_id:
                            must_conditions.append(FieldCondition(key="stock_id", match=MatchValue(value=effective_stock_id)))
                        must_conditions.extend(build_date_conditions())
                        qdrant_filter = Filter(must=must_conditions) if must_conditions else None
                        response = qdrant_client.query_points(
                            collection_name=collection_name,
                            query=query_vector,
                            query_filter=qdrant_filter,
                            limit=10,
                            with_payload=True
                        )
                        hits = response.points
                        grouped_hits = None

                # 顯示時間偵測狀態
                if time_from and time_to:
                    st.caption(f"🗓️ 自動偵測時間範圍：**{time_from[:10]}** ～ **{time_to[:10]}**")

                # 顯示篩選狀態
                if selected_stock_id:
                    st.caption(f"🔍 已套用手動篩選：**{selected_stock_label}**")
                elif len(auto_detected_ids) == 1:
                    st.caption(f"🔍 自動偵測到股票：**{label_map.get(effective_stock_id, effective_stock_id)}**，已套用篩選")
                elif len(auto_detected_ids) > 1:
                    names = "、".join(label_map.get(s, s) for s in auto_detected_ids)
                    per_count = {label_map.get(s, s): len(grouped_hits[s]) for s in auto_detected_ids}
                    detail = "、".join(f"{n} {c}筆" for n, c in per_count.items())
                    st.caption(f"🔍 多股分組檢索：**{names}**（{detail}）")
                else:
                    st.caption("🔍 未偵測到特定股票，搜尋全部資料（可能包含跨股票結果）")

                # 組合 context 字串
                # 多股模式：按股票分組標記，讓 LLM 知道哪些片段屬於哪支股票
                context_parts = []
                if grouped_hits and len(auto_detected_ids) > 1:
                    chunk_num = 1
                    for sid in auto_detected_ids:
                        stock_label = label_map.get(sid, sid)
                        context_parts.append(f"═══ {stock_label} 相關新聞 ═══")
                        for hit in grouped_hits[sid]:
                            p = hit.payload
                            context_parts.append(
                                f"[片段{chunk_num}] 標題：{p.get('title', '')}\n"
                                f"來源：{get_source_name(p.get('source', ''))} | 時間：{p.get('pub_time', '')}\n"
                                f"內容：{p.get('page_content', '')}\n"
                                f"連結：{p.get('url', '')}"
                            )
                            chunk_num += 1
                else:
                    for i, hit in enumerate(hits):
                        p = hit.payload
                        context_parts.append(
                            f"[片段{i+1}] 標題：{p.get('title', '')}\n"
                            f"來源：{get_source_name(p.get('source', ''))} | 時間：{p.get('pub_time', '')}\n"
                            f"內容：{p.get('page_content', '')}\n"
                            f"連結：{p.get('url', '')}"
                        )
                context_str = "\n\n---\n\n".join(context_parts)

                # 組合實際送出的 prompt 字串（用於紀錄）
                prompt_str = ANALYSIS_PROMPT_TEMPLATE.format(
                    context=context_str,
                    query=query,
                    current_time=current_time_str,
                )

                # 呼叫 deepseek-r1-distill-qwen-14b（OpenAI SDK）
                openai_client = get_openai_client()
                start_time = time.time()
                analysis_result = None
                llm_status = "error"
                error_msg = None
                tokens_input = tokens_output = tokens_thinking = None
                try:
                    with st.spinner("🤖 AI 財經分析師正在思考中，請稍候..."):
                        completion = openai_client.chat.completions.create(
                            model="meta/llama-3.3-70b-instruct",
                            messages=[{"role": "user", "content": prompt_str}],
                            temperature=0.6,
                            top_p=0.7,
                            max_tokens=4096,
                            stream=False,
                        )
                        full_content = completion.choices[0].message.content
                        tokens_input  = completion.usage.prompt_tokens
                        tokens_output = completion.usage.completion_tokens

                    # 解析 thinking token：<think>...</think> 字元數 ÷ 4 估算
                    import re
                    think_match = re.search(r"<think>(.*?)</think>", full_content, re.DOTALL)
                    if think_match:
                        tokens_thinking = len(think_match.group(1)) // 4
                        # 移除 <think> 區塊，只保留正式回答
                        analysis_result = re.sub(r"<think>.*?</think>\s*", "", full_content, flags=re.DOTALL).strip()
                    else:
                        analysis_result = full_content.strip()

                    llm_status = "success"
                except Exception as e:
                    error_msg = str(e)
                    st.error(f"⚠️ 無法連線至 LLM，請稍後再試。（錯誤：{e}）")
                finally:
                    duration_ms = int((time.time() - start_time) * 1000)

                # 寫入問答紀錄
                from qa_logger import log_qa
                log_qa(
                    query=query,
                    prompt=prompt_str,
                    chunks=hits,
                    ai_answer=analysis_result,
                    duration_ms=duration_ms,
                    status=llm_status,
                    error_msg=error_msg,
                    tokens_input=tokens_input,
                    tokens_output=tokens_output,
                    tokens_thinking=tokens_thinking,
                )

                # 顯示 AI 分析報告
                if analysis_result:
                    st.markdown("---")
                    st.markdown("### 🤖 AI 財經分析報告")
                    st.markdown(analysis_result)

                # 原始參考片段（折疊）
                st.markdown("---")
                if grouped_hits and len(auto_detected_ids) > 1:
                    filter_badge = f"（多股分組：{', '.join(label_map.get(s,s) for s in auto_detected_ids)}）"
                elif selected_stock_id:
                    filter_badge = f"（篩選：{selected_stock_label}）"
                else:
                    filter_badge = "（未篩選股票）"

                with st.expander(f"📚 查看 {len(hits)} 筆原始參考新聞片段 {filter_badge}", expanded=False):
                    if grouped_hits and len(auto_detected_ids) > 1:
                        # 多股：按股票分組顯示
                        chunk_num = 1
                        for sid in auto_detected_ids:
                            stock_label = label_map.get(sid, sid)
                            st.markdown(f"#### {stock_label}")
                            for hit in grouped_hits[sid]:
                                payload = hit.payload
                                title = payload.get('title', '無標題')
                                pub_time = payload.get('pub_time', '未知')
                                source_name = get_source_name(payload.get('source', ''))
                                page_content = payload.get('page_content', '')
                                url = payload.get('url', '')
                                url_display = f"[點擊前往原文]({url})" if url else "❌ 無網址"
                                st.markdown(f"**[{chunk_num}] {title}**")
                                st.caption(f"來源：{source_name} | 時間：{pub_time} | {url_display}")
                                st.info(page_content)
                                st.divider()
                                chunk_num += 1
                    else:
                        for i, hit in enumerate(hits):
                            payload = hit.payload
                            title = payload.get('title', '無標題')
                            pub_time = payload.get('pub_time', '未知')
                            source_name = get_source_name(payload.get('source', ''))
                            stock_id = payload.get('stock_id', 'N/A')
                            page_content = payload.get('page_content', '')
                            url = payload.get('url', '')
                            url_display = f"[點擊前往原文]({url})" if url else "❌ 無網址"
                            st.markdown(f"**[{i+1}] {title}**")
                            st.caption(f"來源：{source_name} | 股票：{stock_id} | 時間：{pub_time} | {url_display}")
                            st.info(page_content)
                            st.divider()

# ==========================================
# Tab 2: 原始資料庫預覽
# ==========================================
with tab2:
    st.markdown("### 📂 資料庫內容檢視器")
    # 尋找可用的股票代號
    @st.cache_data
    def get_available_stocks():
        files = glob.glob(os.path.join("crawler", "*_news.csv"))
        stocks = set()
        for f in files:
            stock_id = Path(f).stem.split('_')[0]
            stocks.add(stock_id)
        return sorted(list(stocks))

    stocks = get_available_stocks()

    if not stocks:
        st.warning("在 crawler 資料夾中找不到任何新聞 CSV 檔案。")
    else:
        # 確保有分頁的 session state
        if 'page' not in st.session_state:
            st.session_state.page = 1

        def reset_page():
            st.session_state.page = 1

        # 頂部控制面板
        col1, col2, col3 = st.columns([1, 1, 2])

        with col1:
            selected_stock = st.selectbox("請選擇股票代號：", stocks, key="db_stock", on_change=reset_page)

        with col2:
            data_type = st.radio("請選擇資料類型：", ["乾淨新聞 (Cleaned)", "原始新聞 (Raw)", "切塊資料 (Chunked)"], key="db_type", on_change=reset_page)

        with col3:
            search_keyword = st.text_input("在標題或內文中搜尋關鍵字：", key="db_search", on_change=reset_page)

        # 讀取資料的函數
        @st.cache_data
        def load_data(stock, data_type):
            if data_type == "切塊資料 (Chunked)":
                suffix = "_news_chunked.csv"
            elif data_type == "乾淨新聞 (Cleaned)":
                suffix = "_news_cleaned.csv"
            else:
                suffix = "_news.csv"
            file_path = os.path.join("crawler", f"{stock}{suffix}")
            
            if not os.path.exists(file_path):
                return None
            
            df = pd.read_csv(file_path)
            if "發布時間" in df.columns:
                df["發布時間"] = pd.to_datetime(df["發布時間"], errors='coerce')
                df = df.sort_values(by="發布時間", ascending=False)
            elif "pub_time" in df.columns:
                df["pub_time"] = pd.to_datetime(df["pub_time"], errors='coerce')
                df = df.sort_values(by="pub_time", ascending=False)
                
            return df

        df = load_data(selected_stock, data_type)

        if df is None:
            st.error(f"找不到對應的資料檔案。")
        else:
            # 搜尋過濾
            if search_keyword:
                if data_type == "切塊資料 (Chunked)":
                    mask = df['title'].str.contains(search_keyword, na=False, case=False) | \
                           df['content_chunk'].str.contains(search_keyword, na=False, case=False)
                else:
                    mask = df['標題'].str.contains(search_keyword, na=False, case=False) | \
                           df['內文'].str.contains(search_keyword, na=False, case=False)
                df = df[mask]

            st.success(f"目前顯示 **{selected_stock}** 的 {data_type}，共 {len(df)} 筆資料。")

            # === 分頁邏輯開始 ===
            items_per_page = 1000 # 您可以根據需求調整每頁顯示幾筆
            total_pages = (len(df) - 1) // items_per_page + 1 if len(df) > 0 else 1
            
            # 確保目前頁數不會超過總頁數
            if st.session_state.page > total_pages:
                st.session_state.page = total_pages
                
            # 計算目前頁面要切片的範圍
            start_idx = (st.session_state.page - 1) * items_per_page
            end_idx = start_idx + items_per_page
            
            # 分頁控制 UI
            col_p1, col_p2, col_p3 = st.columns([1, 2, 1])
            with col_p1:
                if st.button("⬅️ 上一頁", disabled=st.session_state.page <= 1):
                    st.session_state.page -= 1
                    st.rerun()
            with col_p2:
                st.markdown(f"<div style='text-align: center; padding-top: 10px;'>📄 第 <b>{st.session_state.page}</b> 頁 / 共 {total_pages} 頁 (每頁顯示 {items_per_page} 筆)</div>", unsafe_allow_html=True)
            with col_p3:
                # 靠右對齊的作法
                right_col = st.columns([2, 1])[1]
                with right_col:
                    if st.button("下一頁 ➡️", disabled=st.session_state.page >= total_pages):
                        st.session_state.page += 1
                        st.rerun()

            # 顯示當前頁面的資料片段 (iloc)
            st.dataframe(
                df.iloc[start_idx:end_idx],
                use_container_width=True,
                hide_index=True,
                height=600 
            )
