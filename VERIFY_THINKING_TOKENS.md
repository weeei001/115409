# Thinking Tokens 修復驗證指南

## 實施完成的修改

### ✅ 完成項目
1. **Streaming 模式 (`/api/ask?stream=true`)**
   - 文件：`rag_deploy/api_server.py`，第 573-575 行
   - 修改：提取 `<think>` 標籤內容，計算 thinking tokens，傳遞給 `log_qa()`

2. **Analyze 端點 (`/api/analyze`)**
   - 文件：`rag_deploy/api_server.py`，第 1120-1169 行
   - 修改：新增完整的 token 記錄和 QA 日誌功能

3. **Non-Stream 模式 (`/api/ask?stream=false`)**
   - 文件：`rag_deploy/api_server.py`，第 956-960 行
   - 狀態：已完成（原本就有，無需修改）

## 驗證方法

### 方法 1：檢查數據庫記錄

**測試前準備**
```bash
# 1. 啟動 FastAPI 後端
cd rag_deploy
uvicorn api_server:app --host 0.0.0.0 --port 8000

# 2. 另開終端，進行測試
```

**測試 Streaming 模式**
```bash
curl -X POST http://localhost:8000/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "台積電最近的新聞如何",
    "stock_id": "2330",
    "stream": true
  }' \
  -N | grep -o '"type":"[^"]*"' | head -5
```

**測試 Non-Stream 模式**
```bash
curl -X POST http://localhost:8000/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "台積電最近的新聞如何",
    "stock_id": "2330",
    "stream": false
  }' | jq '.tokens'
```
預期輸出：
```json
{
  "input": 2000-3000,
  "output": 500-1000,
  "thinking": 50-200  // 不應該是 null
}
```

**測試 Analyze 端點**
```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["2330"]}'
```

### 方法 2：查看數據庫內容

**檢查 Streaming 日誌**
```sql
-- 查看最近的 streaming 請求
SELECT 
  id,
  query,
  status,
  tokens_input,
  tokens_output,
  tokens_thinking,
  duration_ms,
  timestamp
FROM qa_logs
WHERE status = 'success_stream'
ORDER BY timestamp DESC
LIMIT 5;
```

**預期結果**
- `tokens_thinking` 不再是 NULL
- `tokens_thinking` > 0（表示 LLM 進行了思考）
- `tokens_input` 和 `tokens_output` 為 NULL（streaming 模式無法從 API 獲得）

**檢查 Analyze 日誌**
```sql
-- 查看分析端點的記錄
SELECT 
  id,
  query,
  status,
  tokens_input,
  tokens_output,
  tokens_thinking,
  duration_ms,
  timestamp
FROM qa_logs
WHERE status LIKE 'success_analyze%'
ORDER BY timestamp DESC
LIMIT 5;
```

**預期結果**
- `tokens_input` 和 `tokens_output` 不為 NULL（actual API token counts）
- `tokens_thinking` 不為 NULL（估算值）
- `query` 以 `[股票分析]` 開頭

### 方法 3：檢查源代碼確認

**確認 Thinking Token 提取邏輯**
```bash
grep -n "tokens_thinking = len(think_match" rag_deploy/api_server.py
```
應該看到 3 行結果（streaming、analyze、non-stream）

**確認 log_qa 調用**
```bash
grep -n "log_qa.*tokens_thinking" rag_deploy/api_server.py
```

## 預期行為

### Scenario 1：LLM 包含思考過程
```
回應: <think>分析台積電的營收趨勢...應該考慮...</think>根據新聞顯示...
結果: tokens_thinking = ~30-50（取決於思考內容長度）
```

### Scenario 2：LLM 不包含思考過程  
```
回應: 根據新聞顯示...（沒有 <think> 標籤）
結果: tokens_thinking = None
```

### Scenario 3：空的思考標籤
```
回應: <think></think>根據新聞顯示...
結果: tokens_thinking = 0（空標籤）
```

## 故障排查

### 問題：tokens_thinking 仍然是 NULL

**可能原因 1**：LLM 未生成 `<think>` 標籤
- 解決：檢查 NVIDIA NIM 模型是否支持思考過程
- 檢查方式：查看 API 原始回應是否包含 `<think>` 標籤

**可能原因 2**：正則表達式不匹配
- 解決：確保 `<think>...</think>` 格式完全符合
- 檢查方式：在數據庫中查看 `ai_answer` 的實際內容

### 問題：Thinking Tokens 計數不準確

**說明**：Token 估算基於 `length // 4` 是粗略估計
- 更精確的方式需要調用 tokenizer 庫
- 目前實現是為了成本估算，不適合計費

### 問題：Analyze 端點沒有記錄

**檢查清單**：
1. 確認 MySQL 連接正常（參見 api_server.py 的錯誤日誌）
2. 確認 `qa_logs` 表已建立（執行 `qa_logger.init_db()`）
3. 檢查是否存在 Exception 導致 fallback_mode=True

## 下一步改進

1. **使用精確的 tokenizer**
   ```python
   from tiktoken import encoding_for_model
   enc = encoding_for_model("gpt-3.5-turbo")
   tokens_thinking = len(enc.encode(thinking_content))
   ```

2. **在前端展示 Thinking 時間**
   - 解析 `tokens_thinking` 並顯示在 UI
   - 提示用戶 LLM 的思考成本

3. **優化 Thinking Prompt**
   - 根據用戶反饋調整 LLM 的思考深度
   - 在費用與品質之間取得平衡

## 參考資源

- NVIDIA NIM API 文檔：https://docs.nvidia.com/nim/
- LangChain AsyncOpenAI：https://python.langchain.com/docs/integrations/chat/openai
- Thinking Tokens 介紹：Claude 和其他 LLM 的思考過程成本計算
