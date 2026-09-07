use serde::Serialize;
use std::path::Path;

use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct LocalFileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<u64>,
}

#[tauri::command]
pub fn local_home() -> Result<String, AppError> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| AppError::General("Cannot resolve home directory".into()))?;
    Ok(home)
}

#[tauri::command]
pub fn local_ls(path: String) -> Result<Vec<LocalFileEntry>, AppError> {
    let dir = Path::new(&path);
    let mut result = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::General(format!("Cannot read {}: {}", path, e)))?;

    for entry in entries.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        result.push(LocalFileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            size: if meta.is_file() { meta.len() } else { 0 },
            is_dir: meta.is_dir(),
            modified,
        });
    }

    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}
