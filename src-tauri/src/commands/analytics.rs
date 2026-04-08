//! Opt-in analytics via a self-hosted Aptabase instance.
//!
//! Nothing is sent unless the user enabled the matching category in the UI.
//! Consent is mirrored here by `analytics_configure` so the backend refuses to
//! send even if the frontend misbehaves. Aptabase stores no IP and no
//! persistent identifier; the session id below is random per launch.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;

const APP_KEY: &str = "A-SH-4259784618";
const ENDPOINT: &str = "https://analytics.nytuo.fr/api/v0/event";
const MAX_PROP_LEN: usize = 300;

static USAGE: AtomicBool = AtomicBool::new(false);
static ERRORS: AtomicBool = AtomicBool::new(false);
static SESSION_ID: OnceLock<String> = OnceLock::new();
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn session_id() -> &'static str {
    SESSION_ID.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default()
    })
}

#[tauri::command]
pub fn analytics_configure(usage: bool, errors: bool) {
    USAGE.store(usage, Ordering::Relaxed);
    ERRORS.store(errors, Ordering::Relaxed);
}

/// `kind` is "usage" or "error"; each is gated by its own consent flag.
#[tauri::command]
pub fn analytics_track(
    app: AppHandle,
    kind: String,
    name: String,
    props: Option<HashMap<String, Value>>,
) {
    let allowed = match kind.as_str() {
        "usage" => USAGE.load(Ordering::Relaxed),
        "error" => ERRORS.load(Ordering::Relaxed),
        _ => false,
    };
    if !allowed {
        return;
    }
    let props: serde_json::Map<String, Value> = props
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(k, v)| match v {
            Value::String(s) => Some((k, Value::String(s.chars().take(MAX_PROP_LEN).collect()))),
            Value::Number(_) | Value::Bool(_) => Some((k, v)),
            _ => None,
        })
        .collect();
    let body = json!({
        "timestamp": time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        "sessionId": session_id(),
        "eventName": name.chars().take(100).collect::<String>(),
        "systemProps": {
            "isDebug": cfg!(debug_assertions),
            "locale": "",
            "osName": std::env::consts::OS,
            "osVersion": "",
            "engineName": "tauri",
            "engineVersion": "",
            "appVersion": app.package_info().version.to_string(),
            "sdkVersion": concat!("watchtower-aptabase@", env!("CARGO_PKG_VERSION")),
        },
        "props": props,
    });
    tauri::async_runtime::spawn(async move {
        let res = client()
            .post(ENDPOINT)
            .header("App-Key", APP_KEY)
            .json(&body)
            .send()
            .await;
        if let Err(e) = res {
            tracing::debug!(error = %e, "analytics send failed");
        }
    });
}
