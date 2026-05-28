# -*- coding: utf-8 -*-
"""
청약홈 공공 API 응답 속도 / 데이터량 측정 스크립트
- 각 엔드포인트가 몇 페이지까지 가는지, 총 몇 건인지, 페이지당 응답 시간이 얼마인지 측정
- 앱 코드(route.ts)와 동일한 방식(perPage=1000, while 끝까지 페이징)으로 호출
- .env.local 의 ODCLOUD_API_KEY 를 자동으로 읽음

실행:
    conda activate (원하는 환경)
    pip install requests        # 없으면
    python measure_api.py
"""

import os
import time
import sys

try:
    import requests
except ImportError:
    print("requests 모듈이 없습니다. 먼저:  pip install requests")
    sys.exit(1)


# ===================== 설정 =====================
PER_PAGE = 1000           # 앱 코드와 동일
MAX_PAGE_SAFETY = 50      # 측정 폭주 방지용 상한 (앱 competition route엔 상한 없음)
TIMEOUT = 30              # 페이지당 타임아웃(초)

BASE = "https://api.odcloud.kr/api"

# (별칭, 엔드포인트 경로) — route.ts 에서 실제로 호출하는 4개
ENDPOINTS = [
    ("공고상세 (apartments)",   "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"),
    ("주택형/분양가 (apartments)", "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl"),
    ("경쟁률 (competition)",    "ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet"),
    ("특별공급 (special-supply)", "ApplyhomeInfoCmpetRtSvc/v1/getAPTSpsplyReqstStus"),
]


# ===================== 키 읽기 =====================
def load_api_key():
    """환경변수 우선, 없으면 .env.local 파싱"""
    key = os.environ.get("ODCLOUD_API_KEY") or os.environ.get("API_KEY2")
    if key:
        return key.strip()

    # .env.local 은 이 스크립트(data/) 기준 한 단계 위
    here = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(here, "..", ".env.local")
    env_path = os.path.normpath(env_path)

    if not os.path.exists(env_path):
        return None

    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k in ("ODCLOUD_API_KEY", "API_KEY2"):
                return v
    return None


# ===================== 측정 =====================
def measure_endpoint(name, endpoint, key):
    """한 엔드포인트를 perPage=1000 으로 끝까지 순차 페이징하며 측정"""
    page = 1
    total_rows = 0
    page_times = []   # 페이지별 응답 시간(초)
    done = False
    error = None

    wall_start = time.perf_counter()

    while not done and page <= MAX_PAGE_SAFETY:
        url = (
            f"{BASE}/{endpoint}"
            f"?serviceKey={requests.utils.quote(key, safe='')}"
            f"&page={page}&perPage={PER_PAGE}&returnType=JSON"
        )
        t0 = time.perf_counter()
        try:
            res = requests.get(url, timeout=TIMEOUT)
        except Exception as e:
            error = f"page {page} 요청 실패: {e}"
            break
        dt = time.perf_counter() - t0
        page_times.append(dt)

        if res.status_code != 200:
            error = f"page {page} HTTP {res.status_code}"
            break

        try:
            data = res.json().get("data", []) or []
        except Exception as e:
            error = f"page {page} JSON 파싱 실패: {e}"
            break

        total_rows += len(data)
        if len(data) < PER_PAGE:
            done = True
        else:
            page += 1

    wall = time.perf_counter() - wall_start

    return {
        "name": name,
        "pages": len(page_times),
        "rows": total_rows,
        "wall": wall,               # 순차 페이징 전체 소요(초) = 앱이 실제로 기다리는 시간
        "page_times": page_times,
        "hit_safety": (page > MAX_PAGE_SAFETY),
        "error": error,
    }


# ===================== 출력 =====================
def fmt(sec):
    return f"{sec*1000:6.0f}ms" if sec < 1 else f"{sec:6.2f}s "

def main():
    key = load_api_key()
    if not key:
        print("ODCLOUD_API_KEY 를 찾지 못했습니다.")
        print("  - 환경변수 ODCLOUD_API_KEY 설정, 또는")
        print("  - 프로젝트 루트의 .env.local 에 ODCLOUD_API_KEY=... 입력")
        sys.exit(1)

    print("=" * 72)
    print(" 청약홈 공공 API 측정  (perPage=%d, 순차 페이징)" % PER_PAGE)
    print("=" * 72)
    print(f"{'엔드포인트':<26}{'페이지':>5}{'총건수':>9}{'전체시간':>11}{'평균/페이지':>12}")
    print("-" * 72)

    results = []
    for name, endpoint in ENDPOINTS:
        r = measure_endpoint(name, endpoint, key)
        results.append(r)

        if r["error"]:
            print(f"{name:<26}{'ERR':>5}{'-':>9}{'-':>11}   {r['error']}")
            continue

        avg = sum(r["page_times"]) / len(r["page_times"]) if r["page_times"] else 0
        flag = "  ⚠상한도달" if r["hit_safety"] else ""
        print(f"{name:<26}{r['pages']:>5}{r['rows']:>9,}"
              f"{fmt(r['wall']):>11}{fmt(avg):>12}{flag}")

    print("-" * 72)

    # ---- 진단 코멘트 ----
    ok = [r for r in results if not r["error"]]
    if ok:
        slowest = max(ok, key=lambda r: r["wall"])
        total_seq = sum(r["wall"] for r in ok)
        print()
        print("[진단]")
        print(f" - 가장 느린 호출: {slowest['name']}  ({slowest['wall']:.2f}s)")
        print(f"   앱은 Promise.all 로 병렬 호출하므로, 첫 화면 대기 ≈ 가장 느린 호출 시간")
        print(f" - 만약 순차였다면 합계: {total_seq:.2f}s (참고용)")
        max_pages = max(r["pages"] for r in ok)
        if max_pages >= 2:
            print(f" - 최대 {max_pages}페이지까지 페이징됨 → 페이지를 하나씩 기다리는 구조라")
            print(f"   페이지 수에 비례해 느려짐. recent 요청은 1페이지로 줄일 여지가 큼.")
        for r in ok:
            if r["pages"] >= 2:
                p1 = r["page_times"][0]
                rest = sum(r["page_times"][1:])
                print(f"   · {r['name']}: 1페이지 {p1*1000:.0f}ms, "
                      f"나머지 {r['pages']-1}페이지 {rest*1000:.0f}ms 추가 소요")

    print()
    print("※ Vercel 서버(한국 외 리전)에서는 네트워크 지연이 더해져 체감이 더 느릴 수 있습니다.")
    print("※ 이 측정은 캐시 없이 직접 호출한 값입니다 (?fresh=1 상황에 해당).")

if __name__ == "__main__":
    main()
