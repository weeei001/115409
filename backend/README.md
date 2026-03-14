# FastAPI + MySQL 股價查詢後端 API

這是一個使用 FastAPI 與 MySQL 建立的股價查詢後端服務，提供股價查詢、K 線資料、統計分析與多股票比較 API。

## 專案結構

```text
backend/
├── main.py              # 應用入口
├── config.py            # 環境變數與設定
├── database.py          # SQLAlchemy 連線
├── requirements.txt     # Python 依賴
├── .env.example         # 環境變數範本
├── models/              # SQLAlchemy 模型
├── schemas/             # Pydantic 資料模型
├── crud/                # 資料查詢邏輯
└── routers/             # API 路由
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
```

說明：`crawl_checkpoint` 供爬蟲斷點續抓使用；`twse_crawler.py` 啟動時也會自動建立這張表。

## 啟動 API

### 方式 A: 使用你指定的 uvicorn 指令

```powershell
uvicorn main:app --reload --port=8000 --host=0.0.0.0
```

### 方式 B: 從 `.env` 讀取 host/port/reload

`main.py` 已加入：

- `APP_HOST`
- `APP_PORT`
- `APP_RELOAD`

因此可直接執行：

```powershell
python main.py
```

這種方式會套用 `.env` 中的 Uvicorn 參數。

## 常用網址

- Swagger 文件: http://localhost:8000/docs
- ReDoc 文件: http://localhost:8000/redoc
- 健康檢查: http://localhost:8000/health

## Crawler 也讀取 .env

`crawler/twse_crawler.py` 與 `crawler/scheduler_utils.py` 會載入同一份 `backend/.env`。

可用變數：

- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`
- `CRAWLER_DEFAULT_STOCKS`（例如 `2330,2317,2454`）
- `CRAWLER_DEFAULT_YEARS`（預設回抓年數）
- `CRAWLER_SCRIPT`（排程要執行的檔案）
- `CRAWLER_PYTHON`（例如 `python` 或虛擬環境的 python）
- `CRAWLER_SCHEDULE_TIME`（例如 `15:00`）

補充：為了相容舊設定，`twse_crawler.py` 仍支援 `DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME`，但建議改用 `DATABASE_*`。

## 主要 API 端點

- `GET /stocks/symbols` 取得所有股票代號
- `GET /stocks/{symbol}/latest` 取得最新股價
- `GET /stocks/{symbol}/price/{date}` 取得指定日期股價
- `GET /stocks/{symbol}/history` 取得歷史資料
- `GET /stocks/{symbol}/candlestick` 取得 K 線資料
- `GET /stocks/{symbol}/statistics` 取得統計資料
- `GET /stocks/compare/multiple` 多股比較

## 注意事項

- 請確認 MySQL 帳號有建立資料庫與資料表權限。
- 生產環境請關閉 `APP_RELOAD` 並限制 CORS。
- `.env` 含敏感資訊，請勿提交到版本控制。
