# 股票財經 RAG + 走勢圖分析系統

> 整合 AI 新聞 RAG、實時股價走勢圖、技術面分析與聊天式股票問答的台股投資輔助平台

## 🎯 核心功能

### 1️⃣ **財經新聞 RAG 系統**
- 📰 多來源新聞爬蟲（鉅亨網、自由時報、MoneyDJ、聯合新聞網、中時新聞網、Yahoo、CMoney 社群）
- 🔍 向量化檢索與相似度排序（NVIDIA NVIDIAEmbeddings, 1024維）
- 🤖 AI 意圖分類（Llama3-70B）+ 動態時間加權排序
- 💬 聊天式股票問答（Llama-3.3-70B 分析 LLM）
- 📊 完整 QA 日誌記錄（SQL 資料庫）

### 2️⃣ **股價走勢圖分析**
- 📈 **K 線圖** + 多條移動平均線（MA5, MA10, MA20, MA60, MA120）
- 📊 **成交量分析** - 量價關係視覺化
- 💹 **價格變化圖** - 漲跌幅百分比計算
- 🔄 **多股票比較** - 同期走勢對比（最多 10 支）
- 📌 **技術指標** - KD、RSI、MACD、布林帶等

### 3️⃣ **實時數據同步**
- 📅 TWSE 日線行情自動爬蟲（含斷點續抓）
- 📰 新聞 30 分鐘定時更新排程
- 🔧 技術指標每日自動計算
- 💼 三大法人買賣超統計

## 📁 項目結構

```
.
├── README.md                          # 本文件
├── CLAUDE.md                          # 詳細架構文檔（給 Claude Code）
├── PLAN.md                            # 開發計劃與完成狀態
│
├── rag/                               # RAG 財經新聞系統
│   ├── viewer.py                      # Streamlit 前端 UI
│   ├── ingest_sources.py              # 新聞攝入與去重
│   ├── run_chunking.py                # 文本分塊（400字, overlap=50）
│   ├── build_vector_db.py             # 向量化構建（Tkinter GUI）
│   ├── news_storage.py                # 本地新聞存儲管理器
│   ├── crawlers/                      # 各媒體爬蟲實現
│   └── qdrant_db/                     # 向量數據庫（本地）
│
├── backend/                           # FastAPI 股價 API 後端
│   ├── main.py                        # 應用入口
│   ├── config.py                      # 環境設定
│   ├── requirements.txt               # Python 依賴
│   ├── API_DOCS.md                    # 詳細 API 文檔
│   ├── README.md                      # 後端說明
│   ├── models/                        # SQLAlchemy ORM 模型
│   │   └── daily_price.py             # 日線行情表
│   ├── schemas/                       # Pydantic 數據模型
│   ├── crud/                          # 資料層邏輯
│   │   ├── daily_price.py             # 股價查詢
│   │   └── chart_helper.py            # 圖表計算（MA、成交量等）
│   ├── routers/                       # API 端點
│   │   └── daily_price.py             # 股價與圖表 API（~100 行代碼）
│   └── crawler/                       # 爬蟲與排程任務
│       ├── twse_crawler.py            # TWSE 日線爬蟲
│       ├── cnyes_crawlwer.py          # 鉅亨網新聞爬蟲
│       └── technical_indicator_job.py # 技術指標計算
│
├── frontend/topictest/                # Next.js + React 前端
│   ├── pages/
│   │   ├── index.tsx                  # 首頁
│   │   ├── ai.tsx                     # AI 顧問頁面
│   │   ├── stock/[id].tsx             # 股票詳情頁（走勢圖集合）
│   │   └── compare.tsx                # 多股比較頁
│   └── components/
│       ├── CandlestickChart.tsx       # K 線圖
│       ├── VolumeChart.tsx            # 成交量圖
│       ├── PriceChangeChart.tsx       # 價格變化圖
│       ├── ComparisonChart.tsx        # 多股比較圖
│       ├── AITrendPanel.tsx           # AI 趨勢分析面板
│       ├── ChatArea.tsx               # 聊天區域
│       └── NewsCard.tsx               # 新聞卡片
│
├── rag_deploy/                        # 獨立部署資料夾
│   ├── api_server.py                  # RAG API 服務器（FastAPI）
│   ├── index.html                     # 前端測試頁面
│   ├── qa_logger.py                   # QA 紀錄服務
│   ├── requirements.txt               # 部署依賴
│   ├── Dockerfile                     # Docker 鏡像配置
│   └── .env                           # 部署環境變數
│
└── docker-compose.yml                 # 完整容器編排（cloudflared + nginx + api）
```

## 📊 數據流架構

```
新聞來源（CSV + OtherNewWeb）
    ↓
ingest_sources.py（去重與入庫）
    ↓
news_db_local/（本地檔案存儲）
    ↓
run_chunking.py（遞迴分塊）
    ↓
build_vector_db.py（向量化）
    ↓
qdrant_db/（向量數據庫）
    ↓
viewer.py / rag_deploy/api_server.py（RAG 查詢）
    ├─→ AI Intent Classifier（股票 + 時間範圍偵測）
    ├─→ Qdrant 相似度搜索 + 時間加權排序
    └─→ 分析 LLM（Llama-3.3-70B）

━━━━━━━━━━━━━━━━━━━━━━━━━

股價爬蟲（TWSE 日線）
    ↓
backend/database（MySQL）
    ↓
backend/routers/daily_price.py（API）
    ├─→ K 線圖 + MA 移動平均線
    ├─→ 成交量分析
    ├─→ 技術指標（KD、RSI、MACD 等）
    └─→ 多股票比較

━━━━━━━━━━━━━━━━━━━━━━━━━

前端展示
    ├─→ Streamlit UI（rag/viewer.py）
    ├─→ Next.js 單頁應用（frontend/topictest）
    └─→ HTML 測試頁（rag_deploy/index.html）
```

