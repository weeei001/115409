from __future__ import annotations

from typing import Final

# 目標股票與公司名稱對照（規格第 2 節）
TARGET_STOCKS: Final[dict[str, str]] = {
    "2330": "台積電",
    "2317": "鴻海",
    "2454": "聯發科",
    "2408": "南亞科",
    "2881": "富邦金",
    "2615": "萬海",
}

# 五類情緒定義（規格第 5.2 節）
LABEL_POSITIVE: Final[str] = "positive"
LABEL_NEGATIVE: Final[str] = "negative"
LABEL_NEUTRAL: Final[str] = "neutral"
LABEL_MIXED: Final[str] = "mixed"
LABEL_INSUFFICIENT: Final[str] = "insufficient"

ALLOWED_LABELS: Final[set[str]] = {
    LABEL_POSITIVE,
    LABEL_NEGATIVE,
    LABEL_NEUTRAL,
    LABEL_MIXED,
    LABEL_INSUFFICIENT,
}

# 標籤顯示文字對照
LABEL_DISPLAY_NAMES: Final[dict[str, str]] = {
    LABEL_POSITIVE: "正面",
    LABEL_NEGATIVE: "負面",
    LABEL_NEUTRAL: "中性",
    LABEL_MIXED: "正負混合",
    LABEL_INSUFFICIENT: "資訊不足",
}

# 預定模型與 Prompt 版本
DEFAULT_MODEL: Final[str] = "gpt-5.6-luna"
PROMPT_VERSION: Final[str] = "v1.0"
NORMALIZATION_VERSION: Final[str] = "norm_v1"

# 價格設定（每百萬 tokens 美元，規格第 7 節假設價格）
INPUT_PRICE_PER_M: Final[float] = 0.20
OUTPUT_PRICE_PER_M: Final[float] = 1.20

# 限制與上限
MAX_INPUT_TOKENS: Final[int] = 8000
MAX_COMPLETION_TOKENS: Final[int] = 1024
DEFAULT_API_TIMEOUT_SECONDS: Final[int] = 60
DEFAULT_MAX_RETRIES_PER_PAIR: Final[int] = 2
MAX_CONSECUTIVE_FAILURES: Final[int] = 3

# 長度規範
MAX_REASON_CHARACTERS: Final[int] = 80
MAX_QUOTE_CHARACTERS: Final[int] = 80
