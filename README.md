# CalForPickle

[![Release](https://img.shields.io/github/v/release/sungmin-c/CalForPickle)](https://github.com/sungmin-c/CalForPickle/releases/latest)
[![License: MIT](https://img.shields.io/github/license/sungmin-c/CalForPickle)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-blue)

A minimalist Windows desktop calendar that an AI agent can read and write. Your events live as plain JSON in your own private GitHub repo. "Pickle" is the author's agent; any agent that can use git works.
AI 에이전트가 읽고 쓸 수 있는 Windows용 미니멀 데스크탑 캘린더. 일정은 내 private GitHub 저장소의 JSON 파일이다. "Pickle"은 만든 사람의 에이전트 이름이고, git을 쓸 수 있는 에이전트면 된다.

**[Download for Windows](https://github.com/sungmin-c/CalForPickle/releases/latest)** · [한국어](#한국어)

## English

- Lives on the desktop: pinned, it sits under the desktop icons, above the wallpaper. Tray only, no taskbar button.
- Your events and tasks are JSON files in **your own private GitHub repo** (`data/events/YYYY-MM.json`, `data/tasks.json`). The app syncs through the GitHub Contents API; Pickle (or any agent) clones the same repo and commits to `main`.
- Edits save locally at once and push 15 s after the last change. Pulls happen once a day after 07:00 and when you press "Sync now".
- Times follow this PC's Windows time zone (read when the app starts). All-day events show on the same date everywhere.
- Merging is per item id; the later `updatedAt` wins. Deletes are soft (`"deleted": true`).
- Works offline with no GitHub at all; data then stays on this PC only.

### Install and connect

1. **Install.** Download `CalForPickle_<version>_x64-setup.exe` from [Releases](https://github.com/sungmin-c/CalForPickle/releases/latest) and run it. The installer is not code-signed, so Windows SmartScreen may say "Windows protected your PC": click **More info → Run anyway**.
2. **Data repo.** Create an **empty private** repo for your data, e.g. `calforpickle-data`. The app refuses to connect to a public repo.
3. **Token.** Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new): *Only select repositories* → that repo, *Repository permissions → Contents: Read and write*. Nothing else.
4. **Connect the app.** Gear icon → owner, repo, token → Save. The token goes to Windows Credential Manager, never to a file. On first sync the app writes `AGENT_GUIDE.md` (schema, timezone, write procedure) and `upcoming.json` (next 14 days) to the repo.
5. **Connect Pickle.** Give Pickle access to **that repo only** (for a GitHub App: add the repo under its repository access). Then send it this, with your own owner and repo:

```text
My calendar lives in the GitHub repo <owner>/<repo>. Before reading or changing any event or task,
read AGENT_GUIDE.md in that repo and follow its write procedure exactly.
```

### Using it

- **Double-click a day** (or Enter on it): that day's checklist. One line per item, Enter for the next line, Esc saves and leaves.
- **"+N"** in a full day opens the same checklist with every line.
- **Click an event** to edit or delete it. A repeating event asks before deleting every occurrence.
- **Routine**: a new event (title and dates). Below it, every repeating routine; click one to edit it. Repeats are made by Pickle ("every Monday ...").
- **☰** shows the memo panel (tasks without a day). **Gear**: language (한국어 / English; English shows US federal holidays, Korean shows Korean ones), GitHub connection, start with Windows, background opacity, keyboard shortcuts.
- **Pin** (header, left of the gear): pinned, the calendar sits on the desktop under the icons, fixed in place; wherever no icon covers it, clicks work as usual (buttons, double-clicking a day, typing), while hovering and dragging don't. Spots covered by an icon don't respond, so place it on empty desktop. Unpinned, it is only for moving and resizing (no editing). The whole window must fit on one monitor to pin.
- **×** hides to the tray. To quit, use the tray icon menu → Quit (it pushes pending edits first).

### Where your data lives

| Place | What |
|---|---|
| This code repo | App code only. No user data, tokens or machine paths |
| Your private data repo | Events, tasks, `AGENT_GUIDE.md`, `upcoming.json` |
| `%APPDATA%\CalForPickle` | Local copy, window settings, sync state |
| Windows Credential Manager | The GitHub token (`CalForPickle` / `github-pat`) |

### Security

- The GitHub token is stored only in Windows Credential Manager. It is never returned to the UI or written to a file.
- The app refuses to connect to a public repo, and re-checks that the repo is private.
- The UI can only read and write the files the app syncs (`data/tasks.json`, `data/events/YYYY-MM.json`, `AGENT_GUIDE.md`, `upcoming.json`), so a compromised page cannot touch e.g. `.github/workflows/`.
- Content-Security-Policy `default-src 'self'`; the webview has no network access of its own.
- Use a fine-grained token limited to the one data repo (Contents: read and write).
- The installer is not code-signed (see Install). Report vulnerabilities privately via the repo's **Security** tab → **Report a vulnerability**, not as a public issue.

### Build

```sh
npm install
npm run tauri dev     # dev mode
npm test              # vitest
npm run tauri build   # installer
```

Needs Rust and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

## 한국어

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

위 English의 Build와 같다.

## License

MIT
