```mermaid
classDiagram
    %% ==========================================
    %% 模組 1：會員與下單業務 (User & Order)
    %% ==========================================
    
    class 會員User {
        電子信箱
        顯示名稱
        是否啟用
    }
    
    class 模擬訂單SimulatedOrder {
        股票代號
        買賣方向
        模擬下單日期
        委託數量
        賣出計畫
        預計賣出日
        委託狀態
        預估成交金額
        損益金額
    }

    %% ==========================================
    %% 模組 2：市場大數據實體 (Market Data)
    %% ==========================================
    
    class 每日股價DailyPrice {
        日期
        股票代號
        開盤價
        最高價
        最低價
        收盤價
        成交股數
        成交金額
        漲跌價差
        成交筆數
    }
    
    class 三大法人交易InstitutionalTrade {
        日期
        股票代號
        外陸資買賣超
        外資自營商買賣超
        投信買賣超
        自營商買賣超
        三大法人買賣超
    }
    
    class 技術指標TechnicalIndicator {
        日期
        股票代號
        各週期均線（5/20/60日）
        14日RSI
        MACD線
        MACD柱狀圖
        5日均量
    }

    class 台股新聞CnyesTWStockNews {
        新聞標題
        新聞內文
        發布時間
        關聯股票
        原始網址
    }

    %% ==========================================
    %% 模組 3：AI 報告分析 (Advisor)
    %% ==========================================
    
    class AI核心決策CoreDecision {
        趨勢結論
        信心等級
        狀態分數
        趨勢分數
        行動建議
        理由點
    }
    
    class AI完整報告AdvisorReport {
        股票代號
        分析基準日
        工作狀態
        規則摘要
        新聞與RAG整理結果
        完整報告內容
    }

    %% ==========================================
    %% 實體關聯 (Relationships)
    %% ==========================================
    
    %% 模組內部關聯
    模擬訂單SimulatedOrder "*" --> "1" 會員User
    每日股價DailyPrice "1" -- "1" 三大法人交易InstitutionalTrade
    每日股價DailyPrice "1" -- "1" 技術指標TechnicalIndicator
    台股新聞CnyesTWStockNews "*" -- "*" 每日股價DailyPrice
    AI完整報告AdvisorReport "1" *-- "1" AI核心決策CoreDecision
    
    %% 跨模組邏輯關聯 (Cross-Module)
    模擬訂單SimulatedOrder "*" --> "1" 每日股價DailyPrice
    AI完整報告AdvisorReport "*" --> "1" 會員User
    AI完整報告AdvisorReport "*" --> "1" 每日股價DailyPrice
```