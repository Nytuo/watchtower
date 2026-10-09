//! Developer tool: advertise (and/or browse) the watchtower service on this
//! machine to debug discovery.   cargo run --example mdns_probe -- [adv|browse|both] [seconds]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn main() {
    use watchtower_lib::lan::discovery::{build_rids, desktop::Daemon};
    let mode = std::env::args().nth(1).unwrap_or_else(|| "both".into());
    let secs: u64 = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(15);
    let d = Daemon::standalone().expect("daemon");
    if mode != "browse" {
        let rids = build_rids(&[], true);
        match d.advertise(43210, &rids) {
            Ok(()) => println!("advertising on 43210 with {} rids", rids.len()),
            Err(e) => println!("ADVERTISE FAILED: {e}"),
        }
    }
    if mode != "adv" {
        d.browse(|f| println!("FOUND {:?}", f)).expect("browse");
    }
    std::thread::sleep(std::time::Duration::from_secs(secs));
}
#[cfg(any(target_os = "android", target_os = "ios"))]
fn main() {}
