# CalForPickle

A minimalist Windows desktop calendar that Pickle can read and write.
Pickle이 읽고 쓰는 Windows용 미니멀 데스크탑 캘린더. (한국어는 아래에)

## English

- Lives on the desktop (optional "always at the bottom"), sits in the tray, no taskbar button.
- Your events and tasks are JSON files in **your own private GitHub repo** (`data/events/YYYY-MM.json`, `data/tasks.json`). The app syncs through the GitHub Contents API; Pickle (or any agent) clones the same repo and commits to `main`.
- Edits save locally at once and push 15 s after the last change. Pulls happen once a day after 07:00 and when you press "Sync now".
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
- **Routine** (루틴; the app's labels are Korean): a new event (title and dates). Below it, every repeating routine; click one to edit it. Repeats are made by Pickle ("every Monday ...").
- **☰** shows the memo panel (tasks without a day). **Gear**: GitHub connection, always at the bottom, start with Windows, background opacity, keyboard shortcuts.
- **Always at the bottom**: the calendar stays behind other windows, comes to the front while you use it, and goes back down when you click elsewhere.
- **×** hides to the tray. To quit, use the tray icon menu → 종료 (Quit; it pushes pending edits first).

### Where your data lives

| Place | What |
|---|---|
| This code repo | App code only. No user data, tokens or machine paths |
| Your private data repo | Events, tasks, `AGENT_GUIDE.md`, `upcoming.json` |
| `%APPDATA%\CalForPickle` | Local copy, window settings, sync state |
| Windows Credential Manager | The GitHub token (`CalForPickle` / `github-pat`) |

### Build

```sh
npm install
npm run tauri dev     # dev mode
npm test              # vitest
npm run tauri build   # installer
```

Needs Rust and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

## 한국어

- 바탕화면에 붙어 있고(선택: "항상 아래"), 트레이에만 보이며 작업 표시줄 버튼은 없다.
- 일정과 할 일은 **내 private GitHub 저장소**의 JSON 파일이다(`data/events/YYYY-MM.json`, `data/tasks.json`). 앱은 GitHub Contents API로 동기화하고, Pickle(또는 다른 에이전트)은 같은 저장소를 clone해서 `main`에 commit한다.
- 편집은 바로 로컬에 저장되고, 마지막 수정 15초 뒤 올린다. 받아오기는 매일 07:00 이후 한 번과 "지금 동기화" 버튼.
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
- **☰**: 메모 패널(날짜 없는 할 일). **톱니바퀴**: GitHub 연결, 항상 아래, Windows 시작 시 실행, 배경 불투명도, 단축키.
- **항상 아래**: 평소엔 다른 창 뒤에 깔려 있고, 누르면 앞으로 나왔다가 다른 창을 누르면 다시 뒤로 간다.
- **×**는 트레이로 숨긴다. 끝내려면 트레이 아이콘 메뉴 → 종료(올리지 않은 변경을 먼저 올린다).

### 데이터 위치

| 위치 | 내용 |
|---|---|
| 이 코드 저장소 | 앱 코드만. 사용자 데이터·토큰·PC 경로 없음 |
| 내 private 데이터 저장소 | 일정, 할 일, `AGENT_GUIDE.md`, `upcoming.json` |
| `%APPDATA%\CalForPickle` | 로컬 사본, 창 설정, 동기화 상태 |
| Windows 자격 증명 관리자 | GitHub 토큰(`CalForPickle` / `github-pat`) |

### 빌드

위 English의 Build와 같다.

## License

MIT
