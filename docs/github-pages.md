# GitHub Pages 배포

이 저장소의 `main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 Vite 빌드를 실행하고 `dist`를 GitHub Pages에 배포합니다. 빌드 시 저장소 이름에 맞춰 `/Becoming-a-pigeon/` 경로가 적용됩니다.

1. GitHub 저장소 `pigeon-master/Becoming-a-pigeon`에서 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.
2. 이 변경을 `main`에 커밋하고 푸시합니다.
3. **Actions** 탭에서 `Deploy to GitHub Pages` 작업이 성공했는지 확인합니다.
4. `https://pigeon-master.github.io/Becoming-a-pigeon/`에 접속합니다.

PowerShell에서는 `npm.cmd run build`로 로컬 빌드를 확인할 수 있습니다. GitHub Actions에서는 별도의 개발용 HTTPS 인증서가 필요하지 않습니다.

배포 워크플로는 Supabase 모드로 빌드합니다. GitHub Actions의 Repository variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 등록하고 Supabase에서 익명 인증과 데이터베이스를 설정하세요. 자세한 순서는 [Supabase 연결 안내](supabase.md)에 있습니다. Supabase가 비둘기·말풍선 저장과 소유자 권한을 담당하며 별도 Node 서버는 필요하지 않습니다.