## 🚀 快速開始

### 前置需求
- Python 3.9+
- MySQL 5.7+（或 MariaDB）
- Docker & Docker Compose（部署用）
- NVIDIA API Key（推理用）

### 1. RAG 財經新聞系統

```bash
# 安裝依賴
pip install -r rag/requirements.txt

# 1️⃣ 攝入新聞資料
python rag/ingest_sources.py

# 2️⃣ 文本分塊（RecursiveCharacterTextSplitter）
python rag/run_chunking.py

# 3️⃣ 向量化構建（有 Tkinter 進度 GUI）
python rag/build_vector_db.py

# 4️⃣ 啟動 Streamlit UI
streamlit run rag/viewer.py
```

### 2. 股價 API 後端

```bash
cd backend

# 設定環境變數
cp .env.example .env
nano .env  # 編輯 MySQL 連線

# 安裝依賴
pip install -r requirements.txt

# 啟動 API（自動建表）
python main.py
# 或：uvicorn main:app --reload --port=8000

# 訪問 Swagger 文檔
# http://localhost:8000/docs
```

### 3. Docker 完整部署

```bash
# 設定 Cloudflare Tunnel Token
nano rag_deploy/.env
# 填入：CLOUDFLARE_TUNNEL_TOKEN=<your-token>

# 啟動所有服務
docker compose up -d

# 驗證健康檢查
curl http://localhost:8080/api/health
```

## 🔌 主要 API 端點

### 股價與圖表（前綴 `/stocks`）
```
GET  /stocks/symbols                      # 所有股票代號
GET  /stocks/{symbol}/latest              # 最新股價
GET  /stocks/{symbol}/candlestick         # K 線圖
GET  /stocks/{symbol}/chart/candlestick-ma  # K 線 + MA 線
GET  /stocks/{symbol}/chart/volume        # 成交量分析
GET  /stocks/{symbol}/chart/price-change  # 價格變化
GET  /stocks/compare/multiple             # 多股比較
GET  /stocks/{symbol}/statistics          # 統計數據
```

詳見 [backend/API_DOCS.md](backend/API_DOCS.md)

### RAG 問答
```
POST /api/ask                             # AI 問答（支援 SSE stream）
  ├─ query: string
  ├─ stock_id?: string
  └─ date_range?: {from, to}

GET  /api/history                         # QA 歷史紀錄
GET  /api/news                            # 新聞列表
```

## 🔑 環境變數配置

### `backend/.env`
```env
DATABASE_HOST=localhost
DATABASE_USER=root
DATABASE_PASSWORD=your_password
DATABASE_NAME=topic_stock
DATABASE_PORT=3306

NVIDIA_API_KEY=xxxx  # 推理服務
```

### `rag_deploy/.env`
```env
NVIDIA_API_KEY=xxxx
CLOUDFLARE_TUNNEL_TOKEN=xxxx
QDRANT_HOST=qdrant  # Docker 環境中為服務名
```

## 📚 詳細文檔

| 文件 | 用途 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 完整架構、執行指令、模組說明 |
| [PLAN.md](PLAN.md) | 開發計劃與完成狀態 |
| [backend/README.md](backend/README.md) | 後端詳細設定與 SQL |
| [backend/API_DOCS.md](backend/API_DOCS.md) | 完整 API 文檔與範例 |

## 🌐 線上部署

目前部署在 **Cloudflare Tunnel**：
- 📍 URL: `https://ragggggggg.bobhsu.dpdns.org/X9k2mR_rag/`
- 🔄 自動同步：cloudflared + nginx 反向代理 + FastAPI

## ⚙️ 關鍵配置

| 組件 | 配置 |
|------|------|
| Embedding | NVIDIA nv-embedqa-e5-v5（1024維） |
| Intent Classifier | Llama3-70B（情意分類） |
| 分析 LLM | Llama-3.3-70B（NVIDIA NIM） |
| Chunk 大小 | 400 字，overlap 50 |
| 向量檢索 | Qdrant（本地存儲） |
| 股價存儲 | MySQL（TWSE 日線） |
| 圖表庫 | Recharts（React） |

## 🐛 常見問題

**Q: Qdrant 鎖定報錯？**
- A: Streamlit 與 build_vector_db 無法同時訪問。執行爬蟲前請停止 Streamlit。

**Q: NVIDIA NIM API 限流？**
- A: 免費方案 40 rpm 限制。部署時建議調整批次大小。

**Q: 股票代號偵測不準？**
- A: OtherNewWeb 來源的代號由 regex 提取，建議手動驗證。

## 📝 開發進度

✅ **已完成**
- RAG 新聞向量化與檢索
- 股價爬蟲 + K 線走勢圖
- 技術指標計算（MA、KD、RSI、MACD、布林帶）
- Docker 容器化部署
- Cloudflare Tunnel 公網對外

⏳ **計劃中**
- 模組化 rag_core（支援 LINE Bot 等多入口）
- LLM Fallback 機制
- 進階時間降級策略

## 👥 開發者

- **wei** (Wei): RAG 新聞系統、新聞爬蟲排程
- **Victor** (Victor Peng): 前端 UI、走勢圖組件、AI 顧問
- **bob**: Docker 部署、API 整合

## 📄 授權

G115409 Project

---

**最後更新**: 2026-04-20  
**主要分支**: `bob`  
**部署狀態**: ✅ 生產環境運行中
