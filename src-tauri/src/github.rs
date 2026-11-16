//! GitHub Contents API. The PAT is read from Credential Manager here and nowhere else; it is never logged.

use crate::{files::check_path, secret};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use std::sync::LazyLock;

static CLIENT: LazyLock<Client> = LazyLock::new(Client::new);

fn url(owner: &str, repo: &str, path: &str) -> Result<String, String> {
    let name = |s: &str| check_path(s).ok().filter(|s| !s.contains('/')).map(str::to_owned);
    let (o, r) = (name(owner), name(repo));
    match (o, r) {
        (Some(o), Some(r)) => Ok(format!("https://api.github.com/repos/{o}/{r}/contents/{}", check_path(path)?)),
        _ => Err("invalid owner/repo".into()),
    }
}

async fn send(req: RequestBuilder) -> Result<Response, String> {
    req.bearer_auth(secret::token()?)
        .header("User-Agent", "CalForPickle")
        .header("Accept", "application/vnd.github+json")
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
    let msg = res.json::<Value>().await.ok().and_then(|v| v["message"].as_str().map(str::to_owned));
    Err(format!("GitHub {status}: {}", msg.unwrap_or_default()))
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

/// None on 404 (file or repo content absent).
#[tauri::command]
pub async fn gh_get(owner: String, repo: String, path: String) -> Result<Option<FileOut>, String> {
    let res = send(CLIENT.get(url(&owner, &repo, &path)?)).await?;
    if res.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let f: FileIn = json_or_err(res).await?;
    // Files over 1 MB come back with encoding "none" and empty content.
    if f.encoding != "base64" {
        return Err(format!("{path}: unsupported encoding {} (file over 1 MB?)", f.encoding));
    }
    let bytes = STANDARD.decode(f.content.replace('\n', "")).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    Ok(Some(FileOut { text, sha: f.sha }))
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
    let res = send(CLIENT.get(url(&owner, &repo, &path)?)).await?;
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

/// sha = None creates the file. 409 (stale sha) and 422 (sha missing for an existing file) both mean
/// "remote moved": the caller refetches, merges and retries.
#[tauri::command]
pub async fn gh_put(
    owner: String,
    repo: String,
    path: String,
    text: String,
    sha: Option<String>,
) -> Result<PutOut, String> {
    let mut body = Map::new();
    body.insert("message".into(), json!(format!("CalForPickle: update {path}")));
    body.insert("content".into(), json!(STANDARD.encode(text)));
    if let Some(sha) = sha {
        body.insert("sha".into(), json!(sha));
    }
    let res = send(CLIENT.put(url(&owner, &repo, &path)?).json(&body)).await?;
    if matches!(res.status(), StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY) {
        return Ok(PutOut::Conflict);
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
    }
}
