//! A day's memo while the calendar is pinned. The pinned window sits under the desktop icons and only gets replayed clicks
//! (desktop.rs), so the memo is a second, ordinary top-level window: above the icons, real mouse and keyboard.
//! The page (Editor.tsx) places it next to the cell, resizes it to the lines, and hides it when the edit ends.

use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Screen position of the window's left edge and its top edge (its bottom edge when it grows upward).
static ANCHOR: Mutex<(i32, i32, bool)> = Mutex::new((0, 0, false));

fn editor(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("editor").ok_or_else(|| "no editor window".to_string())
}

fn place(win: &WebviewWindow, w: i32, h: i32) -> Result<(), String> {
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
    place(&win, w, h)?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn editor_fit(app: AppHandle, w: i32, h: i32) -> Result<(), String> {
    place(&editor(&app)?, w, h)
}

#[tauri::command]
pub fn editor_hide(app: AppHandle) -> Result<(), String> {
    editor(&app)?.hide().map_err(|e| e.to_string())
}
