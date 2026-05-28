#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
청약홈 API 키 진단 스크립트
============================
400 에러 원인을 가려내기 위한 최소 테스트.
환경변수 ODCLOUD_API_KEY 를 읽어서 1페이지만 호출하고,
서버가 돌려준 실제 응답을 그대로 보여준다.

실행:
    python test_api.py
"""
import os
import requests

API_KEY = os.environ.get("ODCLOUD_API_KEY", "").strip()

print("=" * 60)
print("1) 환경변수 확인")
print("=" * 60)
if not API_KEY:
    print("  [X] ODCLOUD_API_KEY 가 비어있습니다. set 명령을 다시 확인하세요.")
    raise SystemExit(1)
print(f"  키 길이: {len(API_KEY)} 글자")
print(f"  앞 6글자: {API_KEY[:6]}")
print(f"  뒤 4글자: {API_KEY[-4:]}   (== 로 끝나야 정상)")
print(f"  '/' 포함 여부: {'/' in API_KEY}")
print(f"  '+' 포함 여부: {'+' in API_KEY}")

endpoint = "ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet"
base = f"https://api.odcloud.kr/api/{endpoint}"

# 방법 A: requests 가 자동 인코딩 (params 사용) — sync_competition.py 와 동일
print()
print("=" * 60)
print("2) 방법 A: params 자동 인코딩 (현재 스크립트 방식)")
print("=" * 60)
try:
    resp = requests.get(
        base,
        params={"serviceKey": API_KEY, "page": 1, "perPage": 5, "returnType": "JSON"},
        timeout=30,
    )
    print(f"  HTTP 상태: {resp.status_code}")
    print(f"  응답 앞부분: {resp.text[:400]}")
except Exception as e:
    print(f"  예외: {e}")

# 방법 B: 키를 그대로 URL 에 붙이기 (인코딩 안 함)
print()
print("=" * 60)
print("3) 방법 B: 키를 URL 에 그대로 부착 (인코딩 안 함)")
print("=" * 60)
try:
    url_b = f"{base}?serviceKey={API_KEY}&page=1&perPage=5&returnType=JSON"
    resp_b = requests.get(url_b, timeout=30)
    print(f"  HTTP 상태: {resp_b.status_code}")
    print(f"  응답 앞부분: {resp_b.text[:400]}")
except Exception as e:
    print(f"  예외: {e}")

print()
print("=" * 60)
print("해석 가이드")
print("=" * 60)
print("  - 방법 A 또는 B 중 하나가 200 이고 data 가 보이면, 그 방식이 정답입니다.")
print("  - 둘 다 400/401 이고 응답에 'SERVICE KEY' 관련 메시지가 있으면 키 문제입니다.")
print("  - 'registered' / 'not registered' 메시지면 키 등록/승인 상태 문제입니다.")