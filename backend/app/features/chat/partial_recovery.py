"""Bounded, conservative recovery of independently checked answer content."""
import re

from app.core.errors import ServiceUnavailable
from app.features.market.company_catalog import company_aliases

from .answer_validation import (
    _checked_answer, _citation_units, _is_disclaimer, _is_insufficient_only,
    _is_summary, _normalized_answer, _validation_paragraphs,
)
from .claims import _normalize, _subjects, numeric_claim_issue
from .comparison_validation import checked_comparison_observations
from .proposals import parse_proposals


# With no semantic dependency graph, remove advice and inferential prose
# everywhere, including conclusions appearing before a rejected observation.
DEPENDENT = re.compile(
    r"因此|所以|故而|綜合|總結|結論|上述|前述|據此|由此|這些|該股|其餘|同期間|"
    r"建議|推薦|優先|適合|值得|配置|投入|買入|買進|加碼|減碼|賣出|保留|"
    r"更為|較為|更穩|更抗跌|最穩|最平穩|最為|相較|勝過"
    r"|(?:這|此)(?:些|個|種|項)?(?:結果|表現|情況|數據|現象)?(?:表示|代表|意味|證明)"
    r"|建立部位|進場布局|(?:操作|交易)(?:可(?:以)?|宜)(?:更)?積極"
)
CONDITIONAL = re.compile(r"若|如果|假設|假如|除非|否則|倘若|一旦|只有|才會")
NOTICE = "部分敘述未能完成來源核對，已省略該部分及相關配置與結論；以下僅保留可獨立核對的內容。"


def recover_partial_answer(raw_text, metadata, sources, warning="", *,
                           company_catalog=None, require_portfolio=False):
    """Return (checked answer or None, non-sensitive recovery diagnostics).

    Called only after the existing model repair budget. Never generates text,
    invents evidence, splits clauses, or accepts a validator exception as success.
    """
    diagnostics = []
    if metadata.get("truncated") or metadata.get("finish_reason") != "stop":
        return None, [{"reason": "length", "result": "ineligible"}]
    paragraphs = _validation_paragraphs(_normalized_answer(raw_text))
    if len(paragraphs) > 64:
        return None, [{"reason": "recovery_limit", "result": "ineligible"}]
    available = {f"[{source.citation_id}]": source for source in sources}
    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    retained = []
    context = ""
    unit_count = 0
    for index, paragraph in enumerate(paragraphs):
        # Repeated identical citation groups have the same evidence scope.
        # Coalesce only those groups, so an inline citation cannot sever a
        # company from its following metrics during local recovery.
        groups = [citations for _, citations, _ in _citation_units(paragraph)]
        if groups and all(set(group) == set(groups[0]) for group in groups):
            paragraph = re.sub(r"\[S[1-9][0-9]*\]", "", paragraph) + "".join(groups[0])
        # Conditions spanning sentences stay atomic. Citation groups are never
        # lent across units; a paragraph-final citation covers its full unit.
        units = [(paragraph, context)]
        if not CONDITIONAL.search(paragraph):
            split = []
            for text, citations, local_context in _citation_units(paragraph):
                offset = 0
                for sentence in re.findall(r"[^。！？!?]+[。！？!?]*", text):
                    split.append((sentence.strip() + "".join(citations),
                                  context + local_context + text[:offset]))
                    offset += len(sentence)
            if split:
                units = split
        for unit, original_context in units:
            unit_count += 1
            if unit_count > 128:
                return None, diagnostics + [{"reason": "recovery_limit", "result": "ineligible"}]
            prose = re.sub(r"\[S[1-9][0-9]*\]", "", unit).strip()
            # An omitted period must not acquire a new meaning when its
            # original context is removed, even if the standalone value fits.
            if (re.search(r"\d", prose) and re.search(r"\d{4}-\d{2}-\d{2}", original_context)
                    and not re.search(r"\d{4}-\d{2}-\d{2}", prose)):
                diagnostics.append({"paragraph": index, "reason": "dependent_period", "result": "removed"})
                continue
            # Subject inheritance is not guaranteed across paragraph boundaries.
            # Do not let a formerly scoped number adopt the cited source's sole
            # company after its original heading or sentence was removed.
            if (re.search(r"\d", prose) and _subjects(_normalize(original_context), aliases)
                    and not _subjects(_normalize(prose), aliases)):
                diagnostics.append({"paragraph": index, "reason": "dependent_subject", "result": "removed"})
                continue
            if DEPENDENT.search(prose):
                citations = list(dict.fromkeys(re.findall(r"\[S[1-9][0-9]*\]", unit)))
                cited = [available[citation] for citation in citations if citation in available]
                observations = checked_comparison_observations(prose, cited, company_catalog)
                if observations:
                    unit = observations + "".join(citations)
                    prose = observations
                    diagnostics.append({"paragraph": index, "reason": "unsupported_conclusion", "result": "narrowed"})
            if (not prose or _is_insufficient_only(prose) or _is_summary(prose)
                    or _is_disclaimer(prose) or DEPENDENT.search(prose)
                    or parse_proposals(prose)):
                diagnostics.append({"paragraph": index, "reason": "dependent_or_non_substantive", "result": "removed"})
                continue
            try:
                # Recheck inherited dates/subjects before discarding context.
                for text, citations, local_context in _citation_units(unit):
                    cited = [available[citation] for citation in citations if citation in available]
                    issue = numeric_claim_issue(text, cited, company_catalog=company_catalog,
                                                context=original_context + local_context)
                    if issue is not None:
                        diagnostics.append({"paragraph": index, "reason": issue.reason, "result": "removed"})
                        break
                else:
                    _checked_answer(unit, metadata, sources, company_catalog=company_catalog,
                                    require_portfolio=require_portfolio)
                    retained.append(unit)
                    continue
            except ServiceUnavailable as exc:
                diagnostics.append({"paragraph": index, "reason": getattr(exc, "issue", getattr(exc, "reason", "validation")),
                                    "result": "removed"})
        context += paragraph + "\n\n"
    candidate = "\n\n".join(retained)
    # A tiny surviving fragment or a disclaimer cannot constitute an answer.
    visible = re.sub(r"\[S[1-9][0-9]*\]|[\W\d_]", "", candidate)
    if len(visible) < 24:
        return None, diagnostics + [{"reason": "insufficient_remaining_content", "result": "withheld"}]
    try:
        checked = _checked_answer(candidate, metadata, sources,
                                  "\n".join(part for part in (warning, NOTICE) if part),
                                  company_catalog=company_catalog, require_portfolio=require_portfolio)
    except ServiceUnavailable as exc:
        return None, diagnostics + [{"reason": getattr(exc, "issue", getattr(exc, "reason", "validation")),
                                     "result": "withheld"}]
    return checked, diagnostics + [{"reason": "partial_recovery", "result": "retained", "units": len(retained)}]
