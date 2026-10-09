"""Check explicit comparison extrema against the complete cited stock universe."""
import json
import re
from decimal import Decimal, InvalidOperation

from app.features.market.company_catalog import company_aliases

from .claims import _claims, _evidence, _matches, _normalize, _subjects, numeric_claim_issue
from .schemas import SourceChunk


METRICS = {
    "annualized_volatility_pct": r"年化波動(?:度|率)",
    "interval_return_pct": r"(?:區間|期間|同期)(?:價格|股價)?(?:報酬率|漲跌幅|漲幅)",
    "unspecified_return": r"報酬率",
    "max_drawdown_pct": r"最大回撤(?:幅度)?",
}
RANK = re.compile(r"最高|最低|最大(?!回撤)|最小|居冠|(?:最|更|較)(?:為)?(?:抗跌)?(?:平穩|穩定|穩健)|(?:高於|低於)其餘\s*\d+\s*檔")


def checked_comparison_observations(text: str, sources: list[SourceChunk],
                                    company_catalog: dict | None = None) -> str | None:
    """Recover independently verified observations, never the rejected conclusion.

    This deliberately narrow projection is only for comparison recovery. If
    grammatical scope could make a number hypothetical or negated, omit the
    unit instead of turning it into an affirmative observation.
    """
    normalized = _normalize(text)
    if re.search(r"不|無|未|非|否|若|假設|假如|如果|除非|預期|預估|未來|可能|可望", normalized):
        return None
    if numeric_claim_issue(text, sources, company_catalog) is not None:
        return None
    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    facts, _ = _evidence(sources, aliases)
    labels = {"interval_return_pct": "區間報酬率", "annualized_volatility_pct": "年化波動度",
              "max_drawdown_pct": "最大回撤"}
    observations = []
    for claim in _claims(normalized, aliases):
        if claim.metric not in labels or not claim.symbol:
            return None
        matches = [fact for fact in facts if _matches(claim, fact)]
        periods = {fact.periods[-1] for fact in matches if fact.periods and all(fact.periods[-1])}
        # A single source period is necessary for a fresh standalone sentence.
        if len(periods) != 1:
            return None
        start, end = periods.pop()
        observations.append(f"{claim.symbol} 在 {start} 至 {end} 的{labels[claim.metric]}為 {claim.value}%。")
    return "".join(dict.fromkeys(observations)) or None


