//! Pinned = a child of Progman placed right under the icon layer (SHELLDLL_DefView), above the wallpaper WorkerW:
//! untouched by Win+D. The icon layer takes every click there, so a low-level mouse hook passes left
//! clicks on empty desktop over the window to the page, which replays them on the element under the pointer. Only
//! clicks go across (no hover, no dragging). While a dialog or an edit is open the page asks for desktop_raise: the
//! window goes above the icons, so it gets real mouse input (a slider drags, nothing is covered by an icon).
//! tao rewrites GWL_STYLE on any flag change (show, hide, resizable), dropping WS_CHILD, so a watcher re-attaches.

#![allow(unsafe_op_in_unsafe_fn)] // the unsafe fns here are thin Win32 wrappers

use std::{ptr::null, sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

type H = isize;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect { l: i32, t: i32, r: i32, b: i32 }

#[repr(C)]
#[derive(Clone, Copy)]
struct Point { x: i32, y: i32 }

#[repr(C)]
struct MouseLL { pt: Point, data: u32, flags: u32, time: u32, extra: usize }

#[link(name = "user32")]
unsafe extern "system" {
    fn FindWindowW(class: *const u16, title: *const u16) -> H;
    fn FindWindowExW(parent: H, after: H, class: *const u16, title: *const u16) -> H;
    fn SendMessageTimeoutW(h: H, msg: u32, w: usize, l: isize, flags: u32, ms: u32, out: *mut usize) -> isize;
    fn SetParent(child: H, parent: H) -> H;
    fn GetParent(h: H) -> H;
    fn GetWindow(h: H, cmd: u32) -> H;
    fn IsWindow(h: H) -> i32;
    fn GetWindowLongPtrW(h: H, i: i32) -> isize;
    fn SetWindowLongPtrW(h: H, i: i32, v: isize) -> isize;
    fn SetWindowPos(h: H, after: H, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    fn GetWindowRect(h: H, r: *mut Rect) -> i32;
    fn ScreenToClient(h: H, p: *mut Point) -> i32;
    fn ShowWindow(h: H, cmd: i32) -> i32;
    fn GetSystemMetrics(i: i32) -> i32;
    fn GetDoubleClickTime() -> u32;
    fn GetDpiForWindow(h: H) -> u32;
    fn SetWindowsHookExW(id: i32, f: unsafe extern "system" fn(i32, usize, isize) -> isize, m: H, thread: u32) -> H;
    fn UnhookWindowsHookEx(h: H) -> i32;
    fn CallNextHookEx(h: H, code: i32, w: usize, l: isize) -> isize;
    fn WindowFromPoint(p: Point) -> H;
    fn GetClassNameW(h: H, buf: *mut u16, n: i32) -> i32;
    fn SetFocus(h: H) -> H;
    fn GetForegroundWindow() -> H;
    fn SetForegroundWindow(h: H) -> i32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleW(name: *const u16) -> H;
}

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmSetWindowAttribute(h: H, attr: u32, v: *const i32, size: u32) -> i32;
}

const GWL_STYLE: i32 = -16;
const WS_POPUP: isize = 0x8000_0000;
const WS_CHILD: isize = 0x4000_0000;
const WS_VISIBLE: isize = 0x1000_0000;
const SWP_NOSIZE: u32 = 0x1;
const SWP_NOMOVE: u32 = 0x2;
const SWP_NOACTIVATE: u32 = 0x10;
const SWP_FRAMECHANGED: u32 = 0x20;
const GW_HWNDPREV: u32 = 3;
const SMTO_ABORTIFHUNG: u32 = 2;
const SW_HIDE: i32 = 0;
const SW_SHOWNOACTIVATE: i32 = 4;
const LVM_GETHOTITEM: u32 = 0x1000 + 61;

struct State {
    pinned: bool,
    hwnd: H,
    /// Screen rect taken while the window was still top-level (child rects come back scaled 1.5x).
    rect: Rect,
    /// Top-level style to restore when detaching.
    style: isize,
    parent: H,
    last_down: Option<(u32, i32, i32)>,
    /// A press the page got: (double-click, swallowed). Its release goes the same way.
    pressed: Option<(bool, bool)>,
}

static ST: Mutex<State> = Mutex::new(State {
    pinned: false, hwnd: 0, rect: Rect { l: 0, t: 0, r: 0, b: 0 }, style: 0, parent: 0, last_down: None, pressed: None,
});
static APP: OnceLock<AppHandle> = OnceLock::new();
static HOOK: Mutex<H> = Mutex::new(0);
static QUITTING: AtomicBool = AtomicBool::new(false);

/// The tray's quit is under way: windows going away now are not an explorer restart.
pub fn quitting() {
    QUITTING.store(true, Ordering::Relaxed);
}

unsafe fn attached(h: H, p: H) -> bool {
    p != 0 && IsWindow(p) != 0 && GetWindowLongPtrW(h, GWL_STYLE) & WS_CHILD != 0 && GetParent(h) == p
}

/// Explorer now and then swaps in a new wallpaper WorkerW right under the icons, over the pinned window (measured:
/// DefView > new WorkerW > app). Under the icons (normal) or on top (raised for an edit) is fine.
unsafe fn buried(h: H, p: H) -> bool {
    let above = GetWindow(h, GW_HWNDPREV);
    above != 0 && above != icons(p)
}


fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

unsafe fn class_of(h: H) -> String {
    let mut b = [0u16; 64];
    let n = GetClassNameW(h, b.as_mut_ptr(), 64);
    String::from_utf16_lossy(&b[..n.max(0) as usize])
}

/// The double-click rule Windows uses: second press within the double-click time, inside a cx x cy box around the first.
fn is_double(prev: Option<(u32, i32, i32)>, now: (u32, i32, i32), ms: u32, cx: i32, cy: i32) -> bool {
    prev.is_some_and(|(t, x, y)| now.0.wrapping_sub(t) <= ms && (now.1 - x).abs() * 2 <= cx && (now.2 - y).abs() * 2 <= cy)
}

/// Whether a click goes to the page (Some) and whether explorer must not see it (true).
/// With the desktop already active, explorer would move focus to the icon list and end an edit in the page.
/// With another app active, explorer has to see the click to activate the desktop, or typed keys go to that app.
fn route(inside: bool, empty_desktop: bool, desktop_active: bool) -> Option<bool> {
    (inside && empty_desktop).then_some(desktop_active)
}

unsafe fn icons(progman: H) -> H {
    FindWindowExW(progman, 0, wide("SHELLDLL_DefView").as_ptr(), null())
}

/// Progman with its icon layer in place, or 0 while explorer is (re)starting.
unsafe fn desktop() -> H {
    let progman = FindWindowW(wide("Progman").as_ptr(), null());
    if progman == 0 || icons(progman) == 0 {
        return 0;
    }
    let mut r = 0;
    // 0x052C asks explorer to create the wallpaper WorkerW (what wallpaper engines do).
    SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, SMTO_ABORTIFHUNG, 1000, &mut r);
    SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_ABORTIFHUNG, 1000, &mut r);
    // ponytail: 24H2+ layout only (icons and WorkerW are children of Progman); older builds keep the icons in a
    // top-level WorkerW, so pinning there leaves a normal window.
    progman
}

