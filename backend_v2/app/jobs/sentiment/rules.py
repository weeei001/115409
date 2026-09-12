from dataclasses import dataclass
import re

from pydantic import ValidationError

from app.features.news.sentiment import (
    TAIPEI_TZ, SentimentOutput, TARGET_STOCKS, clean_text, compute_input_hash, parse_news_pub_time,
)


def extract_candidate_stocks(stock_id: str | None, tags: str | None) -> list[str]:
    result = []
    for candidate in ([stock_id] if stock_id else []) + (tags.split(",") if tags else []):
        symbol = re.sub(r"\.TW$", "", candidate.strip(), flags=re.IGNORECASE).strip()
        if symbol in TARGET_STOCKS and symbol not in result:
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
