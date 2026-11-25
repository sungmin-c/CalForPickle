<p align="right">
  <sub>
    🌐 Language&nbsp;&nbsp;
    <a href="./README.md">English</a>
    &nbsp;|&nbsp;
    <a href="./README.ko.md">한국어</a>
  </sub>
</p>

<p align="center"><img src="docs/logo.png" width="128" alt="CalForPickle logo"></p>

# CalForPickle

[![Release](https://img.shields.io/github/v/release/sungmin-c/CalForPickle)](https://github.com/sungmin-c/CalForPickle/releases/latest)
[![License: MIT](https://img.shields.io/github/license/sungmin-c/CalForPickle)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-blue)

AI 에이전트가 읽고 쓸 수 있는 Windows용 미니멀 데스크탑 캘린더. 일정은 내 private GitHub 저장소의 JSON 파일이다. "Pickle"은 만든 사람의 에이전트 이름이고, git을 쓸 수 있는 에이전트면 된다.

**[Windows용 다운로드](https://github.com/sungmin-c/CalForPickle/releases/latest)**

- 바탕화면에 붙어 있고(핀을 켜면 아이콘 뒤, 배경화면 앞), 트레이에만 보이며 작업 표시줄 버튼은 없다.
- 일정과 할 일은 **내 private GitHub 저장소**의 JSON 파일이다(`data/events/YYYY-MM.json`, `data/tasks.json`). 앱은 GitHub Contents API로 동기화하고, Pickle(또는 다른 에이전트)은 같은 저장소를 clone해서 `main`에 commit한다.
- 편집은 바로 로컬에 저장되고, 마지막 수정 15초 뒤 올린다. 받아오기는 매일 07:00 이후 한 번과 "지금 동기화" 버튼.
- 시각은 이 PC의 Windows 시간대를 따른다(앱을 켤 때 읽음). 종일 일정은 어디서나 같은 날짜에 보인다.
- 병합은 항목 id 단위, `updatedAt`이 늦은 쪽이 이긴다. 삭제는 `"deleted": true` 표시.
- GitHub 없이도 쓸 수 있다. 그때 데이터는 이 PC에만 있다.

### 설치와 연결

1. **설치.** [Releases](https://github.com/sungmin-c/CalForPickle/releases/latest)에서 `CalForPickle_<버전>_x64-setup.exe`를 받아 실행한다. 코드 서명이 없는 설치본이라 "Windows의 PC 보호" 창이 뜰 수 있다: **추가 정보 → 실행**을 누른다.
2. **데이터 저장소.** 데이터용 **빈 private** 저장소를 만든다(예: `calforpickle-data`). public 저장소에는 앱이 연결을 거부한다.
3. **토큰.** [fine-grained 토큰](https://github.com/settings/personal-access-tokens/new)을 만든다: *Only select repositories* → 그 저장소, *Repository permissions → Contents: Read and write*. 그 밖의 권한은 주지 않는다.
4. **앱 연결.** 톱니바퀴 → owner, repo, 토큰 → 저장. 토큰은 Windows 자격 증명 관리자에만 저장되고 파일에는 남지 않는다. 첫 동기화 때 앱이 저장소에 `AGENT_GUIDE.md`(스키마, 시간대, 쓰기 절차)와 `upcoming.json`(앞으로 14일 요약)을 만든다.
5. **Pickle 연결.** Pickle에는 **그 저장소 하나만** 접근을 허용한다(GitHub App이면 저장소 접근 목록에 추가). 그다음 owner와 repo를 바꿔 이렇게 보낸다:

```text
내 일정은 GitHub 저장소 <owner>/<repo>에 있어. 일정이나 할 일을 읽거나 고치기 전에
그 저장소의 AGENT_GUIDE.md를 먼저 읽고, 거기 적힌 쓰기 절차를 그대로 따라 줘.
```

### 사용법

- **날짜 칸 더블클릭**(또는 그 칸에서 Enter): 그날 체크리스트. 한 줄에 하나, Enter로 다음 줄, Esc로 저장하고 나간다.
- 칸이 차면 보이는 **"+N개"**를 누르면 같은 체크리스트가 전부 열린다.
- **일정을 누르면** 편집·삭제. 반복 일정은 모든 회차를 지우기 전에 한 번 더 묻는다.
- **루틴**: 새 일정(제목과 날짜). 그 아래에 반복 루틴 목록이 있고, 누르면 편집 창이 열린다. 반복은 Pickle에게 부탁해 만든다("매주 월요일 ...").
- **☰**: 메모 패널(날짜 없는 할 일). **톱니바퀴**: 언어(한국어 / English, English는 미국 연방 공휴일, 한국어는 한국 공휴일), GitHub 연결, Windows 시작 시 실행, 배경 불투명도, 단축키.
- **핀**(머리줄, 톱니바퀴 왼쪽): 켜면 바탕화면 아이콘 뒤에 자리가 고정된다. 아이콘이 없는 자리는 평소처럼 누를 수 있다(버튼, 날짜 더블클릭, 입력). 마우스를 올렸을 때의 표시와 끌기는 안 된다. 아이콘과 겹친 자리는 눌리지 않으니 빈 바탕화면에 두자. 끄면 옮기기와 크기 조절만 된다(편집 안 됨). 창 전체가 한 모니터 안에 있어야 고정된다.
- **×**는 트레이로 숨긴다. 끝내려면 트레이 아이콘 메뉴 → 종료(올리지 않은 변경을 먼저 올린다).

### 용량과 메모리

Windows 11, v0.1.1, 대기 상태, 2026-11-25 측정.

| | 값 |
|---|---|
| 설치 용량 | 8.5 MB (`calforpickle.exe` 8.4 MB) |
| 메모리, 앱 프로세스 | 작업 집합 45 MB, 전용 14 MB |
| 메모리, WebView2 포함 | 작업 집합 약 580 MB, 전용 254 MB (`msedgewebview2` 자식 프로세스 7개) |

창이 WebView2 페이지라서 메모리 대부분은 `calforpickle.exe`가 아니라 WebView2 자식 프로세스에 있다. 작업 집합 합계는 공유 페이지를 중복해서 세므로 전용 메모리가 실제에 더 가깝다.

### 데이터 위치

| 위치 | 내용 |
|---|---|
| 이 코드 저장소 | 앱 코드만. 사용자 데이터·토큰·PC 경로 없음 |
| 내 private 데이터 저장소 | 일정, 할 일, `AGENT_GUIDE.md`, `upcoming.json` |
| `%APPDATA%\CalForPickle` | 로컬 사본, 창 설정, 동기화 상태 |
| Windows 자격 증명 관리자 | GitHub 토큰(`CalForPickle` / `github-pat`) |

### 보안

- GitHub 토큰은 Windows 자격 증명 관리자에만 저장된다. UI로 돌려주거나 파일에 쓰지 않는다.
- public 저장소에는 연결을 거부하고, private인지 주기적으로 다시 확인한다.
- UI는 앱이 동기화하는 파일(`data/tasks.json`, `data/events/YYYY-MM.json`, `AGENT_GUIDE.md`, `upcoming.json`)만 읽고 쓸 수 있어서, 화면이 뚫려도 `.github/workflows/` 같은 곳은 건드릴 수 없다.
- Content-Security-Policy `default-src 'self'`: 웹뷰가 직접 네트워크에 나가지 못한다.
- 토큰은 데이터 저장소 하나로 제한한 fine-grained 토큰(Contents: 읽기·쓰기)을 쓴다.
- 설치본은 코드 서명이 없다(설치 항목 참고). 취약점은 공개 issue 대신 저장소의 **Security** 탭 → **Report a vulnerability**로 비공개 제보해 달라.

### 빌드

```sh
npm install
npm run tauri dev     # 개발 모드
npm test              # vitest
npm run tauri build   # 설치 파일
```

Rust와 [Tauri 2 사전 요구 사항](https://tauri.app/start/prerequisites/)이 필요하다.

## License

MIT
