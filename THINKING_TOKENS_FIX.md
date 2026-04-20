# Thinking Tokens 處理修復

## 問題
1. **Streaming 模式 (`/api/ask` with `stream=true`)**
   - 雖然 LLM 回應包含 `<think>...</think>` 標籤，但代碼沒有提取思考 tokens
   - 導致 `log_qa()` 被傳入 `tokens_thinking=None`
   - 數據庫記錄不完整

2. **`/api/analyze` 端點**
   - 完全沒有日誌記錄（沒有調用 `log_qa()`）
   - 無法追蹤 API 使用情況和 token 消耗

## 修復內容

### 1. Streaming 模式 (api_server.py, line ~575)
```python
# 提取 thinking tokens
think_match = re.search(r"<think>(.*?)</think>", full_text, re.DOTALL)
tokens_thinking = len(think_match.group(1)) // 4 if think_match else None

clean_text = re.sub(r"<think>.*?</think>\s*", "", full_text, flags=re.DOTALL).strip()
# ... 之後傳給 log_qa()
log_qa(..., tokens_thinking=tokens_thinking)
```

**變化**：
- 在移除 `<think>` 標籤前提取其內容
- 估算 thinking tokens：`len(content) // 4`（粗略估計，1 token ≈ 4 個字符）
- 傳遞給 `log_qa()` 而不是 `None`

### 2. `/api/analyze` 端點 (api_server.py, line ~1120)
```python
# 新增：記錄 token 用量
tokens_input = completion.usage.prompt_tokens
tokens_output = completion.usage.completion_tokens

# 新增：提取 thinking tokens
think_match = re.search(r"<think>(.*?)</think>", full_content, re.DOTALL)
tokens_thinking = len(think_match.group(1)) // 4 if think_match else None

duration_ms = int((time.time() - start) * 1000)

# 新增：記錄 QA
log_qa(
    query=f"[股票分析] {','.join(valid_symbols)}",
    prompt=prompt_str,
    chunks=all_hits,
    ai_answer=raw_answer,
    duration_ms=duration_ms,
    status="success_analyze",
    tokens_input=tokens_input,
    tokens_output=tokens_output,
    tokens_thinking=tokens_thinking,
)
```

**變化**：
- 新增 `time.time()` 計時
- 從 API 回應提取實際 input/output token 計數
- 提取並估算 thinking tokens
- 調用 `log_qa()` 記錄分析結果

## Token 計算方式

### API 提供的 Tokens
- `completion.usage.prompt_tokens`：實際輸入 tokens（精確）
- `completion.usage.completion_tokens`：實際輸出 tokens（精確）

### Thinking Tokens（估算）
- 從 `<think>...</think>` 標籤提取內容
- 估算方式：`len(content) // 4`
- **說明**：OpenAI 的粗略估計標準是 1 token ≈ 4 個字符

## 驗證方式

### 1. Streaming 模式測試
```bash
curl -X POST http://localhost:8000/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "台積電近期表現如何",
    "stock_id": "2330",
    "stream": true
  }'
```
查看 SSE 回應中的 `done` 事件，應該包含 `duration_ms` 和其他 metadata

### 2. 數據庫驗證
```sql
SELECT id, query, status, tokens_input, tokens_output, tokens_thinking, duration_ms
FROM qa_logs
ORDER BY timestamp DESC
LIMIT 10;
```
應該看到 `tokens_thinking` 不再是 NULL（對於含有思考過程的回應）

### 3. `/api/analyze` 端點
```bash
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["2330", "2317"]}'
```
檢查數據庫應該有新記錄：
```sql
SELECT * FROM qa_logs WHERE status LIKE 'success_analyze%';
```

## 注意事項

1. **Token 估算的精確性**
   - Thinking tokens 是估算值，不是精確計數
   - 對於準確的成本計算，應該依賴 `tokens_input` 和 `tokens_output`

2. **API 回應格式**
   - NVIDIA NIM 應該提供 `usage` 物件，包含 `prompt_tokens` 和 `completion_tokens`
   - 如果 API 響應改變，需要相應調整代碼

3. **Streaming vs Non-Streaming**
   - Streaming 模式：無法從 API 直接獲得最終 token 計數，只能從內容估算
   - Non-Streaming 模式：可從 `completion.usage` 獲得精確計數

## 影響範圍

| 端點 | 原始行為 | 修復後 |
|------|---------|--------|
| `/api/ask?stream=false` | ✅ 記錄 thinking tokens | ✅ 記錄 thinking tokens（無變化） |
| `/api/ask?stream=true` | ❌ 記錄 `tokens_thinking=None` | ✅ 記錄 thinking tokens |
| `/api/analyze` | ❌ 完全未記錄 | ✅ 記錄所有 token 和 metadata |
