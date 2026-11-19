import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { tr, type Lang } from "../i18n";
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
  onLang: (l: Lang) => void;
  onCellPopover: (v: boolean) => void;
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
      setMsg(tr.failed(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const connect = (ev: SubmitEvent) => {
    ev.preventDefault();
    if (!NAME.test(owner) || !NAME.test(repo)) return setMsg(tr.badName);
    if (!token && !p.hasToken) return setMsg(tr.needToken);
    const t = token;
    setToken(""); // the token never stays in UI state after it is handed to Credential Manager
    void run(() => p.onConnect({ ...p.settings, owner, repo }, t), tr.connectedMsg);
  };

  return (
    <Modal title={tr.settings} onClose={p.onClose}>
      {/* Both languages in the label, so it can be found whichever one is showing. */}
      {/* Buttons, not a <select>: pinned, clicks arrive as script events (desktop.rs), which never open a native dropdown. */}
      <section class="field">
        <span id="set-lang" class="legend">{tr.language}</span>
        <div class="seg" role="group" aria-labelledby="set-lang">
          {([["ko", "한국어"], ["en", "English"]] as [Lang, string][]).map(([v, l]) => (
            <button key={v} type="button" lang={v} aria-pressed={p.settings.lang === v} onClick={() => p.onLang(v)}>{l}</button>
          ))}
        </div>
      </section>

      <section aria-labelledby="set-gh">
        <h3 id="set-gh">{tr.github}</h3>
        <p class="note">
          {p.live ? tr.connected(`${p.settings.owner}/${p.settings.repo}`) : tr.localOnly}
          {!p.live && p.unpushed > 0 && tr.unpushedOnConnect(p.unpushed)}
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
            <label for="set-token">{tr.token}{p.hasToken && tr.tokenSaved}</label>
            <input id="set-token" type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)}
              autocomplete="off" spellcheck={false} aria-describedby="set-token-hint"
              placeholder={p.hasToken ? tr.tokenPlaceholder : ""} />
            <p id="set-token-hint" class="note">{tr.tokenHint}</p>
          </div>
          <div class="actions">
            {p.hasToken && (
              <button type="button" disabled={busy}
                onClick={() => run(p.onDisconnect, tr.disconnectedMsg)}>
                {tr.disconnect}
              </button>
            )}
            <button type="submit" class="primary" disabled={busy}>{tr.connect}</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="set-win">
        <h3 id="set-win">{tr.window}</h3>
        <label class="check">
          <input type="checkbox" checked={p.settings.autostart} onChange={(e) => p.onAutostart(e.currentTarget.checked)} />
          {tr.autostart}
          {!import.meta.env.PROD && tr.devNoAutostart}
        </label>
        <div class="field">
          <label for="set-opacity">{tr.opacity(p.settings.opacity)}</label>
          <input id="set-opacity" type="range" min={MIN_OPACITY} max={100} step={1} value={p.settings.opacity}
            aria-describedby="set-opacity-hint"
            onInput={(e) => p.onOpacity(Number(e.currentTarget.value), false)}
            onChange={(e) => p.onOpacity(Number(e.currentTarget.value), true)} />
          <p id="set-opacity-hint" class="note">{tr.opacityHint}</p>
        </div>
        <p class="note">{tr.trayNote}</p>
      </section>

      <section class="field">
        <span id="set-cell" class="legend">{tr.cellMemo}</span>
        <div class="seg" role="group" aria-labelledby="set-cell" aria-describedby="set-cell-hint">
          {([[false, tr.cellMemoDialog], [true, tr.cellMemoPopover]] as [boolean, string][]).map(([v, l]) => (
            <button key={String(v)} type="button" aria-pressed={!!p.settings.cellPopover === v} onClick={() => p.onCellPopover(v)}>{l}</button>
          ))}
        </div>
        <p id="set-cell-hint" class="note">{tr.cellMemoHint}</p>
      </section>

      <section aria-labelledby="set-local">
        <h3 id="set-local">{tr.localCopy}</h3>
        <p class="note">{tr.localCopyNote}</p>
        {!confirmClear ? (
          <button type="button" class="danger" ref={clearRef} onClick={() => setConfirmClear(true)}>
            {tr.clearLocal}
          </button>
        ) : (
          <div class="confirm" role="group" aria-labelledby="clear-q">
            <p id="clear-q">
              {p.live ? tr.clearLive : tr.clearOffline}
              {p.live && p.unsynced && tr.clearUnsynced}
            </p>
            <div class="actions">
              <button type="button" ref={cancelRef} onClick={() => setConfirmClear(false)}>{tr.cancel}</button>
              <button type="button" class="danger" disabled={busy}
                onClick={() => run(async () => (await p.onClearLocal(), setConfirmClear(false)), tr.clearedMsg)}>
                {tr.delete}
              </button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="set-keys">
        <h3 id="set-keys">{tr.keyboard}</h3>
        <dl class="keys">
          {tr.keys.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
        </dl>
      </section>

      <p class="note" role="status">{msg}</p>
      <div class="actions">
        <button type="button" onClick={p.onClose}>{tr.closeButton}</button>
      </div>
    </Modal>
  );
}
