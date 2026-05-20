from __future__ import annotations

from datetime import date
from typing import Any, Callable


FieldConverter = Callable[[Any], Any]
FieldSpec = tuple[str, str, FieldConverter]


def _optional_float(value: Any) -> float | None:
    return float(value) if value is not None else None


def _optional_int(value: Any) -> int | None:
    return int(value) if value is not None else None


def _zero_default_int(value: Any) -> int:
    return int(value or 0)


PRICE_FIELD_SPECS: tuple[FieldSpec, ...] = (
    ("open", "open", _optional_float),
    ("high", "high", _optional_float),
    ("low", "low", _optional_float),
    ("close", "close", _optional_float),
    ("volume_shares", "volume_shares", _optional_int),
    ("amount", "amount", _optional_int),
    ("change", "change", _optional_float),
)

CHIP_FIELD_SPECS: tuple[FieldSpec, ...] = (
    ("foreign_buy", "foreign_buy", _zero_default_int),
    ("foreign_sell", "foreign_sell", _zero_default_int),
    ("foreign_net", "foreign_net", _zero_default_int),
    ("investment_trust_buy", "investment_trust_buy", _zero_default_int),
    ("investment_trust_sell", "investment_trust_sell", _zero_default_int),
    ("investment_trust_net", "investment_trust_net", _zero_default_int),
    ("dealer_buy", "dealer_buy", _zero_default_int),
    ("dealer_sell", "dealer_sell", _zero_default_int),
    ("dealer_net", "dealer_net", _zero_default_int),
    ("total_institutional_buy", "total_institutional_buy", _zero_default_int),
    ("total_institutional_sell", "total_institutional_sell", _zero_default_int),
    ("total_institutional_net", "total_institutional_net", _zero_default_int),
)

TECHNICAL_FIELD_SPECS: tuple[FieldSpec, ...] = (
    ("close", "close", _optional_float),
    ("ma5", "ma5", _optional_float),
    ("ma10", "ma10", _optional_float),
    ("ma20", "ma20", _optional_float),
    ("ma60", "ma60", _optional_float),
    ("ma120", "ma120", _optional_float),
    ("ma240", "ma240", _optional_float),
    ("rsi5", "rsi5", _optional_float),
    ("rsi10", "rsi10", _optional_float),
    ("rsv9", "rsv9", _optional_float),
    ("kd_k9", "kd_k9", _optional_float),
    ("kd_d9", "kd_d9", _optional_float),
    ("kd_j9", "kd_j9", _optional_float),
    ("ema12", "ema12", _optional_float),
    ("ema26", "ema26", _optional_float),
    ("macd_dif", "macd_dif", _optional_float),
    ("macd_dea", "macd_dea", _optional_float),
    ("macd_signal", "macd_signal", _optional_float),
    ("macd_hist", "macd_hist", _optional_float),
    ("boll_mid20", "boll_mid20", _optional_float),
    ("boll_upper20", "boll_upper20", _optional_float),
    ("boll_lower20", "boll_lower20", _optional_float),
    ("volume_ma5", "volume_ma5", _optional_float),
)


def serialize_window_rows(
    rows: list[Any],
    *,
    field_specs: tuple[FieldSpec, ...],
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    data = [
        {
            "date": row.date.isoformat(),
            **{
                output_field: converter(getattr(row, source_field, None))
                for output_field, source_field, converter in field_specs
            },
        }
        for row in rows
    ]
    return {
        "window": f"{start_date.isoformat()}~{end_date.isoformat()}",
        "data": data,
        "count": len(data),
    }


def serialize_price_window_rows(rows: list[Any], *, start_date: date, end_date: date) -> dict[str, Any]:
    return serialize_window_rows(
        rows,
        field_specs=PRICE_FIELD_SPECS,
        start_date=start_date,
        end_date=end_date,
    )


def serialize_chip_window_rows(rows: list[Any], *, start_date: date, end_date: date) -> dict[str, Any]:
    return serialize_window_rows(
        rows,
        field_specs=CHIP_FIELD_SPECS,
        start_date=start_date,
        end_date=end_date,
    )


def serialize_technical_window_rows(rows: list[Any], *, start_date: date, end_date: date) -> dict[str, Any]:
    return serialize_window_rows(
        rows,
        field_specs=TECHNICAL_FIELD_SPECS,
        start_date=start_date,
        end_date=end_date,
    )
