// Screen text in Korean and English. No library: one table per language, same keys (tests/i18n.test.ts).
// Not translated: AGENT_GUIDE.md (repo file for agents), user content, the tray before the page loads.

export type Lang = "ko" | "en";

/** Parts of a repeat rule, already read in the series' zone (src/recur.ts describeRule). */
export interface RuleParts {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  days: number[]; // 0 = Sunday
  months: number[];
  monthDays: number[];
  count?: number;
  until?: string; // "YYYY-MM-DD"
  zone?: string; // set when the series runs on another zone than the PC's
}

/** Header title: the year drops out first when the header narrows; `short` replaces the rest at ≤560px.
 *  `year` carries its separator, so the whole title is year + main (yearFirst) or main + year. */
export interface Title {
  main: string;
  year: string;
  short?: string;
}

const n = (d: string) => d.split("-").map(Number) as [number, number, number];
const utc = (d: string) => new Date(`${d}T00:00:00Z`);

const KO_DOW = ["일", "월", "화", "수", "목", "금", "토"];
const koMd = (d: string) => `${n(d)[1]}월 ${n(d)[2]}일`;

const ko = {
  dow: KO_DOW,
  md: koMd,
  /** "2026년 2월 1일 (일)". */
  longDate: (d: string) => `${n(d)[0]}년 ${n(d)[1]}월 ${n(d)[2]}일 (${KO_DOW[utc(d).getUTCDay()]})`,
  /** Memo heading: "11월 15일 일요일". */
  dayHeading: (d: string) => `${koMd(d)} ${KO_DOW[utc(d).getUTCDay()]}요일`,
  /** Week view day button: "15 일". */
  weekDay: (d: string) => `${n(d)[2]} ${KO_DOW[utc(d).getUTCDay()]}`,
  monthTitle: (d: string): Title => ({ main: `${n(d)[1]}월`, year: `${n(d)[0]}년 ` }),
  weekTitle: (a: string, b: string): Title => ({
    main: `${koMd(a)} ~ ${a.slice(5, 7) === b.slice(5, 7) ? `${n(b)[2]}일` : koMd(b)}`,
    year: `${n(a)[0]}년 `,
    short: `${n(a)[1]}.${n(a)[2]} – ${a.slice(5, 7) === b.slice(5, 7) ? n(b)[2] : `${n(b)[1]}.${n(b)[2]}`}`,
  }),
  /** Year before the rest. */
  yearFirst: true,
  rule: (r: RuleParts) => {
    const unit = { DAILY: "일", WEEKLY: "주", MONTHLY: "월", YEARLY: "년" }[r.freq];
    const head = r.interval > 1 ? `${r.interval}${r.freq === "MONTHLY" ? "개월" : unit}마다` : `매${unit}`;
    const days = r.days.map((i) => KO_DOW[i]).join("·");
    const md = r.monthDays.join("·");
    const detail = {
      DAILY: days ? `${days}요일` : "",
      WEEKLY: `${days}요일`,
      MONTHLY: `${md}일`,
      YEARLY: `${r.months.join("·")}월 ${md}일`,
    }[r.freq];
    const tail = r.count ? `, ${r.count}회` : r.until ? `, ${r.until}까지` : "";
    return `${head}${detail ? ` ${detail}` : ""}${tail}${r.zone ? ` (${r.zone} 기준)` : ""}`;
  },

  // Header
  prevMonth: "이전 달", prevWeek: "이전 주", nextMonth: "다음 달", nextWeek: "다음 주", today: "오늘",
  view: "보기", month: "월", week: "주", monthAbbr: "월", weekAbbr: "주", routine: "루틴",
  syncState: "동기화 상태: ", notConnected: "연결 안 됨", syncing: "동기화 중…", syncNow: "지금 동기화",
  pin: "바탕화면에 고정",
  pinnedTitle: "고정됨: 바탕화면 아이콘 뒤에 놓여 있고, 아이콘이 없는 자리는 그대로 누를 수 있습니다. 누르면 풀려서 옮기거나 크기를 바꿀 수 있습니다",
  unpinnedTitle: "바탕화면에 고정 (아이콘 뒤에 놓고, 자리와 크기를 잠급니다)",
  settings: "설정", close: "닫기 (트레이로 숨김)", memoPanel: "메모 패널",
  states: {
    done: ["완료", "모든 변경이 GitHub에 올라갔습니다"],
    pending: ["대기", "올릴 변경이 있습니다. 마지막 편집 15초 뒤에 올립니다"],
    offline: ["오프라인", "GitHub에 닿지 못했습니다. 변경은 이 PC에 저장돼 있습니다"],
    merged: ["병합됨", "GitHub에 있던 변경을 합쳤습니다"],
  } as Record<"done" | "pending" | "offline" | "merged", [string, string]>,

  // App notices
  fatal: "시작하지 못했습니다: ", loading: "불러오는 중…",
  offScreen: "창이 화면 밖으로 나가 있어 고정할 수 없습니다. 화면 안으로 옮기거나 크기를 줄여 주세요",
  moveMode: "자리를 정한 뒤 핀을 누르면 편집할 수 있습니다",
  introLabel: "처음 안내",
  intro: "Windows를 켤 때 자동으로 실행되게 하려면 설정에서 \"Windows 시작 시 실행\"을 켜세요. 지금은 꺼져 있습니다.",
  openSettings: "설정 열기", ok: "확인",
  held: (files: string) => `GitHub의 ${files} 을(를) 읽지 못해 병합을 보류했습니다. 레포에서 JSON을 고친 뒤 지금 동기화를 누르세요.`,
  clockSkew: "받은 항목의 수정 시각이 이 PC 시계보다 10분 넘게 앞섭니다. 이 PC와 Pickle 쪽 시계를 확인하세요.",
  unreachable: (e: string) => `GitHub에 닿지 못했습니다: ${e}`,
  publicNow: "연결한 저장소가 공개(public)로 바뀌었습니다. 일정이 노출되지 않도록 올리기를 멈췄습니다. 저장소를 private로 되돌린 뒤 지금 동기화를 누르세요.",
  publicRepo: "공개(public) 저장소에는 연결할 수 없습니다. 누구나 일정을 볼 수 있게 됩니다. private 저장소를 만들어 쓰세요.",

  // Calendar
  calendar: (title: string) => `달력, ${title}`,
  untitled: "(제목 없음)",
  doneLabel: (title: string) => `${title || "제목 없음"} 완료`,
  blankLine: "빈 줄",
  dayLabel: (d: string, today: boolean, holiday: string | undefined, events: number, tasks: number) =>
    `${koMd(d)} ${KO_DOW[utc(d).getUTCDay()]}요일${today ? ", 오늘" : ""}${holiday ? `, ${holiday}` : ""}, 일정 ${events ? `${events}개` : "없음"}${tasks ? `, 할 일 ${tasks}개` : ""}`,
  moreLabel: (d: string, k: number) => `${koMd(d)} 일정·할 일 ${k}개 더 보기 (메모 열기)`,
  more: (k: number) => `+${k}개`,
  lineLabel: (d: string, i: number) => `${koMd(d)} 할 일 ${i}번째 줄`,

  // Event dialog
  newRoutine: "새 루틴", editRoutine: "루틴 편집", title: "제목",
  repeats: (rule: string) => `반복: ${rule}. 아래 날짜는 첫 회차이며, 바꾸면 모든 회차가 함께 옮겨집니다.`,
  allDay: "종일", startDate: "시작 날짜", startTime: "시작 시각", lastDate: "마지막 날짜", endDate: "끝 날짜", endTime: "끝 시각",
  location: "장소", notes: "메모",
  confirmDeleteRoutine: (title: string) => `'${title}' 루틴을 모든 회차와 함께 삭제할까요?`,
  delete: "삭제", cancel: "취소", save: "저장", deleteOne: "이번 회차만 삭제", deleteAll: "전체 삭제",
  routines: (k: number) => `반복 루틴 ${k}개`,
  ended: "끝남 · ",
  noRoutines: "아직 반복 루틴이 없습니다. 반복은 Pickle에게 \"매주 월요일 ...\"처럼 부탁해 만들 수 있습니다.",
  missingDateTime: "날짜와 시간을 모두 입력하세요.",
  endBeforeStart: "끝이 시작보다 빠릅니다.",

  // Task dialog and panel
  editTask: "할 일 편집", status: "상태", priority: "중요도", due: "마감일 (비워 두면 없음)",
  statusNames: { todo: "할 일", doing: "진행 중", done: "완료" } as Record<"todo" | "doing" | "done", string>,
  priorityNames: { "": "없음", high: "높음", normal: "보통", low: "낮음" } as Record<"" | "high" | "normal" | "low", string>,
  memo: "메모", newMemo: "새 메모", memoPlaceholder: "적고 Enter", noTasks: "날짜 없는 할 일이 없습니다.",
  doneCount: (k: number) => `완료 ${k}개`,
  dueBy: (d: string, late: boolean) => `${koMd(d)}까지${late ? " (지남)" : ""}`,
  doing: "진행 중", highPriority: "중요도 높음", lowPriority: "중요도 낮음",

  // Settings
  language: "언어 / Language",
  github: "GitHub 연결",
  connected: (repo: string) => `연결됨: ${repo}`,
  localOnly: "연결 안 됨. 변경은 이 PC에만 저장됩니다.",
  unpushedOnConnect: (k: number) => ` 아직 올리지 않은 파일 ${k}개는 연결하면 올립니다.`,
  token: "GitHub 토큰 (PAT)", tokenSaved: ", 저장됨", tokenPlaceholder: "바꿀 때만 입력",
  tokenHint: "fine-grained 토큰, 이 레포 하나만, Contents 읽기·쓰기 권한이면 됩니다. Windows 자격 증명 관리자에 저장하고 다시 표시하지 않습니다.",
  disconnect: "연결 해제", connect: "저장하고 연결",
  badName: "owner와 repo에는 영문, 숫자, . _ - 만 쓸 수 있습니다.",
  needToken: "GitHub 토큰을 입력하세요.",
  connectedMsg: "저장했습니다. 지금 GitHub에서 받아옵니다.",
  disconnectedMsg: "연결을 해제했습니다. 저장된 토큰을 지웠습니다.",
  failed: (e: string) => `실패했습니다: ${e}`,
  window: "창", autostart: "Windows 시작 시 실행", devNoAutostart: " (개발 모드에서는 등록 안 됨)",
  opacity: (v: number) => `배경 불투명도 ${v}%`,
  cellMemo: "칸 메모 수정 방식", cellMemoDialog: "대화상자", cellMemoPopover: "칸 위 팝오버",
  cellMemoHint: "대화상자는 가운데에 떠서 아이콘 위에 보입니다. 팝오버는 해당 날짜 칸 위에서 바로 고치지만 바탕화면 아이콘 뒤에 놓일 수 있습니다.",
  opacityHint: "100%보다 낮으면 흐린 글자와 경고색을 진하게 바꿉니다. 바탕화면 때문에 글자가 잘 안 보이면 값을 올리세요.",
  trayNote: "창을 닫으면 트레이로 내려갑니다. 끝내려면 트레이 아이콘 메뉴에서 종료를 누르세요.",
  localCopy: "이 PC의 사본",
  localCopyNote: "%APPDATA%\\CalForPickle 의 일정·할 일 사본과 동기화 기록을 지웁니다. 연결 설정은 남깁니다.",
  clearLocal: "로컬 사본 삭제",
  clearLive: "올리지 않은 변경을 먼저 GitHub에 올린 뒤 지우고, GitHub에서 다시 받습니다.",
  clearOffline: "GitHub에 연결돼 있지 않아 지운 일정과 할 일은 되살릴 수 없습니다.",
  clearUnsynced: " 지금 올리지 못한 변경이 있습니다. 올리기에 실패하면 그 변경은 사라집니다.",
  clearedMsg: "로컬 사본을 지웠습니다.",
  keyboard: "키보드",
  keys: [
    ["방향키", "날짜 이동 (달력의 날짜에 포커스가 있을 때)"],
    ["PageUp / PageDown", "이전 / 다음 달 (주 보기에서는 주)"],
    ["Home", "오늘로"],
    ["Enter", "선택한 날짜 메모 열기(더블클릭과 같음). 메모 안에서는 다음 줄"],
    ["↑ / ↓", "칸 안에서 윗줄 / 아랫줄"],
    ["Backspace", "칸 안의 빈 줄 지우기"],
    ["Tab", "그날 일정, 할 일 목록으로 이동 (칸 안에서는 저장하고 나가기)"],
    ["Space", "할 일 완료 체크"],
    ["Esc", "대화상자 닫기, 칸 안에서는 저장하고 나가기"],
  ] as [string, string][],
  closeButton: "닫기",

  // Tray menu (lib.rs set_tray_labels)
  trayOpen: "열기", trayQuit: "종료",
};