/// Re-parenting turns a visible top-level window into a child (or back), which DWM plays as the window going away
/// (shrinks to the centre) or appearing (zooms in). Only top-level windows take this; on a child it fails, harmlessly.
unsafe fn no_transition(h: H) {
    DwmSetWindowAttribute(h, 3, &1, 4); // 3 = DWMWA_TRANSITIONS_FORCEDISABLED
}

/// Returns the new parent, 0 if the desktop isn't there yet. Keeps the window hidden if it was hidden (closed to the tray).
unsafe fn attach(h: H, r: Rect) -> H {
    let p = desktop();
    if p == 0 {
        return 0;
    }
    no_transition(h); // still top-level here
    let cur = GetWindowLongPtrW(h, GWL_STYLE);
    SetWindowLongPtrW(h, GWL_STYLE, (cur & !WS_POPUP) | WS_CHILD);
    SetParent(h, p);
    let mut at = Point { x: r.l, y: r.t };
    ScreenToClient(p, &mut at);
    // Inserting after the icon layer puts the window right under it, above the wallpaper.
    SetWindowPos(h, icons(p), at.x, at.y, r.r - r.l, r.b - r.t, SWP_NOACTIVATE | SWP_FRAMECHANGED);
    if cur & WS_VISIBLE != 0 {
        ShowWindow(h, SW_SHOWNOACTIVATE);
    }
    p
}

