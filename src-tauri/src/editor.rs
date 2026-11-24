//! A day's memo while the calendar is pinned. The pinned window sits under the desktop icons and only gets replayed clicks
//! (desktop.rs), so the memo is a second, ordinary top-level window: above the icons, real mouse and keyboard.
//! The page (Editor.tsx) places it next to the cell, resizes it to the lines, and hides it when the edit ends.

use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Screen position of the window's left edge and its top edge (its bottom edge when it grows upward).
static ANCHOR: Mutex<(i32, i32, bool)> = Mutex::new((0, 0, false));
/// Latest wanted size, so a resize that arrives while the first memo after a reconnect is still settling is not undone.
static SIZE: Mutex<(i32, i32)> = Mutex::new((0, 0));

fn editor(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("editor").ok_or_else(|| "no editor window".to_string())
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SetWindowPos(h: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    fn GetDpiForWindow(h: isize) -> u32;
}

/// tao's set_position posts the move (SWP_ASYNCWINDOWPOS). A synchronous move finishes the DPI change (WM_DPICHANGED)
/// before it returns, so place() after it stays on one DPI. Returns whether the window had to change DPI.
fn hop_to_dpi(win: &WebviewWindow, x: i32, y: i32) -> Result<bool, String> {
    let hw = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let Some(m) = win.monitor_from_point(x as f64, y as f64).ok().flatten() else { return Ok(false) };
    if unsafe { GetDpiForWindow(hw) } == (m.scale_factor() * 96.0).round() as u32 {
        return Ok(false);
    }
    unsafe { SetWindowPos(hw, 0, x, y, 0, 0, 0x1 | 0x4 | 0x10) }; // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
    Ok(true)
}

fn place(win: &WebviewWindow, w: i32, h: i32) -> Result<(), String> {
    *SIZE.lock().unwrap() = (w, h);
    let (x, y, up) = *ANCHOR.lock().unwrap();
    // Move first: onto another monitor the window changes DPI and Windows rescales its size; set_size after that sticks.
    win.set_position(PhysicalPosition::new(x, if up { y - h } else { y })).map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32)).map_err(|e| e.to_string())
}

/// x, y, w, h in physical pixels relative to the pinned window; `up`: y is the bottom edge and the memo grows upward.
#[tauri::command]
pub fn editor_show(app: AppHandle, x: i32, y: i32, w: i32, h: i32, up: bool) -> Result<(), String> {
    let win = editor(&app)?;
    let (ox, oy) = crate::desktop::pinned_origin().ok_or("not pinned")?;
    *ANCHOR.lock().unwrap() = (x + ox, y + oy, up);
    let top = if up { y + oy - h } else { y + oy };
    let hopped = hop_to_dpi(&win, x + ox, top)?;
    if !hopped {
        place(&win, w, h)?;
        win.show().map_err(|e| e.to_string())?;
        return win.set_focus().map_err(|e| e.to_string());
    }
    // ponytail: the first memo after a monitor reconnect is moved back to the laptop by Windows when it first appears
    // (measured 3-95 ms after show(); to the monitor-relative spot or the creation spot; cause not found). Once it has been
    // seen at the right place the later ones stay. So show it 1x1 (nothing to see), re-place until it holds for 4 checks
    // (60 ms, at most 0.6 s), then size it and focus. Replace with the real fix when the cause is found.
    *SIZE.lock().unwrap() = (w, h);
    let prime = move |w2: &WebviewWindow| {
        let _ = w2.set_position(PhysicalPosition::new(x + ox, top));
        let _ = w2.set_size(PhysicalSize::new(1, 1));
    };
    prime(&win);
    win.show().map_err(|e| e.to_string())?;
    let w2 = win.clone();
    std::thread::spawn(move || {
        let mut stable = 0;
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(15));
            let off = w2.outer_position().ok().is_none_or(|p| (p.x - (x + ox)).abs() > 8);
            if off {
                stable = 0;
                let _ = hop_to_dpi(&w2, x + ox, top);
                prime(&w2);
            } else {
                stable += 1;
                if stable >= 4 {
                    break;
                }
            }
        }
        let (w, h) = *SIZE.lock().unwrap();
        let _ = place(&w2, w, h);
        let _ = w2.set_focus();
    });
    Ok(())
}

#[tauri::command]
pub fn editor_fit(app: AppHandle, w: i32, h: i32) -> Result<(), String> {
    place(&editor(&app)?, w, h)
}

#[tauri::command]
pub fn editor_hide(app: AppHandle) -> Result<(), String> {
    editor(&app)?.hide().map_err(|e| e.to_string())
}
