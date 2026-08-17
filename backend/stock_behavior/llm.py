from __future__ import annotations

import json
import re
from typing import Any

try:
    from langchain_openai import ChatOpenAI
except ImportError:  # pragma: no cover - local test fallback
    ChatOpenAI = None

from stock_behavior.evidence import FIELD_GLOSSARY
from stock_behavior.observability import get_logger, log_warn, stage
from stock_behavior.prompt_templates import TEXT_BRIEF_SYSTEM_PROMPT
from stock_behavior import few_shot_examples


LLM_MAX_COMPLETION_TOKENS = 8192
LLM_TIMEOUT_SECONDS = 900
THINKING_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>\s*", re.IGNORECASE | re.DOTALL)
CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
JSON_NUMBER_RE = r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?"
JSON_NUMERIC_EXPR_RE = re.compile(
    rf"(?P<prefix>:\s*)(?P<left>{JSON_NUMBER_RE})\s*(?P<op>[*/])\s*(?P<right>{JSON_NUMBER_RE})(?P<suffix>\s*[,}}\]])"
)
STANCE_ENUM = "bullish|mildly_bullish|mixed|neutral|mildly_bearish|bearish|uncertain"
TEXT_BRIEF_OUTPUT_SCHEMA = f"""{{
  "key_days": "KeyDay[3..5]",
  "headline": "string (max 80)",
  "current_status": "Claim[1..3]",
  "positive_factors": "Claim[1..3]",
  "negative_factors": "Claim[1..3]",
  "source_divergences": "Claim[0..3]",
  "risks": "Risk[1..3]",
  "watch_points": "WatchPoint[2..4]",
  "forward_views": {{"short_1_5":"ForwardView","swing_6_20":"ForwardView","medium_21_40":"ForwardView"}},
  "overall_stance": "{STANCE_ENUM}",
  "confidence": "low|medium|high",
  "confidence_reason": "string max 160",
  "limitations": "string[0..5]",
  "KeyDay": {{"id":"kd_NN","date":"YYYY-MM-DD","ref":"daily_timeline 中該日的 id","what":"string max 200","evidence_ids":"string[]"}},
  "Claim": {{"id":"cs_NN|pos_NN|neg_NN|div_NN","claim_type":"observation|inference|conflict|limitation","text":"string max 160","direction":"positive|negative|mixed|neutral|not_applicable","evidence_ids":"string[]","importance":"high|medium"}},
  "Risk": {{"id":"rk_NN","risk_type":"string max 20","description":"string max 160","trigger":"string max 120","evidence_ids":"string[]"}},
  "WatchPoint": {{"id":"wp_NN","what_to_watch":"string max 80","why_it_matters":"string max 160","when":"string max 40","evidence_ids":"string[]"}},
  "ForwardView": {{"stance":"{STANCE_ENUM}","reason":"string max 160","invalidation":"string max 120","evidence_ids":"string[]"}}
}}"""


def build_text_brief_system_prompt() -> str:
    """欄位表與輸出 schema 都是常數，放在 system 只出現一次；

    若塞進 task_packet，few-shot 的三個範例輸入會各帶一份，白白多花三倍 token，
    而且範例輸入與真實輸入必須同構，不能只在真實輸入裡附。
    """
    glossary = "\n".join(f"{key}：{text}" for key, text in FIELD_GLOSSARY.items())
    return (
        f"{TEXT_BRIEF_SYSTEM_PROMPT.rstrip()}\n\n"
        f"<field_glossary>\n{glossary}\n</field_glossary>\n\n"
        f"<output_schema>\n{TEXT_BRIEF_OUTPUT_SCHEMA}\n</output_schema>"
    )


def build_text_brief_user_message(payload: dict[str, Any]) -> str:
    return (
        "<payload>\n"
        f"{json.dumps(payload, ensure_ascii=False, default=str)}\n"
        "</payload>"
    )


def _example_task(example: dict[str, Any]) -> dict[str, Any]:
    task = example.get("input_payload", {}).get("task")
    return task if isinstance(task, dict) else {}