/// Attached, the window takes Progman's DPI (the primary monitor's), not that of the monitor under it: on a monitor with
/// another scale the page drew 1.5x too big (measured: window DPI 144 on a 96 DPI monitor). Zoom cancels the difference.
/// Tauri's scale_factor() stays at the top-level value (a child gets no WM_DPICHANGED), so the DPI is read from Win32.
fn fit_zoom(window: &WebviewWindow, h: H, r: Rect) {
    let m = window.monitor_from_point(((r.l + r.r) / 2) as f64, ((r.t + r.b) / 2) as f64).ok().flatten();
    let own = unsafe { GetDpiForWindow(h) } as f64 / 96.0;
    if let (Some(m), true) = (m, own > 0.0) {
        let _ = window.set_zoom(m.scale_factor() / own);
    }
}

unsafe fn detach(h: H, r: Rect, style: isize) {
    let cur = GetWindowLongPtrW(h, GWL_STYLE);
    let shown = cur & WS_VISIBLE != 0;
    if shown {
        ShowWindow(h, SW_HIDE); // hiding a child plays no animation; showing the new top-level would (zoom in)
    }
    SetParent(h, 0);
    SetWindowLongPtrW(h, GWL_STYLE, style & !WS_VISIBLE);
    no_transition(h); // top-level now, still hidden
    SetWindowPos(h, 0, r.l, r.t, r.r - r.l, r.b - r.t, SWP_FRAMECHANGED); // 0 = HWND_TOP
    if shown {
        ShowWindow(h, SW_SHOWNOACTIVATE);
    }
}

/// The lock is never held across Win32 calls: they send messages to the window, and tao's events can call back in here.
fn snapshot() -> (bool, H, Rect, isize, H) {
    let s = ST.lock().unwrap();
    (s.pinned, s.hwnd, s.rect, s.style, s.parent)
}

fn set_parent(h: H, p: H) {
    let mut s = ST.lock().unwrap();
    if s.hwnd == h {
        s.parent = p;
    }
}

/// Screen position of the pinned window's top-left corner, None unless pinned.
pub fn pinned_origin() -> Option<(i32, i32)> {
    let s = ST.lock().unwrap();
    s.pinned.then_some((s.rect.l, s.rect.t))
}

/// The mouse hook exists only while pinned: every click on the whole system passes through it, and Windows drops it
/// without a word if the main thread stalls past LowLevelHooksTimeout. Unpinning and pinning again brings it back.
fn set_hook(hook: &mut H, on: bool, install: impl FnOnce() -> H, remove: impl FnOnce(H)) -> Result<(), String> {
    if on && *hook == 0 {
        *hook = install();
        if *hook == 0 {
            return Err("mouse hook could not be installed".into());
        }
    } else if !on && *hook != 0 {
        remove(std::mem::take(hook));
    }
    Ok(())
}

/// A sync command, so it runs on the main thread, whose message loop runs the hook.
#[tauri::command]
pub fn desktop_pin(window: WebviewWindow, on: bool) -> Result<(), String> {
    let h = window.hwnd().map_err(|e| e.to_string())?.0 as H;
    let (_, old, mut rect, mut style, _) = snapshot();
    if on {
        // Before attaching: without the hook, a pinned window could not be clicked at all.
        set_hook(&mut HOOK.lock().unwrap(), true, || unsafe {
            SetWindowsHookExW(14, on_mouse, GetModuleHandleW(null()), 0) // WH_MOUSE_LL
        }, |_| {})?;
        if old != h || unsafe { GetWindowLongPtrW(h, GWL_STYLE) } & WS_CHILD == 0 {
            unsafe {
                GetWindowRect(h, &mut rect);
                style = GetWindowLongPtrW(h, GWL_STYLE);
            }
        }
        {
            let mut s = ST.lock().unwrap();
            (s.pinned, s.hwnd, s.rect, s.style, s.parent, s.last_down, s.pressed) = (true, h, rect, style, 0, None, None);
        }
        let p = unsafe { attach(h, rect) };
        set_parent(h, p); // 0: the watcher retries until the desktop exists
        if p != 0 {
            fit_zoom(&window, h, rect);
        }
    } else {
        ST.lock().unwrap().pinned = false;
        if unsafe { GetWindowLongPtrW(h, GWL_STYLE) } & WS_CHILD != 0 {
            unsafe { detach(h, rect, style) };
            let _ = window.set_zoom(1.0);
            let _ = window.set_focus();
        }
        set_hook(&mut HOOK.lock().unwrap(), false, || 0, |k| unsafe {
            UnhookWindowsHookEx(k);
        })?;
    }
    Ok(())
}

