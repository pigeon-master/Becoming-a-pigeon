# GitHub Pages + Supabase 연결

가입 화면이나 로그인 버튼은 추가하지 않습니다. Supabase가 최초 촬영 시 브라우저에 익명 사용자 ID를 발급합니다. 서버의 RLS 정책이 그 ID로 소유권을 확인합니다.

## 1. Supabase 프로젝트 설정

1. Supabase 프로젝트의 **Authentication → Sign In / Providers**에서 **Anonymous Sign-Ins**를 활성화하고 저장합니다. 표시 위치는 대시보드 버전에 따라 Authentication 설정 아래에 있을 수 있습니다.
2. **SQL Editor → New query**를 엽니다.
3. 프로젝트 파일 `supabase/schema.sql`의 전체 내용을 붙여넣고 **Run**을 누릅니다.
4. **Table Editor**에서 `public.pigeons` 테이블이 생성됐는지 확인합니다. RLS는 활성화된 상태로 유지하세요.
5. **Connect** 또는 **Project Settings → API / API Keys**에서 Project URL과 **publishable key**를 복사합니다. 예전 프로젝트라면 **legacy anon key**도 사용할 수 있습니다.

사용하는 키는 브라우저에서 사용하도록 만든 공개 키입니다. `sb_secret_...` 키나 `service_role` 키는 이 사이트에 넣지 마세요. 코드가 해당 키로 빌드하는 것을 차단합니다.

이 SQL은 `pigeons`, `pigeon_private` 이름을 사용합니다. 이미 다른 용도로 같은 이름의 테이블/스키마가 있다면 먼저 이름 충돌을 확인하세요. SQL을 다시 실행해도 이 구성으로 만든 비둘기 데이터는 보존됩니다.

## 2. GitHub에 연결 정보 등록

1. `pigeon-master/Becoming-a-pigeon` 저장소의 **Settings → Secrets and variables → Actions → Variables**를 엽니다.
2. **New repository variable**로 다음 두 값을 등록합니다.

| 이름 | 값 |
| --- | --- |
| `VITE_SUPABASE_URL` | 프로젝트 URL, 예: `https://xxxxxxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key 또는 legacy anon key |

Variables 대신 동일한 이름의 **Repository secrets**에 등록해도 동작합니다. 두 곳에 같은 이름이 있으면 Variables 값이 우선 적용됩니다. 이름을 정확히 맞춰 주세요.

3. **Settings → Pages → Source**가 **GitHub Actions**인지 확인합니다.
4. 코드 변경을 `main`에 커밋하고 푸시합니다.

```powershell
git add package.json package-lock.json src vite.config.ts .github/workflows/deploy-pages.yml .env.supabase.example supabase docs scripts/supabase.test.mjs scripts/supabase-browser.mjs
git commit -m "Connect shared pigeons and speech to Supabase"
git push origin main
```

5. 푸시만으로 자동 배포되지 않습니다. 배포가 필요할 때 **Actions → Deploy to GitHub Pages → Run workflow**에서 `main`을 선택해 실행합니다. 성공하면 `https://pigeon-master.github.io/Becoming-a-pigeon/`에 접속합니다. 변수만 바꿨을 때도 수동으로 다시 빌드해야 합니다. 공개 키와 URL은 빌드 때 포함되므로 재배포 전에는 반영되지 않습니다.

배포 워크플로는 Supabase 모드로 빌드합니다. 두 값이 누락되거나 키 종류가 잘못되면 배포가 중단되고 설명이 로그에 표시됩니다.

## 3. 내 컴퓨터에서 연결 테스트하기 (선택)

1. `.env.supabase.example`을 `.env.local`이라는 이름으로 복사합니다.
2. `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`를 실제 값으로 수정합니다. `VITE_STORAGE_MODE=supabase`를 유지합니다.
3. `npm.cmd run dev`를 직접 실행합니다. 로컬 개발은 기존 HTTPS 설정을 사용합니다.

`.env.local`은 Git에서 제외됩니다. 해당 파일을 만들지 않으면 로컬 개발은 기존 IndexedDB 모드입니다. `.env.server`는 예전 별도 서버 모드 설정이며 이 Supabase 배포에서는 사용하지 않습니다.

## 4. 두 사용자로 확인하기

