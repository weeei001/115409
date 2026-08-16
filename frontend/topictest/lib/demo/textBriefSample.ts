import type { TaskPacket, TextBriefResponse } from './textBriefTypes';

/**
 * 離線範例：一次真實執行的回應，不是手捏的假資料。
 * 2330、基準日 2026-07-13、deepseek-ai/deepseek-v4-flash、91 秒、status=verified。
 *
 * 要換新樣本就整段取代：
 *   回應   — scripts/smoke_text_brief.py --dump out.json
 *   payload — 從 llm_responses.prompt_json 取
 */
export const SAMPLE: TextBriefResponse = {
  "schema_version": "text-first-v2",
  "symbol": "2330",
  "as_of_date": "2026-07-13",
  "generated_by": "deepseek-ai/deepseek-v4-flash",
  "status": "verified",
  "brief": {
    "key_days": [
      {
        "id": "kd_01",
        "date": "2026-05-29",
        "ref": "d_11",
        "what": "成交量暴增到十萬四千多張，比五日均量多一倍以上，外資買超一萬三千多張，是這四十天裡量價配合最好的一天。",
        "evidence_ids": [
          "d_11"
        ],
        "move_pct": 2.61,
        "volume_ratio": 2.11
      },
      {
        "id": "kd_02",
        "date": "2026-06-22",
        "ref": "d_26",
        "what": "股價創下近一年新高 2510 元，外資買超一萬四千多張，但成交量只比五日均量多 17%，追價力道沒有跟上創高的氣勢。",
        "evidence_ids": [
          "d_26",
          "lt_01"
        ],
        "move_pct": 4.15,
        "volume_ratio": 1.17
      },
      {
        "id": "kd_03",
        "date": "2026-06-24",
        "ref": "d_28",
        "what": "從高點回跌 4.02%，成交量放大 45%，外資單日賣超三萬八千多張，創高後的獲利了結壓力非常明顯。",
        "evidence_ids": [
          "d_28"
        ],
        "move_pct": -4.02,
        "volume_ratio": 1.45
      },
      {
        "id": "kd_04",
        "date": "2026-07-01",
        "ref": "d_33",
        "what": "反彈 3.94%，外資與投信同步買超，但成交量反而比五日均量少 15%，這波上漲是在量縮的情況下發生的。",
        "evidence_ids": [
          "d_33"
        ],
        "move_pct": 3.94,
        "volume_ratio": 0.85
      },
      {
        "id": "kd_05",
        "date": "2026-07-09",
        "ref": "d_39",
        "what": "下跌 2.03%，成交量放大 19%，外資又賣超近一萬三千張，當天新聞也提到外資對這檔股票的大額調節，兩邊互相印證。",
        "evidence_ids": [
          "d_39",
          "nw_05"
        ],
        "move_pct": -2.03,
        "volume_ratio": 1.19
      }
    ],
    "headline": "創新高後快速回檔，外資反覆調節、量能只在下跌時放大",
    "current_status": [
      {
        "id": "cs_01",
        "claim_type": "observation",
        "text": "七月十三日收在 2440 元，只比月線高不到一個百分點，最近兩週幾乎是原地整理。",
        "direction": "neutral",
        "evidence_ids": [
          "d_40"
        ],
        "importance": "high"
      },
      {
        "id": "cs_02",
        "claim_type": "observation",
        "text": "股價位置很高，落在近一年區間的九成五附近，但上行動能已經連續多日轉為負值而且持續擴大。",
        "direction": "mixed",
        "evidence_ids": [
          "lt_03",
          "d_40"
        ],
        "importance": "high"
      },
      {
        "id": "cs_03",
        "claim_type": "observation",
        "text": "這段期間大多數交易日的成交量都低於近五日平均，只有下跌的日子量能才明顯放大。",
        "direction": "negative",
        "evidence_ids": [
          "d_33",
          "d_39",
          "d_28"
        ],
        "importance": "medium"
      }
    ],
    "positive_factors": [
      {
        "id": "pos_01",
        "claim_type": "observation",
        "text": "最近一季每股純益 22.08 元，比去年同期成長將近六成，而且已經連續四季逐季走高。",
        "direction": "positive",
        "evidence_ids": [
          "fd_01"
        ],
        "importance": "high"
      },
      {
        "id": "pos_02",
        "claim_type": "observation",
        "text": "六月營收 4427 億元，年增將近七成、月增六個百分點，成長動能沒有放緩的跡象。",
        "direction": "positive",
        "evidence_ids": [
          "fd_04"
        ],
        "importance": "high"
      },
      {
        "id": "pos_03",
        "claim_type": "observation",
        "text": "毛利率與營業利益率分別維持在六成六與五成八左右，獲利品質處在很高的水準。",
        "direction": "positive",
        "evidence_ids": [
          "fd_02",
          "fd_03"
        ],
        "importance": "medium"
      }
    ],
    "negative_factors": [
      {
        "id": "neg_01",
        "claim_type": "observation",
        "text": "外資在六月二十四日與七月九日兩次大量調節，合計倒出超過五萬張，創高後的賣壓持續存在。",
        "direction": "negative",
        "evidence_ids": [
          "d_28",
          "d_39"
        ],
        "importance": "high"
      },
      {
        "id": "neg_02",
        "claim_type": "inference",
        "text": "上漲的日子量能反而縮、下跌的日子量能才放大，代表追價意願不足，賣方比買方積極。",
        "direction": "negative",
        "evidence_ids": [
          "d_33",
          "d_39",
          "d_28"
        ],
        "importance": "high"
      },
      {
        "id": "neg_03",
        "claim_type": "inference",
        "text": "股價已經在近一年區間的高位，上行動能卻同時轉弱，價格與動能之間出現背離。",
        "direction": "negative",
        "evidence_ids": [
          "lt_03",
          "d_40"
        ],
        "importance": "medium"
      }
    ],
    "source_divergences": [
      {
        "id": "div_01",
        "claim_type": "conflict",
        "text": "公司的獲利與營收數字非常強，但市場資金在同一段時間持續流出，基本面與籌碼面方向相反。",
        "direction": "mixed",
        "evidence_ids": [
          "fd_01",
          "fd_04",
          "d_28",
          "d_39"
        ],
        "importance": "high"
      },
      {
        "id": "div_02",
        "claim_type": "limitation",
        "text": "檢索到的五則新聞有四則是大盤指數的即時行情快訊，與這檔個股沒有直接關聯，只有一則提到外資對本檔的調節。",
        "direction": "not_applicable",
        "evidence_ids": [
          "nw_01",
          "nw_02",
          "nw_05"
        ],
        "importance": "medium"
      }
    ],
    "risks": [
      {
        "id": "rk_01",
        "risk_type": "籌碼",
        "description": "外資在創高後連續調節，在股價位於近一年高位的情況下，籌碼鬆動的影響會被放大。",
        "trigger": "外資單日賣超再度超過一萬張，且股價同步收黑",
        "evidence_ids": [
          "d_28",
          "d_39",
          "lt_03"
        ]
      },
      {
        "id": "rk_02",
        "risk_type": "量能",
        "description": "反彈都在量能不足的情況下發生，缺乏成交量確認的上漲通常不容易延續。",
        "trigger": "上漲日的成交量仍然低於近五日平均",
        "evidence_ids": [
          "d_33",
          "d_40"
        ]
      },
      {
        "id": "rk_03",
        "risk_type": "評價",
        "description": "目前的高股價已經反映很強的獲利成長，一旦單月營收的成長速度放慢，評價調整的壓力會很直接。",
        "trigger": "單月營收年增率明顯低於前幾期",
        "evidence_ids": [
          "fd_04",
          "lt_03"
        ]
      }
    ],
    "watch_points": [
      {
        "id": "wp_01",
        "what_to_watch": "七月營收公告",
        "why_it_matters": "六月營收年增將近七成，七月能否維持同樣量級，是判斷成長動能有沒有轉折最直接的指標。",
        "when": "八月十日前",
        "evidence_ids": [
          "fd_04"
        ]
      },
      {
        "id": "wp_02",
        "what_to_watch": "外資連續賣超會不會中斷",
        "why_it_matters": "近兩週的壓力主要來自外資調節，只要這條賣超鏈沒有斷，股價就很難脫離整理。",
        "when": "接下來一到兩週的每日法人資料",
        "evidence_ids": [
          "d_28",
          "d_39",
          "d_40"
        ]
      },
      {
        "id": "wp_03",
        "what_to_watch": "上漲日的成交量",
        "why_it_matters": "這段期間上漲都是量縮，只有出現量價同步放大的日子，才代表買方態度真的轉變。",
        "when": "接下來的每個交易日",
        "evidence_ids": [
          "d_33",
          "d_40"
        ]
      },
      {
        "id": "wp_04",
        "what_to_watch": "最新一季財報",
        "why_it_matters": "正式財報目前只到上一季，下一季數字能否延續逐季成長，會決定基本面優勢還在不在。",
        "when": "下一季財報公告",
        "evidence_ids": [
          "fd_01"
        ]
      }
    ],
    "forward_views": {
      "short_1_5": {
        "stance": "neutral",
        "reason": "價格貼著月線整理，量能與籌碼都沒有給出明確方向。",
        "invalidation": "出現量價同步放大、且外資轉為買超的交易日",
        "evidence_ids": [
          "d_40",
          "d_33"
        ]
      },
      "swing_6_20": {
        "stance": "mixed",
        "reason": "基本面成長很強，但外資持續調節與上行動能轉弱同時存在，兩股力量互相抵銷。",
        "invalidation": "外資連續三天買超，或單月營收成長明顯降速",
        "evidence_ids": [
          "fd_04",
          "d_28",
          "d_39"
        ]
      },
      "medium_21_40": {
        "stance": "mildly_bullish",
        "reason": "獲利與營收連續多期走高，只要成長節奏不變，中期的基本面仍是主要支持。",
        "invalidation": "單月營收年增率連續兩期明顯放緩，或季度獲利停止成長",
        "evidence_ids": [
          "fd_01",
          "fd_04"
        ]
      }
    },
    "overall_stance": "mixed",
    "confidence": "medium",
    "confidence_reason": "價量、籌碼與基本面資料都完整，但基本面明顯偏多、籌碼與量能偏空，方向互相矛盾，可用新聞也多為大盤雜訊。",
    "limitations": [
      "檢索到的新聞多為大盤指數快訊，其中三則是同一則盤中速報的不同時間點，對個股判斷幫助有限。",
      "最新正式財報為 2026 年第一季，下一季的獲利狀況尚無法確認。"
    ]
  },
  "evidence_catalog": [
    {
      "id": "d_11",
      "field": "daily_timeline",
      "date": "2026-05-29",
      "value": {
        "close": 2355,
        "chg_pct": 2.61,
        "vol_lots": 104784,
        "vol_vs_ma5_pct": 111,
        "foreign_net_lots": 13284
      }
    },
    {
      "id": "d_26",
      "field": "daily_timeline",
      "date": "2026-06-22",
      "value": {
        "close": 2510,
        "chg_pct": 4.15,
        "vol_lots": 45208,
        "vol_vs_ma5_pct": 17,
        "foreign_net_lots": 14361
      }
    },
    {
      "id": "d_28",
      "field": "daily_timeline",
      "date": "2026-06-24",
      "value": {
        "close": 2390,
        "chg_pct": -4.02,
        "vol_lots": 67304,
        "vol_vs_ma5_pct": 45,
        "foreign_net_lots": -38450
      }
    },
    {
      "id": "d_33",
      "field": "daily_timeline",
      "date": "2026-07-01",
      "value": {
        "close": 2505,
        "chg_pct": 3.94,
        "vol_lots": 37544,
        "vol_vs_ma5_pct": -15,
        "foreign_net_lots": 7400
      }
    },
    {
      "id": "d_39",
      "field": "daily_timeline",
      "date": "2026-07-09",
      "value": {
        "close": 2415,
        "chg_pct": -2.03,
        "vol_lots": 34681,
        "vol_vs_ma5_pct": 19,
        "foreign_net_lots": -12749
      }
    },
    {
      "id": "d_40",
      "field": "daily_timeline",
      "date": "2026-07-13",
      "value": {
        "close": 2440,
        "chg_pct": 1.04,
        "vol_lots": 35310,
        "vol_vs_ma5_pct": 19,
        "foreign_net_lots": -2045
      }
    },
    {
      "id": "lt_01",
      "field": "high_1y",
      "date": "2026-06-22",
      "value": 2510
    },
    {
      "id": "lt_03",
      "field": "close_pos_in_1y_pct",
      "date": "2026-07-13",
      "value": 95.1
    },
    {
      "id": "fd_01",
      "field": "eps",
      "date": "2026-03-31",
      "value": 22.08,
      "period": "2026Q1",
      "qoq_pct": 13.2,
      "yoy_pct": 58.3,
      "last4q": [
        [
          "2025Q2",
          15.36
        ],
        [
          "2025Q3",
          17.44
        ],
        [
          "2025Q4",
          19.51
        ],
        [
          "2026Q1",
          22.08
        ]
      ]
    },
    {
      "id": "fd_02",
      "field": "gross_margin_pct",
      "date": "2026-03-31",
      "value": 66.2,
      "period": "2026Q1"
    },
    {
      "id": "fd_03",
      "field": "operating_margin_pct",
      "date": "2026-03-31",
      "value": 58.1,
      "period": "2026Q1"
    },
    {
      "id": "fd_04",
      "field": "revenue_monthly",
      "date": null,
      "value": 442679969000,
      "period": "2026-06",
      "yoy_pct": 67.9,
      "mom_pct": 6.2,
      "yoy_last6": [
        [
          "2026-01",
          36.8
        ],
        [
          "2026-02",
          22.2
        ],
        [
          "2026-03",
          45.2
        ],
        [
          "2026-04",
          17.5
        ],
        [
          "2026-05",
          30.1
        ],
        [
          "2026-06",
          67.9
        ]
      ]
    },
    {
      "id": "nw_01",
      "field": "news",
      "date": "2026-07-02",
      "value": "美股今日凌晨收盤部分，道瓊下跌 13.96 點或 0.03%，收報 52,305.24 點；標普 500 下跌 16.1…",
      "kind": "general",
      "title": "〈台股開盤〉逾千跌點回測4萬6後跌幅收斂 機器人、無人機聯歡齊嗨"
    },
    {
      "id": "nw_02",
      "field": "news",
      "date": "2026-07-01",
      "value": "截至台北時間01日11:29，集中市場加權指數上漲946.67點（或2.05%），暫報47072.58點。 歷史漲跌幅 …",
      "kind": "general",
      "title": "盤中速報 - 集中市場加權指數上漲946.67點至47072.58點，漲幅2.05%"
    },
    {
      "id": "nw_05",
      "field": "news",
      "date": "2026-07-09",
      "value": "資深證券分析師簡伯儀指出，台股集中市場近期出現量能萎縮格局，而在大型颱風巴威逼近同時，更使得買盤縮手，甚至買了也不敢貿然…",
      "kind": "general",
      "title": "外資賣超471億元連6賣 光是台積電就提款310億元"
    }
  ],
  "verification": {
    "filtered_evidence_ids": [],
    "compliance_violations": [],
    "simplified_chars": [],
    "future_dated_items": [],
    "removed_item_ids": [],
    "soft_compliance_hits": [],
    "unverified_numbers": [],
    "undercount_sections": [],
    "truncated_sections": [],
    "jargon_hits": []
  },
  "disclaimer": {
    "version": "v1",
    "text": "本內容由 AI 系統彙整公開資訊自動產生，僅供參考，不構成投資建議或個股買賣依據；投資人應自行獨立判斷並自負投資風險。行情與公告請以臺灣證券交易所、證券櫃檯買賣中心及公開資訊觀測站公告為準。"
  },
  "limitations": [
    "本分析未涵蓋公司自提財測，展望類資訊僅來自媒體報導。"
  ],
  "cached": false
};

