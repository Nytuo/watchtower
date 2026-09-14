use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

use crate::error::AppError;
use crate::vault::schema::{AuthMethod, CredentialType, HostKeyPolicy, KnownHost};
use crate::vault::store::SharedVaultState;

pub type SharedMounts = AsyncMutex<HashMap<String, MountInfo>>;

#[derive(Clone, Serialize)]
pub struct MountInfo {
    pub id: String,
    pub server_id: String,
    pub server_name: String,
    pub host: String,
    pub remote_path: String,
    pub mount_point: String,
    #[serde(skip)]
    pub pid: Option<i32>,
    #[serde(skip)]
    pub scratch_dir: Option<PathBuf>,
}

#[derive(Serialize)]
pub struct MountToolStatus {
    pub available: bool,
    pub tool: String,
    pub hint: String,
}

fn which(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|p| p.join(bin).is_file()))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn mount_check_tool() -> Result<MountToolStatus, AppError> {
    #[cfg(target_os = "macos")]
    {
        Ok(MountToolStatus {
            available: which("sshfs"),
            tool: "sshfs".into(),
            hint:
                "Install macFUSE (macfuse.github.io), then `brew install gromgit/fuse/sshfs-mac`."
                    .into(),
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if crate::sandbox::is_flatpak() {
            return Ok(MountToolStatus {
                available: crate::sandbox::host_has("sshfs").await,
                tool: "sshfs".into(),
                hint: crate::sandbox::FLATPAK_HOST_HINT.into(),
            });
        }
        Ok(MountToolStatus {
            available: which("sshfs"),
            tool: "sshfs".into(),
            hint: "Install the sshfs package, e.g. `sudo apt install sshfs` or `sudo dnf install fuse-sshfs`."
                .into(),
        })
    }
    #[cfg(windows)]
    {
        let available = Path::new(r"C:\Program Files\SSHFS-Win\bin\sshfs-win.exe").exists()
            || Path::new(r"C:\Program Files (x86)\SSHFS-Win\bin\sshfs-win.exe").exists();
        Ok(MountToolStatus {
            available,
            tool: "sshfs-win".into(),
            hint: "Install WinFsp and SSHFS-Win from github.com/winfsp/sshfs-win/releases.".into(),
        })
    }
}

fn validate_ssh_config_field(name: &str, value: &str) -> Result<(), AppError> {
    if value.contains(['\n', '\r', '\0']) {
        return Err(AppError::General(format!(
            "{name} contains characters that aren't safe to use for mounting"
        )));
    }
    Ok(())
}

fn resolve_connection(
    vault_state: &State<'_, SharedVaultState>,
    server_id: &str,
) -> Result<
    (
        String,
        u16,
        String,
        AuthMethod,
        String,
        Vec<KnownHost>,
        HostKeyPolicy,
    ),
    AppError,
> {
    let vault = vault_state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    let entry = data
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .cloned()
        .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", server_id)))?;

    let mut auth = entry.auth.clone();
    if let AuthMethod::Keychain { ref keychain_id } = auth {
        let kc = data
            .keychains
            .iter()
            .find(|k| &k.id == keychain_id)
            .ok_or_else(|| {
                AppError::Vault(format!("Keychain entry '{}' not found", keychain_id))
            })?;
        auth = match &kc.credential {
            CredentialType::Password { password, .. } => AuthMethod::Password {
                password: password.clone(),
            },
            CredentialType::SshKey {
                private_key,
                passphrase,
                ..
            } => AuthMethod::Key {
                private_key: private_key.clone(),
                passphrase: passphrase.clone(),
            },
            _ => {
                return Err(AppError::General(
                    "This keychain credential type can't be used to mount a drive".into(),
                ))
            }
        };
    }

    validate_ssh_config_field("Host", &entry.host)?;
    validate_ssh_config_field("Username", &entry.username)?;
    if let AuthMethod::KeyFile { ref path, .. } = auth {
        validate_ssh_config_field("Key file path", path)?;
    }

    let policy = HostKeyPolicy::parse(&data.settings.host_key_policy);
    Ok((
        entry.host,
        entry.port,
        entry.username,
        auth,
        entry.name,
        data.known_hosts.clone(),
        policy,
    ))
}

#[cfg(unix)]
fn default_mount_point(app: &AppHandle, server_name: &str, id: &str) -> Result<PathBuf, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::General(format!("cannot resolve home directory: {e}")))?;
    let safe: String = server_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    Ok(home
        .join("WatchtowerMounts")
        .join(format!("{}-{}", safe, &id[..8])))
}

