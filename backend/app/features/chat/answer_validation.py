"""Validate complete model answers and bind numeric checks to cited evidence."""
import re
from urllib.parse import quote, urlsplit

from app.core.errors import ServiceUnavailable

from app.features.market.company_catalog import company_aliases

from .claims import _normalize, unsupported_numeric_claim
from .proposals import plan_supported
from .prompts import INSUFFICIENT_EVIDENCE_ANSWER
from .schemas import SourceChunk


def _is_insufficient_only(raw_text: str) -> bool:
    without_citations = re.sub(r"\s*\[S[1-9][0-9]*\]", "", raw_text).strip()
    return without_citations == INSUFFICIENT_EVIDENCE_ANSWER


class AnswerValidationError(ServiceUnavailable):
    reason = "invalid_answer"


class CitationValidationError(AnswerValidationError):
    reason = "citations"


class NumericValidationError(CitationValidationError):
    reason = "numbers"

    def __init__(self, detail, *, claim: str = ""):
        super().__init__(detail)
        # Recovery prompt only; HTTP handlers serialize detail, never the rejected prose.
        self.claim = claim


class EmptyAnswerError(AnswerValidationError):
    reason = "empty"


class TruncatedAnswerError(AnswerValidationError):
    reason = "length"


NUMERIC_RECOVERY_GUIDANCE = "請先查看本輪資料面板，再指定 1 至 2 檔股票重新提問。"


def _checked_answer(raw_text: str, metadata: dict, sources: list[SourceChunk], warning: str = "",
                    *, company_catalog: dict | None = None) -> str:
    if metadata.get("finish_reason") == "length" or (
            metadata.get("truncated") and metadata.get("finish_reason") == "stop"):
        raise TruncatedAnswerError("模型回答未完整生成，請稍後重試。")
    if metadata.get("truncated") or metadata.get("finish_reason") != "stop":
        raise ServiceUnavailable("模型回答未完整生成，請稍後重試。")
    answer = raw_text.strip()
    if not answer:
        raise EmptyAnswerError("模型服務未回傳有效內容，請稍後重試")
    if _is_insufficient_only(answer):
        return INSUFFICIENT_EVIDENCE_ANSWER + warning

    # Normalize citation typography only; every resulting ID is still checked below.
    answer = re.sub(
        r"\[\s*[sS]\d+(?:\s*[,，、]\s*[sS]\d+)*\s*\]|［\s*[sS]\d+(?:\s*[,，、]\s*[sS]\d+)*\s*］|【\s*[sS]\d+(?:\s*[,，、]\s*[sS]\d+)*\s*】",
        lambda match: "".join(f"[{token.upper()}]" for token in re.findall(r"[sS]\d+", match.group())),
        answer,
    )
    # ponytail: structural checks cannot prove entailment; add semantic evaluation when needed.
    citation_pattern = r"\[S[1-9][0-9]*\]"
    cited = list(dict.fromkeys(re.findall(citation_pattern, answer)))
    available = {f"[{source.citation_id}]": source for source in sources if source.content.strip()}
    remainder = re.sub(citation_pattern, "", answer)
    if (not cited or any(citation not in available for citation in cited)
            or re.search(r"[\[\]［］]|【\s*[sS]\d|[a-z][a-z0-9+.-]*://|www\.|<\s*/?[a-z]",
                         remainder, re.IGNORECASE)
            or "【引用來源】" in answer):
        raise CitationValidationError("回答的引用資料不足或格式無法核對，請稍後重試。")

    headings = {"【綜合摘要】", "【市場情緒】", "【關鍵事件】", "【投資提示】",
                "【重點】", "【技術解讀】", "【資料限制】"}
    prose = "\n".join("" if line.strip().lstrip("# ").strip("*_ ") in headings else line
                      for line in answer.splitlines())
    paragraphs = re.split(r"\n\s*\n|\n(?=\s*(?:[-*•·]|\d+[.)])\s)", prose)
    list_marker = re.compile(r"\s*(?:[-*•·]|\d+[.)])\s")
    for index, paragraph in enumerate(paragraphs):
        stripped = paragraph.strip()
        next_paragraph = next((candidate.strip() for candidate in paragraphs[index + 1:] if candidate.strip()), "")
        compact = stripped.strip("*_ ")
        is_structural_list_intro = (compact.endswith(("：", ":")) and bool(list_marker.match(next_paragraph)))
        if (stripped and stripped not in {INSUFFICIENT_EVIDENCE_ANSWER, "非投資建議。"}
                and not is_structural_list_intro
                and not re.search(citation_pattern, paragraph)):
            raise CitationValidationError("回答的引用資料不足或格式無法核對，請稍後重試。")

    for index, paragraph in enumerate(paragraphs):
        prior_context = "\n\n".join(paragraphs[:index]) + "\n\n" if index else ""
        for text, citations, context in _citation_units(paragraph):
            failed = unsupported_numeric_claim(text, [available[citation] for citation in citations],
                                               company_catalog=company_catalog, context=prior_context + context,
                                               continuation=paragraph[len(context) + len(text):])
            if failed is not None:
                raise NumericValidationError("回答的數值與所引用資料無法核對。" + NUMERIC_RECOVERY_GUIDANCE,
                                             claim=failed or _normalize(text).strip())

    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    if not plan_supported(_normalize(prose), [available[citation] for citation in cited], aliases):
        raise NumericValidationError("回答的資金配置或賣出股數超出可用範圍。" + NUMERIC_RECOVERY_GUIDANCE)

    references = []
    for citation in cited:
        source = available[citation]
        title = re.sub(r"https?://\S+", "", " ".join(source.title.split()), flags=re.IGNORECASE)
        reference = f"- {citation} {title or source.source_name or source.citation_id}"
        if source.article_id:
            reference += f"：/news/{quote(source.article_id, safe='')}"
        else:
            try:
                url = urlsplit(source.url)
                if (url.scheme in {"http", "https"} and url.hostname and not url.username and not url.password
                        and not re.search(r"[\s<>]", source.url)):
                    reference += f"：{source.url}"
            except ValueError:
                pass
        references.append(reference)
    if warning:
        answer += "\n\n【資料限制】\n" + warning.strip()
    return answer + "\n\n【引用來源】\n" + "\n".join(references)


def _citation_units(paragraph: str):
    """A following citation group supports its preceding text, not other claims.

    A single group at the paragraph's end still supports the full paragraph.
    Text after the final group is checked against that group as well.
    """
    cursor = 0
    citations = []
    for match in re.finditer(r"\[S[1-9][0-9]*\](?:\s*\[S[1-9][0-9]*\])*", paragraph):
        citations = list(dict.fromkeys(re.findall(r"\[S[1-9][0-9]*\]", match.group())))
        yield paragraph[cursor:match.start()], citations, paragraph[:cursor]
        cursor = match.end()
    if citations and paragraph[cursor:].strip():
        yield paragraph[cursor:], citations, paragraph[:cursor]