const en_ = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o });
const EN_DOW = Array.from({ length: 7 }, (_, i) => en_({ weekday: "short" }).format(Date.UTC(2026, 10, 15 + i)));
const enMon = en_({ month: "short" });
const enMd = (d: string) => `${enMon.format(utc(d))} ${n(d)[2]}`;
const enList = (xs: (string | number)[]) => xs.join(", ");

const en: typeof ko = {
  dow: EN_DOW,
  md: enMd,
  longDate: (d: string) => en_({ weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(utc(d)),
  dayHeading: (d: string) => en_({ weekday: "long", month: "short", day: "numeric" }).format(utc(d)),
  weekDay: (d: string) => `${n(d)[2]} ${EN_DOW[utc(d).getUTCDay()]}`,
  monthTitle: (d: string): Title => ({
    main: en_({ month: "long" }).format(utc(d)),
    year: ` ${n(d)[0]}`,
    short: `${enMon.format(utc(d))} ${n(d)[0]}`,
  }),
  weekTitle: (a: string, b: string): Title => ({
    main: `${enMd(a)} – ${a.slice(5, 7) === b.slice(5, 7) ? n(b)[2] : enMd(b)}`,
    year: `, ${n(a)[0]}`,
    short: `${n(a)[1]}/${n(a)[2]} – ${a.slice(5, 7) === b.slice(5, 7) ? n(b)[2] : `${n(b)[1]}/${n(b)[2]}`}`,
  }),
  yearFirst: false,
  rule: (r: RuleParts) => {
    const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[r.freq];
    const head = r.interval > 1 ? `Every ${r.interval} ${unit}s` : { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[r.freq];
    const days = enList(r.days.map((i) => EN_DOW[i]));
    const md = enList(r.monthDays);
    const detail = {
      DAILY: days ? `on ${days}` : "",
      WEEKLY: `on ${days}`,
      MONTHLY: `on day ${md}`,
      YEARLY: `on ${enList(r.months.map((m) => enMon.format(Date.UTC(2026, m - 1, 1))))} ${md}`,
    }[r.freq];
    const tail = r.count ? `, ${r.count} times` : r.until ? `, until ${r.until}` : "";
    return `${head}${detail ? ` ${detail}` : ""}${tail}${r.zone ? ` (${r.zone} time)` : ""}`;
  },

  prevMonth: "Previous month", prevWeek: "Previous week", nextMonth: "Next month", nextWeek: "Next week", today: "Today",
  view: "View", month: "Month", week: "Week", monthAbbr: "M", weekAbbr: "W", routine: "Routine",
  syncState: "Sync status: ", notConnected: "Not connected", syncing: "Syncing…", syncNow: "Sync now",
  pin: "Pin to desktop",
  pinnedTitle: "Pinned: sits behind the desktop icons; wherever no icon covers it, you can click it as usual. Click to unpin and move or resize it",
  unpinnedTitle: "Pin to desktop (puts it behind the icons and locks its place and size)",
  settings: "Settings", close: "Close (hide to tray)", memoPanel: "Memo panel",
  states: {
    done: ["Synced", "All changes are on GitHub"],
    pending: ["Waiting", "Changes to upload. They go up 15 seconds after the last edit"],
    offline: ["Offline", "Couldn't reach GitHub. Your changes are saved on this PC"],
    merged: ["Merged", "Changes from GitHub were merged in"],
  },

  fatal: "Couldn't start: ", loading: "Loading…",
  offScreen: "The window is partly off screen, so it can't be pinned. Move it onto the screen or make it smaller",
  moveMode: "Place the window, then click the pin to edit",
  introLabel: "First-run note",
  intro: "To start the app with Windows, turn on \"Start with Windows\" in Settings. It's off now.",
  openSettings: "Open settings", ok: "OK",
  held: (files: string) => `Couldn't read ${files} on GitHub, so it wasn't merged. Fix the JSON in the repo, then click Sync now.`,
  clockSkew: "Some received items were edited more than 10 minutes ahead of this PC's clock. Check the clocks on this PC and on Pickle's side.",
  unreachable: (e: string) => `Couldn't reach GitHub: ${e}`,
  publicNow: "The connected repository is now public. Pushing is paused so your calendar is not exposed. Make it private again, then press Sync now.",
  publicRepo: "Can't connect to a public repository: anyone could read your calendar. Use a private repository.",

  calendar: (title: string) => `Calendar, ${title}`,
  untitled: "(Untitled)",
  doneLabel: (title: string) => `${title || "Untitled"} done`,
  blankLine: "Blank line",
  dayLabel: (d: string, today: boolean, holiday: string | undefined, events: number, tasks: number) =>
    `${en_({ weekday: "long", month: "long", day: "numeric" }).format(utc(d))}${today ? ", today" : ""}${holiday ? `, ${holiday}` : ""}, ${events ? `${events} event${events > 1 ? "s" : ""}` : "no events"}${tasks ? `, ${tasks} task${tasks > 1 ? "s" : ""}` : ""}`,
  moreLabel: (d: string, k: number) => `${k} more on ${enMd(d)} (open memo)`,
  more: (k: number) => `+${k} more`,
  lineLabel: (d: string, i: number) => `${enMd(d)} task, line ${i}`,

  newRoutine: "New routine", editRoutine: "Edit routine", title: "Title",
  repeats: (rule: string) => `Repeats: ${rule}. The dates below are the first occurrence; changing them moves every occurrence.`,
  allDay: "All day", startDate: "Start date", startTime: "Start time", lastDate: "Last day", endDate: "End date", endTime: "End time",
  location: "Location", notes: "Notes",
  confirmDeleteRoutine: (title: string) => `Delete the routine '${title}' and all its occurrences?`,
  delete: "Delete", cancel: "Cancel", save: "Save", deleteOne: "Delete this occurrence", deleteAll: "Delete all",
  routines: (k: number) => `${k} repeating routine${k === 1 ? "" : "s"}`,
  ended: "Ended · ",
  noRoutines: "No repeating routines yet. Ask Pickle for one, like \"every Monday ...\".",
  missingDateTime: "Enter both the date and the time.",
  endBeforeStart: "The end is before the start.",

  editTask: "Edit task", status: "Status", priority: "Priority", due: "Due date (leave empty for none)",
  statusNames: { todo: "To do", doing: "In progress", done: "Done" },
  priorityNames: { "": "None", high: "High", normal: "Normal", low: "Low" },
  memo: "Memo", newMemo: "New memo", memoPlaceholder: "Type and press Enter", noTasks: "No undated tasks.",
  doneCount: (k: number) => `${k} done`,
  dueBy: (d: string, late: boolean) => `Due ${enMd(d)}${late ? " (overdue)" : ""}`,
  doing: "In progress", highPriority: "High priority", lowPriority: "Low priority",

  language: "언어 / Language",
  github: "GitHub connection",
  connected: (repo: string) => `Connected: ${repo}`,
  localOnly: "Not connected. Changes are saved on this PC only.",
  unpushedOnConnect: (k: number) => ` ${k} file${k === 1 ? "" : "s"} not uploaded yet will go up once you connect.`,
  token: "GitHub token (PAT)", tokenSaved: ", saved", tokenPlaceholder: "Only to change it",
  tokenHint: "A fine-grained token for this one repository with Contents read and write is enough. It's stored in Windows Credential Manager and never shown again.",
  disconnect: "Disconnect", connect: "Save and connect",
  badName: "owner and repo may only use letters, digits, . _ -",
  needToken: "Enter a GitHub token.",
  connectedMsg: "Saved. Fetching from GitHub now.",
  disconnectedMsg: "Disconnected. The saved token was deleted.",
  failed: (e: string) => `Failed: ${e}`,
  window: "Window", autostart: "Start with Windows", devNoAutostart: " (not registered in dev mode)",
  opacity: (v: number) => `Background opacity ${v}%`,
  cellMemo: "Day memo editing", cellMemoDialog: "Dialog", cellMemoPopover: "Popover on the cell",
  cellMemoHint: "The dialog opens in the middle, above desktop icons. The popover edits on the day cell itself but may sit behind desktop icons.",
  opacityHint: "Below 100%, faint text and warning colors turn darker. If the wallpaper makes text hard to read, raise the value.",
  trayNote: "Closing the window sends it to the tray. To quit, choose Quit from the tray icon's menu.",
  localCopy: "Copy on this PC",
  localCopyNote: "Deletes the copy of events and tasks and the sync record in %APPDATA%\\CalForPickle. The connection settings stay.",
  clearLocal: "Delete local copy",
  clearLive: "Uploads changes not yet on GitHub, deletes the copy, then downloads it again from GitHub.",
  clearOffline: "Not connected to GitHub, so deleted events and tasks can't be recovered.",
  clearUnsynced: " Some changes couldn't be uploaded. If the upload fails, they are lost.",
  clearedMsg: "Local copy deleted.",
  keyboard: "Keyboard",
  keys: [
    ["Arrow keys", "Move between days (when a day has focus)"],
    ["PageUp / PageDown", "Previous / next month (week in week view)"],
    ["Home", "Go to today"],
    ["Enter", "Open the selected day's memo (same as double-click). In the memo: new line"],
    ["↑ / ↓", "Line above / below in a cell"],
    ["Backspace", "Delete an empty line in a cell"],
    ["Tab", "Move to that day's events and tasks (in a cell: save and leave)"],
    ["Space", "Check a task done"],
    ["Esc", "Close a dialog; in a cell: save and leave"],
  ],
  closeButton: "Close",

  trayOpen: "Open", trayQuit: "Quit",
};

export const TEXT = { ko, en };
export let lang: Lang = "ko";
/** Current table; a live binding, so components read the new language on their next render. */
export let tr = ko;

export function setLang(l: Lang) {
  lang = l;
  tr = TEXT[l];
  if (typeof document !== "undefined") document.documentElement.lang = l;
}
