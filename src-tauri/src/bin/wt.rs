//! `wt` — tiny companion CLI for Watchtower.
//!
//! It doesn't touch the vault (that stays in the GUI, encrypted). It just
//! hands connection requests to the running Watchtower app via its URL scheme.

use std::process::Command;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn print_help() {
    println!(
        r#"wt {VERSION} — Watchtower companion

USAGE:
    wt ssh <[user@]host[:port]>     open an SSH session in Watchtower
    wt open <watchtower://...>      hand a Watchtower URL to the app
    wt --version
    wt --help

Examples:
    wt ssh root@10.0.0.5
    wt ssh prod.example.com:2222
"#
    );
}

fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", url]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.status().map(|_| ())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version" | "-V") => println!("wt {VERSION}"),
        Some("ssh") => {
            let Some(target) = args.get(1) else {
                eprintln!("wt: usage: wt ssh <[user@]host[:port]>");
                std::process::exit(2);
            };
            let url = format!("ssh://{}", target.trim_start_matches("ssh://"));
            if let Err(e) = open_url(&url) {
                eprintln!("wt: could not open Watchtower: {e}");
                std::process::exit(1);
            }
        }
        Some("open") => {
            let Some(url) = args.get(1) else {
                eprintln!("wt: usage: wt open <watchtower://...>");
                std::process::exit(2);
            };
            if let Err(e) = open_url(url) {
                eprintln!("wt: could not open Watchtower: {e}");
                std::process::exit(1);
            }
        }
        _ => print_help(),
    }
}
