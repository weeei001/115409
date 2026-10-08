"""Validate complete model answers and bind numeric checks to cited evidence."""
import re
from urllib.parse import quote, urlsplit

from app.core.errors import ServiceUnavailable

from app.features.market.company_catalog import company_aliases

from .claims import _normalize, unsupported_numeric_claim
from .comparison_validation import unsupported_comparison
from .grounding import unsupported_market_cause, target_quote_supported
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

    def __init__(self, detail, *, hint: str = ""):
        super().__init__(detail)
        # Recovery prompt only: which paragraph or token failed, never serialized to HTTP.
        self.hint = hint


class NumericValidationError(CitationValidationError):
    reason = "numbers"

    def __init__(self, detail, *, claim: str = ""):
        super().__init__(detail)
        # Recovery prompt only; HTTP handlers serialize detail, never the rejected prose.
        self.claim = claim


class ComplianceValidationError(CitationValidationError):
    """A promised outcome or an unsourced price target; recommendations themselves are allowed."""
    reason = "compliance"


class GroundingValidationError(CitationValidationError):
    """A market-cause claim lacks an attributable supporting source statement."""
    reason = "grounding"


class EmptyAnswerError(AnswerValidationError):
    reason = "empty"


class TruncatedAnswerError(AnswerValidationError):
    reason = "length"


NUMERIC_RECOVERY_GUIDANCE = "請先查看本輪資料面板，再指定 1 至 2 檔股票重新提問。"
CITATION_ERROR = "回答的引用資料不足或格式無法核對，請稍後重試。"
COMPLIANCE_ERROR = "回答含有保證結果或無法核對的目標價，請稍後重試。"
# Real markup only: comparisons such as "K<D" or "收盤<MA20" are not tags.
HTML_NAMES = (r"(?:a|b|br|i|u|p|em|strong|small|span|div|font|h[1-6]|hr|img|iframe|script|style|svg|"
              r"object|embed|form|input|button|link|meta|code|pre|table|thead|tbody|tr|td|th|ul|ol|li|"
              r"details|summary|section|article|blockquote|sub|sup)(?=[\s/>])")
HTML_TAG = re.compile(r"<!--|<\s*/?\s*" + HTML_NAMES, re.IGNORECASE)
HTML_MARKUP = re.compile(r"<\s*/?\s*" + HTML_NAMES + r"[^<>]*>", re.IGNORECASE)
HTML_ELEMENT = re.compile(r"<\s*(script|style)\b[^>]*>.*?<\s*/\s*\1\s*>|<!--.*?-->", re.IGNORECASE | re.DOTALL)
LINK_START = r"(?:[a-z][a-z0-9+.-]*:)?//|www\."
URL = re.compile(r"(?:" + LINK_START + r")[^\s\[\]［］【】（）()<>「」，。、；;]+", re.IGNORECASE)
# Generic closing reminders; they state no fact, so they need no citation.
DISCLAIMER = re.compile(r"(?:僅供參考|不構成(?:任何)?投資建議|非投資建議|投資有賺有賠|請(?:自行)?審慎評估|請自行判斷)")
STRUCTURAL_LABELS = {
    "綜合摘要", "市場情緒", "關鍵事件", "投資提示", "重點", "技術解讀", "資料限制", "已核對資料",
    "結論", "摘要", "技術面", "基本面", "籌碼面", "消息面", "風險", "風險提醒", "注意事項",
    "建議", "我的建議", "建議配置", "目前帳戶", "帳戶現況", "目前持股", "資金配置", "配置建議",
    "以下是重點", "以下是建議", "以下建議", "建議如下", "重點如下", "分析", "比較", "下一步",
    "營收分析", "價格分析", "行情分析", "觀察重點", "比較結果", "操作建議",
}
# Unsourced price targets and promised outcomes; buy/sell views remain allowed by the answer prompt.
PRICE_TARGET = re.compile(r"(?:目標價(?:位)?|合理價(?:位)?|上看|下看)[^。，,；;\n\d]{0,8}([\d,]+(?:\.\d+)?)\s*(?:元|塊)")
TARGET_ATTRIBUTION = re.compile(r"分析師|法人|券商|投顧|外資|報導|媒體|研究|機構|研調|指出|表示|預估|給予|喊出|調升|調降|維持")
PROMISE = re.compile(r"穩賺|穩賠|零風險|必漲|必跌"
                     r"|(?:保證|一定|必定|必然|絕對)(?:會|能)?(?:上漲|下跌|漲|跌|賺|獲利|回本|不賠|報酬)")