def select_few_shot_examples(
    examples: list[Any],
    *,
    symbol: str | None,
    as_of_date: str | None,
) -> list[Any]:
    """濾掉「在本次基準日當下還不可能知道」的範例。

    範例取自真實資料，帶有當時的股價、法人買賣與新聞。兩種情況要擋：

    1. 基準日晚於本次請求——不分股票一律丟掉。先前只擋同一檔股票，但範例裡
       別檔股票的未來收盤價、法人動向同樣是未來資訊：拿 2025 年初回放時，
       上下文若躺著 2026 年的價量，等於告訴模型後來大盤漲到哪裡。
    2. 基準日與本次相同、且是同一檔股票——雖然不是未來資料，但那份範例就是
       這次要產出的答案本身，留著等於直接給答案。同一天的別檔股票不算洩漏，
       那是當下就取得到的橫向資訊，予以保留。

    濾到一個範例都不剩是可能的（回放時間早於所有範例）。這裡不補救，
    由呼叫端的 few_shot 計數把情況記錄下來，避免無聲降級。
    """
    if not symbol or not as_of_date:
        return list(examples)

    kept = []
    for example in examples:
        task = _example_task(example)
        example_date = str(task.get("as_of_date") or "")
        if example_date > as_of_date:
            continue
        if example_date == as_of_date and str(task.get("symbol") or "") == symbol:
            continue
        kept.append(example)
    return kept


def build_text_brief_messages(task_packet: dict[str, Any]) -> list[tuple[str, str]]:
    """system + few-shot 多輪 user/assistant + 真實輸入。

    few-shot 以真正的對話輪次呈現（而非塞在單一 user 訊息的 XML 區塊裡），
    範例輸入與真實輸入同構，模型才學得到「這種時間軸要怎麼讀成 key_days」。
    """
    task = task_packet.get("task") if isinstance(task_packet.get("task"), dict) else {}
    examples = select_few_shot_examples(
        few_shot_examples.FEW_SHOT_EXAMPLES,
        symbol=str(task.get("symbol") or "") or None,
        as_of_date=str(task.get("as_of_date") or "") or None,
    )

    messages: list[tuple[str, str]] = [("system", build_text_brief_system_prompt())]
    for example in examples:
        messages.append(("human", build_text_brief_user_message(example["input_payload"])))
        messages.append(
            ("ai", json.dumps(example["output_brief"], ensure_ascii=False))
        )
    messages.append(("human", build_text_brief_user_message(task_packet)))
    return messages


def _coerce_llm_text(content: str | list[Any] | None) -> str:
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return content if isinstance(content, str) else ""


def _clean_llm_json_text(text: str) -> str:
    cleaned = THINKING_BLOCK_RE.sub("", text).strip()
    return CODE_FENCE_RE.sub("", cleaned).strip()