/// Above the icon layer while the page is being edited, back under it afterwards. Does nothing unless attached.
/// With the window on top, WindowFromPoint is the page, not the icon list: the hook lets clicks and wheel through.
#[tauri::command]
pub fn desktop_raise(window: WebviewWindow, on: bool) -> Result<(), String> {
    let h = window.hwnd().map_err(|e| e.to_string())?.0 as H;
    let (pinned, hwnd, _, _, p) = snapshot();
    if !pinned || hwnd != h || !unsafe { attached(h, p) } {
        return Ok(());
    }
    let after = if on { 0 } else { unsafe { icons(p) } }; // 0 = HWND_TOP
    unsafe { SetWindowPos(h, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    Ok(())
}

/// The desktop's icon list when no other window covers the spot.
unsafe fn desktop_list(x: i32, y: i32) -> Option<H> {
    let lv = WindowFromPoint(Point { x, y });
    let view = GetParent(lv);
    (class_of(lv) == "SysListView32" && class_of(view) == "SHELLDLL_DefView" && class_of(GetParent(view)) == "Progman").then_some(lv)
}

/// No window over the spot and no icon under it. The hovered icon stands in for a hit test.
/// ponytail: LVM_HITTEST would need memory inside explorer; the hover state is right as long as the mouse moved there.
unsafe fn empty_desktop(x: i32, y: i32) -> bool {
    let Some(lv) = desktop_list(x, y) else { return false };
    let mut hot = 0usize;
    SendMessageTimeoutW(lv, LVM_GETHOTITEM, 0, 0, SMTO_ABORTIFHUNG, 50, &mut hot) != 0 && hot as i32 == -1
}

unsafe fn desktop_active() -> bool {
    matches!(class_of(GetForegroundWindow()).as_str(), "Progman" | "WorkerW")
}

/// Hands a press or release to the page (window-relative physical pixels). Keyboard focus moves on the release,
/// after explorer has handled a press it was allowed to see.
fn send(h: H, down: bool, x: i32, y: i32, dbl: bool) {
    let Some(app) = APP.get() else { return };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if !down {
            unsafe {
                // Over our window explorer doesn't make the desktop the active window (measured: Chrome stayed in front
                // for 1.5 s after a double-click), so typed keys went to that app. Do it here, then focus the page.
                if !desktop_active() {
                    SetForegroundWindow(FindWindowW(wide("Progman").as_ptr(), null()));
                }
                SetFocus(h) // wry hands focus on to WebView2; works because a child shares explorer's input queue
            };
        }
        let _ = a.emit("desktop-mouse", (if down { "down" } else { "up" }, x, y, dbl));
    });
}

/// Some(swallow) when the page took the event. The lock is only tried: a busy lock just lets the click through.
unsafe fn take_click(down: bool, x: i32, y: i32, time: u32) -> Option<bool> {
    let (h, r) = {
        let mut s = ST.try_lock().ok()?;
        if !down {
            let (dbl, swallow) = s.pressed.take()?;
            let (h, r) = (s.hwnd, s.rect);
            drop(s);
            send(h, false, x - r.l, y - r.t, dbl);
            return Some(swallow);
        }
        if !s.pinned || s.parent == 0 {
            return None;
        }
        (s.hwnd, s.rect)
    };
    let inside = x >= r.l && x < r.r && y >= r.t && y < r.b;
    let swallow = route(inside, inside && empty_desktop(x, y), desktop_active())?;
    let mut s = ST.try_lock().ok()?;
    let now = (time, x, y);
    let dbl = is_double(s.last_down, now, GetDoubleClickTime(), GetSystemMetrics(36), GetSystemMetrics(37));
    s.last_down = if dbl { None } else { Some(now) };
    s.pressed = Some((dbl, swallow));
    drop(s);
    send(h, true, x - r.l, y - r.t, dbl);
    Some(swallow)
}

/// A wheel turn over the pinned app (icon or not) scrolls the page; explorer never sees it, so Ctrl+wheel there
/// doesn't resize the icons. True when the page took it.
unsafe fn take_wheel(x: i32, y: i32, delta: i16) -> bool {
    let Ok(s) = ST.try_lock() else { return false };
    let (pinned, r, parent) = (s.pinned, s.rect, s.parent);
    drop(s);
    if !pinned || parent == 0 || !(x >= r.l && x < r.r && y >= r.t && y < r.b) || desktop_list(x, y).is_none() {
        return false;
    }
    let Some(app) = APP.get() else { return false };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = a.emit("desktop-wheel", (x - r.l, y - r.t, delta));
    });
    true
}

