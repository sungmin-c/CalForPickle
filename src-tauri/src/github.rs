//! GitHub Contents API. The PAT is read from Credential Manager here and nowhere else; it is never logged.

use crate::{files::check_path, secret};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use std::future::Future;
use std::sync::LazyLock;
use std::time::Duration;

// Without a timeout a half-open connection (hotel Wi-Fi, proxy) never returns and the sync queue stalls behind it.
static CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest client")
});

fn repo_url(owner: &str, repo: &str) -> Result<String, String> {
    let name = |s: &str| check_path(s).ok().filter(|s| !s.contains('/')).map(str::to_owned);
    match (name(owner), name(repo)) {
        (Some(o), Some(r)) => Ok(format!("https://api.github.com/repos/{o}/{r}")),
        _ => Err("invalid owner/repo".into()),
    }
}

fn url(owner: &str, repo: &str, path: &str) -> Result<String, String> {
    Ok(format!("{}/contents/{}", repo_url(owner, repo)?, check_path(path)?))
}

/// The webview may only touch the files the app itself syncs, so an XSS cannot write e.g. `.github/workflows/*`.
fn allowed_file(p: &str) -> Result<&str, String> {
    let month = |m: &str| {
        let b = m.as_bytes();
        b.len() == 7
            && b[4] == b'-'
            && b[..4].iter().all(u8::is_ascii_digit)
            && matches!(&m[5..], "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12")
    };
    let ok = matches!(p, "data/tasks.json" | "AGENT_GUIDE.md" | "upcoming.json")
        || p.strip_prefix("data/events/").and_then(|f| f.strip_suffix(".json")).is_some_and(month);
    if ok { Ok(p) } else { Err(format!("invalid path: {p}")) }
}

fn allowed_dir(p: &str) -> Result<&str, String> {
    if matches!(p, "data" | "data/events") { Ok(p) } else { Err(format!("invalid path: {p}")) }
}

const JSON_ACCEPT: &str = "application/vnd.github+json";
const RAW: &str = "application/vnd.github.raw+json";

async fn send(req: RequestBuilder) -> Result<Response, String> {
    send_accept(req, JSON_ACCEPT).await
}

async fn send_accept(req: RequestBuilder, accept: &str) -> Result<Response, String> {
    send_with(req, accept, &secret::token()?).await
}

async fn send_with(req: RequestBuilder, accept: &str, token: &str) -> Result<Response, String> {
    req.bearer_auth(token)
        .header("User-Agent", "CalForPickle")
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| e.without_url().to_string())
}

async fn json_or_err<T: DeserializeOwned>(res: Response) -> Result<T, String> {
    let status = res.status();
    if status.is_success() {
        return res.json().await.map_err(|e| e.without_url().to_string());
    }
    Err(err_of(res).await)
}

async fn message_of(res: Response) -> String {
    res.json::<Value>().await.ok().and_then(|v| v["message"].as_str().map(str::to_owned)).unwrap_or_default()
}

async fn err_of(res: Response) -> String {
    let status = res.status();
    format!("GitHub {status}: {}", message_of(res).await)
}

/// 422 also reports other validation errors; only "sha wasn't supplied" means the remote file moved.
fn sha_missing(msg: &str) -> bool {
    msg.contains("\"sha\"")
}

#[derive(Deserialize)]
struct FileIn {
    content: String,
    encoding: String,
    sha: String,
}

#[derive(Serialize)]
pub struct FileOut {
    text: String,
    sha: String,
}

#[derive(Deserialize)]
struct RepoIn {
    private: bool,
}

/// The data repo holds the whole calendar, so it must be private (needs only Metadata read).
/// `token` checks a token before it is stored; None uses the stored one (the periodic re-check).
#[tauri::command]
pub async fn gh_private(owner: String, repo: String, token: Option<String>) -> Result<bool, String> {
    let req = CLIENT.get(repo_url(&owner, &repo)?);
    let res = match token.as_deref().map(str::trim) {
        Some("") => return Err("empty token".into()),
        Some(t) => send_with(req, JSON_ACCEPT, t).await?,
        None => send(req).await?,
    };
    let r: RepoIn = json_or_err(res).await?;
    Ok(r.private)
}

