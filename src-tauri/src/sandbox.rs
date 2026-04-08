//! Running host tools (sshfs, ssh-keyscan, mosh, ...) from inside a Flatpak.
//!
//! The Flatpak runtime ships none of these tools and cannot mount FUSE file
//! systems, so inside the sandbox they run on the host through
//! `flatpak-spawn --host`. That requires the `org.freedesktop.Flatpak` bus
//! permission, which is not granted by default: users opt in with Flatseal or
//! `flatpak override`

use std::ffi::OsStr;
use std::path::PathBuf;

use tokio::process::Command;

pub const FLATPAK_HOST_HINT: &str = "Watchtower runs in a Flatpak sandbox: install it on your system, then allow Watchtower to run host commands — in Flatseal (Session Bus → Talk → org.freedesktop.Flatpak) or with `flatpak override --user --talk-name=org.freedesktop.Flatpak fr.nytuo.watchtower`.";

/// GUI launches (Finder/Dock/launchd) don't inherit the shell's PATH, so tools
/// installed by Homebrew/MacPorts/Nix (sshfs, mosh, ...) are invisible to the
/// bundled app. Append the usual locations once at startup, before any threads
/// read the environment.
pub fn augment_path() {
    #[cfg(unix)]
    {
        let extra = [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/opt/local/bin",
            "/run/current-system/sw/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ];
        let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        for dir in extra {
            let dir = PathBuf::from(dir);
            if !paths.contains(&dir) {
                paths.push(dir);
            }
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            std::env::set_var("PATH", joined);
        }
    }
}

pub fn is_flatpak() -> bool {
    std::path::Path::new("/.flatpak-info").exists()
}

pub fn host_command<P, I, K, V>(program: P, envs: I) -> Command
where
    P: AsRef<OsStr>,
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<str>,
    V: AsRef<str>,
{
    if is_flatpak() {
        let mut cmd = Command::new("flatpak-spawn");
        cmd.arg("--host");
        for (key, value) in envs {
            cmd.arg(format!("--env={}={}", key.as_ref(), value.as_ref()));
        }
        cmd.arg(program);
        cmd
    } else {
        let mut cmd = Command::new(program);
        for (key, value) in envs {
            cmd.env(key.as_ref(), value.as_ref());
        }
        cmd
    }
}

pub fn host_argv(argv: Vec<String>) -> Vec<String> {
    if is_flatpak() {
        ["flatpak-spawn".to_string(), "--host".to_string()]
            .into_iter()
            .chain(argv)
            .collect()
    } else {
        argv
    }
}

pub async fn host_has(bin: &str) -> bool {
    host_command("sh", std::iter::empty::<(&str, &str)>())
        .arg("-c")
        .arg("command -v \"$1\" >/dev/null")
        .arg("sh")
        .arg(bin)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn host_visible_temp_dir() -> PathBuf {
    if is_flatpak() {
        if let (Some(runtime), Some(app_id)) =
            (std::env::var_os("XDG_RUNTIME_DIR"), std::env::var_os("FLATPAK_ID"))
        {
            return PathBuf::from(runtime).join("app").join(app_id);
        }
    }
    std::env::temp_dir()
}