unsafe extern "system" fn on_mouse(code: i32, w: usize, l: isize) -> isize {
    // WM_LBUTTONDOWN / WM_LBUTTONUP
    if code >= 0 && (w == 0x201 || w == 0x202) {
        let m = &*(l as *const MouseLL);
        if take_click(w == 0x201, m.pt.x, m.pt.y, m.time) == Some(true) {
            return 1;
        }
    }
    // WM_MOUSEWHEEL: the delta is the high word of mouseData
    if code >= 0 && w == 0x20A {
        let m = &*(l as *const MouseLL);
        if take_wheel(m.pt.x, m.pt.y, (m.data >> 16) as u16 as i16) {
            return 1;
        }
    }
    CallNextHookEx(0, code, w, l)
}

/// Call once from setup. The mouse hook comes with desktop_pin.
pub fn start(app: AppHandle) {
    let _ = APP.set(app.clone());
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let (pinned, h, _, _, p) = snapshot();
        if !pinned || h == 0 || QUITTING.load(Ordering::Relaxed) {
            continue;
        }
        // Killing explorer takes its children along without a single message to us (no Destroyed event), and Tauri
        // keeps the dead window under its label. Restarting the app is the clean way back; edits are already on disk.
        if unsafe { IsWindow(h) } == 0 {
            let a = app.clone();
            let _ = app.run_on_main_thread(move || a.restart());
            return;
        }
        let style = unsafe { GetWindowLongPtrW(h, GWL_STYLE) };
        if style & WS_VISIBLE == 0 {
            continue;
        }
        if unsafe { attached(h, p) } {
            if unsafe { buried(h, p) } {
                let _ = app.run_on_main_thread(move || unsafe {
                    if attached(h, p) && buried(h, p) { // desktop_raise may have run in between
                        SetWindowPos(h, icons(p), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                });
            }
            continue;
        }
        let a = app.clone();
        let _ = app.run_on_main_thread(move || {
            let (pinned, h2, rect, _, p2) = snapshot();
            if pinned && h2 == h && !unsafe { attached(h, p2) } {
                let p = unsafe { attach(h, rect) };
                set_parent(h, p);
                if let (true, Some(w)) = (p != 0, a.get_webview_window("main")) {
                    fit_zoom(&w, h, rect);
                }
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::{is_double, route, set_hook};

    #[test]
    fn hook_exists_only_while_pinned() {
        let mut hook = 0;
        assert!(set_hook(&mut hook, true, || 7, |_| panic!("nothing to remove")).is_ok());
        assert_eq!(hook, 7);
        assert!(set_hook(&mut hook, true, || panic!("already installed"), |_| panic!()).is_ok()); // pinned again at startup
        let mut removed = 0;
        assert!(set_hook(&mut hook, false, || panic!(), |h| removed = h).is_ok());
        assert_eq!((hook, removed), (0, 7));
        assert!(set_hook(&mut hook, false, || panic!(), |_| panic!("already removed")).is_ok());
        assert!(set_hook(&mut hook, true, || 0, |_| panic!()).is_err()); // SetWindowsHookExW failed
        assert_eq!(hook, 0);
    }

    #[test]
    fn clicks_reach_the_app_only_on_empty_desktop_over_it() {
        assert_eq!(route(false, false, true), None); // elsewhere on the screen
        assert_eq!(route(true, false, true), None); // an icon or another window covers the spot
        assert_eq!(route(true, true, true), Some(true)); // desktop active: swallow, or the icon list takes focus and ends an edit
        assert_eq!(route(true, true, false), Some(false)); // another app active: let explorer activate the desktop first
    }

    #[test]
    fn double_click_needs_time_and_place() {
        let first = Some((1000, 500, 300));
        assert!(is_double(first, (1400, 502, 299), 500, 4, 4));
        assert!(is_double(first, (1500, 498, 302), 500, 4, 4)); // exactly the limit
        assert!(!is_double(first, (1501, 500, 300), 500, 4, 4)); // too slow
        assert!(!is_double(first, (1100, 503, 300), 500, 4, 4)); // moved out of the 4x4 box
        assert!(!is_double(None, (1100, 500, 300), 500, 4, 4));
        assert!(is_double(Some((u32::MAX - 100, 0, 0)), (100, 0, 0), 500, 4, 4)); // tick counter wrapped
    }
}