#[cfg(unix)]
async fn create_scratch_dir() -> Result<PathBuf, AppError> {
    use std::os::unix::fs::DirBuilderExt;
    let scratch = crate::sandbox::host_visible_temp_dir()
        .join(format!("watchtower-mount-{}", uuid::Uuid::new_v4()));
    let scratch_clone = scratch.clone();
    tokio::task::spawn_blocking(move || {
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&scratch_clone)
    })
    .await
    .map_err(|e| AppError::General(format!("cannot create scratch dir: {e}")))?
    .map_err(|e| AppError::General(format!("cannot create scratch dir: {e}")))?;
    Ok(scratch)
}

#[cfg(unix)]
async fn write_secret(path: &Path, contents: &str, mode: u32) -> Result<(), AppError> {
    use tokio::io::AsyncWriteExt;

    let mut f = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(path)
        .await
        .map_err(|e| AppError::General(format!("cannot write {}: {e}", path.display())))?;
    f.write_all(contents.as_bytes())
        .await
        .map_err(|e| AppError::General(format!("cannot write {}: {e}", path.display())))?;
    Ok(())
}

#[cfg(unix)]
async fn write_askpass_script(scratch: &Path, secret: &str) -> Result<PathBuf, AppError> {
    let path = scratch.join("askpass.sh");
    let escaped = secret.replace('\'', "'\\''");
    let script = format!("#!/bin/sh\nprintf '%s' '{escaped}'\n");
    write_secret(&path, &script, 0o700).await?;
    Ok(path)
}

#[cfg(unix)]
async fn resolve_known_hosts_lines(
    host: &str,
    port: u16,
    known_hosts: &[KnownHost],
    policy: HostKeyPolicy,
) -> Result<Vec<String>, AppError> {
    let scan = crate::sandbox::host_command("ssh-keyscan", std::iter::empty::<(&str, &str)>())
        .arg("-p")
        .arg(port.to_string())
        .arg("-T")
        .arg("5")
        .arg(host)
        .output()
        .await;

    let scanned_lines: Vec<String> = match &scan {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(str::to_string)
            .collect(),
        Err(_) => Vec::new(),
    };

    let mut trusted_lines = Vec::new();
    let mut any_verified = false;
    for line in &scanned_lines {
        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        let [_, key_type, b64] = parts.as_slice() else {
            continue;
        };
        let Ok(key) = russh_keys::parse_public_key_base64(b64) else {
            continue;
        };
        let fingerprint = key.fingerprint();
        if let Some(kh) = known_hosts
            .iter()
            .find(|kh| kh.host == host && kh.port == port && kh.key_type == *key_type)
        {
            if kh.trusted && kh.key_fingerprint == fingerprint {
                any_verified = true;
                trusted_lines.push(line.clone());
            } else if kh.trusted {
                tracing::error!(
                    host,
                    key_type,
                    expected = %kh.key_fingerprint,
                    got = %fingerprint,
                    "host key mismatch while resolving mount"
                );
                return Err(AppError::General(format!(
                    "The host key for {host} has changed since Watchtower last trusted it — refusing to mount. Connect via a terminal session to review and accept (or reject) the new key first."
                )));
            }
        }
    }

    if any_verified {
        return Ok(trusted_lines);
    }

    match policy {
        HostKeyPolicy::Strict => Err(AppError::General(format!(
            "No trusted host key on file for {host}:{port} — connect via a terminal session first so Watchtower can record and verify it, or relax Host Key Policy in Settings."
        ))),
        HostKeyPolicy::Off => Ok(Vec::new()),
        HostKeyPolicy::AcceptNew => {
            Ok(scanned_lines)
        }
    }
}

