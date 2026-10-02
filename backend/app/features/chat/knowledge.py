"""提供本系統實際支援功能的精簡參考說明與引用來源。"""
import json
import re

from app.features.analysis.evidence import FIELD_GLOSSARY
from app.features.retrieval.common import STOCK_OPTIONS

from .schemas import SourceChunk


INDICATOR_GUIDES = (
    (r"KD|隨機|stochastic|黃金交叉|死亡交叉", "KD／隨機指標觀念", "fast-stochastic",
     "隨機指標描述收盤價在近期最高價與最低價區間中的相對位置。K 線反應較快，D 線則將 K 值平滑化。"
     "高於 80 與低於 20 的區域常稱為超買與超賣。判定交叉時，必須確認兩條線在前後觀察點的相對位置發生改變。"
     "平滑方式與回看期間有不同設定；此參考來源以 14 期為例。"
     "以上是一般觀念，不代表本系統已儲存的指標數值。"),
    (r"RSI|相對強弱", "RSI 相對強弱指標觀念", "RSI",
     "RSI 比較價格上漲與下跌的相對變化，以 0 至 100 的數值衡量價格動能。"
     "70 與 30 是常見的超買與超賣門檻，但並非所有設定都適用。趨勢強勁時，RSI 可能長時間停留在極端區域。"
     "不能只憑 RSI 偏高或偏低就認定價格將反轉，仍須考量計算期間與其他證據。"),
    (r"MACD|指數平滑異同", "MACD 趨勢動能觀念", "macd",
     "MACD 比較較快與較慢的指數移動平均線。常見範例使用 12 期與 26 期，並搭配 9 期 EMA 訊號線。"
     "線與線交叉或穿越零軸可描述動能變化，但盤整行情可能反覆出現誤導性的交叉訊號。"
     "MACD 沒有固定上下界，通常不作為判定超買與超賣的震盪指標。不同系統採用的參數可能不同。"),
)


def reference_source(title: str, content: str, *, category: str = "knowledge", url: str = "") -> SourceChunk:
    return SourceChunk(title=title, content=content, category=category, source=f"system_{category}",
                       source_name="Fidelity 指標指南" if url else "系統功能與欄位說明",
                       pub_time="", url=url, stock_id="", score=1)


def collect_knowledge_sources(query: str, *, include_help: bool, include_knowledge: bool) -> list[SourceChunk]:
    sources = []
    if include_help:
        sources.append(reference_source("系統功能與操作入口", json.dumps({
            "supported_stocks": STOCK_OPTIONS,
            "features": {
                "home": "首頁提供股票總覽，以及個股頁面的入口。",
                "individual_stock": "個股頁面依現有資料提供價量圖、技術指標、法人買賣超、財務資料、新聞與 AI 分析。",
                "comparison": "比較頁面可選擇多檔支援的股票與日期區間，比較價格表現、波動度、回撤、相關性、技術指標與法人買賣超。",
                "chat": "可詢問個股、多股比較、新聞或指標觀念；也可點選 AI 建議的追問，或要求更精簡、深入的說明。",
                "paper_portfolio": "登入後先自行設定想投入的模擬資金，金額可貼近實際願意投入的投資預算，不必提供總存款。"
                                   "可在對話中編輯並確認模擬單草稿，或至 /order 建立委託。買入以金額操作，支援零股。"
                                   "委託預計於下一個交易日收盤成交，實際股數依成交價格計算；尚未進入成交處理的委託可取消。"
                                   "主畫面可查看可用資金、總資產、投資損益與持股，交易紀錄及回顧按需要展開。"
                                   "AI 可引用帳戶提供的資金與持股配置比例，分母為模擬總資產；全部現金包含可用與委託保留資金。"
                                   "尚未設定預算、總資產為零或行情不完整時，配置比例可能無法計算。"
                                   "可透過管理資金增加或取回模擬現金，取回金額不能超過可用資金。追加資金不計為投資獲利。"
                                   "AI 可依收藏、模擬持股及可用資金討論投資分配；草稿須經使用者確認，不會自動下單或調整資金。"
                                   "模擬資產不代表真實存款或券商持股；回顧到期不會自動賣出持股。",
            },
            "chat_limits": "對話可讀取系統現有行情與參考資料，無法存取真實券商持股或執行真實交易。"
                           "登入後，可依提問讀取目前使用者的收藏與模擬投資帳戶，並準備可編輯的模擬單草稿。"
                           "請透過提供的頁面按鈕操作支援的功能。資料可能缺漏或延遲，已儲存行情並非即時報價。",
        }, ensure_ascii=False), category="help"))
    if include_knowledge:
        glossary = {key: value for key, value in FIELD_GLOSSARY.items()
                    if key not in {"rsi5", "kd_k", "macd_hist"}}
        sources.append(reference_source("系統分析欄位與比較口徑", json.dumps({
            "fields": glossary,
            "comparison": "區間價格報酬率 =（期末收盤價 / 期初收盤價 - 1）× 100。"
                          "年化波動度 = 日報酬率的樣本標準差 × 252 的平方根 × 100。"
                          "最大回撤是區間內相對於先前累積高點的最大跌幅。"
                          "皮爾森相關係數使用配對的每日報酬率計算；序列為常數或樣本過少時，相關係數無法定義。"
                          "報酬不含股息、交易成本與稅費；缺值不等於零。",
            "limits": "以上是欄位定義與計算方式，不代表已觀察到的個股狀況。請使用各筆股票資料實際提供的單位與參數名稱。",
        }, ensure_ascii=False)))
        for pattern, title, slug, content in INDICATOR_GUIDES:
            if re.search(pattern, query, re.IGNORECASE):
                sources.append(reference_source(title, content, url=
                    "https://www.fidelity.com/learning-center/trading-investing/technical-analysis/"
                    f"technical-indicator-guide/{slug}"))
    return sources
