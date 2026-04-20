# 開發計畫：Docker 化部署（已完成）

> 此檔案供 Claude Code 快速了解本專案的開發決策與完成狀態。
> 請搭配 CLAUDE.md 一起閱讀。

---

## 目前狀態：全部完成 ✅

所有修改已套用至程式碼，可直接啟動 Docker。

---

## 完成項目

### 第一部分：Qdrant Server 模式 ✅

所有檔案統一改為讀 `QDRANT_HOST` 環境變數決定連線方式：

```python
qdrant_host = os.environ.get("QDRANT_HOST", "")
if qdrant_host:
    client = QdrantClient(host=qdrant_host, port=6333)
else:
    client = QdrantClient(path="./qdrant_db")  # 本地開發 fallback
```

**修改過的檔案**：`viewer.py`、`rag_deploy/api_server.py`、`build_vector_db.py`、`update_stock_id.py`

**`build_vector_db.py` 執行方式**：直接在 Mac Mini 上執行：
```bash
QDRANT_HOST=localhost python build_vector_db.py
```

---

### 第二部分：API Key + Timeout ✅

- `rag_deploy/api_server.py`：OpenAI client 加上 `httpx.Client(timeout=30.0)`
- stream 模式和非 stream 模式都加了 `httpx.TimeoutException` 處理
- `.env` 已在 `.gitignore`，不會進 git

---

### 第三部分：程式碼整合決策 ✅

- `api_server.py` 和 `viewer.py` 的 RAG 核心邏輯完全相同，**不需要搬移**
- `viewer.py` 維持不動，保留作開發用 Streamlit UI
- 正式服務完全走 `rag_deploy/api_server.py`

---

### 第四部分：時間處理強化 ✅

已套用至 `rag_deploy/api_server.py`：

1. **Graceful Degradation**：用 `qdrant_client.count()` 確認時間範圍內有資料，沒有就直接回傳錯誤（不進 LLM）
2. **雙層搜尋**：先用時間 filter 精準搜尋，再補 5 筆背景資料，合併去重
3. **動態 limit**：跨度 ≤30天=10筆、≤90天=15筆、≤365天=20筆、>365天=25筆+警告
4. **時間加權排序**：向量相似度 70% + 時間分數 30%
5. **LLM prompt**：要求 LLM 主動說明引用資料的時間範圍

---

## Docker 架構

```
cloudflared（對外）
    → nginx（:8080）
        → api_server（FastAPI :8000）
            → qdrant（內部 :6333，不對外）
```

### 啟動步驟

```bash
# 1. 填入環境變數
nano rag_deploy/.env
# 填入 CLOUDFLARE_TUNNEL_TOKEN=

# 2. 啟動
docker compose up -d

# 3. 驗證
curl http://localhost:8080/api/health
curl -X POST http://localhost:8080/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "台積電最近表現如何", "stock_id": "2330"}'
```

### 需要填入的環境變數（`rag_deploy/.env`）

| 變數 | 說明 |
|------|------|
| `NVIDIA_API_KEY` | 已填入 ✅ |
| `CLOUDFLARE_TUNNEL_TOKEN` | 需要填入 ❌ |
| `QDRANT_HOST` | Docker 環境由 docker-compose 覆蓋，不需手動填 |

---

## 未來待辦（開發階段暫緩）

- `rag_core/` 模組化（等有第二個入口如 LINE Bot 再做）
- Docker Secret（正式上線再考慮）
- LLM Fallback 切換備用服務（正式上線再考慮）
- Multi-Granularity Fallback 多層時間降級