#[cfg(unix)]
#[tracing::instrument(skip(auth, known_hosts), fields(host, port, username, remote_path, mount_point = %mount_point.display()))]
async fn mount_sshfs(
    host: &str,
    port: u16,
    username: &str,
    remote_path: &str,
    mount_point: &Path,
    auth: &AuthMethod,
    known_hosts: &[KnownHost],
    host_key_policy: HostKeyPolicy,
) -> Result<(i32, PathBuf), AppError> {
    let scratch = create_scratch_dir().await?;
    match mount_sshfs_inner(
        host,
        port,
        username,
        remote_path,
        mount_point,
        auth,
        known_hosts,
        host_key_policy,
        &scratch,
    )
    .await
    {
        Ok(pid) => Ok((pid, scratch)),
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&scratch).await;
            Err(e)
        }
    }
}

#[cfg(unix)]
#[allow(clippy::too_many_arguments)]
async fn mount_sshfs_inner(
    host: &str,
    port: u16,
    username: &str,
    remote_path: &str,
    mount_point: &Path,
    auth: &AuthMethod,
    known_hosts: &[KnownHost],
    host_key_policy: HostKeyPolicy,
    scratch: &Path,
) -> Result<i32, AppError> {
    use std::os::unix::fs::MetadataExt;

    let alias = "watchtower-mount";
    let mut config = format!(
        "Host {alias}\n    HostName {host}\n    Port {port}\n    User {username}\n    ServerAliveInterval 15\n    ServerAliveCountMax 3\n    LogLevel VERBOSE\n    GSSAPIAuthentication no\n    BatchMode no\n"
    );

    let known_hosts_lines =
        resolve_known_hosts_lines(host, port, known_hosts, host_key_policy).await?;
    if matches!(host_key_policy, HostKeyPolicy::Off) {
        config.push_str("    StrictHostKeyChecking no\n    UserKnownHostsFile /dev/null\n");
    } else {
        let kh_path = scratch.join("known_hosts");
        write_secret(&kh_path, &(known_hosts_lines.join("\n") + "\n"), 0o600).await?;
        config.push_str("    StrictHostKeyChecking yes\n");
        config.push_str(&format!("    UserKnownHostsFile {}\n", kh_path.display()));
    }

    let mut env: Vec<(&'static str, PathBuf)> = vec![];

    match auth {
        AuthMethod::Agent | AuthMethod::None => {}
        AuthMethod::Password { password } => {
            let script = write_askpass_script(scratch, password).await?;
            config.push_str("    PreferredAuthentications password,keyboard-interactive\n");
            config.push_str("    PubkeyAuthentication no\n");
            env.push(("SSH_ASKPASS", script));
        }
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            let key_path = scratch.join("id_key");
            write_secret(&key_path, private_key, 0o600).await?;
            config.push_str(&format!("    IdentityFile {}\n", key_path.display()));
            config.push_str("    IdentitiesOnly yes\n");
            if let Some(pw) = passphrase.as_deref().filter(|p| !p.is_empty()) {
                let script = write_askpass_script(scratch, pw).await?;
                env.push(("SSH_ASKPASS", script));
            }
        }
        AuthMethod::KeyFile { path, passphrase } => {
            config.push_str(&format!("    IdentityFile {path}\n"));
            config.push_str("    IdentitiesOnly yes\n");
            if let Some(pw) = passphrase.as_deref().filter(|p| !p.is_empty()) {
                let script = write_askpass_script(scratch, pw).await?;
                env.push(("SSH_ASKPASS", script));
            }
        }
        AuthMethod::Keychain { .. } => unreachable!("resolved before dispatch"),
    }

    let config_path = scratch.join("ssh_config");
    write_secret(&config_path, &config, 0o600).await?;
    tracing::debug!(%config, "generated ssh_config for mount");

    let debug_log = scratch.join("ssh-debug.log");
    let wrapper_path = scratch.join("ssh_wrapper.sh");
    write_secret(
        &wrapper_path,
        &format!(
            "#!/bin/sh\nexec ssh -vvv -E '{}' \"$@\"\n",
            debug_log.display()
        ),
        0o700,
    )
    .await?;

    let stdout_path = scratch.join("sshfs-stdout.log");
    let stderr_path = scratch.join("sshfs-stderr.log");
    write_secret(&stdout_path, "", 0o600).await?;
    write_secret(&stderr_path, "", 0o600).await?;
    let stdout_file = std::fs::File::options()
        .write(true)
        .open(&stdout_path)
        .map_err(|e| AppError::General(format!("cannot open stdout log: {e}")))?;
    let stderr_file = std::fs::File::options()
        .write(true)
        .open(&stderr_path)
        .map_err(|e| AppError::General(format!("cannot open stderr log: {e}")))?;

    let mut spawn_env: Vec<(String, String)> = env
        .iter()
        .map(|(k, v)| (k.to_string(), v.display().to_string()))
        .collect();
    if !env.is_empty() {
        spawn_env.push(("SSH_ASKPASS_REQUIRE".into(), "force".into()));
        if std::env::var_os("DISPLAY").is_none() {
            spawn_env.push(("DISPLAY".into(), "localhost:0".into()));
        }
    }

    let mut cmd = crate::sandbox::host_command("sshfs", spawn_env);
    cmd.arg(format!("{alias}:{remote_path}"))
        .arg(mount_point)
        .arg("-f")
        .arg("-F")
        .arg(&config_path)
        .arg("-o")
        .arg("reconnect,follow_symlinks")
        .arg("-o")
        .arg(format!("ssh_command={}", wrapper_path.display()))
        .stdin(Stdio::null())
        .stdout(stdout_file)
        .stderr(stderr_file)
        .process_group(0);

    tracing::info!(?cmd, "spawning sshfs");
    let mut child = cmd.spawn().map_err(|e| {
        AppError::General(format!("failed to launch sshfs — is it installed? ({e})"))
    })?;
    let pid = child
        .id()
        .ok_or_else(|| AppError::General("sshfs exited immediately".into()))? as i32;

    let parent_dev = tokio::fs::metadata(mount_point.parent().unwrap_or(mount_point))
        .await
        .map(|m| m.dev())
        .ok();

    const MOUNT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);
    const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
    let deadline = tokio::time::Instant::now() + MOUNT_TIMEOUT;

    let outcome: Result<(), String> = loop {
        let mounted = parent_dev.is_some_and(|pd| {
            std::fs::metadata(mount_point)
                .map(|m| m.dev() != pd)
                .unwrap_or(false)
        });
        if mounted {
            break Ok(());
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                break Err(format!("sshfs exited early with {status}"));
            }
            Ok(None) => {}
            Err(e) => break Err(format!("failed to poll sshfs: {e}")),
        }

        if tokio::time::Instant::now() >= deadline {
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            break Err(format!(
                "timed out after {}s waiting for the server",
                MOUNT_TIMEOUT.as_secs()
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    };

    let ssh_debug = tokio::fs::read_to_string(&debug_log)
        .await
        .unwrap_or_default();
    let tail = |log: &str| -> String {
        log.lines()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" / ")
    };

    if let Err(reason) = outcome {
        let stdout = tokio::fs::read_to_string(&stdout_path)
            .await
            .unwrap_or_default();
        let stderr = tokio::fs::read_to_string(&stderr_path)
            .await
            .unwrap_or_default();
        tracing::error!(
            reason = %reason,
            stdout = %stdout.trim(),
            stderr = %stderr.trim(),
            ssh_debug = %ssh_debug,
            "sshfs mount did not succeed"
        );

        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            reason
        };
        let t = tail(&ssh_debug);
        return Err(AppError::General(if t.trim().is_empty() {
            format!("sshfs failed: {detail}")
        } else {
            format!("sshfs failed: {detail}\n\nssh: {t}")
        }));
    }

    tracing::info!(pid, "sshfs mounted successfully");
    Ok(pid)
}

