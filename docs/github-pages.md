# GitHub Pages 배포

이 저장소의 `main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 Vite 빌드를 실행하고 `dist`를 GitHub Pages에 배포합니다. 빌드 시 저장소 이름에 맞춰 `/Becoming-a-pigeon/` 경로가 적용됩니다.

1. GitHub 저장소 `pigeon-master/Becoming-a-pigeon`에서 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.
2. 이 변경을 `main`에 커밋하고 푸시합니다.
3. **Actions** 탭에서 `Deploy to GitHub Pages` 작업이 성공했는지 확인합니다.
4. `https://pigeon-master.github.io/Becoming-a-pigeon/`에 접속합니다.

PowerShell에서는 `npm.cmd run build`로 로컬 빌드를 확인할 수 있습니다. GitHub Actions에서는 별도의 개발용 HTTPS 인증서가 필요하지 않습니다.

GitHub Pages는 정적 파일만 제공하므로 이 배포에서는 기본 로컬 저장 모드가 사용됩니다. 생성한 비둘기는 각 브라우저의 IndexedDB에 저장되며 다른 사람의 브라우저와 공유되지 않습니다. 여러 사용자에게 같은 비둘기 무리를 보여주려면 나중에 별도 서버와 데이터베이스를 배포해야 합니다.
