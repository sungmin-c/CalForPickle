//! Local copy under %APPDATA%\CalForPickle. Writes go to a temp file then rename, so a crash never leaves half a JSON file.

use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Plain relative paths only ("data/events/2026-11.json"): no "..", no drive, no backslash.
/// Guards both the local root and the GitHub URL against values coming from the webview.
pub fn check_path(p: &str) -> Result<&str, String> {
    let ok = !p.is_empty()
        && p.split('/').all(|s| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        });
    if ok { Ok(p) } else { Err(format!("invalid path: {p}")) }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(|e| e.to_string())?.join("CalForPickle"))
}

fn write_atomic(file: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    let tmp = file.with_file_name(format!("{name}.tmp"));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
    }
    // std::fs::rename replaces an existing target on Windows (MoveFileExW + REPLACE_EXISTING).
    fs::rename(&tmp, file)
}

#[tauri::command]
pub fn local_read(app: AppHandle, path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(root(&app)?.join(check_path(&path)?)) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn local_write(app: AppHandle, path: String, text: String) -> Result<(), String> {
    write_atomic(&root(&app)?.join(check_path(&path)?), &text).map_err(|e| e.to_string())
}

/// Files directly under dir as "dir/name"; empty when dir does not exist.
#[tauri::command]
pub fn local_list(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = root(&app)?.join(check_path(&path)?);
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = vec![];
    for e in rd {
        let e = e.map_err(|e| e.to_string())?;
        if e.file_type().map_err(|e| e.to_string())?.is_file() {
            out.push(format!("{path}/{}", e.file_name().to_string_lossy()));
        }
    }
    out.sort();
    Ok(out)
}

/// "로컬 사본 삭제": the synced copy and its sync state. settings.json stays so the connection survives.
#[tauri::command]
pub fn local_clear(app: AppHandle) -> Result<(), String> {
    let root = root(&app)?;
    let gone = |r: io::Result<()>| match r {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    };
    gone(fs::remove_dir_all(root.join("data")))?;
    for f in ["sync-state.json", "upcoming.json", "AGENT_GUIDE.md"] {
        gone(fs::remove_file(root.join(f)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_path_rejects_escapes() {
        assert!(check_path("data/events/2026-11.json").is_ok());
        assert!(check_path("AGENT_GUIDE.md").is_ok());
        for bad in ["", "../x", "data/../x", "/x", "data//x", "C:/x", "data\\x", "a/./b", "x/"] {
            assert!(check_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("cfp-test-{}", std::process::id()));
        let f = dir.join("data/tasks.json");
        write_atomic(&f, "[]\n").unwrap();
        write_atomic(&f, "[1]\n").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "[1]\n");
        assert!(!dir.join("data/tasks.json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