#[cfg(windows)]
fn free_drive_letter() -> Option<char> {
    ('D'..='Z')
        .rev()
        .find(|c| !Path::new(&format!("{c}:\\")).exists())
}

#[cfg(windows)]
async fn mount_windows(
    host: &str,
    port: u16,
    username: &str,
    remote_path: &str,
    auth: &AuthMethod,
) -> Result<char, AppError> {
    use tokio::io::AsyncWriteExt;

    let password = match auth {
        AuthMethod::Password { password } => password.clone(),
        AuthMethod::Agent | AuthMethod::None => String::new(),
        AuthMethod::Key { .. } | AuthMethod::KeyFile { .. } => {
            return Err(AppError::General(
                "Mounting with a private key isn't supported on Windows yet — use password auth, or load the key into Pageant first."
                    .into(),
            ))
        }
        AuthMethod::Keychain { .. } => unreachable!("resolved before dispatch"),
    };

    let letter = free_drive_letter()
        .ok_or_else(|| AppError::General("no free drive letter available".into()))?;
    let unc_path = remote_path.trim_start_matches('/').replace('/', "\\");
    let unc = format!(r"\\sshfs\{username}@{host}!{port}\{unc_path}");

    let mut cmd = tokio::process::Command::new("net");
    cmd.arg("use").arg(format!("{letter}:")).arg(&unc);
    if !password.is_empty() {
        cmd.arg("*").stdin(Stdio::piped());
    }
    cmd.arg(format!("/user:{username}")).arg("/persistent:no");
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        AppError::General(format!(
            "failed to run 'net use' — is SSHFS-Win/WinFsp installed? ({e})"
        ))
    })?;
    if !password.is_empty() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format!("{password}\r\n").as_bytes()).await;
        }
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::General(format!("'net use' failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::General(format!(
            "mount failed: {}",
            stderr.trim()
        )));
    }
    Ok(letter)
}

