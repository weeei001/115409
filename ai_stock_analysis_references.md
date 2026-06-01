# AI 完整股票建議分析 — 開源專案參考

> 背景：現有系統為台股財經新聞 RAG（6 檔個股），此文件整理可擴充為完整股票建議分析的開源參考資源。

---

## 現有系統的定位

| 目前已有 | 說明 |
|----------|------|
| 新聞 RAG | Qdrant 向量庫，6 檔台股新聞檢索 |
| 情緒分析 | LLM 分析新聞語意，判斷正負面 |
| QA 問答介面 | Streamlit UI + FastAPI 後端 |
| 意圖分類 | 自動識別股票名稱 + 時間範圍 |

| 目前缺少 | 說明 |
|----------|------|
| 基本面資料 | 財報、EPS、本益比、營收成長率 |
| 技術指標 | MA、RSI、MACD、布林通道 |
| 多代理人協作 | 各面向分析師角色互相協作 |
| 綜合評分輸出 | 買賣建議、風險評估報告 |

---

## 推薦開源專案

### 1. TradingAgents（最推薦）
- **GitHub**：https://github.com/TauricResearch/TradingAgents
- **特色**：模擬真實交易公司的多代理人框架
  - 基本面分析師 Agent
  - 技術面分析師 Agent
  - 情緒分析師 Agent（可接入你的 RAG）
  - 風險管理員 Agent
  - 交易員 Agent（最終決策）
- **技術**：LangGraph，支援 OpenAI / Anthropic / Ollama
- **與現有系統整合**：你的 Qdrant RAG 可直接作為情緒分析師的資料來源

---

### 2. FinRobot
- **GitHub**：https://github.com/AI4Finance-Foundation/FinRobot
- **特色**：AI4Finance 出品，8 個專門 Agent
  - 基本面、技術面、估值、風險評估
  - 可輸出完整投資論文（investment thesis）
- **適合用途**：學習完整多 Agent 架構設計

---

### 3. FinGPT
- **GitHub**：https://github.com/AI4Finance-Foundation/FinGPT
- **特色**：金融領域 LLM 訓練與微調完整 pipeline
- **適合用途**：想自訓練針對台股的語言模型

---

### 4. Stock-Analysis-Assistant
- **GitHub**：https://github.com/mlengineershub/Stock-Analysis-Assistant
- **特色**：Agentic RAG 架構，專為股市分析設計，可本地執行
- **適合用途**：與現有 RAG 架構最接近，適合對照學習

---

### 5. FinancialAdvisorGPT
- **GitHub**：https://github.com/mburaksayici/FinancialAdvisorGPT
- **特色**：RAG + LLM 完整 boilerplate（MongoDB、Chroma、FastAPI、React UI）
- **適合用途**：快速建立 production-ready 財務顧問介面

---

### 6. MarketGPT
- **GitHub**：https://github.com/JHenzi/MarketGPT
- **特色**：用 CNBC 新聞做 RAG，ChromaDB，含新聞引用
- **適合用途**：與你的新聞 RAG 架構最相似，可對照設計

---

### 7. FinMem-LLM-StockTrading
- **GitHub**：https://github.com/pipiku915/FinMem-LLM-StockTrading
- **特色**：分層記憶架構（短期/長期記憶），增強 LLM 交易決策
- **適合用途**：想加入記憶機制讓 Agent 有歷史感知能力

---

### 8. awesome-ai-in-finance（資源彙整）
- **GitHub**：https://github.com/georgezouq/awesome-ai-in-finance
- **特色**：整理 AI × 金融的工具、論文、資料集清單
- **適合用途**：尋找更多工具與靈感

---

## 台股資料來源補充

若要加入基本面與技術面分析，推薦以下台股專用資料平台：

| 平台 | GitHub | 說明 |
|------|--------|------|
| FinMind | https://github.com/FinMind/FinMind | 台股開源資料平台，財報、籌碼、技術指標 API，部分免費 |
| tejapi | https://github.com/TEJ-Enterprise/tejapi | 台股財務資料，學術方案有免費配額 |

---

## 建議整合架構

```
┌─────────────────────────────────────┐
│         使用者提問介面               │
│     （Streamlit / FastAPI）          │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│         多代理人協調層               │
│         （LangGraph / CrewAI）       │
└──┬──────────┬──────────┬────────────┘
   │          │          │
┌──▼──┐  ┌───▼───┐  ┌───▼────┐
│情緒  │  │基本面  │  │技術面   │
│Agent│  │Agent  │  │Agent   │
│     │  │       │  │        │
│你現在│  │FinMind│  │talib / │
│的RAG│  │財報API│  │pandas_ta│
└──┬──┘  └───┬───┘  └───┬────┘
   │          │          │
┌──▼──────────▼──────────▼────────────┐
│         風險管理 Agent               │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│       綜合投資建議報告輸出            │
│  （評分 + 風險等級 + 買賣建議）       │
└─────────────────────────────────────┘
```

---

## 術語說明

| 術語 | 說明 |
|------|------|
| **AI Agent** | 能自主決策、規劃多步驟行動的 AI 系統 |
| **Multi-Agent System** | 多個 Agent 協作，各司其職 |
| **Tool / Skill** | Agent 可呼叫的單一功能模組（如：查股價、搜尋新聞） |
| **RAG Pipeline** | 檢索增強生成，你現有系統的核心 |

> 你目前的系統是 **RAG Pipeline**，擴充後目標是 **Multi-Agent System**，其中 RAG 作為情緒分析 Agent 的 Tool 被呼叫。

---

*產生日期：2026-04-07*