/** 上面那一次執行真正送進 LLM 的 task packet */
export const SAMPLE_PACKET: TaskPacket = {
  "task": {
    "type": "stock_behavior_text_brief",
    "symbol": "2330",
    "as_of_date": "2026-07-13",
    "timeline_trading_days": 40,
    "analysis_language": "zh-TW"
  },
  "daily_timeline": [
    {
      "id": "d_01",
      "date": "2026-05-15",
      "close": 2265,
      "chg_pct": -0.22,
      "vol_lots": 34361,
      "vol_vs_ma5_pct": -21,
      "foreign_net_lots": -3399,
      "trust_net_lots": 3386,
      "dealer_net_lots": -21,
      "rsi5": 57,
      "kd_k": 49.9,
      "macd_hist": -6.3,
      "vs_ma20_pct": 3.3,
      "news": []
    },
    {
      "id": "d_02",
      "date": "2026-05-18",
      "close": 2240,
      "chg_pct": -1.1,
      "vol_lots": 32967,
      "vol_vs_ma5_pct": -20,
      "foreign_net_lots": -9522,
      "trust_net_lots": 6430,
      "dealer_net_lots": 520,
      "rsi5": 48.2,
      "kd_k": 41.6,
      "macd_hist": -9.11,
      "vs_ma20_pct": 1.7,
      "news": []
    },
    {
      "id": "d_03",
      "date": "2026-05-19",
      "close": 2205,
      "chg_pct": -1.56,
      "vol_lots": 45586,
      "vol_vs_ma5_pct": 16,
      "foreign_net_lots": -17247,
      "trust_net_lots": 4144,
      "dealer_net_lots": 200,
      "rsi5": 37.9,
      "kd_k": 27.7,
      "macd_hist": -13.37,
      "vs_ma20_pct": -0.3,
      "news": []
    },
    {
      "id": "d_04",
      "date": "2026-05-20",
      "close": 2185,
      "chg_pct": -0.91,
      "vol_lots": 38333,
      "vol_vs_ma5_pct": 0,
      "foreign_net_lots": -11031,
      "trust_net_lots": 2189,
      "dealer_net_lots": -712,
      "rsi5": 32.9,
      "kd_k": 18.5,
      "macd_hist": -17.33,
      "vs_ma20_pct": -1.5,
      "news": []
    },
    {
      "id": "d_05",
      "date": "2026-05-21",
      "close": 2230,
      "chg_pct": 2.06,
      "vol_lots": 24929,
      "vol_vs_ma5_pct": -29,
      "foreign_net_lots": 1014,
      "trust_net_lots": 167,
      "dealer_net_lots": 423,
      "rsi5": 51.1,
      "kd_k": 23,
      "macd_hist": -16.69,
      "vs_ma20_pct": 0.1,
      "news": []
    },
    {
      "id": "d_06",
      "date": "2026-05-22",
      "close": 2255,
      "chg_pct": 1.12,
      "vol_lots": 26823,
      "vol_vs_ma5_pct": -20,
      "foreign_net_lots": 733,
      "trust_net_lots": -465,
      "dealer_net_lots": 188,
      "rsi5": 58.8,
      "kd_k": 32,
      "macd_hist": -14.46,
      "vs_ma20_pct": 0.9,
      "news": []
    },
    {
      "id": "d_07",
      "date": "2026-05-25",
      "close": 2310,
      "chg_pct": 2.44,
      "vol_lots": 28251,
      "vol_vs_ma5_pct": -14,
      "foreign_net_lots": 4046,
      "trust_net_lots": 4128,
      "dealer_net_lots": 97,
      "rsi5": 71.3,
      "kd_k": 51.1,
      "macd_hist": -9.39,
      "vs_ma20_pct": 3,
      "news": []
    },
    {
      "id": "d_08",
      "date": "2026-05-26",
      "close": 2270,
      "chg_pct": -1.73,
      "vol_lots": 32781,
      "vol_vs_ma5_pct": 8,
      "foreign_net_lots": -7749,
      "trust_net_lots": -597,
      "dealer_net_lots": 98,
      "rsi5": 55.9,
      "kd_k": 54.3,
      "macd_hist": -8.85,
      "vs_ma20_pct": 1.2,
      "news": []
    },
    {
      "id": "d_09",
      "date": "2026-05-27",
      "close": 2300,
      "chg_pct": 1.32,
      "vol_lots": 40272,
      "vol_vs_ma5_pct": 32,
      "foreign_net_lots": 8811,
      "trust_net_lots": 1,
      "dealer_net_lots": 371,
      "rsi5": 63.3,
      "kd_k": 62.6,
      "macd_hist": -6.69,
      "vs_ma20_pct": 2.4,
      "news": []
    },
    {
      "id": "d_10",
      "date": "2026-05-28",
      "close": 2295,
      "chg_pct": -0.22,
      "vol_lots": 42313,
      "vol_vs_ma5_pct": 24,
      "foreign_net_lots": -7079,
      "trust_net_lots": 465,
      "dealer_net_lots": 466,
      "rsi5": 61.2,
      "kd_k": 62.7,
      "macd_hist": -5.85,
      "vs_ma20_pct": 1.9,
      "news": []
    },
    {
      "id": "d_11",
      "date": "2026-05-29",
      "close": 2355,
      "chg_pct": 2.61,
      "vol_lots": 104784,
      "vol_vs_ma5_pct": 111,
      "foreign_net_lots": 13284,
      "trust_net_lots": 349,
      "dealer_net_lots": 420,
      "rsi5": 74.3,
      "kd_k": 71.6,
      "macd_hist": -1.71,
      "vs_ma20_pct": 4.1,
      "news": []
    },
    {
      "id": "d_12",
      "date": "2026-06-01",
      "close": 2355,
      "chg_pct": 0,
      "vol_lots": 60943,
      "vol_vs_ma5_pct": 8,
      "foreign_net_lots": -3312,
      "trust_net_lots": 458,
      "dealer_net_lots": 922,
      "rsi5": 74.3,
      "kd_k": 72.4,
      "macd_hist": 0.45,
      "vs_ma20_pct": 3.9,
      "news": []
    },
    {
      "id": "d_13",
      "date": "2026-06-02",
      "close": 2380,
      "chg_pct": 1.06,
      "vol_lots": 41533,
      "vol_vs_ma5_pct": -28,
      "foreign_net_lots": 391,
      "trust_net_lots": -68,
      "dealer_net_lots": 462,
      "rsi5": 78.9,
      "kd_k": 75.5,
      "macd_hist": 2.85,
      "vs_ma20_pct": 4.7,
      "news": []
    },
    {
      "id": "d_14",
      "date": "2026-06-03",
      "close": 2425,
      "chg_pct": 1.89,
      "vol_lots": 29220,
      "vol_vs_ma5_pct": -48,
      "foreign_net_lots": -104,
      "trust_net_lots": 648,
      "dealer_net_lots": 227,
      "rsi5": 85,
      "kd_k": 81.3,
      "macd_hist": 6.54,
      "vs_ma20_pct": 6.2,
      "news": []
    },
    {
      "id": "d_15",
      "date": "2026-06-04",
      "close": 2385,
      "chg_pct": -1.65,
      "vol_lots": 32543,
      "vol_vs_ma5_pct": -40,
      "foreign_net_lots": -11256,
      "trust_net_lots": 538,
      "dealer_net_lots": 1099,
      "rsi5": 64.4,
      "kd_k": 76.8,
      "macd_hist": 5.41,
      "vs_ma20_pct": 4.3,
      "news": []
    },
    {
      "id": "d_16",
      "date": "2026-06-05",
      "close": 2365,
      "chg_pct": -0.84,
      "vol_lots": 43404,
      "vol_vs_ma5_pct": 5,
      "foreign_net_lots": -17840,
      "trust_net_lots": 2900,
      "dealer_net_lots": 517,
      "rsi5": 55.9,
      "kd_k": 69.8,
      "macd_hist": 2.59,
      "vs_ma20_pct": 3.3,
      "news": []
    },
    {
      "id": "d_17",
      "date": "2026-06-08",
      "close": 2295,
      "chg_pct": -2.96,
      "vol_lots": 52274,
      "vol_vs_ma5_pct": 31,
      "foreign_net_lots": -20465,
      "trust_net_lots": 730,
      "dealer_net_lots": -214,
      "rsi5": 35.5,
      "kd_k": 56.9,
      "macd_hist": -4.35,
      "vs_ma20_pct": 0.1,
      "news": []
    },
    {
      "id": "d_18",
      "date": "2026-06-09",
      "close": 2305,
      "chg_pct": 0.44,
      "vol_lots": 38848,
      "vol_vs_ma5_pct": -1,
      "foreign_net_lots": -15008,
      "trust_net_lots": 2660,
      "dealer_net_lots": -1254,
      "rsi5": 39.4,
      "kd_k": 49.8,
      "macd_hist": -8.39,
      "vs_ma20_pct": 0.4,
      "news": []
    },
    {
      "id": "d_19",
      "date": "2026-06-10",
      "close": 2255,
      "chg_pct": -2.17,
      "vol_lots": 54194,
      "vol_vs_ma5_pct": 22,
      "foreign_net_lots": -15543,
      "trust_net_lots": -4,
      "dealer_net_lots": -731,
      "rsi5": 28.5,
      "kd_k": 37.2,
      "macd_hist": -14.21,
      "vs_ma20_pct": -1.8,
      "news": []
    },
    {
      "id": "d_20",
      "date": "2026-06-11",
      "close": 2250,
      "chg_pct": -0.22,
      "vol_lots": 46418,
      "vol_vs_ma5_pct": -1,
      "foreign_net_lots": -4904,
      "trust_net_lots": 612,
      "dealer_net_lots": 2909,
      "rsi5": 27.6,
      "kd_k": 30.6,
      "macd_hist": -17.93,
      "vs_ma20_pct": -2,
      "news": []
    },
    {
      "id": "d_21",
      "date": "2026-06-12",
      "close": 2310,
      "chg_pct": 2.67,
      "vol_lots": 26307,
      "vol_vs_ma5_pct": -40,
      "foreign_net_lots": 3927,
      "trust_net_lots": -149,
      "dealer_net_lots": -181,
      "rsi5": 51.8,
      "kd_k": 34.9,
      "macd_hist": -15.96,
      "vs_ma20_pct": 0.5,
      "news": []
    },
    {
      "id": "d_22",
      "date": "2026-06-15",
      "close": 2375,
      "chg_pct": 2.81,
      "vol_lots": 30229,
      "vol_vs_ma5_pct": -23,
      "foreign_net_lots": 9647,
      "trust_net_lots": 86,
      "dealer_net_lots": 107,
      "rsi5": 66.8,
      "kd_k": 47.2,
      "macd_hist": -10.17,
      "vs_ma20_pct": 3,
      "news": []
    },
    {
      "id": "d_23",
      "date": "2026-06-16",
      "close": 2400,
      "chg_pct": 1.05,
      "vol_lots": 37146,
      "vol_vs_ma5_pct": -4,
      "foreign_net_lots": -382,
      "trust_net_lots": 3849,
      "dealer_net_lots": -158,
      "rsi5": 71.1,
      "kd_k": 62.3,
      "macd_hist": -4.81,
      "vs_ma20_pct": 3.7,
      "news": []
    },
    {
      "id": "d_24",
      "date": "2026-06-17",
      "close": 2385,
      "chg_pct": -0.62,
      "vol_lots": 30059,
      "vol_vs_ma5_pct": -12,
      "foreign_net_lots": -6877,
      "trust_net_lots": -317,
      "dealer_net_lots": 895,
      "rsi5": 64.8,
      "kd_k": 71.5,
      "macd_hist": -2.55,
      "vs_ma20_pct": 2.6,
      "news": []
    },
    {
      "id": "d_25",
      "date": "2026-06-18",
      "close": 2410,
      "chg_pct": 1.05,
      "vol_lots": 49983,
      "vol_vs_ma5_pct": 44,
      "foreign_net_lots": 7516,
      "trust_net_lots": -7268,
      "dealer_net_lots": 37,
      "rsi5": 70.3,
      "kd_k": 80.2,
      "macd_hist": 0.21,
      "vs_ma20_pct": 3.3,
      "news": []
    },
    {
      "id": "d_26",
      "date": "2026-06-22",
      "close": 2510,
      "chg_pct": 4.15,
      "vol_lots": 45208,
      "vol_vs_ma5_pct": 17,
      "foreign_net_lots": 14361,
      "trust_net_lots": -202,
      "dealer_net_lots": 1146,
      "rsi5": 83.3,
      "kd_k": 86.8,
      "macd_hist": 7.92,
      "vs_ma20_pct": 7,
      "news": []
    },
    {
      "id": "d_27",
      "date": "2026-06-23",
      "close": 2490,
      "chg_pct": -0.8,
      "vol_lots": 39538,
      "vol_vs_ma5_pct": -2,
      "foreign_net_lots": -2726,
      "trust_net_lots": 165,
      "dealer_net_lots": 1192,
      "rsi5": 75.1,
      "kd_k": 86.6,
      "macd_hist": 10.66,
      "vs_ma20_pct": 5.7,
      "news": []
    },
    {
      "id": "d_28",
      "date": "2026-06-24",
      "close": 2390,
      "chg_pct": -4.02,
      "vol_lots": 67304,
      "vol_vs_ma5_pct": 45,
      "foreign_net_lots": -38450,
      "trust_net_lots": 658,
      "dealer_net_lots": 1078,
      "rsi5": 46.4,
      "kd_k": 76.2,
      "macd_hist": 5,
      "vs_ma20_pct": 1.2,
      "news": []
    },
    {
      "id": "d_29",
      "date": "2026-06-25",
      "close": 2390,
      "chg_pct": 0,
      "vol_lots": 41100,
      "vol_vs_ma5_pct": -15,
      "foreign_net_lots": -6104,
      "trust_net_lots": 179,
      "dealer_net_lots": -310,
      "rsi5": 46.4,
      "kd_k": 64.4,
      "macd_hist": 0.76,
      "vs_ma20_pct": 1,
      "news": []
    },
    {
      "id": "d_30",
      "date": "2026-06-26",
      "close": 2340,
      "chg_pct": -2.09,
      "vol_lots": 53800,
      "vol_vs_ma5_pct": 9,
      "foreign_net_lots": -14281,
      "trust_net_lots": 734,
      "dealer_net_lots": 1009,
      "rsi5": 35.8,
      "kd_k": 45.3,
      "macd_hist": -5.58,
      "vs_ma20_pct": -1.2,
      "news": []
    },
    {
      "id": "d_31",
      "date": "2026-06-29",
      "close": 2370,
      "chg_pct": 1.28,
      "vol_lots": 38134,
      "vol_vs_ma5_pct": -21,
      "foreign_net_lots": -1912,
      "trust_net_lots": 919,
      "dealer_net_lots": 997,
      "rsi5": 45.2,
      "kd_k": 37.4,
      "macd_hist": -7.77,
      "vs_ma20_pct": 0,
      "news": []
    },
    {
      "id": "d_32",
      "date": "2026-06-30",
      "close": 2410,
      "chg_pct": 1.69,
      "vol_lots": 49540,
      "vol_vs_ma5_pct": -1,
      "foreign_net_lots": -1426,
      "trust_net_lots": -90,
      "dealer_net_lots": 652,
      "rsi5": 56,
      "kd_k": 38.4,
      "macd_hist": -6.6,
      "vs_ma20_pct": 1.6,
      "news": []
    },
    {
      "id": "d_33",
      "date": "2026-07-01",
      "close": 2505,
      "chg_pct": 3.94,
      "vol_lots": 37544,
      "foreign_net_lots": 7400,
      "trust_net_lots": 4743,
      "dealer_net_lots": -386,
      "rsi5": 72.2,
      "kd_k": 54.2,
      "macd_hist": 0.15,
      "vs_ma20_pct": 5.3,
      "news": [
        "nw_02",
        "nw_03",
        "nw_04"
      ],
      "vol_vs_ma5_pct": -15
    },
    {
      "id": "d_34",
      "date": "2026-07-02",
      "close": 2465,
      "chg_pct": -1.6,
      "vol_lots": 35919,
      "foreign_net_lots": -12254,
      "trust_net_lots": 1026,
      "dealer_net_lots": 217,
      "rsi5": 60.5,
      "kd_k": 58.3,
      "macd_hist": 1.42,
      "vs_ma20_pct": 3.6,
      "news": [
        "nw_01"
      ],
      "vol_vs_ma5_pct": -16
    },
    {
      "id": "d_35",
      "date": "2026-07-03",
      "close": 2445,
      "chg_pct": -0.81,
      "vol_lots": 32906,
      "foreign_net_lots": -12537,
      "trust_net_lots": 821,
      "dealer_net_lots": 653,
      "rsi5": 54.9,
      "kd_k": 57.9,
      "macd_hist": 0.47,
      "vs_ma20_pct": 2.6,
      "news": [],
      "vol_vs_ma5_pct": -15
    },
    {
      "id": "d_36",
      "date": "2026-07-06",
      "close": 2460,
      "chg_pct": 0.61,
      "vol_lots": 21042,
      "foreign_net_lots": -241,
      "trust_net_lots": 380,
      "dealer_net_lots": 119,
      "rsi5": 58.5,
      "kd_k": 63.6,
      "macd_hist": 0.4,
      "vs_ma20_pct": 3,
      "news": [],
      "vol_vs_ma5_pct": -41
    },
    {
      "id": "d_37",
      "date": "2026-07-07",
      "close": 2440,
      "chg_pct": -0.81,
      "vol_lots": 31401,
      "vol_vs_ma5_pct": -1,
      "foreign_net_lots": 83,
      "trust_net_lots": 539,
      "dealer_net_lots": -237,
      "rsi5": 51.6,
      "kd_k": 63.7,
      "macd_hist": -1.34,
      "vs_ma20_pct": 1.9,
      "news": []
    },
    {
      "id": "d_38",
      "date": "2026-07-08",
      "close": 2465,
      "chg_pct": 1.02,
      "vol_lots": 25520,
      "vol_vs_ma5_pct": -13,
      "foreign_net_lots": -4155,
      "trust_net_lots": 730,
      "dealer_net_lots": 468,
      "rsi5": 59.1,
      "kd_k": 68.4,
      "macd_hist": -1.17,
      "vs_ma20_pct": 2.6,
      "news": []
    },
    {
      "id": "d_39",
      "date": "2026-07-09",
      "close": 2415,
      "chg_pct": -2.03,
      "vol_lots": 34681,
      "vol_vs_ma5_pct": 19,
      "foreign_net_lots": -12749,
      "trust_net_lots": 43,
      "dealer_net_lots": 90,
      "rsi5": 42.6,
      "kd_k": 61.8,
      "macd_hist": -4.59,
      "vs_ma20_pct": 0.2,
      "news": [
        "nw_05"
      ]
    },
    {
      "id": "d_40",
      "date": "2026-07-13",
      "close": 2440,
      "chg_pct": 1.04,
      "vol_lots": 35310,
      "vol_vs_ma5_pct": 19,
      "foreign_net_lots": -2045,
      "trust_net_lots": 530,
      "dealer_net_lots": 623,
      "rsi5": 51.1,
      "kd_k": 51.7,
      "macd_hist": -5.28,
      "vs_ma20_pct": 0.8,
      "news": []
    }
  ],
  "long_term_anchor": [
    {
      "id": "lt_01",
      "field": "high_1y",
      "date": "2026-06-22",
      "value": 2510
    },
    {
      "id": "lt_02",
      "field": "low_1y",
      "date": "2025-07-14",
      "value": 1095
    },
    {
      "id": "lt_03",
      "field": "close_pos_in_1y_pct",
      "date": "2026-07-13",
      "value": 95.1
    },
    {
      "id": "lt_04",
      "field": "vs_ma60_pct",
      "date": "2026-07-13",
      "value": 6.1
    },
    {
      "id": "lt_05",
      "field": "vs_ma240_pct",
      "date": "2026-07-13",
      "value": 42.9
    }
  ],
  "fundamental": [
    {
      "id": "fd_01",
      "field": "eps",
      "period": "2026Q1",
      "date": "2026-03-31",
      "value": 22.08,
      "qoq_pct": 13.2,
      "yoy_pct": 58.3,
      "last4q": [
        [
          "2025Q2",
          15.36
        ],
        [
          "2025Q3",
          17.44
        ],
        [
          "2025Q4",
          19.51
        ],
        [
          "2026Q1",
          22.08
        ]
      ]
    },
    {
      "id": "fd_02",
      "field": "gross_margin_pct",
      "period": "2026Q1",
      "date": "2026-03-31",
      "value": 66.2
    },
    {
      "id": "fd_03",
      "field": "operating_margin_pct",
      "period": "2026Q1",
      "date": "2026-03-31",
      "value": 58.1
    },
    {
      "id": "fd_04",
      "field": "revenue_monthly",
      "period": "2026-06",
      "value": 442679969000,
      "yoy_pct": 67.9,
      "mom_pct": 6.2,
      "yoy_last6": [
        [
          "2026-01",
          36.8
        ],
        [
          "2026-02",
          22.2
        ],
        [
          "2026-03",
          45.2
        ],
        [
          "2026-04",
          17.5
        ],
        [
          "2026-05",
          30.1
        ],
        [
          "2026-06",
          67.9
        ]
      ]
    },
    {
      "id": "fd_05",
      "field": "revenue_yoy_positive_streak",
      "period": "2026-06",
      "value": 14
    },
    {
      "id": "fd_06",
      "field": "per",
      "date": "2026-07-13",
      "value": 32.8,
      "pct_rank_1y": 91
    },
    {
      "id": "fd_07",
      "field": "pbr",
      "date": "2026-07-13",
      "value": 10.74,
      "pct_rank_1y": 94
    },
    {
      "id": "fd_08",
      "field": "dividend_yield",
      "date": "2026-07-13",
      "value": 0.9,
      "pct_rank_1y": 5
    }
  ],
  "news": [
    {
      "id": "nw_01",
      "field": "news",
      "date": "2026-07-02",
      "kind": "general",
      "title": "〈台股開盤〉逾千跌點回測4萬6後跌幅收斂 機器人、無人機聯歡齊嗨",
      "value": "美股今日凌晨收盤部分，道瓊下跌 13.96 點或 0.03%，收報 52,305.24 點；標普 500 下跌 16.13 點或 0.22%，收 7,483.23 點；那斯達克下跌 173.69 點或 0.66%，收 26,040.03 點；費城重跌 893.68 點或 6.27%，收 13,353.28 點。"
    },
    {
      "id": "nw_02",
      "field": "news",
      "date": "2026-07-01",
      "kind": "general",
      "title": "盤中速報 - 集中市場加權指數上漲946.67點至47072.58點，漲幅2.05%",
      "value": "截至台北時間01日11:29，集中市場加權指數上漲946.67點（或2.05%），暫報47072.58點。 歷史漲跌幅 近 1 週：-2.07%近 1 月：+3.11%近 3 月：+41.85%近 6 月：+60.68%今年以來：+59.25%焦點個股 18吋晶圓概念領漲+4.67%。其中 盟立(2464-TW) 上漲 9.83% ; 家登(3680-TW) 上漲 8.27% ; 台積電(2330-TW) 上漲 3.32% 。 自動化概念股概念領漲+4.66%。其中 盟立(2464-TW) 上漲 9.83% ; 泓格(3577-TW) 上漲 9.7% ; 德律(3030-TW) 上漲 7.94% 。"
    },
    {
      "id": "nw_03",
      "field": "news",
      "date": "2026-07-01",
      "kind": "general",
      "title": "盤中速報 - 集中市場加權指數上漲925.03點至47050.94點，漲幅2.01%",
      "value": "截至台北時間01日11:36，集中市場加權指數上漲925.03點（或2.01%），暫報47050.94點。 歷史漲跌幅 近 1 週：-2.07%近 1 月：+3.11%近 3 月：+41.85%近 6 月：+60.68%今年以來：+59.25%焦點個股 18吋晶圓概念領漲+5.08%。其中 盟立(2464-TW) 上漲 9.83% ; 家登(3680-TW) 上漲 9.06% ; 台積電(2330-TW) 上漲 3.32% 。 自動化概念股概念領漲+4.74%。其中 盟立(2464-TW) 上漲 9.83% ; 泓格(3577-TW) 上漲 9.7% ; 德律(3030-TW) 上漲 7.94% 。"
    },
    {
      "id": "nw_04",
      "field": "news",
      "date": "2026-07-01",
      "kind": "general",
      "title": "盤中速報 - 集中市場加權指數上漲934.47點至47060.38點，漲幅2.03%",
      "value": "截至台北時間01日11:47，集中市場加權指數上漲934.47點（或2.03%），暫報47060.38點。 歷史漲跌幅 近 1 週：-2.07%近 1 月：+3.11%近 3 月：+41.85%近 6 月：+60.68%今年以來：+59.25%焦點個股 18吋晶圓概念領漲+5.08%。其中 盟立(2464-TW) 上漲 9.83% ; 家登(3680-TW) 上漲 9.06% ; 台積電(2330-TW) 上漲 3.32% 。 自動化概念股概念領漲+4.74%。其中 盟立(2464-TW) 上漲 9.83% ; 泓格(3577-TW) 上漲 9.7% ; 德律(3030-TW) 上漲 7.94% 。"
    },
    {
      "id": "nw_05",
      "field": "news",
      "date": "2026-07-09",
      "kind": "general",
      "title": "外資賣超471億元連6賣 光是台積電就提款310億元",
      "value": "資深證券分析師簡伯儀指出，台股集中市場近期出現量能萎縮格局，而在大型颱風巴威逼近同時，更使得買盤縮手，甚至買了也不敢貿然留倉，預判近期台股將維持在震盪格局，但必須留意市場量能否向上擴張。"
    }
  ],
  "missing_fields": []
};