#[tauri::command]
#[tracing::instrument(skip(app, vault_state, mounts))]
pub async fn mount_sftp(
    server_id: String,
    remote_path: Option<String>,
    mount_point: Option<String>,
    app: AppHandle,
    vault_state: State<'_, SharedVaultState>,
    mounts: State<'_, SharedMounts>,
) -> Result<MountInfo, AppError> {
    tracing::info!("mount requested");
    let (host, port, username, auth, server_name, known_hosts, host_key_policy) =
        resolve_connection(&vault_state, &server_id).inspect_err(|e| {
            tracing::error!(error = %e, "could not resolve server/credentials for mount");
        })?;
    let remote_path = remote_path.unwrap_or_else(|| "/".to_string());
    let id = uuid::Uuid::new_v4().to_string();

    #[cfg(unix)]
    let mount_point_path: PathBuf = match &mount_point {
        Some(p) => PathBuf::from(p),
        None => default_mount_point(&app, &server_name, &id)?,
    };
    #[cfg(unix)]
    let (pid, scratch_dir): (Option<i32>, Option<PathBuf>) = {
        let _ = &app;
        tokio::fs::create_dir_all(&mount_point_path)
            .await
            .map_err(|e| AppError::General(format!("cannot create mount point: {e}")))?;
        let (pid, scratch) = mount_sshfs(
            &host,
            port,
            &username,
            &remote_path,
            &mount_point_path,
            &auth,
            &known_hosts,
            host_key_policy,
        )
        .await?;
        (Some(pid), Some(scratch))
    };

    #[cfg(windows)]
    let mount_point_path: PathBuf = {
        let _ = (&mount_point, &app, &known_hosts, &host_key_policy);
        let letter = mount_windows(&host, port, &username, &remote_path, &auth).await?;
        PathBuf::from(format!("{letter}:\\"))
    };
    #[cfg(windows)]
    let pid: Option<i32> = None;
    #[cfg(windows)]
    let scratch_dir: Option<PathBuf> = None;

    let info = MountInfo {
        id: id.clone(),
        server_id,
        server_name,
        host,
        remote_path,
        mount_point: mount_point_path.to_string_lossy().to_string(),
        pid,
        scratch_dir,
    };

    mounts.lock().await.insert(id, info.clone());
    tracing::info!(mount_point = %info.mount_point, "mount registered");
    Ok(info)
}

