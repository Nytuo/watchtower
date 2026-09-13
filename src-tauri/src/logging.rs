use std::path::Path;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

const FILE_PREFIX: &str = "watchtower";
const FILE_SUFFIX: &str = "log";
const KEEP_DAYS: u64 = 14;

fn clean_old_logs(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now() - Duration::from_secs(KEEP_DAYS * 24 * 60 * 60);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(FILE_PREFIX) || !name.ends_with(FILE_SUFFIX) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified < cutoff {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

pub fn init(app: &AppHandle) -> WorkerGuard {
    let log_dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("watchtower-logs"));
    let _ = std::fs::create_dir_all(&log_dir);
    clean_old_logs(&log_dir);

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(FILE_PREFIX)
        .filename_suffix(FILE_SUFFIX)
        .max_log_files(KEEP_DAYS as usize)
        .build(&log_dir)
        .unwrap_or_else(|_| RollingFileAppender::new(Rotation::DAILY, &log_dir, FILE_PREFIX));

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter = || {
        EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,watchtower_lib=debug"))
    };

    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_filter(filter());

    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true)
        .with_filter(filter());

    if let Err(e) = tracing_subscriber::registry()
        .with(file_layer)
        .with(stderr_layer)
        .try_init()
    {
        eprintln!("logging: subscriber already installed, skipping ({e})");
    } else {
        tracing::info!(dir = %log_dir.display(), "logging initialized");
    }
    guard
}
