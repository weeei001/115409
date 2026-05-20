# Backend README

本目錄是台股查詢系統的 FastAPI 後端服務，提供股價、新聞、技術指標、三大法人、模擬下單、認證與 AI 分析相關 API。

API 端點與 request/response schema 請以 Swagger 文件為準：

```text
http://<ip>:<port>/docs
```

本機開發預設：

```text
http://localhost:8000/docs
```

## 技術棧

- Python 3.12+
- FastAPI
- SQLAlchemy
- MySQL
- Pydantic v2
- JWT Bearer Token

## 目錄說明

- `main.py`：FastAPI 入口與路由註冊
- `config.py`：環境變數設定
- `database.py`：資料庫連線與 Session
- `routers/`：API 路由
- `schemas/`：Pydantic request/response schema
- `models/`：SQLAlchemy models
- `crud/`：資料查詢與商業邏輯
- `auth/`：登入、JWT、密碼與 Google 驗證
- `stock_behavior/`：股票 AI 分析流程

## 快速啟動

進入後端目錄：

```powershell
cd backend
```

建立並啟用虛擬環境：

```powershell
python -m venv env
.\env\Scripts\Activate.ps1
```

安裝依賴：

```powershell
pip install -r requirements.txt
```

確認環境設定：

```text
.env
```

至少需確認資料庫連線設定：

- `DATABASE_HOST`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`
- `DATABASE_PORT`

啟動服務：

```powershell
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

或使用 `main.py` 內設定啟動：

```powershell
python main.py
```

## 文件入口

啟動後開啟：

```text
http://<ip>:<port>/docs
```

Swagger 文件會列出所有 API 端點、參數、錯誤狀態碼與 request/response 範例。

若在本機開發，通常是：

```text
http://localhost:8000/docs
```

## 注意事項

- 正式環境請更換 `JWT_SECRET`。
- `.env` 內布林值請使用 `true` 或 `false`。
- AI、RAG、Google 登入、SMTP 等外部服務需要另外設定對應環境變數。
- API 細節不要手動維護在 README，請以 runtime OpenAPI / Swagger 為準。
