"""理解任務，再由後端編譯資料存取需求。"""
from time import perf_counter
from typing import Literal

from pydantic import Field, ValidationError

from .prompts import INTENT_SYSTEM_PROMPT
from .schemas import Intent, IntentDetails


TASK_REQUIREMENTS = {
    "portfolio_review": {"portfolio"},
    "favorites_review": {"favorites"},
    "stock_facts": {"market"},
    "stock_analysis": {"market", "news"},
    "news_search": {"news"},
    "explain_finance": {"knowledge"},
    "app_help": {"help"},
    "non_finance": set(),
}


class TaskPlan(IntentDetails):
    tasks: list[Literal[
        "portfolio_review", "favorites_review", "stock_facts", "stock_analysis",
        "news_search", "explain_finance", "app_help", "non_finance",
    ]] = Field(max_length=8)
    portfolio_access: Literal["requested", "not_needed", "forbidden"]
    favorites_access: Literal["requested", "not_needed", "forbidden"]


def compile_plan(plan: TaskPlan) -> Intent:
    tasks = set(plan.tasks)
    if "non_finance" in tasks and len(tasks) != 1:
        raise ValueError("non_finance 不可與支援範圍內的任務混用")
    needs = set().union(*(TASK_REQUIREMENTS[task] for task in tasks))
    for scope in ("portfolio", "favorites"):
        requested = getattr(plan, f"{scope}_access") == "requested"
        if requested != (scope in needs):
            raise ValueError(f"{scope} 的存取判斷與任務不一致")
    details = plan.model_dump(exclude={"tasks", "portfolio_access", "favorites_access"})
    # 明確要求的新聞任務，不得被後續證據檢查略過。
    if "news_search" in tasks:
        details["news_strategy"] = "required"
    details["is_finance"] = "non_finance" not in tasks
    return Intent(**details, data_needs=sorted(needs))


async def plan_request(client, *, request, history, current_time, add_usage):
    """產生一次任務計畫；結構不完整或存取契約矛盾時最多重試一次。"""
    feedback = None
    for attempt in range(2):
        payload = {"query": request.query, "history": history, "current_time": current_time}
        if feedback:
            payload["previous_plan_issue"] = feedback
        plan = await _generate(client, TaskPlan, INTENT_SYSTEM_PROMPT, payload,
                               request._planning_trace, add_usage)
        if plan is None:
            feedback = "請依指定結構回傳完整的任務計畫。"
            continue
        try:
            intent = compile_plan(plan)
        except ValueError as exc:
            request._planning_trace[-1]["status"] = "inconsistent"
            feedback = str(exc)
            request._planning_trace[-1]["issue"] = feedback
            continue
        request._planning_trace[-1]["effective_needs"] = intent.data_needs
        return intent
    return None


async def _generate(client, schema, prompt, payload, trace, add_usage, *, stage="plan"):
    entry = {"stage": stage, "status": "started"}
    trace.append(entry)
    started = perf_counter()
    try:
        result = await client.generate(system_prompt=prompt, payload=payload, schema=schema)
        add_usage(result.metadata)
        entry["finish_reason"] = result.metadata.get("finish_reason")
        entry["tokens"] = {name: result.metadata.get(name) for name in
                           ("prompt_tokens", "completion_tokens", "reasoning_tokens")}
        if result.metadata.get("truncated") or result.metadata.get("finish_reason") not in {None, "stop"}:
            entry["status"] = "incomplete"
            return None
        try:
            parsed = schema.model_validate(result.payload)
        except ValidationError as exc:
            entry["status"] = "invalid"
            entry["invalid_fields"] = [".".join(map(str, error["loc"])) for error in exc.errors()][:20]
            return None
        entry["result"] = parsed.model_dump(mode="json")
        entry["status"] = "accepted"
        return parsed
    except BaseException as exc:
        entry["status"] = "failed"
        entry["error_type"] = type(exc).__name__
        raise
    finally:
        entry["duration_ms"] = int((perf_counter() - started) * 1000)
