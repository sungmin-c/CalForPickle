mod files;
mod github;
mod secret;

use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The webview pushes pending edits (up to 10 s) and then calls app_exit.
/// If the webview never answers, exit anyway after 11 s; unpushed files stay dirty on disk for next launch.
fn request_quit(app: &AppHandle) {
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(11));
        app.exit(0);
    });
}

#[tauri::command]
fn app_exit(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch exits here and brings the running window forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "열기", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("CalForPickle")
                .menu(&Menu::with_items(app, &[&show, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => request_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        // Closing the window keeps the app in the tray; quitting goes through the tray menu so edits get flushed.
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_exit,
            secret::secret_set,
            secret::secret_exists,
            secret::secret_delete,
            github::gh_get,
            github::gh_list,
            github::gh_put,
            files::local_read,
            files::local_write,
            files::local_list,
            files::local_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
