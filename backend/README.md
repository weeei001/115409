# FastAPI + MySQL 股價查詢後端 API

使用 FastAPI 與 MySQL 的後端服務，提供股價查詢、K 線與圖表資料、統計與多股比較、技術指標、鉅亨新聞查詢，以及模擬下單相關 API。

啟動應用時，`main.py` 會透過 SQLAlchemy 對尚未存在的資料表執行 `create_all`；若你偏好手動建庫，可參考下方 SQL。

## 專案結構

```text
backend/
├── main.py                 # 應用入口（註冊路由、生命週期、Uvicorn）
├── config.py               # 環境變數與設定
├── database.py             # SQLAlchemy 連線與 Session
├── requirements.txt        # Python 依賴
├── .env.example            # 環境變數範本
├── API_DOCS.md             # 給前端的較完整 API 說明（股價／圖表等）
├── models/                 # SQLAlchemy 模型
├── schemas/                # Pydantic 資料模型
├── crud/                   # 資料查詢與業務邏輯
├── routers/                # API 路由（股價、新聞、技術指標、模擬下單）
└── crawler/                # 爬蟲與批次作業（TWSE 日線、新聞、技術指標等）
```

## 快速開始

### 1. 建立虛擬環境

在 `backend/` 目錄下執行：

```powershell
python -m venv env
```

啟用虛擬環境：

```powershell
.\env\Scripts\Activate.ps1
```

若使用 CMD：

```cmd
env\Scripts\activate.bat
```

### 2. 安裝依賴

```powershell
pip install -r requirements.txt
```

### 3. 設定環境變數

複製 `.env.example` 成 `.env`：

```powershell
Copy-Item .env.example .env
```

編輯 `.env`，至少設定資料庫連線：

```env
DATABASE_HOST=localhost
DATABASE_USER=root
DATABASE_PASSWORD=your_password
DATABASE_NAME=topic_stock
DATABASE_PORT=3306

APP_NAME=FastAPI MySQL Application
APP_VERSION=1.0.0
DEBUG=True

# Uvicorn 啟動參數（python main.py 時使用）
APP_HOST=0.0.0.0
APP_PORT=8000
APP_RELOAD=True
```

## MySQL 建庫與建表 SQL

