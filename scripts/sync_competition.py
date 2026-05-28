#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
청약홈 경쟁률 데이터 수집 → Neon DB upsert (방식 A)
====================================================
Anaconda 환경에서 실행:
    pip install requests psycopg2-binary
    python sync_competition.py

route.ts 의 가공 로직(순위/지역 정규화, 특공 병합, 경쟁률 계산)을
Python 으로 그대로 포팅했습니다. 결과 CompetitionItem 구조가
앱(route.ts)이 기대하는 형태와 100% 동일합니다.

환경변수:
    ODCLOUD_API_KEY  : 공공데이터포털 API 키 (운영키)
    DATABASE_URL     : Neon 연결 문자열 (pooled connection string 권장)
"""

import os
import json
import sys
import time
from datetime import datetime, timezone

import requests
import psycopg2
from psycopg2.extras import execute_values

# ---- 환경변수 ----
API_KEY = os.environ.get("ODCLOUD_API_KEY", "").strip()
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

API_BASE = "https://api.odcloud.kr/api"
PER_PAGE = 1000
MAX_PAGE = 60          # 안전장치 (route.ts와 동일)
REQUEST_TIMEOUT = 30   # 초


# ===================== 유틸 (route.ts 포팅) =====================
def parse_date(value) -> str:
    text = str(value if value is not None else "").strip()
    if not text:
        return ""
    normalized = text.replace(".", "-").replace("/", "-")
    digits = normalized.replace("-", "")
    if len(digits) == 8 and digits.isdigit():
        return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
    if len(normalized) == 10 and normalized[4] == "-" and normalized[7] == "-":
        return normalized
    return text


def to_ym(date_str: str) -> str:
    text = (date_str or "").strip()
    if not text:
        return ""
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[0:7]
    if len(text) == 7 and text[4] == "-":
        return text
    digits = text.replace("-", "")
    if len(digits) == 8 and digits.isdigit():
        return f"{digits[0:4]}-{digits[4:6]}"
    return ""


REGION_KEYWORDS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
]


def normalize_region_from_text(source: str) -> str:
    text = (source or "").strip()
    for kw in REGION_KEYWORDS:
        if kw in text:
            return kw
    return ""


def normalize_region(house_name: str, address: str = "", region_name: str = "") -> str:
    for src in (region_name, address, house_name):
        r = normalize_region_from_text(src)
        if r:
            return r
    return "기타"


def pick_house_name(row: dict) -> str:
    return str(
        row.get("HOUSE_NM") or row.get("HSSPLY_NM") or row.get("PBLANC_NM") or ""
    ).strip()


def normalize_rank(value) -> str:
    text = str(value if value is not None else "").strip()
    if text == "00":
        return "3"
    if text in ("01", "1"):
        return "1"
    if text in ("02", "2"):
        return "2"
    if text in ("03", "3"):
        return "3"
    return text


def normalize_reside_from_code(code) -> str:
    text = str(code if code is not None else "").strip()
    return {"01": "해당지역", "02": "기타지역", "03": "기타경기"}.get(text, "")


def normalize_reside(name, code=None) -> str:
    text = (name or "").strip()
    if not text:
        return normalize_reside_from_code(code)
    if text in ("해당지역", "기타지역", "기타경기"):
        return text
    if "기타" in text:
        return "기타지역"
    if "해당" in text:
        return "해당지역"
    return text


def normalize_rate(raw_rate, req_cnt, suply) -> str:
    text = str(raw_rate if raw_rate is not None else "").strip()
    if text and text not in ("null", "undefined"):
        return text
    try:
        req = float(req_cnt or 0)
        supply = float(suply or 0)
    except (TypeError, ValueError):
        return "-"
    if not supply:
        return "-"
    rate = req / supply
    # route.ts: toFixed(2) 후 불필요한 0 제거
    s = f"{rate:.2f}"
    if s.endswith(".00"):
        s = s[:-3]
    elif s.endswith("0"):
        s = s[:-1]
    return s


def to_item_key(pblanc_no: str, house_manage_no: str) -> str:
    return pblanc_no or house_manage_no


# ===================== 특공 집계 (route.ts SpecialAgg 포팅) =====================
SPECIAL_FIELDS = [
    "MNYCH_HSHLDCO",
    "NWWDS_NMTW_HSHLDCO",
    "LFE_FRST_HSHLDCO",
    "NWBB_NWBBSHR_HSHLDCO",
    "YGMN_HSHLDCO",
    "OLD_PARNTS_SUPORT_HSHLDCO",
    "CRSPAREA_MNYCH_CNT",
    "CRSPAREA_NWWDS_NMTW_CNT",
    "CRSPAREA_LFE_FRST_CNT",
    "CRSPAREA_NWBB_NWBBSHR_CNT",
    "CRSPAREA_YGMN_CNT",
    "CRSPAREA_OPS_CNT",
]


def empty_special_agg() -> dict:
    return {k: 0 for k in SPECIAL_FIELDS}


def to_special_agg(row: dict) -> dict:
    agg = {}
    for k in SPECIAL_FIELDS:
        try:
            agg[k] = int(float(row.get(k) or 0))
        except (TypeError, ValueError):
            agg[k] = 0
    return agg


def merge_special_agg(target: dict, add: dict) -> dict:
    return {k: target.get(k, 0) + add.get(k, 0) for k in SPECIAL_FIELDS}


def special_agg_to_record(agg: dict):
    out = {k: str(agg.get(k, 0)) for k in SPECIAL_FIELDS}
    has_any = any(int(v) > 0 for v in out.values())
    return out if has_any else None


# ===================== API 호출 (페이지네이션) =====================
def fetch_paged(endpoint: str, max_page: int = MAX_PAGE) -> list:
    if not API_KEY:
        raise RuntimeError("ODCLOUD_API_KEY 환경변수가 없습니다.")

    rows = []
    page = 1
    while page <= max_page:
        url = f"{API_BASE}/{endpoint}"
        params = {
            "serviceKey": API_KEY,
            "page": page,
            "perPage": PER_PAGE,
            "returnType": "JSON",
        }
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        if not resp.ok:
            raise RuntimeError(f"API 실패: {endpoint} {resp.status_code}")
        data = resp.json().get("data", []) or []
        rows.extend(data)
        if len(data) < PER_PAGE:
            break
        page += 1
        time.sleep(0.1)  # API 부하 완화
    return rows


def fetch_competition_rows() -> list:
    return fetch_paged("ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet")


def fetch_special_supply_rows() -> list:
    return fetch_paged("ApplyhomeInfoCmpetRtSvc/v1/getAPTSpsplyReqstStus")


def fetch_notice_rows() -> list:
    candidates = [
        "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail",
        "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblanc",
    ]
    for endpoint in candidates:
        try:
            rows = fetch_paged(endpoint)
            if rows:
                return rows
        except Exception:
            continue
    return []


# ===================== 그룹핑 (route.ts GET 핸들러 포팅) =====================
def build_competition_items() -> list:
    """청약홈 3종 API → 완성된 CompetitionItem 리스트.

    중요: route.ts와 달리 필터(keyword/region/ym)는 적용하지 않는다.
    DB에는 '전체 확정 데이터'를 넣어두고, 필터는 앱이 SELECT 시점에 건다.
    """
    competition_rows = fetch_competition_rows()
    special_rows = fetch_special_supply_rows()
    notice_rows = fetch_notice_rows()

    # 공고 메타 맵
    notice_map = {}
    for row in notice_rows:
        pblanc_no = str(row.get("PBLANC_NO") or "").strip()
        house_manage_no = str(row.get("HOUSE_MANAGE_NO") or "").strip()
        key = to_item_key(pblanc_no, house_manage_no)
        if not key:
            continue
        notice_map[key] = {
            "houseName": pick_house_name(row),
            "address": str(row.get("HSSPLY_ADRES") or row.get("ADRES") or "").strip(),
            "regionName": str(row.get("SUBSCRPT_AREA_CODE_NM") or "").strip(),
            "rceptBgnde": parse_date(row.get("RCEPT_BGNDE")),
            "rceptEndde": parse_date(row.get("RCEPT_ENDDE")),
        }

    # 특공 집계 + 메타
    special_map = {}
    meta_map = {}
    for row in special_rows:
        pblanc_no = str(row.get("PBLANC_NO") or "").strip()
        house_manage_no = str(row.get("HOUSE_MANAGE_NO") or "").strip()
        key = to_item_key(pblanc_no, house_manage_no)
        if not key:
            continue
        current = special_map.get(key) or empty_special_agg()
        special_map[key] = merge_special_agg(current, to_special_agg(row))
        if key not in meta_map:
            meta_map[key] = {
                "houseName": pick_house_name(row),
                "rceptBgnde": parse_date(row.get("RCEPT_BGNDE")),
                "rceptEndde": parse_date(row.get("RCEPT_ENDDE")),
            }

    # 경쟁률 그룹핑
    grouped = {}
    for row in competition_rows:
        house_manage_no = str(row.get("HOUSE_MANAGE_NO") or "").strip()
        pblanc_no = str(row.get("PBLANC_NO") or "").strip()
        key = to_item_key(pblanc_no, house_manage_no)
        if not key:
            continue

        notice = notice_map.get(key)
        meta = meta_map.get(key)

        house_name = (
            (notice or {}).get("houseName")
            or (meta or {}).get("houseName")
            or pick_house_name(row)
            or "단지명 확인중"
        )
        rcept_bgnde = (
            (notice or {}).get("rceptBgnde")
            or (meta or {}).get("rceptBgnde")
            or parse_date(row.get("RCEPT_BGNDE"))
        )
        rcept_endde = (
            (notice or {}).get("rceptEndde")
            or (meta or {}).get("rceptEndde")
            or parse_date(row.get("RCEPT_ENDDE"))
        )
        row_region = normalize_region(
            house_name,
            (notice or {}).get("address", ""),
            (notice or {}).get("regionName", ""),
        )

        if key not in grouped:
            grouped[key] = {
                "pblancNo": key,
                "houseName": house_name,
                "region": row_region,
                "rceptBgnde": rcept_bgnde,
                "rceptEndde": rcept_endde,
                "houseTypes": [],
            }

        grouped[key]["houseTypes"].append({
            "type": str(row.get("HOUSE_TY") or "").strip(),
            "rate": normalize_rate(row.get("CMPET_RATE"), row.get("REQ_CNT"), row.get("SUPLY_HSHLDCO")),
            "reqCnt": str(row.get("REQ_CNT") if row.get("REQ_CNT") is not None else "0"),
            "suply": str(row.get("SUPLY_HSHLDCO") if row.get("SUPLY_HSHLDCO") is not None else "0"),
            "rank": normalize_rank(row.get("SUBSCRPT_RANK_CODE")),
            "reside": normalize_reside(row.get("RESIDE_SENM"), row.get("RESIDE_SECD")),
        })

    # 특공 집계를 첫 주택형에 얹기 + 주택형 정렬
    items = []
    for item in grouped.values():
        spsply_agg = special_map.get(item["pblancNo"])
        spsply = special_agg_to_record(spsply_agg) if spsply_agg else None
        if spsply and item["houseTypes"]:
            item["houseTypes"][0]["spsply"] = spsply

        item["houseTypes"].sort(key=lambda h: (
            h["type"],
            int(h["rank"]) if str(h["rank"]).isdigit() else 0,
            h["reside"],
        ))
        items.append(item)

    items.sort(key=lambda it: it.get("rceptBgnde") or "", reverse=True)
    return items


# ===================== DB upsert =====================
def upsert_items(items: list) -> int:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL 환경변수가 없습니다.")

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            values = []
            for it in items:
                values.append((
                    it["pblancNo"],
                    it["houseName"],
                    it["region"],
                    it.get("rceptBgnde") or None,
                    it.get("rceptEndde") or None,
                    to_ym(it.get("rceptBgnde") or "") or None,
                    json.dumps(it, ensure_ascii=False),
                ))

            # PBLANC_NO 기준 upsert (있으면 갱신, 없으면 삽입)
            execute_values(
                cur,
                """
                INSERT INTO competition_items
                    (pblanc_no, house_name, region, rcept_bgnde, rcept_endde, ym, item, updated_at)
                VALUES %s
                ON CONFLICT (pblanc_no) DO UPDATE SET
                    house_name  = EXCLUDED.house_name,
                    region      = EXCLUDED.region,
                    rcept_bgnde = EXCLUDED.rcept_bgnde,
                    rcept_endde = EXCLUDED.rcept_endde,
                    ym          = EXCLUDED.ym,
                    item        = EXCLUDED.item,
                    updated_at  = now()
                """,
                values,
                template="(%s, %s, %s, %s, %s, %s, %s::jsonb, now())",
                page_size=500,
            )

            cur.execute(
                "INSERT INTO competition_sync_log (item_count, note) VALUES (%s, %s)",
                (len(items), "sync_competition.py"),
            )
        conn.commit()
        return len(items)
    finally:
        conn.close()


def main():
    started = datetime.now(timezone.utc)
    print(f"[{started.isoformat()}] 청약홈 경쟁률 수집 시작...")

    items = build_competition_items()
    print(f"  - 가공 완료: 공고 {len(items)}건")

    saved = upsert_items(items)
    print(f"  - DB upsert 완료: {saved}건")

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"완료 (소요 {elapsed:.1f}초)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        sys.exit(1)
