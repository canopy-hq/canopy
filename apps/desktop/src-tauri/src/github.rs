use serde::{Deserialize, Serialize};

// ── Constants ─────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE: &str = "com.superagent.app";
const KEYCHAIN_USER: &str = "github-oauth-token";

fn client_id() -> Result<String, String> {
    option_env!("SUPERAGENT_GITHUB_CLIENT_ID")
        .map(String::from)
        .ok_or_else(|| "SUPERAGENT_GITHUB_CLIENT_ID not set at build time".into())
}

// ── Types ─────────────────────────────────────────────────────────────

// GitHub sends snake_case; Tauri IPC serializes camelCase for the frontend.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct TokenSuccessResponse {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct TokenErrorResponse {
    pub error: String,
    pub error_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConnection {
    pub username: String,
    pub avatar_url: String,
}

// ── Keychain helpers ──────────────────────────────────────────────────

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| format!("keychain entry error: {e}"))
}

fn store_token(token: &str) -> Result<(), String> {
    keychain_entry()?.set_password(token).map_err(|e| format!("keychain store error: {e}"))
}

fn load_token() -> Result<Option<String>, String> {
    match keychain_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain load error: {e}")),
    }
}

fn delete_token() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete error: {e}")),
    }
}

// ── HTTP helpers ──────────────────────────────────────────────────────

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Superagent-Desktop/0.1")
        .build()
        .map_err(|e| format!("http client error: {e}"))
}

async fn fetch_github_user(token: &str) -> Result<GitHubConnection, String> {
    #[derive(Deserialize)]
    struct GhUser {
        login: String,
        avatar_url: String,
    }

    let client = http_client()?;
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub API error: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        return Err(format!("github_api_error:{code}"));
    }

    let user: GhUser = resp.json().await.map_err(|e| format!("parse error: {e}"))?;
    Ok(GitHubConnection {
        username: user.login,
        avatar_url: user.avatar_url,
    })
}

fn is_auth_error(e: &str) -> bool {
    e.starts_with("github_api_error:401") || e.starts_with("github_api_error:403")
}

// ── Tauri commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn github_start_device_flow() -> Result<DeviceCodeResponse, String> {
    let cid = client_id()?;
    let client = http_client()?;

    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", cid.as_str()), ("scope", "repo")])
        .send()
        .await
        .map_err(|e| format!("device flow request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub returned {status}: {body}"));
    }

    resp.json::<DeviceCodeResponse>()
        .await
        .map_err(|e| format!("parse error: {e}"))
}

#[tauri::command]
pub async fn github_poll_token(device_code: String, interval: u64, expires_in: u64) -> Result<GitHubConnection, String> {
    let cid = client_id()?;
    let client = http_client()?;
    let mut poll_interval = std::time::Duration::from_secs(interval.max(5));
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(expires_in);

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err("Device code expired. Please try again.".into());
        }
        tokio::time::sleep(poll_interval).await;

        let resp = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", cid.as_str()),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("token poll failed: {e}"))?;

        let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

        if let Ok(success) = serde_json::from_str::<TokenSuccessResponse>(&body) {
            store_token(&success.access_token)?;
            return fetch_github_user(&success.access_token).await;
        }

        let error: TokenErrorResponse =
            serde_json::from_str(&body).map_err(|e| format!("unexpected response: {e}"))?;

        match error.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                poll_interval += std::time::Duration::from_secs(5);
                continue;
            }
            "expired_token" => return Err("Device code expired. Please try again.".into()),
            "access_denied" => return Err("Authorization was denied by the user.".into()),
            other => return Err(format!("GitHub auth error: {other}")),
        }
    }
}

#[tauri::command]
pub async fn github_get_connection() -> Result<Option<GitHubConnection>, String> {
    let token = match load_token()? {
        Some(t) => t,
        None => return Ok(None),
    };

    match fetch_github_user(&token).await {
        Ok(conn) => Ok(Some(conn)),
        Err(e) => {
            if is_auth_error(&e) {
                let _ = delete_token();
            }
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn github_disconnect() -> Result<(), String> {
    delete_token()
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_device_code_response() {
        let json = r#"{
            "device_code": "3584d83530557fdd1f46af8289938c8ef79f9dc5",
            "user_code": "WDJB-MJHT",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 899,
            "interval": 5
        }"#;
        let resp: DeviceCodeResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.user_code, "WDJB-MJHT");
        assert_eq!(resp.interval, 5);
        assert_eq!(resp.verification_uri, "https://github.com/login/device");
    }

    #[test]
    fn parse_token_success_response() {
        let json = r#"{
            "access_token": "gho_16C7e42F292c6912E7710c838347Ae178B4a",
            "token_type": "bearer",
            "scope": "repo"
        }"#;
        let resp: TokenSuccessResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.access_token, "gho_16C7e42F292c6912E7710c838347Ae178B4a");
        assert_eq!(resp.token_type, "bearer");
    }

    #[test]
    fn parse_token_error_response() {
        let json = r#"{
            "error": "authorization_pending",
            "error_description": "The authorization request is still pending."
        }"#;
        let resp: TokenErrorResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.error, "authorization_pending");
    }

    #[test]
    fn parse_token_error_without_description() {
        let json = r#"{"error": "slow_down"}"#;
        let resp: TokenErrorResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.error, "slow_down");
        assert!(resp.error_description.is_none());
    }

    #[test]
    fn client_id_from_env() {
        let result = client_id();
        if option_env!("SUPERAGENT_GITHUB_CLIENT_ID").is_some() {
            assert!(result.is_ok());
        } else {
            assert!(result.unwrap_err().contains("not set"));
        }
    }
}