/// Decodes the Contents API response; over-1MB files (encoding "none", empty content) come from `raw` instead.
/// sha always comes from the first response.
async fn file_out<F, Fut>(f: FileIn, raw: F) -> Result<FileOut, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let text = if f.encoding == "base64" {
        let bytes = STANDARD.decode(f.content.replace('\n', "")).map_err(|e| e.to_string())?;
        String::from_utf8(bytes).map_err(|e| e.to_string())?
    } else {
        raw().await?
    };
    Ok(FileOut { text, sha: f.sha })
}

/// None on 404 (file or repo content absent).
#[tauri::command]
pub async fn gh_get(owner: String, repo: String, path: String) -> Result<Option<FileOut>, String> {
    let u = url(&owner, &repo, allowed_file(&path)?)?;
    let res = send(CLIENT.get(&u)).await?;
    if res.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let f: FileIn = json_or_err(res).await?;
    let raw = || async {
        let res = send_accept(CLIENT.get(&u), RAW).await?;
        if !res.status().is_success() {
            return Err(err_of(res).await);
        }
        res.text().await.map_err(|e| e.without_url().to_string())
    };
    file_out(f, raw).await.map(Some)
}

#[derive(Deserialize)]
struct EntryIn {
    path: String,
    sha: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize)]
pub struct EntryOut {
    path: String,
    sha: String,
}