PROMISE_NEGATION = re.compile(r"(?:不|未|無法|不能|並非|不是|沒有)(?:會|能)?$")


def _repaired(answer: str) -> str:
    """Remove formatting that can be dropped without changing a claim, instead of rejecting the answer."""
    header = re.search(r"(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?【引用來源】", answer)
    if header:
        answer = answer[:header.start()].rstrip()  # The server appends the verified list.
    answer = re.sub(r"\[([^\[\]\n]{1,40})\]\(\s*(?:" + LINK_START + r")[^)\s]*\s*\)", r"\1", answer,
                    flags=re.IGNORECASE)
    answer = HTML_ELEMENT.sub("", answer)
    answer = re.sub(r"<\s*br\s*/?\s*>", "\n", answer, flags=re.IGNORECASE)
    answer = HTML_MARKUP.sub("", answer)
    return URL.sub("", answer)


def _relabelled(answer: str) -> str:
    """Runs after citation normalization, so only non-citation brackets remain."""
    def label(match):
        text = match.group(1).strip()
        # A bracketed number or source name poses as a citation; drop it so the paragraph check sees no support.
        if re.fullmatch(r"\d+|.*(?:來源|資料|片段|參考|出處|引用|ref|source|[sS]\s*\d).*", text, re.IGNORECASE):
            return ""
        return f"【{text}】"
    return re.sub(r"[\[［](?!S[1-9][0-9]*\])([^\[\]［］\n]{1,20})[\]］]", label, answer)


def _is_summary(paragraph: str) -> bool:
    text = re.sub(r"^(?:綜合(?:來看|而言|以上)|整體(?:來看|而言)|總結|總的來說|簡單來說)[，,:：\s]*", "", paragraph)
    # 結語豁免只接受沒有新事實的完整句型，不能夾帶公司事件或持倉。
    return bool(re.fullmatch(
        r"(?:(?:目前|現有|本輪)?(?:資料|證據)(?:仍)?(?:不足以|無法|尚無法)(?:判斷|判定|確認)"
        r"(?:股價)?(?:漲跌|上漲|下跌|短線)?(?:方向|走勢|原因|主因)?"
        r"|(?:短線|後續)?(?:方向|走勢)(?:仍|尚)?不明確|仍需觀察|有待確認)[。！!\s]*", text))


def _citation_group(match) -> str:
    """Normalize "[S1, S2]", "【S1】", "[片段1]" and "[S1-S3]" to "[S1][S2]..."."""
    text = match.group()
    numbers = []
    for start, end in re.findall(r"(\d+)\s*(?:[-–~～至到]\s*(?:[sS]|片段)?\s*(\d+))?", text):
        low, high = int(start), int(end or start)
        if not 0 <= high - low <= 10:
            return text  # Left unnormalized, so it is dropped as a fake citation and its paragraph is uncited.
        numbers.extend(range(low, high + 1))
    return "".join(f"[S{number}]" for number in numbers)


def _is_disclaimer(paragraph: str) -> bool:
    """A short reminder with no number, stock view or trading direction."""
    if len(paragraph) > 60 or not DISCLAIMER.search(paragraph):
        return False
    rest = DISCLAIMER.sub("", paragraph)
    return bool(re.fullmatch(r"(?:以上(?:資訊|內容)?|本(?:回答|內容)|這些資訊|投資提醒|[，,。；;：:\s])*", rest))


def _is_heading(paragraph: str, next_paragraph: str, catalog=None) -> bool:
    lines = [line for line in paragraph.splitlines() if line.strip()]
    if len(lines) != 1 or not next_paragraph:
        return False
    # A stock code in a heading such as "**台積電（2330）**" or "### 台積電 2330" names the subject, not a value.
    catalog = catalog or {}
    line = re.sub(r"[(（]\s*(\d{4,6})\s*[)）]",
                  lambda match: "" if match[1] in catalog else match.group(), lines[0].strip())
    line = re.sub(r"(?<![\d,.])\d{4,6}(?![\d,.%])", lambda match: "" if match.group() in catalog else match.group(), line)
    marked = line.startswith("#") or line.startswith(("**", "__", "【")) or line.endswith((":", "：", ":**", "：**"))
    if not marked:
        return False
    label = line.strip("#*_【】[]：: \t")
    label = re.sub(r"^(?:\d+[.)、]|[一二三四五六七八九十]+、)\s*", "", label)
    for symbol, company in catalog.items():
        for alias in sorted(company_aliases(symbol, company), key=len, reverse=True):
            label = label.replace(alias, "")
    return not label.strip() or _is_structural_label(label.strip())


