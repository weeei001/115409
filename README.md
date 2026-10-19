<p align="center">
  <img src="docs/images/readme/logo.png" alt="股海明燈 logo" width="120">
</p>

<h1 align="center">股海明燈 Stock Lighthouse</h1>

<p align="center">可查證的台股 AI 分析平台：AI 分析附上依據與原文，判斷到期後公開回顧</p>

<p align="center">
  <a href="https://github.com/weeei001/115409/actions/workflows/ci-cd.yml"><img src="https://github.com/weeei001/115409/actions/workflows/ci-cd.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white" alt="Python 3.12">
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://stock-lighthouse.com"><strong>線上版</strong></a> ·
  <a href="docs/development.md"><strong>開發文件</strong></a>
</p>

![股海明燈觀測台：觀測清單、K 線、三大法人與技術指標](docs/images/readme/hero.png)

## 核心理念

不比誰猜得準，而是讓每個判斷都能查證。

- **判斷附依據**：AI 分析報告的每一項都標出依據，例如交易資料、法人統計或新聞報導，引用新聞時附上原文。
- **新聞分層判讀**：每則新聞分別判讀對大盤、產業與個股的影響，標出的原文可以對照到事件分析。
- **到期公開回顧**：短線（1–5 日）、波段（6–20 日）、中期（21–40 日）三個期間的判斷，到期後和實際走勢對照，命中率公開在個股頁。

## 功能特色

- **個股資訊**：查看歷史行情、技術指標、財務資料與法人買賣超，搭配相關新聞及 AI 分析；AI 分析可開成完整報告，列印或存成 PDF。
- **多股比較**：依指定日期區間比較股票的價格表現、風險與相關性。
- **新聞分析**：整理新聞事件，區分對市場、產業與個別公司的影響，並保留原文引用。
- **AI 對話**：支援個股問答、多股比較與金融概念說明，提供引用來源；登入後可保存並延續對話。
- **收藏與通知**：管理收藏股票，設定摘要、漲跌幅及重大新聞通知。
- **模擬投資**：自訂練習資金、確認模擬委託、追蹤持股與損益，保留決策理由並安排回顧。

<table>
  <tr>
    <td width="33%" align="center">
      <img src="docs/images/readme/report.png" alt="台積電 AI 分析報告，每一項都標出依據"><br>
      <sub>AI 分析報告：每一項都標出依據</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/images/readme/news.png" alt="新聞事件影響分析，附上原文依據"><br>
      <sub>新聞事件影響：附上原文依據</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/images/readme/compare.png" alt="台積電、聯發科、鴻海的指數化走勢比較"><br>
      <sub>多股比較：同期價格表現</sub>
    </td>
  </tr>
</table>

## 系統架構

```mermaid
flowchart LR
  src["公開市場資料<br>證交所、櫃買中心<br>公開資訊觀測站、集保"]
  news["財經新聞"]
  llm["LLM 與<br>Embedding API"]
  jobs["排程工作<br>行情、法人、指標、新聞"]
  mysql[("MySQL")]
  qdrant[("Qdrant")]
  api["FastAPI"]
  web["Next.js 網站"]
  app["Android App<br>（Capacitor）"]

  src --> jobs
  news --> jobs
  llm -.-> jobs
  llm -.-> api
  jobs --> mysql
  jobs --> qdrant
  mysql --> api
  qdrant --> api
  api --> web
  api --> app
```

後端的排程工作抓取公開市場資料與財經新聞存進 MySQL；新聞切段後產生向量存進 Qdrant，供 AI 檢索。個股 AI 分析由排程每日產生，AI 對話則即時呼叫 LLM。網站與 Android App 共用同一套 Next.js 介面。

## 技術棧

| 類別 | 技術 |
| --- | --- |
| 前端 | Next.js 16（Pages Router）、React 19、TypeScript、Tailwind CSS 4、ECharts、lightweight-charts |
| App | Capacitor 8（Android）、Firebase 推播 |
| 後端 | Python 3.12、FastAPI、SQLAlchemy 2、Pydantic 2 |
| 資料庫 | MySQL、Qdrant |
| AI | LangChain 串接 LLM、Embedding API、新聞語意檢索（RAG） |
| CI/CD | GitHub Actions（測試、CodeQL、相依套件稽核、Gitleaks 機密掃描）、自架 Windows runner 部署 |

## 免責聲明

本站資料與 AI 分析僅供研究參考，不構成投資建議；投資前請自行判斷，並自行承擔投資損益。行情為收盤後資料，不是即時報價；AI 的推論與數字可能有誤。模擬投資不連接真實券商帳戶。

## 授權

本專案採用 [MIT 授權](LICENSE)。
