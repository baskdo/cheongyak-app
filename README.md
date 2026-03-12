# 🏢 한눈에 보는 청약홈

복잡한 아파트 청약 공고를 요약된 정보로 쉽고 빠르게 확인하세요.

## 🚀 배포 방법 (Vercel - 무료)

### 1단계: GitHub에 올리기

```bash
# 터미널(또는 아나콘다 프롬프트)에서 실행
git init
git add .
git commit -m "첫 번째 커밋: 청약홈 앱"

# GitHub에서 새 레포지토리 만든 후
git remote add origin https://github.com/본인계정/레포이름.git
git branch -M main
git push -u origin main
```

### 2단계: Vercel 배포

1. [vercel.com](https://vercel.com) 접속 → GitHub으로 로그인
2. **"New Project"** 클릭
3. 방금 올린 레포지토리 선택 → **"Import"**
4. **Environment Variables** 섹션에서:
   - Name: `API_KEY`
   - Value: 공공데이터포털에서 받은 API 키 입력
5. **"Deploy"** 클릭!

약 1분 후 `https://프로젝트명.vercel.app` 으로 접속 가능!

---

## 💻 로컬 개발 방법

```bash
# 1. 패키지 설치
npm install

# 2. .env.local 파일 만들기
cp .env.local.example .env.local
# .env.local 파일 열어서 API_KEY에 실제 키 입력

# 3. 개발 서버 실행
npm run dev

# http://localhost:3000 에서 확인
```

---

## 🔑 API 키 발급 방법

1. [공공데이터포털](https://www.data.go.kr) 접속
2. 회원가입/로그인
3. 검색창에 `"APT분양정보"` 또는 `"청약홈"` 검색
4. **"한국부동산원_APT분양정보"** 선택 → 활용신청
5. 승인 후 마이페이지에서 API 키 확인

---

## 🛠 기술 스택

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **API**: 공공데이터포털 청약홈 API
- **배포**: Vercel (무료)

---

## 📝 API 키 없어도 괜찮아요

API 키가 없어도 샘플 데이터로 화면이 정상 동작합니다.
Vercel에 API_KEY를 설정하면 실시간 청약 데이터가 표시됩니다.
