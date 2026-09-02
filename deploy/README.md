# 本機反代部署

## 架構

```
                                              ┌→ /          → Next.js:3000
網際網路 → Cloudflare Tunnel → nginx:8080 ────┼→ /backend/* → backend:8000
                                              └→ /rag/*     → rag:8001
```

三個服務都掛在同一個網域下的不同路徑，由 nginx 直接代理。同源，所以
瀏覽器與打包的 APP 都不必處理 CORS：

| 對外 URL | 服務 |
| --- | --- |
| `https://stock-lighthouse.com` | 前端 |
| `https://stock-lighthouse.com/backend` | 主後端 API |
| `https://stock-lighthouse.com/rag` | RAG 服務 |

8000 / 8001 本身不開對外埠，只能經 nginx 進來。MySQL 與 Qdrant 沿用本機既有服務。

## 啟動

### 正式（NSSM 服務，開機自動啟動）

以**系統管理員**開 PowerShell 跑一次：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install-services.ps1
```

會註冊四個服務（沒有 nssm 會先用 choco 裝）：

| 服務 | 內容 | 埠 |
|---|---|---|
| `stock-backend` | FastAPI | 8000 |
| `stock-rag` | RAG API | 8001 |
| `stock-frontend` | Next.js | 3000 |
| `stock-scheduler` | 爬蟲＋向量管線排程 | — |

log 在 `deploy/logs/`（10MB 輪替）。常用：

```powershell
Get-Service stock-*
Restart-Service stock-backend
Get-Content deploy\logs\stock-rag.log -Tail 50 -Wait
```

移除：`powershell -ExecutionPolicy Bypass -File deploy\uninstall-services.ps1`

nginx 與 cloudflared 由 Docker 的 `restart: unless-stopped` 顧，不用進 NSSM。

## 本地開發

四個服務佔著 3000 / 8000 / 8001，開發時**不用全停**。

### 只改前端（最常見）

```bash
cd frontend/topictest
npm run dev -- -p 3001      # http://localhost:3001
```

dev server 跑在 3001，打的是正在跑的 `stock-backend` / `stock-rag` 服務，正式站
（3000）完全不受影響。Next 16 的 dev 產物在 `.next/dev/`，不會蓋掉 `next build`
的輸出，正式站的 BUILD_ID 不變。

### 改 backend 或 rag（不用停服務）

dev 用另一個埠，正式服務照常跑：

| | 正式服務 | 本地開發 |
|---|---|---|
| backend | 8000 | **8010** |
| rag | 8001 | **8011** |
| frontend | 3000 | **3001** |

```powershell
cd backend; python -m uvicorn main:app --reload --port 8010
```

前端 dev 要指過去，靠 `frontend/topictest/.env.development.local`
（Next.js 讀取優先序高於 `.env.development`，且被 `.gitignore` 排除）：

```
NEXT_PUBLIC_API_URL=http://localhost:8010
BACKEND_API_URL=http://127.0.0.1:8010
```

rag 同理，`--port 8011` 搭配：

```
NEXT_PUBLIC_RAG_API_BASE_URL=http://localhost:8011
RAG_API_BASE_URL=http://127.0.0.1:8011
```

**只做前端時把 `.env.development.local` 改名或刪掉**，dev 就會回去打 8000 / 8001
的正式服務，不必自己再起一份後端。

### 改完前端要上線

```bash
cd frontend/topictest && npm run build
```
```powershell
Restart-Service stock-frontend
```

`NEXT_PUBLIC_*` 是 build 時內嵌的，改 `.env.production` 一定要重 build。

### 手動全開（不用服務時）

三個應用服務各開一個視窗：

```bash
# backend
cd backend  && python -m uvicorn main:app --host 0.0.0.0 --port 8000

# rag
cd rag_deploy && python -m uvicorn api_server:app --host 0.0.0.0 --port 8001

# frontend（改過 .env.production 一定要重新 build，NEXT_PUBLIC_* 是 build 時內嵌）
cd frontend/topictest && npm run build && npm run start
```

反代：

```bash
cd deploy && docker compose up -d nginx      # http://localhost:8080 驗證
```

## 接上網域 stock-lighthouse.com

網域已指向 Cloudflare NS，剩下兩步：

1. Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel（Cloudflared），
   複製畫面上的 token，貼進 `deploy/.env`：
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```
2. 同一個 tunnel 設定頁 → Public Hostname → Add：
   - Subdomain：留空　Domain：`stock-lighthouse.com`
   - Type：`HTTP`　URL：`nginx:80`
   （要順便吃 www 就再加一筆 Subdomain `www`）

然後 `cd deploy && docker compose up -d`。

不需要 port forwarding、不需要固定 IP，TLS 由 Cloudflare 處理。

## 還沒做、需要你到主控台操作的

- Google Cloud Console → API 和服務 → 憑證 → OAuth 2.0 用戶端，
  「已授權的 JavaScript 來源」加入 `https://stock-lighthouse.com`，
  否則 Google 登入會被擋。

## 已知但沒動的

- `backend/main.py` 與 `rag_deploy/api_server.py` 的 CORS 都是 `allow_origins=["*"]`。
  因為只開一個對外埠、全部同源，實務上沒被用到；要收緊就改成實際網域。
- `backend/.env` 的變數叫 `NIM_API_KEY` 但目前放的是 OpenAI key，名稱會誤導。