#[tauri::command]
#[tracing::instrument(skip(mounts))]
pub async fn unmount_sftp(
    mount_id: String,
    mounts: State<'_, SharedMounts>,
) -> Result<(), AppError> {
    let info = mounts
        .lock()
        .await
        .remove(&mount_id)
        .ok_or_else(|| AppError::General("mount not found".into()))?;
    unmount_one(&info).await;
    Ok(())
}

async fn force_unmount_path(path: &str) {
    #[cfg(target_os = "macos")]
    {
        let ok = tokio::process::Command::new("diskutil")
            .arg("unmount")
            .arg(path)
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            let _ = tokio::process::Command::new("umount")
                .arg(path)
                .status()
                .await;
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let no_env = std::iter::empty::<(&str, &str)>;
        let ok = crate::sandbox::host_command("fusermount", no_env())
            .arg("-u")
            .arg(path)
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            let _ = crate::sandbox::host_command("umount", no_env())
                .arg(path)
                .status()
                .await;
        }
    }
    #[cfg(windows)]
    {
        let _ = path;
    }
}

async fn unmount_one(info: &MountInfo) {
    tracing::info!(mount_point = %info.mount_point, "unmounting");
    force_unmount_path(&info.mount_point).await;

    #[cfg(unix)]
    {
        if let Some(pid) = info.pid {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let alive = unsafe { libc::kill(pid, 0) == 0 };
            if alive {
                tracing::warn!(pid, "sshfs still running after unmount, killing it");
                unsafe {
                    libc::kill(-pid, libc::SIGKILL);
                }
            }
        }
        if let Some(scratch) = &info.scratch_dir {
            let _ = tokio::fs::remove_dir_all(scratch).await;
        }
    }
    #[cfg(windows)]
    {
        if let Some(letter) = info.mount_point.chars().next() {
            let _ = tokio::process::Command::new("net")
                .args(["use", &format!("{letter}:"), "/delete", "/y"])
                .status()
                .await;
        }
    }
}

pub async fn unmount_all(mounts: &SharedMounts) {
    let remaining: Vec<MountInfo> = mounts.lock().await.drain().map(|(_, v)| v).collect();
    if remaining.is_empty() {
        return;
    }
    tracing::info!(count = remaining.len(), "unmounting all drives on shutdown");
    for info in &remaining {
        unmount_one(info).await;
    }
}

#[cfg(unix)]
pub async fn reconcile_orphaned_mounts(app: &AppHandle) {
    use std::os::unix::fs::MetadataExt;

    let Ok(home) = app.path().home_dir() else {
        return;
    };
    let root = home.join("WatchtowerMounts");
    let Ok(mut entries) = tokio::fs::read_dir(&root).await else {
        return;
    };
    let Some(root_dev) = tokio::fs::metadata(&root).await.ok().map(|m| m.dev()) else {
        return;
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let Ok(meta) = tokio::fs::metadata(&path).await else {
            continue;
        };
        if meta.dev() == root_dev {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();
        tracing::warn!(mount_point = %path_str, "found orphaned mount from a previous run, unmounting");
        force_unmount_path(&path_str).await;
        let _ = tokio::fs::remove_dir(&path).await;
    }
}

#[cfg(windows)]
pub async fn reconcile_orphaned_mounts(_app: &AppHandle) {}

#[tauri::command]
pub async fn list_mounts(mounts: State<'_, SharedMounts>) -> Result<Vec<MountInfo>, AppError> {
    Ok(mounts.lock().await.values().cloned().collect())
}
