# CalForPickle

Windows용 가벼운 캘린더·할 일 위젯. Tauri 2 + Preact.

- 데이터는 내 GitHub 저장소의 JSON 파일(`data/events/YYYY-MM.json`, `data/tasks.json`)이다. 앱은 GitHub Contents API로 동기화하고, AI 에이전트(Pickle)는 같은 저장소에 직접 commit한다.
- 편집은 바로 로컬에 저장되고, 마지막 수정 15초 뒤 바뀐 파일만 올린다. 받아오기는 매일 07:00 한 번과 "지금 동기화" 버튼.
- 병합은 항목 id 단위, `updatedAt`이 늦은 쪽이 이긴다.
- GitHub에 연결하지 않아도 이 PC에만 저장하며 쓸 수 있다.

## 실행

```sh
npm install
npm run tauri dev     # 개발 모드
npm test              # vitest
npm run tauri build   # 설치본
```

Rust와 [Tauri 2 사전 준비](https://tauri.app/start/prerequisites/)가 필요하다.

## 라이선스

MIT