```sql
CREATE DATABASE IF NOT EXISTS topic_stock
	CHARACTER SET utf8mb4
	COLLATE utf8mb4_unicode_ci;

USE topic_stock;

CREATE TABLE IF NOT EXISTS `daily_prices` (
	`date` DATE NOT NULL COMMENT '日期',
	`symbol` VARCHAR(10) NOT NULL COMMENT '股票代號',
	`open` DECIMAL(10,2) DEFAULT NULL COMMENT '開盤價',
	`high` DECIMAL(10,2) DEFAULT NULL COMMENT '最高價',
	`low` DECIMAL(10,2) DEFAULT NULL COMMENT '最低價',
	`close` DECIMAL(10,2) DEFAULT NULL COMMENT '收盤價',
	`volume_shares` BIGINT DEFAULT NULL COMMENT '成交股數',
	`amount` BIGINT DEFAULT NULL COMMENT '成交金額',
	`change` DECIMAL(10,2) DEFAULT NULL COMMENT '漲跌價差',
	`trades` INT DEFAULT NULL COMMENT '成交筆數',
	PRIMARY KEY (`date`, `symbol`),
	KEY `idx_symbol` (`symbol`),
	KEY `idx_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `crawl_checkpoint` (
	`symbol` VARCHAR(10) NOT NULL COMMENT '股票代號',
	`yyyymm` CHAR(6) NOT NULL COMMENT '完成月份(YYYYMM)',
	PRIMARY KEY (`symbol`, `yyyymm`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cnyes_tw_stock_news` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主鍵 ID',
  `news_id` BIGINT NOT NULL COMMENT '來源新聞編號（唯一）',
  `title` VARCHAR(500) NOT NULL COMMENT '新聞標題',
  `content` LONGTEXT COMMENT '新聞內文',
  `related_stocks` VARCHAR(500) DEFAULT NULL COMMENT '關聯股票（逗號分隔）',
  `publish_time` DATETIME DEFAULT NULL COMMENT '發布時間',
  `url` VARCHAR(1000) DEFAULT NULL COMMENT '原始新聞網址',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新時間',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_id` (`news_id`),
  KEY `idx_publish_time` (`publish_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `technical_indicators` (
  `date` DATE NOT NULL COMMENT '日期',
  `symbol` VARCHAR(10) NOT NULL COMMENT '股票代號',
  `ma5` DECIMAL(10,2) DEFAULT NULL COMMENT '5日均線',
  `ma10` DECIMAL(10,2) DEFAULT NULL COMMENT '10日均線',
  `ma20` DECIMAL(10,2) DEFAULT NULL COMMENT '20日均線',
  `ma60` DECIMAL(10,2) DEFAULT NULL COMMENT '60日均線',
  `k_value` DECIMAL(6,2) DEFAULT NULL COMMENT 'KD K值',
  `d_value` DECIMAL(6,2) DEFAULT NULL COMMENT 'KD D值',
  `rsi14` DECIMAL(6,2) DEFAULT NULL COMMENT '14日RSI',
  `macd` DECIMAL(10,4) DEFAULT NULL COMMENT 'MACD線',
  `macd_signal` DECIMAL(10,4) DEFAULT NULL COMMENT 'MACD訊號線',
  `macd_hist` DECIMAL(10,4) DEFAULT NULL COMMENT 'MACD柱狀圖',
  `bb_upper` DECIMAL(10,2) DEFAULT NULL COMMENT '布林上軌',
  `bb_middle` DECIMAL(10,2) DEFAULT NULL COMMENT '布林中軌',
  `bb_lower` DECIMAL(10,2) DEFAULT NULL COMMENT '布林下軌',
  `volume_ma5` DECIMAL(20,2) DEFAULT NULL COMMENT '5日均量',
  PRIMARY KEY (`date`, `symbol`),
  KEY `idx_ti_symbol` (`symbol`),
  KEY `idx_ti_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `simulated_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '內部主鍵',
  `session_id` VARCHAR(36) NOT NULL COMMENT '匿名使用者會話ID',
  `symbol` VARCHAR(12) NOT NULL COMMENT '股票代號',
  `side` VARCHAR(8) NOT NULL COMMENT '買賣方向 buy|sell',
  `order_type` VARCHAR(16) NOT NULL COMMENT '委託類型 limit|market',
  `limit_price` DECIMAL(12,4) DEFAULT NULL COMMENT '限價，市價單為 NULL',
  `trade_date` DATE NOT NULL COMMENT '模擬下單日期',
  `quantity` INT NOT NULL COMMENT '委託數量（張）',
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '委託狀態',
  `estimated_amount` BIGINT NOT NULL COMMENT '預估成交金額（元）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
  PRIMARY KEY (`id`),
  KEY `idx_session_created` (`session_id`, `created_at`),
  KEY `idx_session_trade_created` (`session_id`, `trade_date`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

說明：

- `crawl_checkpoint` 供 TWSE 日線爬蟲斷點續抓；`twse_crawler.py` 啟動時也會確保此表存在。
- `technical_indicators` 資料通常由 `crawler/technical_indicator_job.py` 等批次寫入。
- 若未先手動建表，啟動 API 時仍會依模型建立 `technical_indicators` 與 `simulated_orders`（以及其他已註冊於 `Base` 的表）。

## 啟動 API

### 方式 A: 使用 uvicorn 指令

```powershell
uvicorn main:app --reload --port=8000 --host=0.0.0.0
```

### 方式 B: 從 `.env` 讀取 host/port/reload

`main.py` 會讀取 `APP_HOST`、`APP_PORT`、`APP_RELOAD`，可直接執行：

```powershell
python main.py
```

## 常用網址

- Swagger 文件: http://localhost:8000/docs
- ReDoc 文件: http://localhost:8000/redoc
- 健康檢查: http://localhost:8000/health

更細的請求/回應範例見同目錄下的 [API_DOCS.md](./API_DOCS.md)。

## Crawler 與資料庫連線

`config.py` 會從 **`backend/.env` 的絕對路徑** 讀取設定（不論從哪個工作目錄執行爬蟲）。

需要連 MySQL 的爬蟲會透過 **`database.get_pymysql_connect_kwargs()`** 取得與 SQLAlchemy `engine` **相同來源**的連線參數（`DATABASE_*` 與 API 一致）：

- `crawler/twse_crawler.py`
- `crawler/cnyes_crawlwer.py`（檔名拼字如此）
- `crawler/institutional_trades_job.py`

`crawler/technical_indicator_job.py` 則直接使用 `database.SessionLocal` / `engine`。

`crawler/scheduler_utils.py` 僅以 subprocess 呼叫上述腳本，本身不連資料庫。

排程與批次行為（每日幾點跑、接續跑技術指標／三大法人、預設股票清單、鉅亨每幾分鐘同步等）都寫在對應 `.py` 檔頂部常數，例如：

- `crawler/scheduler_utils.py`：`SCHEDULE_TIME`、`RUN_TECHNICAL_INDICATOR_AFTER_CRAWL`、`RUN_INSTITUTIONAL_TRADES_AFTER_CRAWL`
- `crawler/twse_crawler.py`：`DEFAULT_STOCKS`、`DEFAULT_YEARS`
- `crawler/cnyes_crawlwer.py`：`SCHEDULE_INTERVAL_MINUTES`、`SCHEDULE_LOOKBACK_DAYS` 等

## 主要 API 端點（摘要）

### 股價與圖表（前綴 `/stocks`）

- `GET /stocks/symbols`：所有股票代號
- `GET /stocks/{symbol}/latest`：最新一筆日線
- `GET /stocks/{symbol}/price/{date}`：指定日期股價
- `GET /stocks/{symbol}/date-range`：資料庫內該股日期範圍
- `GET /stocks/{symbol}/history`：歷史列表（分頁）
- `GET /stocks/{symbol}/candlestick`：K 線
- `GET /stocks/{symbol}/chart/candlestick-ma`：K 線 + MA
- `GET /stocks/{symbol}/chart/volume`、`/chart/price-change`、`/chart/ohlc`：圖表用資料
- `GET /stocks/{symbol}/statistics`：區間統計
- `GET /stocks/compare/multiple`：多股同區間比較

### 技術指標（前綴 `/stocks`）

- `GET /stocks/{symbol}/indicators`：`start_date`、`end_date` 區間
- `GET /stocks/{symbol}/indicators/latest`：最新一筆

### 新聞（`cnyes_tw_stock_news`）

- `GET /news`：列表與篩選（`keyword`、`stock`、時間區間、分頁等）
- `GET /news/{id}`：依主鍵 `id`
- `GET /news/by-news-id/{news_id}`：依來源 `news_id`
- `GET /news/stats/count`：符合條件筆數

### 模擬下單（前綴 `/simulated-orders`）

- `POST /simulated-orders/`：建立模擬委託（需該交易日有日線資料）
- `GET /simulated-orders/?session_id=...`：依會話查列表
- `GET /simulated-orders/profit-by-category?session_id=...`：依股票彙總模擬收益

## 注意事項

- 請確認 MySQL 帳號有建立資料庫與資料表權限。
- 生產環境請關閉 `APP_RELOAD`，並將 CORS `allow_origins` 改為實際前端網域（見 `main.py`）。
- `.env` 含敏感資訊，請勿提交到版本控制。
