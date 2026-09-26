"""Pure sentiment contract shared by the news API and the standalone batch worker."""
from datetime import datetime, timedelta, timezone
import hashlib
import html
import json
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .prompts import SYSTEM_PROMPT


ARTICLE_TARGET = "__article__"
LEGACY_STOCK_NAMES = {"2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2408": "南亞科", "2881": "富邦金", "2615": "萬海"}
PROMPT_VERSION = "v3.0"
ANALYSIS_INSTRUCTION = ("For target_stock_id='__article__', judge the overall financial event in this article, "
    "including benefits and harms to different parties; do not average company labels. "
    "For a company target, set related=false and label=insufficient when the article does not clearly refer "
    "to that listed company (including ambiguous common words, namesakes and group companies). "
    "Otherwise set related=true. Quote only exact text from title or content. "
    "A title-only article can be judged with title evidence when sufficiently clear; mention the limited source in reason.")
NORMALIZATION_VERSION = "norm_v1"
MAX_INPUT_TOKENS = 8000
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    field: Literal["title", "content"]
    quote: ShortText


class SentimentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    label: Literal["positive", "negative", "neutral", "mixed", "insufficient"]
    reason: ShortText
    evidence: list[Evidence] = Field(max_length=2)
    related: bool = True

    @model_validator(mode="after")
    def evidence_count_matches_label(self):
        if not self.related and self.label != "insufficient":
            raise ValueError("unrelated company requires insufficient label")
        if self.label == "mixed" and len(self.evidence) != 2:
            raise ValueError("mixed requires exactly two evidence quotes")
        if self.label in {"positive", "negative", "neutral"} and not self.evidence:
            raise ValueError("positive, negative and neutral require evidence")
        return self


def active_config_hash(settings) -> str:
    configuration = {
        "model": settings.LLM_MODEL, "prompt_version": PROMPT_VERSION,
        "normalization_version": NORMALIZATION_VERSION, "system_prompt": SYSTEM_PROMPT,
        "analysis_instruction": ANALYSIS_INSTRUCTION,
        "schema_definition": SentimentOutput.model_json_schema(),
        "generation_params": {"max_completion_tokens": settings.LLM_MAX_TOKENS,
            "temperature": settings.LLM_TEMPERATURE, "response_format": settings.LLM_RESPONSE_FORMAT,
            "base_url": settings.LLM_BASE_URL, "timeout_seconds": settings.LLM_TIMEOUT_SECONDS,
            "max_retries": 0, "streaming": False},
    }
    serialized = json.dumps(configuration, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


TAIPEI_TZ = timezone(timedelta(hours=8))


def company_catalog():
    from app.features.market.company_catalog import load_catalog
    return load_catalog()


def extract_candidate_stocks(stock_id: str | None, tags: str | None, title: str | None = None,
                             content: str | None = None, catalog=None) -> list[str]:
    if catalog is None:
        catalog = company_catalog()
    result = []
    for candidate in ([stock_id] if stock_id else []) + (tags.split(",") if tags else []):
        symbol = re.sub(r"\.(?:TW|TWO)$", "", candidate.strip(), flags=re.IGNORECASE).strip()
        if symbol in catalog and symbol not in result:
            result.append(symbol)
    text = "\n".join((title or "", content or ""))
    if text:
        names = {}
        for symbol, company in catalog.items():
            for name in [company.get("name"), *(company.get("aliases") or [])]:
                if isinstance(name, str) and len(name.strip()) >= 2:
                    names.setdefault(name.strip(), set()).add(symbol)
        for name, symbols in names.items():
            search_text = (title or "") if len(name) == 2 else text
            if len(symbols) == 1 and name in search_text:
                symbol = next(iter(symbols))
                if symbol not in result:
                    result.append(symbol)
        for match in re.finditer(r"(?<!\d)(\d{4,6})\.(?:TW|TWO)\b", text, flags=re.IGNORECASE):
            symbol = match.group(1)
            if symbol in catalog and symbol not in result:
                result.append(symbol)
    return result


def clean_text(raw_text: str | None) -> str:
    text = re.sub(r"<[^>]+>", "", html.unescape(raw_text or ""), flags=re.IGNORECASE)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(re.sub(r"[^\S\r\n]+", " ", line).strip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_news_pub_time(value: str | None) -> tuple[datetime | None, str]:
    if not value or not value.strip():
        return None, ""
    try:
        timestamp = datetime.fromisoformat(value.strip())
    except ValueError:
        timestamp = None
        for format_string in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d",
                              "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                timestamp = datetime.strptime(value.strip(), format_string)
                break
            except ValueError:
                continue
    if timestamp is None:
        return None, ""
    timestamp = timestamp.replace(tzinfo=TAIPEI_TZ) if timestamp.tzinfo is None else timestamp.astimezone(TAIPEI_TZ)
    return timestamp, timestamp.isoformat()


def compute_input_hash(*, cleaned_title: str, cleaned_content: str, pub_time_str: str,
                       target_stock_id: str, target_stock_name: str) -> str:
    data = {"content": cleaned_content, "normalization_version": NORMALIZATION_VERSION,
            "pub_time": pub_time_str, "target_stock_id": target_stock_id,
            "target_stock_name": target_stock_name, "title": cleaned_title}
    serialized = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def article_input_hash(article, symbol: str, catalog=None) -> str | None:
    if catalog is None:
        catalog = company_catalog()
    name = "" if symbol == ARTICLE_TARGET else (catalog.get(symbol) or {}).get("name") or LEGACY_STOCK_NAMES.get(symbol)
    if name is None:
        return None
    canonical_time = parse_news_pub_time(article.pub_time)[1]
    return compute_input_hash(cleaned_title=clean_text(article.title), cleaned_content=clean_text(article.content),
        pub_time_str=canonical_time or (article.pub_time or "").strip(),
        target_stock_id=symbol, target_stock_name=name)