/// Files directly under a directory with their blob sha; [] on 404.
#[tauri::command]
pub async fn gh_list(owner: String, repo: String, path: String) -> Result<Vec<EntryOut>, String> {
    let res = send(CLIENT.get(url(&owner, &repo, allowed_dir(&path)?)?)).await?;
    if res.status() == StatusCode::NOT_FOUND {
        return Ok(vec![]);
    }
    let entries: Vec<EntryIn> = json_or_err(res).await?;
    Ok(entries
        .into_iter()
        .filter(|e| e.kind == "file")
        .map(|e| EntryOut { path: e.path, sha: e.sha })
        .collect())
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PutOut {
    Ok { sha: String },
    Conflict,
}

#[derive(Deserialize)]
struct PutIn {
    content: ShaIn,
}

#[derive(Deserialize)]
struct ShaIn {
    sha: String,
}

/// sha = None creates the file. 409 (stale sha) and 422 "sha wasn't supplied" (existing file) both mean
/// "remote moved": the caller refetches, merges and retries. Any other 422 is an error shown to the user.
#[tauri::command]
pub async fn gh_put(
    owner: String,
    repo: String,
    path: String,
    text: String,
    sha: Option<String>,
) -> Result<PutOut, String> {
    let u = url(&owner, &repo, allowed_file(&path)?)?;
    let mut body = Map::new();
    body.insert("message".into(), json!(format!("CalForPickle: update {path}")));
    body.insert("content".into(), json!(STANDARD.encode(text)));
    if let Some(sha) = sha {
        body.insert("sha".into(), json!(sha));
    }
    let res = send(CLIENT.put(u).json(&body)).await?;
    match res.status() {
        StatusCode::CONFLICT => return Ok(PutOut::Conflict),
        StatusCode::UNPROCESSABLE_ENTITY => {
            let msg = message_of(res).await;
            return if sha_missing(&msg) { Ok(PutOut::Conflict) } else { Err(format!("GitHub 422: {msg}")) };
        }
        _ => {}
    }
    let r: PutIn = json_or_err(res).await?;
    Ok(PutOut::Ok { sha: r.content.sha })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_rejects_bad_owner_repo() {
        assert!(url("me", "cal-data", "data/tasks.json").is_ok());
        assert!(url("me/x", "r", "a").is_err());
        assert!(url("me", "..", "a").is_err());
        assert!(url("me", "r", "../a").is_err());
        assert_eq!(url("me", "cal", "a.json").unwrap(), "https://api.github.com/repos/me/cal/contents/a.json");
    }

    #[test]
    fn only_app_files_and_dirs_are_allowed() {
        for p in ["data/tasks.json", "data/events/2026-11.json", "AGENT_GUIDE.md", "upcoming.json"] {
            assert_eq!(allowed_file(p), Ok(p), "{p}");
        }
        for p in [
            ".github/workflows/x.yml",
            "data/other.json",
            "data/events/2026-13.json",
            "data/events/2026-00.json",
            "data/events/26-11.json",
            "data/events/2026-11.json.tmp",
            "data/events/2026-11.json/x",
            "data/events",
            "data",
            "README.md",
            "../data/tasks.json",
            "data/tasks.json/",
            "",
        ] {
            assert!(allowed_file(p).is_err(), "{p}");
        }
        for p in ["data", "data/events"] {
            assert_eq!(allowed_dir(p), Ok(p), "{p}");
        }
        for p in ["", ".", ".github", ".github/workflows", "data/", "data/events/2026-11.json", "data/x", "upcoming.json"] {
            assert!(allowed_dir(p).is_err(), "{p}");
        }
    }

    #[test]
    fn commands_reject_other_paths_before_any_request() {
        use tauri::async_runtime::block_on;
        let bad = || ".github/workflows/x.yml".to_string();
        let (me, r) = ("me".to_string(), "r".to_string());
        assert!(block_on(gh_get(me.clone(), r.clone(), bad())).err().unwrap().starts_with("invalid path"));
        assert!(block_on(gh_list(me.clone(), r.clone(), bad())).err().unwrap().starts_with("invalid path"));
        assert!(block_on(gh_put(me, r, bad(), "x".into(), None)).err().unwrap().starts_with("invalid path"));
    }

    #[test]
    fn over_1mb_file_is_fetched_raw_with_first_sha() {
        let big = FileIn { content: String::new(), encoding: "none".into(), sha: "abc".into() };
        let out = tauri::async_runtime::block_on(file_out(big, || async { Ok("{\"big\":1}".to_string()) }))
            .unwrap();
        assert_eq!((out.text.as_str(), out.sha.as_str()), ("{\"big\":1}", "abc"));

        let small = FileIn { content: STANDARD.encode("hi"), encoding: "base64".into(), sha: "s".into() };
        let out = tauri::async_runtime::block_on(file_out(small, || async { Err("raw must not be called".into()) })).unwrap();
        assert_eq!(out.text, "hi");

        let big = FileIn { content: String::new(), encoding: "none".into(), sha: "abc".into() };
        let err = tauri::async_runtime::block_on(file_out(big, || async { Err("GitHub 403: x".into()) })).err().unwrap();
        assert_eq!(err, "GitHub 403: x");
    }

    #[test]
    fn only_a_missing_sha_422_is_a_conflict() {
        assert!(sha_missing("Invalid request.

\"sha\" wasn't supplied."));
        assert!(!sha_missing("Invalid request.

\"content\" wasn't supplied."));
        assert!(!sha_missing(""));
    }

    #[test]
    fn private_check_rejects_blank_token_before_any_request() {
        let r = tauri::async_runtime::block_on(gh_private("me".into(), "r".into(), Some("  ".into())));
        assert_eq!(r, Err("empty token".into()));
    }

    /// Live check with the token in Credential Manager: `cargo test --lib -- --ignored private_flag`.
    #[test]
    #[ignore]
    fn private_flag_live() {
        let get = |r: &str| tauri::async_runtime::block_on(gh_private("sungmin-c".into(), r.into(), None));
        assert_eq!(get("CalForPickle"), Ok(false));
        assert_eq!(get("calforpickle-sandbox"), Ok(true));
    }
}