def _is_structural_label(label: str) -> bool:
    label = re.sub(r"^以下(?:是|為)?(?:詳細|簡要)?", "", label)
    label = re.sub(r"(?:整理|如下)$", "", label)
    if label in STRUCTURAL_LABELS:
        return True
    # Only neutral topic labels compose headings. A recommendation or factual
    # assertion remains a claim even when it ends in a colon.
    topic = (r"(?:帳戶概況|帳戶現況|配置問題|分析範圍|資料日期|採用條件|下一步方案|"
             r"重大風險|風險|調整建議條件|調整條件|建議|支持來源|評選標準|資料限制|觀察重點)")
    return bool(re.fullmatch(rf"{topic}(?:[與及、]{topic})*", label))


def _validation_paragraphs(answer: str) -> list[str]:
    paragraphs = re.split(r"\n\s*\n|\n(?=\s*(?:[-*•·]|\d+[.)])\s)", answer)
    grouped = []
    for paragraph in paragraphs:
        # A colon introduces the immediately following list item. Its citation
        # can support that complete unit, including every claim in the lead-in.
        # Do not borrow a later item's citations or exempt the lead-in's facts.
        if (grouped and re.match(r"\s*以下(?:依據|根據|在)", grouped[-1])
                and "\n" not in grouped[-1].strip()
                and grouped[-1].rstrip().endswith(("：", ":"))
                and not re.search(r"\[S[1-9][0-9]*\]", grouped[-1])
                and re.match(r"\s*(?:[-*•·]|\d+[.)])\s", paragraph)):
            grouped[-1] += "\n" + paragraph
        else:
            grouped.append(paragraph)
    return grouped


