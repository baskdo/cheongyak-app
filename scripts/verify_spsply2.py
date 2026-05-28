#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
재수집 후 검증 v2: DB의 spsplyDetail 을 카드(CompetitionCard) 로직 그대로
계산해서 화면 표시값(검암역 222/384)과 일치하는지 확인.

실행 (DATABASE_URL 설정된 상태):
    python verify_spsply2.py
"""
import os
import json
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
TARGET_KEYWORD = "검암역자이르네"


def calc_card_totals(spsply_detail: dict):
    """CompetitionCard 의 specialTotalReq / specialTotalSupply 계산 그대로."""
    total_req = 0
    total_supply = 0
    for ht in spsply_detail.get("houseTypes", []):
        for cat in ht.get("categories", []):
            total_supply += cat.get("suply", 0)
            if "areaData" in cat:
                a = cat["areaData"]
                total_req += a["해당"] + a["기타경기"] + a["기타지역"]
            elif "instData" in cat:
                i = cat["instData"]
                total_req += i["결정"] + i["미결"]
    return total_req, total_supply


conn = psycopg2.connect(DATABASE_URL)
with conn.cursor() as cur:
    cur.execute(
        "SELECT house_name, item FROM competition_items WHERE house_name ILIKE %s LIMIT 3",
        (f"%{TARGET_KEYWORD}%",),
    )
    rows = cur.fetchall()
conn.close()

if not rows:
    print("DB에 해당 단지 없음")
    raise SystemExit(1)

for house_name, item in rows:
    if isinstance(item, str):
        item = json.loads(item)
    detail = item.get("spsplyDetail")
    print("=" * 56)
    print(house_name)
    print("=" * 56)
    if not detail:
        print("  spsplyDetail 없음 (특공 없는 단지이거나 미수집)")
        continue
    req, supply = calc_card_totals(detail)
    print(f"  특공 배정합계(공급): {supply}")
    print(f"  특공 접수합계: {req}")
    print(f"  주택형 수: {len(detail.get('houseTypes', []))}")
    for ht in detail.get("houseTypes", []):
        cats = ", ".join(f"{c['name']}({c['suply']})" for c in ht["categories"])
        print(f"    - {ht['typeLabel']}: {cats}")
    print()
    print(f"  >> 화면에 '특공 (공급 {supply}) {req}건 접수' 로 표시될 값")
    if "검암역" in house_name:
        ok = (supply == 384 and req == 222)
        print(f"  >> 검암역 기대값 384/222 와 {'일치 ✓' if ok else '불일치 ✗'}")
