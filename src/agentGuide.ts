export const GUIDE_PATH = "AGENT_GUIDE.md";
const MARKER = "<!-- agent-guide v6 -->";

/** Rewrite the repo guide when it is missing or carries another version marker (DESIGN §4.3). */
export function needsGuide(text: string | undefined): boolean {
  return text?.split("\n", 1)[0].trim() !== MARKER;
}

export const AGENT_GUIDE = `${MARKER}
# AGENT_GUIDE: CalForPickle 데이터 레포

이 파일은 CalForPickle 앱이 생성·갱신한다. 수정하지 말 것(앱이 다시 덮어쓴다).

## 1. 파일 구조

\`\`\`
AGENT_GUIDE.md            이 문서 (읽기 전용)
data/events/YYYY-MM.json  일정. start의 서울 기준 달 파일에 둔다
data/tasks.json           태스크
upcoming.json             앱이 재생성하는 요약 (편집 금지)
\`\`\`

시간대는 항상 \`Asia/Seoul\`, 오프셋 \`+09:00\`.

## 2. 일정(event)과 태스크(task) 중 무엇으로 쓸지

- 기본은 태스크다. 사용자가 반복·루틴을 명시적으로 부탁하지 않은 일정은 \`data/tasks.json\`에 태스크로 쓴다. 그 날짜를 \`due\`에 넣으면 앱의 그 날짜 칸에 체크박스 할 일로 보인다.
  - 시각이 있으면 제목 앞에 붙인다: \`"17:00 회의"\`. 끝 시각·장소 등 나머지는 \`notes\`에 쓴다.
- 반복·루틴("매주", "매일", "루틴으로" 등)을 명시적으로 부탁받았을 때만 \`recurrence\`가 있는 일정을 \`data/events/\`에 쓴다.
- 이미 있는 항목을 고칠 때는 그 항목의 종류를 바꾸지 않는다.

## 3. 스키마

일정 (\`data/events/YYYY-MM.json\`, 배열):

\`\`\`json
{
  "id": "uuid-v4",
  "title": "string",
  "color": "#F12424",
  "start": "2026-11-20T14:00:00+09:00",
  "end": "2026-11-20T15:00:00+09:00",
  "allDay": false,
  "recurrence": "FREQ=WEEKLY;BYDAY=MO",
  "exdates": ["2026-11-23"],
  "location": "",
  "notes": "",
  "updatedAt": "2026-11-15T10:00:00.000+09:00",
  "deleted": false
}
\`\`\`

태스크 (\`data/tasks.json\`, 배열):

\`\`\`json
{
  "id": "uuid-v4",
  "title": "string",
  "color": "#F12424",
  "status": "todo",
  "due": "2026-11-20",
  "priority": "normal",
  "order": 0,
  "notes": "",
  "updatedAt": "2026-11-15T10:00:00.000+09:00",
  "deleted": false
}
\`\`\`

- \`status\`: \`"todo" | "doing" | "done"\`. \`priority\`: \`"high" | "normal" | "low"\`.
- \`order\`: 같은 \`due\` 날 칸 안의 표시 순서(0 이상 정수). 앱은 미완료 → 완료, 그 안에서 \`order\` 순으로 보여 준다. 없으면 같은 날 맨 뒤(제목순).
- \`recurrence\`: 반복 규칙(RFC 5545 RRULE 본문, \`RRULE:\` 접두어 없이). 반복이 아니면 키를 생략한다. 앱이 펼칠 수 있는 범위만 쓴다:
  - \`FREQ\`: \`DAILY | WEEKLY | MONTHLY | YEARLY\`. 함께 쓸 수 있는 키: \`INTERVAL\`, \`COUNT\` 또는 \`UNTIL\`(둘 중 하나), 그리고 DAILY는 \`BYDAY\`·\`BYMONTH\`·\`BYMONTHDAY\`, WEEKLY는 \`BYDAY\`·\`BYMONTH\`, MONTHLY·YEARLY는 \`BYMONTH\`·\`BYMONTHDAY\`.
  - \`BYDAY\`는 요일 코드만(\`MO,WE\`). \`2MO\` 같은 "몇째 주"는 안 된다. \`BYSETPOS\`, \`WKST\` 등 다른 키도 안 된다. 이 범위를 벗어나면 앱이 그 파일 병합을 보류한다.
  - \`UNTIL=YYYYMMDD\`는 그날 회차까지 포함한다. \`start\`가 첫 회차이고 \`end\`와의 길이가 모든 회차에 적용된다.
- \`exdates\`: 반복 중 빠진 회차의 서울 날짜(\`"YYYY-MM-DD"\`) 배열. 회차 하나를 지우려면 여기에 날짜를 넣고 \`updatedAt\`을 갱신한다. 없으면 키를 생략한다.
- \`color\`: 제목 앞에 보이는 색 점, \`"#RRGGBB"\`(16진수 6자리). 제목에 HTML(\`<font>\` 등)을 넣지 말고 이 키를 쓴다. 다른 형식이면 앱이 그 파일 병합을 보류한다.
- \`color\`, \`due\`, \`priority\`, \`order\`는 값이 없으면 키를 생략한다. 나머지 키는 항상 쓴다(빈 값은 \`""\`).
- 종일 일정: \`start\`/\`end\`는 \`"YYYY-MM-DD"\`, \`end\`는 포함하지 않는 날(하루짜리면 다음 날).
- 시각 일정: \`"YYYY-MM-DDTHH:mm:ss+09:00"\`. \`due\`는 \`"YYYY-MM-DD"\`만.
- \`updatedAt\`: 밀리초 포함 \`"YYYY-MM-DDTHH:mm:ss.SSS+09:00"\`.
- 스키마에 없는 키는 앱이 버린다.

## 4. 충돌 방지 규칙

- 새 항목의 \`id\`는 uuid-v4로 새로 만든다. 기존 id를 재사용하지 않는다.
- 바꾼 항목만 \`updatedAt\`을 현재 시각으로 갱신한다. 안 바꾼 항목은 건드리지 않는다.
- 삭제는 \`"deleted": true\`로 표시하고 \`updatedAt\`을 갱신한다. 배열에서 지우지 않는다.
- 같은 id가 양쪽에서 바뀌면 \`updatedAt\`이 늦은 쪽 항목 전체가 이긴다.

## 5. 쓰기 절차

1. \`git pull --rebase\`
2. 대상 파일만 수정하고, 바꾼 항목의 \`updatedAt\` 갱신
3. 바꾼 파일이 올바른 JSON인지 확인한다(예: \`python -m json.tool 파일 > /dev/null\`). 깨진 파일은 앱이 병합을 보류한다
4. commit → push
5. push가 거부되면 \`git pull --rebase\` 후 다시 push

일정의 \`start\`가 다른 달로 바뀌면 같은 commit에서 옛 달 파일에서 빼고 새 달 파일에 넣는다.

## 6. upcoming.json

편집하지 않는다. 오늘부터 14일 일정과 열린 태스크 요약이며, 반복 일정은 회차마다 한 줄씩(\`id\`는 원본 일정과 같음) 펼쳐 있다. 회차를 고치려면 원본 일정을 고친다. 요약은 앱이 매일 07:00와 앱이 push할 때 다시 만든다. events/tasks를 직접 바꿨거나 \`generatedAt\`의 날짜가 오늘(서울)이 아니면 upcoming.json 대신 원본 파일을 읽는다(앱이 꺼져 있으면 요약이 갱신되지 않는다).

## 7. 형식

- 2칸 들여쓰기, 파일 끝 개행 1개.
- 배열은 \`id\` 오름차순.
- 키 순서는 위 스키마 예시 순서 그대로.
`;
