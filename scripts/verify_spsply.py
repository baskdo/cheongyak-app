#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
특공값 검증: DB 저장값 vs special-supply API 실제 출력값 비교
==============================================================
경쟁률 카드의 특공을 DB(item.spsply)로 통합해도 되는지 판단하기 위한 검증.

DB에 저장된 spsply(현재 sync_competition.py가 넣은 값)로 계산한
(배정합계 / 접수합계) 가, 청약홈 special-supply API가 만드는 값과
일치하는지 확인한다.

실행 (환경변수 ODCLOUD_API_KEY, DATABASE_URL 설정된 상태에서):
    python verify_spsply.py
"""
import os
import json
import requests
import psycopg2

API_KEY = os.environ.get("ODCLOUD_API_KEY", "").strip()
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

# 검증할 단지 키워드 (DB house_name 부분일치)
TARGET_KEYWORD = "검암역자이르네"

SPECIAL_FIELDS_ASSIGN = [  # 배정세대 필드 (12개 중 일반6 + 기관2)
    "MNYCH_HSHLDCO", "NWWDS_NMTW_HSHLDCO", "LFE_FRST_HSHLDCO",
    "NWBB_NWBBSHR_HSHLDCO", "YGMN_HSHLDCO", "OLD_PARNTS_SUPORT_HSHLDCO",
]
SPECIAL_FIELDS_REQ_DB = [  # DB spsply 에 들어있는 접수 필드 (= CRSPAREA = 해당지역만)
    "CRSPAREA_MNYCH_CNT", "CRSPAREA_NWWDS_NMTW_CNT", "CRSPAREA_LFE_FRST_CNT",
    "CRSPAREA_NWBB_NWBBSHR_CNT", "CRSPAREA_YGMN_CNT", "CRSPAREA_OPS_CNT",
]


def num(v):
    try:
        return int(float(v or 0))
    except (TypeError, ValueError):
        return 0


# ---------- 1) DB 에서 spsply 꺼내기 ----------
print("=" * 64)
print(f"1) DB 저장값 조회: '{TARGET_KEYWORD}'")
print("=" * 64)
conn = psycopg2.connect(DATABASE_URL)
db_pblanc = None
db_spsply = None
db_house = None
with conn.cursor() as cur:
    cur.execute(
        "SELECT pblanc_no, house_name, item FROM competition_items WHERE house_name ILIKE %s LIMIT 5",
        (f"%{TARGET_KEYWORD}%",),
    )
    rows = cur.fetchall()
    if not rows:
        print("  [X] DB에 해당 단지가 없습니다. TARGET_KEYWORD를 바꿔보세요.")
        conn.close()
        raise SystemExit(1)
    for pblanc_no, house_name, item in rows:
        # item 은 jsonb -> psycopg2가 dict로 줌 (혹은 str일 수 있어 방어)
        if isinstance(item, str):
            item = json.loads(item)
        house_types = item.get("houseTypes", [])
        spsply = None
        for ht in house_types:
            if ht.get("spsply"):
                spsply = ht["spsply"]
                break
        print(f"  - {house_name} (pblanc_no={pblanc_no}) spsply={'있음' if spsply else '없음'}")
        if spsply and db_spsply is None:
            db_pblanc, db_house, db_spsply = pblanc_no, house_name, spsply
conn.close()

if not db_spsply:
    print("  [X] spsply가 저장된 행이 없습니다.")
    raise SystemExit(1)

db_assign = sum(num(db_spsply.get(f)) for f in SPECIAL_FIELDS_ASSIGN)
db_req = sum(num(db_spsply.get(f)) for f in SPECIAL_FIELDS_REQ_DB)
print()
print(f"  >> DB 기준 배정합계: {db_assign}")
print(f"  >> DB 기준 접수합계(해당지역 CRSPAREA만): {db_req}")
print(f"  >> DB spsply 원본: {json.dumps(db_spsply, ensure_ascii=False)}")


# ---------- 2) special-supply API 원본으로 같은 계산 ----------
print()
print("=" * 64)
print("2) 청약홈 special-supply 원본 API 로 같은 단지 계산")
print("=" * 64)
print("  (해당 CRSPAREA + 기타경기 CTPRVN + 기타지역 ETC_AREA 3지역 합산)")

endpoint = "ApplyhomeInfoCmpetRtSvc/v1/getAPTSpsplyReqstStus"
base = f"https://api.odcloud.kr/api/{endpoint}"

api_assign = 0
api_req_3area = 0   # 3지역 합산 (special-supply 방식)
api_req_local = 0   # 해당지역만 (DB 방식과 동일)
found = 0
page = 1
while page <= 60:
    resp = requests.get(base, params={
        "serviceKey": API_KEY, "page": page, "perPage": 1000, "returnType": "JSON",
    }, timeout=30)
    if not resp.ok:
        print(f"  API 실패 {resp.status_code}: {resp.text[:200]}")
        break
    data = resp.json().get("data", []) or []
    for row in data:
        if str(row.get("PBLANC_NO") or "").strip() != str(db_pblanc).strip():
            continue
        found += 1
        # 배정
        api_assign += sum(num(row.get(f)) for f in SPECIAL_FIELDS_ASSIGN)
        # 일반6분류 접수 - 3지역
        for base_field in ["MNYCH", "NWWDS_NMTW", "LFE_FRST", "YGMN", "OPS", "NWBB_NWBBSHR"]:
            local = num(row.get(f"CRSPAREA_{base_field}_CNT"))
            gg = num(row.get(f"CTPRVN_{base_field}_CNT"))
            etc = num(row.get(f"ETC_AREA_{base_field}_CNT"))
            api_req_3area += local + gg + etc
            api_req_local += local
        # 기관추천/이전기관 결정+미결
        inst = num(row.get("INSTT_RECOMEND_DCSN_CNT")) + num(row.get("INSTT_RECOMEND_PREPAR_CNT")) \
             + num(row.get("TRANSR_INSTT_ENFSN_CNT"))
        api_req_3area += inst
        api_req_local += inst
    if len(data) < 1000:
        break
    page += 1

print(f"  매칭된 주택형 행 수: {found}")
print(f"  >> API 기준 배정합계: {api_assign}")
print(f"  >> API 기준 접수합계(3지역, special-supply 방식): {api_req_3area}")
print(f"  >> API 기준 접수합계(해당지역만, DB와 동일 기준): {api_req_local}")


# ---------- 3) 판정 ----------
print()
print("=" * 64)
print("3) 판정")
print("=" * 64)
print(f"  배정:  DB={db_assign}  vs  API={api_assign}  -> {'일치' if db_assign==api_assign else '불일치'}")
print(f"  접수:  DB={db_req}  vs  API(3지역)={api_req_3area}  -> {'일치' if db_req==api_req_3area else '불일치'}")
print(f"  접수:  DB={db_req}  vs  API(해당만)={api_req_local}  -> {'일치' if db_req==api_req_local else '불일치'}")
print()
if db_req == api_req_3area and db_assign == api_assign:
    print("  ==> 결론: DB값이 화면값과 완전히 일치. 그대로 통합 가능.")
elif db_req == api_req_local and db_req != api_req_3area:
    print("  ==> 결론: DB는 '해당지역만' 저장됨. 화면은 3지역 합산이라 값이 다름.")
    print("           통합하려면 sync_competition.py가 3지역(기타경기/기타지역)도")
    print("           수집하도록 먼저 고쳐야 함. (재수집 필요)")
else:
    print("  ==> 결론: 예상과 다른 차이. 위 숫자를 보고 추가 분석 필요.")
