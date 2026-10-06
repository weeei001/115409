"""Company recognition and news text helpers shared by the news API, retrieval and impact workers."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import html
import re

from app.features.market.company_catalog import company_aliases


# Supplemental catalog aliases change evidence recognition and cached impact eligibility.
COMPANY_RECOGNITION_VERSION = "mentions-v4"
# ponytail: known ambiguous words require tickers; expand from labeled errors, not guessed matches.
AMBIGUOUS_COMPANY_NAMES = {"世界", "大量", "精確", "進階", "安心", "全新", "聯合", "中華", "大眾", "統一", "三星"}
TAIWAN_MARKETS = {"TW", "TWSE", "TPEX", "TWS", "TWO"}
QUALIFIED_TICKER = re.compile(
    r"(?<![A-Za-z0-9])(?:(?P<prefix>[A-Za-z][A-Za-z0-9]{1,8})\s*:\s*(?P<prefix_symbol>\d{4,6})"
    r"|(?P<suffix_symbol>\d{4,6})[.-](?P<suffix>[A-Za-z][A-Za-z0-9]{1,8}))\b"
    r"|[（(]\s*(?P<bare_symbol>\d{4,6})\s*[）)]", re.IGNORECASE)


def local_stock_symbol(value: str) -> str | None:
    identifier = value.strip()
    if re.fullmatch(r"\d{4,6}", identifier):
        return identifier
    match = QUALIFIED_TICKER.fullmatch(identifier)
    if match and (match["prefix"] or match["suffix"] or "").upper() in TAIWAN_MARKETS:
        return match["prefix_symbol"] or match["suffix_symbol"]
    return None


TAIPEI_TZ = timezone(timedelta(hours=8))


def company_catalog():
    from app.features.market.company_catalog import load_catalog
    return load_catalog()


def extract_candidate_stocks(stock_id: str | None, tags: str | None, title: str | None = None,
                             content: str | None = None, catalog=None) -> list[str]:
    if catalog is None:
        catalog = company_catalog()
    mentions, rejected = _company_references(title, content, catalog)
    mentioned_symbols = {mention["symbol"] for mention in mentions}
    result = []
    for candidate in ([stock_id] if stock_id else []) + (tags.split(",") if tags else []):
        symbol = local_stock_symbol(candidate)
        if symbol in catalog and symbol not in result and (symbol not in rejected or symbol in mentioned_symbols):
            result.append(symbol)
    for mention in mentions:
        if mention["symbol"] not in result:
            result.append(mention["symbol"])
    return result


def safe_stock_metadata(stock_id: str | None, tags: str | None, title: str | None,
                        content: str | None, catalog: dict) -> dict:
    """Hide contradicted legacy tags in responses without changing saved source data."""
    mentions, rejected = _company_references(title, content, catalog)
    rejected -= {mention["symbol"] for mention in mentions}
    safe_stock = None if stock_id and local_stock_symbol(stock_id) in rejected else stock_id
    safe_tags = tags
    if tags and any(local_stock_symbol(item) in rejected for item in tags.split(",")):
        safe_tags = ",".join(item for item in tags.split(",") if local_stock_symbol(item) not in rejected) or None
    return {"stock_id": safe_stock, "tags": safe_tags}


@lru_cache(maxsize=8192)
def _company_name_pattern(name: str):
    # Keep catalog patterns outside re's small shared cache.
    pattern = re.escape(name)
    if name.isascii():
        pattern = r"(?<![A-Za-z0-9])" + pattern + r"(?![A-Za-z0-9])"
    return re.compile(pattern, re.IGNORECASE)


def company_mentions(title: str | None, content: str | None, catalog: dict) -> list[dict]:
    """Resolve overlapping names at each position without hiding separate mentions."""
    return _company_references(title, content, catalog)[0]


def _company_references(title: str | None, content: str | None, catalog: dict) -> tuple[list[dict], set[str]]:
    names: dict[str, set[str]] = {}
    for symbol, company in catalog.items():
        for name in company_aliases(symbol, company):
            if isinstance(name, str) and len(name.strip()) >= 2:
                names.setdefault(name.strip(), set()).add(symbol)
    mentions, rejected = [], set()
    for field, text in (("title", title or ""), ("content", content or "")):
        candidates = []
        for name, symbols in names.items():
            if len(symbols) != 1:
                continue
            for match in _company_name_pattern(name).finditer(text):
                symbol = next(iter(symbols))
                if name in AMBIGUOUS_COMPANY_NAMES:
                    rejected.add(symbol)
                    continue
                candidates.append({"symbol": symbol, "field": field,
                    "start": match.start(), "end": match.end(), "kind": "name"})
        occupied = []
        for candidate in sorted(candidates, key=lambda item: (-(item["end"] - item["start"]), item["start"])):
            if any(candidate["start"] < end and start < candidate["end"] for start, end in occupied):
                continue
            occupied.append((candidate["start"], candidate["end"]))
            mentions.append(candidate)
        for match in QUALIFIED_TICKER.finditer(text):
            group = "prefix_symbol" if match["prefix_symbol"] else "suffix_symbol" if match["suffix_symbol"] else "bare_symbol"
            qualifier = (match["prefix"] or match["suffix"] or "").upper()
            symbol = match[group] if not qualifier or qualifier in TAIWAN_MARKETS else None
            if not qualifier and symbol not in catalog:
                continue
            # An explicit identifier overrides the nearby name, including foreign markets.
            contradicted = [mention for mention in mentions if (
                mention["field"] == field and mention["kind"] == "name"
                and mention["symbol"] != symbol and mention["end"] <= match.start()
                and re.fullmatch(r"[\s（(]*", text[mention["end"]:match.start()]))]
            rejected.update(mention["symbol"] for mention in contradicted)
            mentions = [mention for mention in mentions if mention not in contradicted]
            if symbol in catalog:
                mentions.append({"symbol": symbol, "field": field, "start": match.start(group),
                                 "end": match.end(group), "kind": "ticker"})
    return sorted(mentions, key=lambda item: (item["field"] != "title", item["start"], item["kind"] != "ticker")), rejected


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