def _checked_answer(raw_text: str, metadata: dict, sources: list[SourceChunk], warning: str = "",
                    *, company_catalog: dict | None = None, require_portfolio: bool = False) -> str:
    if metadata.get("finish_reason") == "length" or (
            metadata.get("truncated") and metadata.get("finish_reason") == "stop"):
        raise TruncatedAnswerError("模型回答未完整生成，請稍後重試。")
    if metadata.get("truncated") or metadata.get("finish_reason") != "stop":
        raise ServiceUnavailable("模型回答未完整生成，請稍後重試。")
    answer = _repaired(raw_text.strip()).strip()
    if not answer:
        raise EmptyAnswerError("模型服務未回傳有效內容，請稍後重試")
    if _is_insufficient_only(answer):
        return INSUFFICIENT_EVIDENCE_ANSWER + warning

    # Normalize citation typography only; every resulting ID is still checked below.
    # The prompt labels evidence "[片段N] [SN]", so both numberings name the same source.
    token = r"(?:[sS]|片段)\s*\d+"
    answer = re.sub(
        rf"[\[［【(（]\s*{token}(?:\s*(?:[,，、]|[-–~～至到])\s*{token}|\s*[-–~～至到]\s*\d+)*\s*[\]］】)）]",
        _citation_group, answer,
    )
    answer = _relabelled(answer)
    # 結構與已辨識主張的檢查並不等於完整語意蘊含驗證。
    citation_pattern = r"\[S[1-9][0-9]*\]"
    cited = list(dict.fromkeys(re.findall(citation_pattern, answer)))
    available = {f"[{source.citation_id}]": source for source in sources if source.content.strip()}
    remainder = re.sub(citation_pattern, "", answer)
    if not cited:
        raise CitationValidationError(CITATION_ERROR, hint="整份回答沒有任何 [S1] 格式的引用編號。")
    unknown = [citation for citation in cited if citation not in available]
    if unknown:
        raise CitationValidationError(CITATION_ERROR, hint="使用了本輪不存在的引用編號：" + "".join(unknown))
    invalid = (re.search(r"[\[\]［］]|【\s*[sS]\d|[a-z][a-z0-9+.-]*://|www\.|(?<![:\w])//\w", remainder, re.IGNORECASE)
               or HTML_TAG.search(remainder))
    if invalid:
        excerpt = remainder[max(0, invalid.start() - 12):invalid.end() + 12]
        raise CitationValidationError(CITATION_ERROR, hint="含有無法核對的引用格式、連結或 HTML：" + excerpt)

    # 保留標題作為建議／現況的作用域邊界；顯示豁免不應抹除驗證上下文。
    prose = answer
    paragraphs = _validation_paragraphs(prose)
    list_marker = re.compile(r"\s*(?:[-*•·]|\d+[.)])\s")
    for index, paragraph in enumerate(paragraphs):
        stripped = paragraph.strip()
        next_paragraph = next((candidate.strip() for candidate in paragraphs[index + 1:] if candidate.strip()), "")
        # 顯示標題可以與正文只隔一個換行；只在引用格式檢查中略過，原文仍保留供作用域核對。
        visible_lines = stripped.splitlines()
        while len(visible_lines) > 1 and _is_heading(visible_lines[0], "\n".join(visible_lines[1:]), company_catalog):
            visible_lines = visible_lines[1:]
        compact = "\n".join(visible_lines).strip("*_ \n")
        is_structural_list_intro = (_is_structural_label(compact.rstrip("：: "))
                                    and compact.endswith(("：", ":")) and bool(list_marker.match(next_paragraph)))
        if (compact and compact not in {INSUFFICIENT_EVIDENCE_ANSWER, "非投資建議。"}
                and not is_structural_list_intro
                and not _is_heading(stripped, next_paragraph, company_catalog)
                and not _is_disclaimer(compact)
                and not _is_summary(compact)
                and not re.search(citation_pattern, paragraph)):
            raise CitationValidationError(CITATION_ERROR, hint="這個段落沒有以引用編號結尾：" + compact[:80])

    for match in PROMISE.finditer(prose):
        if not PROMISE_NEGATION.search(prose[max(0, match.start() - 4):match.start()]):
            raise ComplianceValidationError(COMPLIANCE_ERROR, hint="含有保證結果的說法：" + match.group())
    for paragraph in paragraphs:
        for text, citations, _ in _citation_units(paragraph):
            for match in PRICE_TARGET.finditer(text):
                number = match.group(1).replace(",", "")
                start = max(text.rfind(mark, 0, match.start()) for mark in "。!?！？\n") + 1
                end = re.search(r"[。!?！？\n]", text[match.end():])
                sentence = text[start:match.end() + end.start() if end else len(text)]
                sourced = target_quote_supported(sentence, number,
                                                  [available[citation] for citation in citations], company_catalog)
                if not (sourced and TARGET_ATTRIBUTION.search(sentence)):
                    raise ComplianceValidationError(COMPLIANCE_ERROR, hint="目標價須是引用來源中標明出處的數字：" + match.group())
            cause = unsupported_market_cause(text, [available[citation] for citation in citations], company_catalog)
            if cause:
                raise GroundingValidationError("回答的漲跌原因缺少可核對的原文依據。", hint=cause)

    for index, paragraph in enumerate(paragraphs):
        prior_context = "\n\n".join(paragraphs[:index]) + "\n\n" if index else ""
        for text, citations, context in _citation_units(paragraph):
            failed = unsupported_numeric_claim(text, [available[citation] for citation in citations],
                                               company_catalog=company_catalog, context=prior_context + context,
                                               continuation=paragraph[len(context) + len(text):])
            if failed is not None:
                raise NumericValidationError("回答的數值與所引用資料無法核對。" + NUMERIC_RECOVERY_GUIDANCE,
                                             claim=failed or _normalize(text).strip())
            comparison_issue = unsupported_comparison(
                text, [available[citation] for citation in citations], company_catalog)
            if comparison_issue:
                raise NumericValidationError("回答的比較排名與所引用資料無法核對。", claim=comparison_issue)

    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    # 引用檢查維持逐項就地核對；帳戶限制則固定使用完整本輪快照，不能由模型選引用來跳過。
    account_bound = require_portfolio or any(source.category == "personal" for source in sources)
    if not plan_supported(_normalize(prose), sources, aliases, require_portfolio=account_bound):
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