def _repair_json_numeric_expressions(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        left = float(match.group("left"))
        right = float(match.group("right"))
        if match.group("op") == "/" and right == 0:
            return match.group(0)
        value = left * right if match.group("op") == "*" else left / right
        return f"{match.group('prefix')}{value}{match.group('suffix')}"

    return JSON_NUMERIC_EXPR_RE.sub(replace, text)


def _thinking_extra_body(model: str) -> dict[str, Any]:
    model = model.lower()
    if model.startswith(("deepseek-ai/", "moonshotai/")):
        return {"chat_template_kwargs": {"thinking": False}}
    if model.startswith(("qwen/", "z-ai/")):
        return {"chat_template_kwargs": {"enable_thinking": False}}
    return {}


def _load_json_object(text: str) -> dict[str, Any] | None:
    text = _clean_llm_json_text(text)
    repaired_text = _repair_json_numeric_expressions(text)
    candidates = (text,) if repaired_text == text else (text, repaired_text)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        return parsed if isinstance(parsed, dict) else None

    decoder = json.JSONDecoder()
    for candidate in candidates:
        if not candidate.startswith("{"):
            continue
        try:
            parsed, _ = decoder.raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        return parsed if isinstance(parsed, dict) else None
    return None


class StockBehaviorLlmService:
    def __init__(self, settings: Any) -> None:
        self._settings = settings
        self._model = settings.ADVISOR_LLM_MODEL or "meta/llama-3.1-70b-instruct"
        self._max_completion_tokens = getattr(
            settings,
            "ADVISOR_LLM_MAX_COMPLETION_TOKENS",
            LLM_MAX_COMPLETION_TOKENS,
        )
        self._response_format = getattr(
            settings,
            "ADVISOR_LLM_RESPONSE_FORMAT",
            "json_object",
        )
        self._timeout_seconds = getattr(
            settings,
            "ADVISOR_LLM_TIMEOUT_SECONDS",
            LLM_TIMEOUT_SECONDS,
        )
        self._streaming = bool(getattr(settings, "ADVISOR_LLM_STREAMING", False))
        self._max_retries = getattr(settings, "ADVISOR_LLM_MAX_RETRIES", 2)
        # 0／None＝停用「chunk 之間」的 timeout；整體仍受 self._timeout_seconds 保護。
        self._stream_chunk_timeout = (
            getattr(settings, "ADVISOR_LLM_STREAM_CHUNK_TIMEOUT_SECONDS", 0) or None
        )
        self._enabled = bool(
            settings.NIM_API_KEY and settings.NIM_BASE_URL and self._model
        )
        model_kwargs: dict[str, Any] = {}
        if self._response_format == "json_object":
            model_kwargs["response_format"] = {"type": "json_object"}
        if self._streaming:
            # 串流下 token_usage 預設不會回來，要明確要求，否則 completion_tokens 全是 None，
            # 就分不出「模型只寫這麼多」與「被 max_completion_tokens 砍斷」。
            model_kwargs["stream_options"] = {"include_usage": True}
        self._client = (
            ChatOpenAI(
                api_key=settings.NIM_API_KEY,
                base_url=settings.NIM_BASE_URL,
                model=self._model,
                temperature=getattr(settings, "ADVISOR_LLM_TEMPERATURE", 0.2),
                timeout=self._timeout_seconds,
                max_retries=self._max_retries,
                max_completion_tokens=self._max_completion_tokens,
                streaming=self._streaming,
                stream_chunk_timeout=self._stream_chunk_timeout,
                model_kwargs=model_kwargs,
                extra_body=_thinking_extra_body(self._model),
            )
            if self._enabled and ChatOpenAI is not None
            else None
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def model_name(self) -> str:
        return self._model


    async def generate_text_brief_from_evidence(
        self,
        *,
        task_packet: dict[str, Any],
    ) -> tuple[dict[str, Any], str, dict[str, Any]]:
        if not self._enabled or self._client is None:
            log_warn(
                "text_brief.llm.disabled",
                enabled=self._enabled,
                model=self._model,
                has_api_key=bool(self._settings.NIM_API_KEY),
                base_url=self._settings.NIM_BASE_URL or "-",
            )
            raise RuntimeError(
                "LLM service is disabled: missing NIM_API_KEY, NIM_BASE_URL, model, or langchain dependencies"
            )

        messages = build_text_brief_messages(task_packet)
        prompt_chars = sum(len(content) for _, content in messages)

        # 這一段是最常卡住的地方：只印 start 而遲遲沒有 done，就代表在等 NIM 回應。
        with stage(
            "text_brief.llm",
            model=self._model,
            messages=len(messages),
            few_shot=(len(messages) - 2) // 2,
            prompt_chars=prompt_chars,
            max_tokens=self._max_completion_tokens,
            timeout_s=self._timeout_seconds,
            max_retries=self._max_retries,
            streaming=self._streaming,
        ) as info:
            response = await self._client.ainvoke(messages)
            raw_content = response.content
            raw_text = _coerce_llm_text(raw_content)
            response_metadata = getattr(response, "response_metadata", {}) or {}
            finish_reason = response_metadata.get("finish_reason")
            token_usage = response_metadata.get("token_usage") or {}
            completion_tokens = token_usage.get("completion_tokens")
            if completion_tokens is None:
                completion_tokens = (getattr(response, "usage_metadata", {}) or {}).get(
                    "output_tokens"
                )
            info["finish_reason"] = finish_reason
            info["prompt_tokens"] = token_usage.get("prompt_tokens")
            info["completion_tokens"] = completion_tokens
            info["reply_chars"] = len(raw_text)

        meta = {
            "finish_reason": finish_reason,
            "completion_tokens": (
                completion_tokens if isinstance(completion_tokens, int) else None
            ),
            "truncated": finish_reason == "length",
        }
        get_logger().debug(
            "text_brief.llm.raw model=%s preview=%s", self._model, raw_text[:1500]
        )

        if meta["truncated"]:
            log_warn(
                "text_brief.llm.truncated",
                model=self._model,
                completion_tokens=meta["completion_tokens"],
                max_tokens=self._max_completion_tokens,
            )
            return {}, raw_text, meta

        parsed = _load_json_object(raw_text)
        if parsed is None:
            log_warn(
                "text_brief.llm.parse_failed",
                model=self._model,
                reply_chars=len(raw_text),
                preview=raw_text[:200].replace("\n", " "),
            )
            return {}, raw_text, meta

        return parsed, raw_text, meta