1. 일반 브라우저 A에서 비둘기를 만들고 `Wanna Say Something?`으로 글을 쓴 뒤 Enter를 누릅니다. 입력창이 닫히고 Supabase `pigeons.message`와 `automatic`에 저장됩니다. 기존 자동 9·점과 한글 입력 처리는 유지됩니다.
2. 시크릿 창 또는 다른 브라우저 B로 같은 사이트를 엽니다. A의 비둘기와 말풍선이 보이지만 B가 아직 비둘기를 만들지 않았다면 `Become a Pigeon`만 표시됩니다.
3. B도 비둘기를 만들고 글을 제출합니다. A와 B에서 양쪽 말풍선이 보이는지 확인합니다. 저장된 변경은 약 3초 간격으로 반영됩니다. 별도의 Realtime 설정은 필요 없습니다.
4. 각 브라우저에서 글을 수정하면 자신의 가장 최근 비둘기만 변경됩니다. 다른 사람의 데이터는 Supabase가 직접 수정·삭제 요청을 차단합니다.
5. 새로고침 후 소유권과 글이 복원되는지 확인합니다. 저장 실패 시 입력창이 다시 열리고 오류가 표시됩니다. 연결을 복구한 뒤 Enter로 다시 제출하세요.

## 저장과 소유권

- 비둘기의 얼굴 이미지·3D 형태와 제출된 말풍선은 Supabase 데이터베이스에 저장됩니다. GitHub Pages와 Supabase만 사용합니다.
- 입력 중인 글은 해당 브라우저에서 미리 보입니다. Enter나 입력창 닫기로 제출된 글이 다른 방문자에게 표시됩니다.
- 모든 방문자는 저장된 비둘기와 글을 읽습니다. 소유자는 자신의 말풍선을 수정하거나 비둘기를 삭제할 수 있습니다. 소유자 ID·얼굴·생성 순서를 수정하는 권한은 제공하지 않습니다.
- 광장에는 40마리가 남습니다. 41번째 생성부터 데이터베이스 함수가 가장 오래된 개체를 교체합니다. 이는 개별 사용자의 타인 삭제 권한과 별도로 처리됩니다.
- 같은 브라우저의 익명 ID는 새로고침 후 유지됩니다. 다른 기기·브라우저 또는 사이트 데이터 삭제 후에는 소유권이 자동 복원되지 않습니다. 기기 간 소유권 이전에는 향후 별도 복구 코드 기능이 필요합니다.
- 기존 IndexedDB 비둘기는 Supabase로 자동 업로드되지 않습니다. 새 모드에서 만든 개체부터 공유됩니다.
- 익명 인증은 브라우저 세션으로 사용자 ID를 구분합니다. 별도 가입 화면은 없지만 Supabase Authentication에는 익명 사용자가 기록됩니다.

## 오류 해결

- `Anonymous sign-ins are disabled`: Supabase의 Anonymous Sign-Ins를 활성화합니다.
- `Could not find the table / function`: `supabase/schema.sql` 전체를 실행했는지 확인합니다.
- `Invalid API key`: Project URL과 공개 키가 같은 Supabase 프로젝트의 값인지 확인하고 GitHub 변수를 수정한 뒤 재배포합니다.
- 인증 요청에 `429`가 발생하면 잠시 기다린 뒤 다시 시도합니다. 익명 인증의 프로젝트/IP별 요청 제한을 확인하세요. CAPTCHA를 강제하도록 설정했다면 현재 자동 익명 인증에 별도 CAPTCHA 연동이 필요합니다.
- 카메라가 차단되면 GitHub Pages의 HTTPS 주소로 접속하고 브라우저 사이트 권한에서 카메라 사용을 허용합니다.

## 검증

`npm.cmd run test:supabase`는 로컬 PostgreSQL 테스트 환경에서 공개 읽기, 타인 수정·삭제 차단, 본인 수정·삭제, 글자 수 검증, 최대 40마리 교체와 재시도 동작을 확인합니다. `npm.cmd run test:supabase-browser`는 Edge에서 실제 Supabase 클라이언트와 말풍선 입력 코드를 모의 API에 연결해 엔터 저장·방문자 간 조회·소유권 복원·오류 재제출을 검사합니다. 이 테스트들은 실제 Supabase 프로젝트에 연결하거나 프로젝트의 데이터를 변경하지 않습니다.

참고: [Supabase 익명 인증](https://supabase.com/docs/guides/auth/auth-anonymous), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [공개 API 키](https://supabase.com/docs/guides/getting-started/api-keys).
