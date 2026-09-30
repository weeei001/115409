"""Pure sentiment contract shared by the news API and the standalone batch worker."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import html
import json
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .prompts import SYSTEM_PROMPT


ARTICLE_TARGET = "__article__"
LEGACY_STOCK_NAMES = {"2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2408": "南亞科", "2881": "富邦金", "2615": "萬海"}
PROMPT_VERSION = "v1.0"
ANALYSIS_INSTRUCTION = ("For target_stock_id='__article__', judge the overall financial event in this article, "
    "including benefits and harms to different parties; do not average company labels. "
    "For a company target, set related=false and label=insufficient when the article does not clearly refer "
    "to that listed company (including ambiguous common words, namesakes and group companies). "
    "Otherwise set related=true. Quote only exact text from title or content. "
    "A title-only article can be judged with title evidence when sufficiently clear; mention the limited source in reason.")
NORMALIZATION_VERSION = "norm_v1"
COMPANY_RECOGNITION_VERSION = "mentions-v1"
# ponytail: known ambiguous words require tickers; expand from labeled errors, not guessed matches.
AMBIGUOUS_COMPANY_NAMES = {"世界", "大量", "精確", "進階", "安心", "全新", "聯合", "中華", "大眾", "統一"}
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
    for mention in company_mentions(title, content, catalog):
        if mention["symbol"] not in result:
            result.append(mention["symbol"])
    return result


@lru_cache(maxsize=8192)
def _company_name_pattern(name: str):
    # Keep catalog patterns outside re's small shared cache.
    pattern = re.escape(name)
    if name.isascii():
        pattern = r"(?<![A-Za-z0-9])" + pattern + r"(?![A-Za-z0-9])"
    return re.compile(pattern, re.IGNORECASE)


def company_mentions(title: str | None, content: str | None, catalog: dict) -> list[dict]:
    """Resolve overlapping names at each position without hiding separate mentions."""
    names: dict[str, set[str]] = {}
    for symbol, company in catalog.items():
        for name in [company.get("name"), *(company.get("aliases") or [])]:
            if isinstance(name, str) and len(name.strip()) >= 2:
                names.setdefault(name.strip(), set()).add(symbol)
    mentions = []
    for field, text in (("title", title or ""), ("content", content or "")):
        candidates = []
        for name, symbols in names.items():
            if len(symbols) != 1 or name in AMBIGUOUS_COMPANY_NAMES:
                continue
            for match in _company_name_pattern(name).finditer(text):
                candidates.append({"symbol": next(iter(symbols)), "field": field,
                    "start": match.start(), "end": match.end(), "kind": "name"})
        occupied = []
        for candidate in sorted(candidates, key=lambda item: (-(item["end"] - item["start"]), item["start"])):
            if any(candidate["start"] < end and start < candidate["end"] for start, end in occupied):
                continue
            occupied.append((candidate["start"], candidate["end"]))
            mentions.append(candidate)
        for match in re.finditer(r"(?<!\d)(\d{4,6})[.-](?:TWO|TW)\b|[（(]\s*(\d{4,6})\s*[）)]", text, re.IGNORECASE):
            group = 1 if match.group(1) else 2
            symbol = match.group(group)
            if symbol in catalog:
                mentions = [mention for mention in mentions if not (
                    mention["field"] == field and mention["kind"] == "name"
                    and mention["symbol"] != symbol and mention["end"] <= match.start(group)
                    and re.fullmatch(r"[\s（(]*", text[mention["end"]:match.start(group)]))]
                mentions.append({"symbol": symbol, "field": field, "start": match.start(group),
                                 "end": match.end(group), "kind": "ticker"})
    return sorted(mentions, key=lambda item: (item["field"] != "title", item["start"], item["kind"] != "ticker"))


def clean_text(raw_text: str | None) -> str:
    text = re.sub(r"<[^>]+>", "", html.unescape(raw_text or ""), flags=re.IGNORECASE)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(re.sub(r"[^\S\r\n]+", " ", line).strip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def source_quote_span(raw_text: str | None, quote: str) -> tuple[int, int] | None:
    """Match cleaned text while retaining offsets into the unmodified source."""
    raw = raw_text or ""
    normalized, offsets = [], []
    for token in re.finditer(r"<[^>]+>|&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z]+);|\s+|.", raw, re.DOTALL):
        value = token.group()
        if value.startswith("<") and value.endswith(">"):
            continue
        for char in html.unescape(value):
            if char.isspace():
                if normalized and normalized[-1] == " ":
                    offsets[-1] = (offsets[-1][0], token.end())
                    continue
                char = " "
            normalized.append(char)
            offsets.append((token.start(), token.end()))
    needle = re.sub(r"\s+", " ", clean_text(quote)).strip()
    start = "".join(normalized).find(needle) if needle else -1
    return None if start < 0 else (offsets[start][0], offsets[start + len(needle) - 1][1])


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


def estimate_token_count(text: str) -> int:
    if not text:
        return 0
    cjk = len(re.findall(r"[\u4e00-\u9fff\u3400-\u4dbf]", text))
    return int(cjk * 1.3 + (len(text) - cjk) * 0.4) + 10


def analysis_content_window(content: str) -> str:
    """Bound input while keeping closing revisions; omitted middle stays explicit."""
    if estimate_token_count(content) <= 4500:
        return content
    low, high = 0, len(content) // 2
    while low < high:
        middle = (low + high + 1) // 2
        sample = content[:middle] + "\n[... omitted middle ...]\n" + content[-middle:]
        if estimate_token_count(sample) <= 4500:
            low = middle
        else:
            high = middle - 1
    return content[:low] + "\n[... omitted middle ...]\n" + content[-low:]
