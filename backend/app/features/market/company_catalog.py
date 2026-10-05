"""Official TWSE and TPEx listed-company directory shared by market and news jobs."""
from __future__ import annotations

import csv
import io
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.core.config import state_directory


SOURCES = {
    "TWSE": "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    "TPEx": "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
}
TPEX_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv"
# Official industry-code tables in the TWSE and TPEx market-data specifications:
# https://dsp.twse.com.tw/public/static/downloads/computerPlanningOperationsDepartment/TWSE%E9%9B%86%E4%B8%AD%E5%B8%82%E5%A0%B4%E5%8D%B3%E6%99%82%E4%BA%A4%E6%98%93%E8%B3%87%E8%A8%8A%E5%82%B3%E8%BC%B8%E8%A6%8F%E6%A0%BC%E6%9B%B8%28B.12.11%29%28202503%29_20250113092444.pdf
# https://dsp.tpex.org.tw/storage/eb_data/11310/1130501078-1.pdf
TWSE_INDUSTRIES = {
    "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維",
    "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業",
    "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "14": "建材營造",
    "15": "航運業", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨",
    "19": "綜合", "20": "其他", "21": "化學工業", "22": "生技醫療業",
    "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業", "26": "光電業",
    "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
    "31": "其他電子", "35": "綠能環保", "36": "數位雲端", "37": "運動休閒",
    "38": "居家生活",
}
TPEX_INDUSTRIES = {
    code: TWSE_INDUSTRIES[code] for code in (
        "02", "03", "04", "05", "06", "08", "10", "11", "14", "15", "16", "17",
        "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31",
        "35", "36", "37", "38")
} | {"17": "金融業", "22": "生技醫療", "31": "其他電子業",
     "32": "文化創意業", "33": "農業科技業"}


# Supplemental recognition aliases only; membership always comes from the catalog.
COMPANY_ALIASES = {
    "2330": ("TSMC", "台積"),
    "2317": ("Foxconn", "富士康"),
    "2454": ("MediaTek",),
    "2881": ("富邦金控",),
    "2408": ("南亞科技", "Nanya"),
    "5007": ("三星科技",),
}


def company_aliases(symbol: str, company: dict) -> list[str]:
    return list(dict.fromkeys(name for name in (
        company.get("name"), *(company.get("aliases") or []), *COMPANY_ALIASES.get(symbol, ())
    ) if isinstance(name, str) and name.strip()))


def company_name(symbol: str) -> str:
    return (load_catalog().get(symbol) or {}).get("name") or symbol


def load_catalog(path: Path | None = None) -> dict[str, dict]:
    path = path if path is not None else state_directory() / "company_catalog.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        for company in data.values():
            if isinstance(company, dict) and company.get("industry_code") and not company.get("industry_name"):
                names = {"TWSE": TWSE_INDUSTRIES, "TPEx": TPEX_INDUSTRIES}.get(company.get("market"), {})
                company["industry_name"] = names.get(company["industry_code"])
        return data
    except (OSError, ValueError):
        return {}


def _parse(rows: object, market: str) -> dict[str, dict]:
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"Invalid {market} company directory")
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"Invalid {market} company row")
        symbol = str(row.get("公司代號") or row.get("SecuritiesCompanyCode") or "").strip()
        short = str(row.get("公司簡稱") or row.get("CompanyAbbreviation") or "").strip()
        full = str(row.get("公司名稱") or row.get("CompanyName") or "").strip()
        if not re.fullmatch(r"\d{4,6}", symbol) or not short:
            continue
        raw_industry = str(row.get("產業別") or row.get("SecuritiesIndustryCode") or "").strip()
        industry_code = raw_industry.zfill(2) if re.fullmatch(r"\d{1,2}", raw_industry) else None
        names = TWSE_INDUSTRIES if market == "TWSE" else TPEX_INDUSTRIES
        industry_name = str(row.get("產業名稱") or row.get("SecuritiesIndustryName") or "").strip() or names.get(industry_code)
        result[symbol] = {"symbol": symbol, "name": short, "market": market,
                          "aliases": [full] if full and full != short else [],
                          "industry": f"{market}:{industry_code}" if industry_code else None,
                          "industry_code": industry_code, "industry_name": industry_name}
    if not result:
        raise ValueError(f"Empty {market} company directory")
    return result


def refresh_catalog(http: httpx.Client | None = None, path: Path | None = None) -> dict[str, dict]:
    """Replace the cached directory only after both official markets succeed."""
    path = path if path is not None else state_directory() / "company_catalog.json"
    if http is None:
        with httpx.Client(trust_env=False, timeout=30) as client:
            return refresh_catalog(client, path)
    catalog = {}
    for market, url in SOURCES.items():
        try:
            response = http.get(url)
            response.raise_for_status()
            fresh = _parse(response.json(), market)
        except (httpx.HTTPError, ValueError):
            if market != "TPEx":
                raise
            response = http.get(TPEX_CSV)
            response.raise_for_status()
            fresh = _parse(list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))), market)
        if catalog.keys() & fresh.keys():
            raise ValueError("Duplicate company code across markets")
        catalog.update(fresh)
    updated_at = datetime.now(timezone.utc).isoformat()
    for company in catalog.values():
        company["updated_at"] = updated_at
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)
    return catalog
