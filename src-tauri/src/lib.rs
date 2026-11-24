mod autostart;
mod desktop;
mod editor;
mod files;
mod github;
mod secret;

use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent, Wry,
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
    desktop::quitting();
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(11));
        app.exit(0);
    });
}

/// Tray menu items, relabelled by the page in the chosen language. Korean until the page loads.
struct TrayItems(MenuItem<Wry>, MenuItem<Wry>);

#[tauri::command]
fn set_tray_labels(items: State<TrayItems>, open: String, quit: String) -> Result<(), String> {
    items.0.set_text(open).map_err(|e| e.to_string())?;
    items.1.set_text(quit).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_exit(app: AppHandle) {
    desktop::quitting();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch exits here and brings the running window forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
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
            app.manage(TrayItems(show, quit));
            desktop::start(app.handle().clone());
            Ok(())
        })
        // Closing the window keeps the app in the tray; quitting goes through the tray menu so edits get flushed.
        .on_window_event(|w, e| match e {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = w.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            app_exit,
            set_tray_labels,
            autostart::autostart_enabled,
            autostart::autostart_set,
            desktop::desktop_pin,
            desktop::desktop_raise,
            editor::editor_show,
            editor::editor_fit,
            editor::editor_hide,
            secret::secret_set,
            secret::secret_exists,
            secret::secret_delete,
            github::gh_get,
            github::gh_private,
            github::gh_list,
            github::gh_put,
            files::local_read,
            files::local_write,
            files::local_list,
            files::local_clear,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // The last window going away (explorer restart, see desktop.rs) must not end the app before the watcher restarts it;
        // app.exit passes a code and still quits.
        .run(|_, e| {
            if let RunEvent::ExitRequested { code: None, api, .. } = e {
                api.prevent_exit();
            }
        });
}