def unsupported_comparison(text: str, sources: list[SourceChunk],
                           company_catalog: dict | None = None) -> str | None:
    """Return a recovery hint for an unsupported explicit rank, otherwise None.

    The caller supplies only locally cited evidence. This bounded check does
    not turn a preferred investment scenario into a factual ranking.
    """
    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    payloads = []
    for source in sources:
        if source.category == "comparison":
            try:
                payload = json.loads(source.content)
            except (TypeError, ValueError):
                payload = None
            payloads.append(payload)
    for sentence in re.split(r"[。!?\n]", _normalize(text)):
        metrics = [(match, metric) for metric, pattern in METRICS.items()
                   for match in re.finditer(pattern, sentence)]
        for rank in RANK.finditer(sentence):
            if re.search(r"(?:並非|不是|未必|不一定|不能|無法|不足以)[^,;]{0,12}$", sentence[:rank.start()]):
                continue
            clause_start = max(sentence.rfind(mark, 0, rank.start()) for mark in ",;") + 1
            local_prefix = sentence[clause_start:rank.start()].strip()
            if (re.match(r"(?:若|如果)(?:未來|後續)", local_prefix)
                    and not re.search(r"目前|現在|已|實際|截至|當前", local_prefix)
                    and re.match(r"(?:時|後)?\s*[,;]?\s*(?:再|才)(?:討論|考慮|評估)"
                                 r"(?:加碼|進場|減碼|買進|賣出|調整部位)", sentence[rank.end():])):
                # An explicitly future prerequisite is not a present ranking.
                # The exception is local to this rank, not its whole sentence.
                continue
            preceding = [(match, metric) for match, metric in metrics if match.end() <= rank.start()]
            other_rank = re.fullmatch(r"(高於|低於)其餘\s*(\d+)\s*檔", rank[0])
            stability = any(word in rank[0] for word in ("平穩", "穩定", "穩健"))
            if stability:
                # Stability is not a defined financial metric. Require the
                # prose itself to explicitly establish the lowest volatility.
                supported_definition = re.search(r"年化波動(?:度|率)[^;。]{0,30}最低", sentence[:rank.start()])
                if not supported_definition:
                    return "穩定程度的比較結論需明示可核對的排名指標：" + sentence.strip()
                metric_match, metric = next((match, metric) for match, metric in preceding
                                            if match.start() == supported_definition.start())
                largest = False
            else:
                if not preceding:
                    continue
                metric_match, metric = max(preceding, key=lambda item: (item[0].end(), len(item[0][0])))
                if ";" in sentence[metric_match.end():rank.start()]:
                    continue
                # Do not treat an unrelated noun, such as '最大風險', as a metric rank.
                if re.match(r"[\u4e00-\u9fff]", sentence[rank.end():]) and not sentence[rank.end():].startswith(("的", "者")):
                    continue
                largest = rank[0] in {"最高", "最大", "居冠"} or bool(other_rank and other_rank[1] == "高於")
            if metric == "unspecified_return":
                return "比較排名需明示報酬率的期間與口徑：" + sentence.strip()
            subjects = _subjects(sentence[:metric_match.start()], aliases)
            if not subjects:
                return "比較排名缺少明確股票主詞：" + sentence.strip()
            subject = max(subjects, key=lambda item: item[:2])[2]
            if not payloads:
                return "比較排名需引用本輪共同期間的完整比較資料：" + sentence.strip()
            for payload in payloads:
                if not isinstance(payload, dict):
                    return "比較排名來源格式無法核對。"
                stocks = payload.get("stocks")
                if not isinstance(stocks, list) or len(stocks) < 2 or not all(isinstance(stock, dict) for stock in stocks):
                    return "比較排名需至少兩檔完整資料。"
                count = re.search(r"([一二三四五六七八九十百\d]+)\s*檔(?:股票)?中", sentence)
                if count:
                    expected = int(count[1]) if count[1].isdigit() else {
                        word: index for index, word in enumerate("一二三四五六七八九十", 1)
                    }.get(count[1])
                    if expected != len(stocks):
                        return "比較排名宣稱的股票數與來源範圍不符。"
                start, end = payload.get("common_start_date"), payload.get("common_end_date")
                if not start or not end:
                    return "比較排名缺少共同觀測期間。"
                if any(day not in {start, end} for day in re.findall(r"\d{4}-\d{2}-\d{2}", sentence)):
                    return "比較排名的日期與共同觀測期間不符。"
                values = {}
                for stock in stocks:
                    try:
                        value = Decimal(str(stock.get(metric)))
                    except (InvalidOperation, TypeError, ValueError):
                        return "比較排名所需指標不完整。"
                    if not value.is_finite() or not stock.get("symbol"):
                        return "比較排名所需指標不完整。"
                    values[str(stock["symbol"])] = abs(value) if metric == "max_drawdown_pct" else value
                if len(values) != len(stocks) or subject not in values:
                    return "比較排名的股票範圍無法核對。"
                if other_rank and int(other_rank[2]) + 1 != len(values):
                    return "其餘股票數與本輪完整比較範圍不符。"
                count = re.search(r"([一二兩三四五六七八九十]|\d+)\s*檔(?:股票)?中", sentence)
                if count:
                    raw = count[1].replace("兩", "二")
                    expected = int(raw) if raw.isdigit() else "一二三四五六七八九十".index(raw) + 1
                    if expected != len(values):
                        return "比較排名宣稱的股票數與本輪比較範圍不符。"
                extreme = (max if largest else min)(values.values())
                if values[subject] != extreme:
                    return "比較排名與本輪完整比較資料不符：" + sentence.strip()
                if other_rank and any(value == values[subject] for symbol, value in values.items() if symbol != subject):
                    return "高於或低於其餘股票的描述不能使用並列排名。"
    return None
