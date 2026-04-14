# 股海明燈 - Activity diagram

## 1. 會員註冊
```mermaid
flowchart TD
    Start([開始]) --> Step1[進入登入頁面]
    Step1 --> Step2[點擊註冊，進入註冊介面]
    Step2 --> Step3[輸入註冊資料並點擊送出]
    
    Step3 --> Cond{驗證與註冊結果}
    
    Cond -- "失敗：格式資料有誤" --> Error1[顯示格式錯誤提示]
    Error1 --> Step3
    
    Cond -- "失敗：帳號已被註冊" --> Error2[顯示帳號已註冊提示]
    Error2 --> Step3
    
    Cond -- "成功" --> Step4[顯示註冊成功提示]
    
    Step4 --> Step5[自動導回登入頁面]
    Step5 --> Finish([結束])
```
## 2. 會員登入
```mermaid
flowchart TD
    Start([開始]) --> Step1[進入登入頁面]
    Step1 --> Step2[輸入登入資料\n並點擊送出]
    
    Step2 --> Cond{ }
    
    Cond -- "[格式有誤]" --> Error1[提示\n資料格式有誤]
    Error1 --> Step2
    
    Cond -- "[帳號或密碼錯誤]" --> Error2[提示\n帳號或密碼錯誤]
    Error2 --> Step2
    
    Cond -- "[登入成功]" --> Step3[顯示\n登入成功提示]
    
    Step3 --> Step4[進入系統首頁]
    Step4 --> Finish([結束])
```
## 3. 忘記密碼
```mermaid
flowchart TD
    Start([開始]) --> Step1[進入忘記密碼頁面]
    Step1 --> Step2[輸入電子信箱並點擊發送]
    
    Step2 --> Cond1{前端本地驗證}
    
    Cond1 -- "[空白或格式錯誤]" --> Error1[顯示錯誤提示]
    Error1 --> Step2
    
    Cond1 -- "[驗證通過]" --> Step3[點擊按鈕發送重設連結]
    
    Step3 --> Step4[切換至「郵件已發送」畫面]
    
    Step4 --> Step5[點擊返回登入頁面]
    Step5 --> Finish([結束])
```
## 4. 投資顧問
```mermaid
flowchart TD
    Start([開始]) --> Step1[進入 AI 投資顧問頁面]
    Step1 --> Step2[輸入投資問題並點擊發送]
    
    Step2 --> Step3[發送請求並顯示載入中動畫]
    
    Step3 --> Cond1{接收系統回覆}
    
    Cond1 -- "[發生錯誤或超時]" --> Error[提示系統異常請稍後再試]
    Error --> Step2
    
    Cond1 -- "[成功生成]" --> Step4[顯示 AI 回覆內容與參考新聞來源]
    
    Step4 --> Step5[閱讀回覆，可點選檢視新聞來源]
    
    %% 在這裡加入一個空的菱形作為分流點
    Step5 --> Cond2{ }
    
    Cond2 -- "繼續輸入新問題" --> Step2
    Cond2 -- "切換頁面或關閉" --> Finish([結束])
```
## 5. 歷史回測
```mermaid
flowchart TD
    Start([開始]) --> Step1[進入歷史回測頁面\n取得 Session ID 並載入資料]
    Step1 --> Step2[輸入下單參數\n股票代號、買賣方向、日期、張數]
    Step2 --> Action1[點擊確認送出]
    
    Action1 --> Cond1{前端防呆驗證}
    
    Cond1 -- "[驗證失敗]" --> Error1[顯示對應錯誤提示\n並標示錯誤欄位]
    Error1 --> Step2
    
    Cond1 -- "[驗證成功]" --> Step3[彈出「確認委託」視窗\n讓使用者預覽參數]
    
    Step3 --> Action2[點擊確認下單\n進入 Loading 狀態並呼叫 API]
    
    Action2 --> Cond2{接收系統回傳結果}
    
    Cond2 -- "[失敗：查無股價 404]" --> Error2[提示該日期無收盤資料]
    Error2 --> Step2
    
    Cond2 -- "[失敗：其他錯誤]" --> Error3[提示標準下單失敗錯誤]
    Error3 --> Step2
    
    Cond2 -- "[下單成功]" --> Step4[關閉彈窗並清空輸入表單\n顯示成功提示 Toast]
    
    Step4 --> Step5[背景自動重新呼叫 API\n刷新委託紀錄與損益彙總表]
    
    %% 隱形菱形結尾分流
    Step5 --> Cond3{ }
    
    Cond3 -- "繼續輸入新條件" --> Step2
    Cond3 -- "切換頁面或關閉" --> Finish([結束])
```
## 6. 多股比較
```mermaid
flowchart TD
    Start([開始]) --> Init[進入多股比較頁面\n顯示預設日期與股票搜尋列]
    
    %% 1. 匯集節點 (Merge Node)：專門收攏所有進來的線
    Init --> MergePoint{ } 
    Ignore --> MergePoint
    ErrMax --> MergePoint
    AddTag --> MergePoint
    ErrMin --> MergePoint
    Join -- "繼續操作" --> MergePoint
    
    %% 2. 決策節點 (Decision Node)：專門負責分流
    MergePoint --> UserChoice{使用者選擇操作} 
    
    %% 路線一：設定/修改參數
    UserChoice -- "[新增/移除股票]" --> ActionAdd[搜尋並選擇股票代號]
    
    ActionAdd --> CondAdd{新增防呆檢查}
    CondAdd -- "[已存在]" --> Ignore[忽略動作]
    CondAdd -- "[總數 >= 10]" --> ErrMax[顯示紅框提示：最多比較 10 支股票]
    CondAdd -- "[正常]" --> AddTag[畫面上新增該股票標籤]
    
    %% 路線二：點擊送出
    UserChoice -- "[點擊開始比較]" --> CondSubmit{前端送出驗證}
    
    CondSubmit -- "[少於 2 檔]" --> ErrMin[顯示紅框提示：請至少選擇 2 支股票]
    CondSubmit -- "[驗證通過]" --> Loading[清空舊錯誤與警告\n進入 Loading 狀態]
    
    Loading --> CondCache{快取判斷}
    CondCache -- "[已有快取]" --> RenderAll[略過請求，直接渲染所有圖表與數據]
    
    %% 平行處理分流 (Fork)
    CondCache -- "[無快取]" --> Fork((並行發起 API 請求))
    
    Fork --> ReqA[路線 A：取得區間歷史報價]
    Fork --> ReqB[路線 B：取得單股細部指標與矩陣]
    
    %% 路線 A 邏輯
    ReqA --> CondA{路線 A 回應}
    CondA -- "[失敗]" --> ErrA[Toast 錯誤提示與紅框\n清空舊數據並隱藏走勢圖]
    CondA -- "[成功]" --> RenderA[渲染「多股走勢比較圖」\n顯示圖表模式切換按鈕]
    
    %% 路線 B 邏輯
    ReqB --> CondB{路線 B 回應}
    CondB -- "[重大例外失敗]" --> ErrB[Toast 錯誤提示與紅框\n顯示指標錯誤]
    CondB -- "[部分成功/部分失敗]" --> WarnB[收集警告並顯示黃框提示\n整合剩餘可用的成功資料] --> RenderB
    CondB -- "[完全成功]" --> RenderB[渲染指標數據比較表\n風險報酬散佈圖、相關係數熱力圖]
    
    %% 匯集點 (Join)
    ErrA --> Join{ }
    RenderA --> Join
    ErrB --> Join
    RenderB --> Join
    RenderAll --> Join
    
    Join -- "離開頁面" --> Finish([結束])
```