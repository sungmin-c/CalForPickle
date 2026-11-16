//! GitHub PAT in Windows Credential Manager. The token is never returned to the webview.

use keyring::{Entry, Error};

const SERVICE: &str = "CalForPickle";
const USER: &str = "github-pat";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

/// For Rust-side HTTP only.
pub fn token() -> Result<String, String> {
    entry()?.get_password().map_err(|e| match e {
        Error::NoEntry => "no GitHub token stored".to_string(),
        e => e.to_string(),
    })
}

#[tauri::command]
pub fn secret_set(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("empty token".into());
    }
    entry()?.set_password(t).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_exists() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Touches the real Credential Manager under a throwaway name: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn credential_manager_roundtrip() {
        let e = Entry::new("CalForPickle-selftest", "dummy").unwrap();
        e.set_password("not-a-real-token").unwrap();
        assert_eq!(e.get_password().unwrap(), "not-a-real-token");
        e.delete_credential().unwrap();
        assert!(matches!(e.get_password(), Err(Error::NoEntry)));
    }
}

/// "연결 해제": removing an absent token is not an error.
#[tauri::command]
pub fn secret_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
