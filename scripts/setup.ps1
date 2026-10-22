# 새 Windows PC에서 이 저장소를 돌리는 데 필요한 프로그램 설치 (winget). 관리자 확인 창(UAC)이 뜨면 "예".
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1            Git, Node.js LTS, Docker Desktop
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Unreal    + Visual Studio 2022(C++ 게임 개발), Epic Games Launcher
# 다음: npm install → npm run setup
param([switch]$Unreal)
$ErrorActionPreference = 'Stop'

function Install([string]$Id, [string[]]$Extra = @()) {
  winget list --id $Id -e --accept-source-agreements *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "  · 이미 있음: $Id"; return }
  Write-Host "  · 설치: $Id"
  winget install --id $Id -e --accept-package-agreements --accept-source-agreements @Extra
  if ($LASTEXITCODE -ne 0) { throw "$Id 설치 실패 ($LASTEXITCODE)" }
}

Install 'Git.Git'
# Nuxt 4: Node 22.21+ 또는 24.11+
Install 'OpenJS.NodeJS.LTS'
Install 'Docker.DockerDesktop'

if ($Unreal) {
  # 언리얼 C++ 빌드: MSVC + Windows SDK + .NET (Epic 권장 워크로드)
  Install 'Microsoft.VisualStudio.2022.Community' @('--override', '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.NativeGame --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Workload.ManagedDesktop --includeRecommended')
  # winget은 설치 관리자를 띄우고 먼저 끝난다 → 실제 설치 완료(isComplete)까지 기다린다
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  while (-not ((& $vswhere -all -format json | ConvertFrom-Json) | Where-Object { $_.isComplete })) {
    Write-Host '  · Visual Studio 설치 진행 중…'; Start-Sleep 30
  }
  Install 'EpicGames.EpicGamesLauncher'
  Write-Host ''
  Write-Host '  → Epic Games Launcher 실행·로그인 → 언리얼 엔진 → 라이브러리 → 엔진 버전 + → 5.8 설치'
  Write-Host '    (옵션: 대상 플랫폼은 Windows만. 기본 경로 C:\Program Files\Epic Games\UE_5.8, 다르면 .env UE_ROOT)'
  Write-Host '    Cesium for Unreal 플러그인은 npm run setup이 GitHub 릴리스에서 받는다 (Fab 설치 불필요)'
}

Write-Host ''
Write-Host '  → Docker Desktop을 한 번 실행해 WSL2 설정을 마친 뒤: npm install → npm run setup'
