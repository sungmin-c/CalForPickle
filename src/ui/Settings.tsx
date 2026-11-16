import { useEffect, useRef, useState } from "preact/hooks";
import { Modal } from "./Dialogs";
import { MIN_OPACITY, type Settings } from "./prefs";

const NAME = /^[A-Za-z0-9._-]+$/; // same rule as the Rust side

export function SettingsDialog(p: {
  settings: Settings;
  live: boolean;
  hasToken: boolean;
  unsynced: boolean;
  unpushed: number;
  onConnect: (s: Settings, token: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClearLocal: () => Promise<void>;
  onAutostart: (v: boolean) => void;
  /** `save` is false while dragging (preview only) and true when the value is committed. */
  onOpacity: (v: number, save: boolean) => void;
  onClose: () => void;
}) {
  const [owner, setOwner] = useState(p.settings.owner ?? "");
  const [repo, setRepo] = useState(p.settings.repo ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);
  // The button that was pressed disappears, so focus moves with the swap (autoFocus only works on dialog open).
  useEffect(() => {
    if (firstRender.current) return void (firstRender.current = false);
    (confirmClear ? cancelRef : clearRef).current?.focus();
  }, [confirmClear]);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setMsg(`실패했습니다: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const connect = (ev: SubmitEvent) => {
    ev.preventDefault();
    if (!NAME.test(owner) || !NAME.test(repo)) return setMsg("owner와 repo에는 영문, 숫자, . _ - 만 쓸 수 있습니다.");
    if (!token && !p.hasToken) return setMsg("GitHub 토큰을 입력하세요.");
    const t = token;
    setToken(""); // the token never stays in UI state after it is handed to Credential Manager
    void run(() => p.onConnect({ ...p.settings, owner, repo }, t), "저장했습니다. 지금 GitHub에서 받아옵니다.");
  };

  return (
    <Modal title="설정" onClose={p.onClose}>
      <section aria-labelledby="set-gh">
        <h3 id="set-gh">GitHub 연결</h3>
        <p class="note">
          {p.live ? `연결됨: ${p.settings.owner}/${p.settings.repo}` : "연결 안 됨. 변경은 이 PC에만 저장됩니다."}
          {!p.live && p.unpushed > 0 && ` 아직 올리지 않은 파일 ${p.unpushed}개는 연결하면 올립니다.`}
        </p>
        <form onSubmit={connect}>
          <div class="row">
            <div class="field">
              <label for="set-owner">owner</label>
              <input id="set-owner" value={owner} onInput={(e) => setOwner(e.currentTarget.value.trim())}
                autocomplete="off" spellcheck={false} />
            </div>
            <div class="field">
              <label for="set-repo">repo</label>
              <input id="set-repo" value={repo} onInput={(e) => setRepo(e.currentTarget.value.trim())}
                autocomplete="off" spellcheck={false} />
            </div>
          </div>
          <div class="field">
            <label for="set-token">GitHub 토큰 (PAT){p.hasToken && ", 저장됨"}</label>
            <input id="set-token" type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)}
              autocomplete="off" spellcheck={false} aria-describedby="set-token-hint"
              placeholder={p.hasToken ? "바꿀 때만 입력" : ""} />
            <p id="set-token-hint" class="note">
              fine-grained 토큰, 이 레포 하나만, Contents 읽기·쓰기 권한이면 됩니다. Windows 자격 증명 관리자에 저장하고
              다시 표시하지 않습니다.
            </p>
          </div>
          <div class="actions">
            {p.hasToken && (
              <button type="button" disabled={busy}
                onClick={() => run(p.onDisconnect, "연결을 해제했습니다. 저장된 토큰을 지웠습니다.")}>
                연결 해제
              </button>
            )}
            <button type="submit" class="primary" disabled={busy}>저장하고 연결</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="set-win">
        <h3 id="set-win">창</h3>
        <label class="check">
          <input type="checkbox" checked={p.settings.autostart} onChange={(e) => p.onAutostart(e.currentTarget.checked)} />
          Windows 시작 시 실행
          {!import.meta.env.PROD && " (개발 모드에서는 등록 안 됨)"}
        </label>
        <div class="field">
          <label for="set-opacity">배경 불투명도 {p.settings.opacity}%</label>
          <input id="set-opacity" type="range" min={MIN_OPACITY} max={100} step={1} value={p.settings.opacity}
            aria-describedby="set-opacity-hint"
            onInput={(e) => p.onOpacity(Number(e.currentTarget.value), false)}
            onChange={(e) => p.onOpacity(Number(e.currentTarget.value), true)} />
          <p id="set-opacity-hint" class="note">
            100%보다 낮으면 흐린 글자와 경고색을 진하게 바꿉니다. 바탕화면 때문에 글자가 잘 안 보이면 값을 올리세요.
          </p>
        </div>
        <p class="note">창을 닫으면 트레이로 내려갑니다. 끝내려면 트레이 아이콘 메뉴에서 종료를 누르세요.</p>
      </section>

      <section aria-labelledby="set-local">
        <h3 id="set-local">이 PC의 사본</h3>
        <p class="note">%APPDATA%\CalForPickle 의 일정·할 일 사본과 동기화 기록을 지웁니다. 연결 설정은 남깁니다.</p>
        {!confirmClear ? (
          <button type="button" class="danger" ref={clearRef} onClick={() => setConfirmClear(true)}>
            로컬 사본 삭제
          </button>
        ) : (
          <div class="confirm" role="group" aria-labelledby="clear-q">
            <p id="clear-q">
              {p.live
                ? "올리지 않은 변경을 먼저 GitHub에 올린 뒤 지우고, GitHub에서 다시 받습니다."
                : "GitHub에 연결돼 있지 않아 지운 일정과 할 일은 되살릴 수 없습니다."}
              {p.live && p.unsynced && " 지금 올리지 못한 변경이 있습니다. 올리기에 실패하면 그 변경은 사라집니다."}
            </p>
            <div class="actions">
              <button type="button" ref={cancelRef} onClick={() => setConfirmClear(false)}>취소</button>
              <button type="button" class="danger" disabled={busy}
                onClick={() => run(async () => (await p.onClearLocal(), setConfirmClear(false)), "로컬 사본을 지웠습니다.")}>
                삭제
              </button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="set-keys">
        <h3 id="set-keys">키보드</h3>
        <dl class="keys">
          <dt>방향키</dt><dd>날짜 이동 (달력의 날짜에 포커스가 있을 때)</dd>
          <dt>PageUp / PageDown</dt><dd>이전 / 다음 달 (주 보기에서는 주)</dd>
          <dt>Home</dt><dd>오늘로</dd>
          <dt>Enter</dt><dd>선택한 날짜 메모 열기(더블클릭과 같음). 메모 안에서는 다음 줄</dd>
          <dt>↑ / ↓</dt><dd>칸 안에서 윗줄 / 아랫줄</dd>
          <dt>Backspace</dt><dd>칸 안의 빈 줄 지우기</dd>
          <dt>Tab</dt><dd>그날 일정, 할 일 목록으로 이동 (칸 안에서는 저장하고 나가기)</dd>
          <dt>Space</dt><dd>할 일 완료 체크</dd>
          <dt>Esc</dt><dd>대화상자 닫기, 칸 안에서는 저장하고 나가기</dd>
        </dl>
      </section>

      <p class="note" role="status">{msg}</p>
      <div class="actions">
        <button type="button" onClick={p.onClose}>닫기</button>
      </div>
    </Modal>
  );
}
