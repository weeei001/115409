from dataclasses import dataclass
import re

from pydantic import ValidationError

from app.features.news.sentiment import (
    TAIPEI_TZ, SentimentOutput, clean_text, company_catalog, compute_input_hash, parse_news_pub_time,
)


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


def estimate_token_count(text: str) -> int:
    if not text:
        return 0
    cjk = len(re.findall(r"[\u4e00-\u9fff\u3400-\u4dbf]", text))
    return int(cjk * 1.3 + (len(text) - cjk) * 0.4) + 10


@dataclass
class ValidationResult:
    is_valid: bool
    error_message: str | None = None
    output: SentimentOutput | None = None


def validate_sentiment_payload(payload, *, cleaned_title: str, cleaned_content: str) -> ValidationResult:
    try:
        output = SentimentOutput.model_validate(payload)
    except ValidationError as exc:
        return ValidationResult(False, "; ".join(error["msg"] for error in exc.errors(include_input=False)))
    for evidence in output.evidence:
        original = cleaned_title if evidence.field == "title" else cleaned_content
        if evidence.quote not in original:
            return ValidationResult(False, f"Evidence quote does not appear in {evidence.field}")
    return ValidationResult(True, output=output)
