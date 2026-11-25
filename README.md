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

A minimalist Windows desktop calendar that an AI agent can read and write. Your events live as plain JSON in your own private GitHub repo. "Pickle" is the author's agent; any agent that can use git works.

**[Download for Windows](https://github.com/sungmin-c/CalForPickle/releases/latest)**

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

### Footprint

Measured on Windows 11, v0.1.1, idle, 2026-11-25.

| | Size |
|---|---|
| Installed size | 8.5 MB (`calforpickle.exe` 8.4 MB) |
| Memory, app process | 45 MB working set, 14 MB private |
| Memory, incl. WebView2 | about 580 MB working set, 254 MB private (7 `msedgewebview2` child processes) |

The window is a WebView2 page, so most memory sits in the WebView2 child processes, not in `calforpickle.exe`. Working-set totals count shared pages more than once; private memory is the closer figure.

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

## License

MIT
