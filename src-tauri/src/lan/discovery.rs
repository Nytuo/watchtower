use serde::{Deserialize, Serialize};

use super::identity::{current_window, rid, to_hex, Peer};

pub const SERVICE_TYPE: &str = "_watchtower-sync._tcp.local.";
pub const PAIR_MARKER: &str = "pair";

pub const RID_SLOTS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Found {
    pub instance: String,

    pub addrs: Vec<String>,

    pub rids: Vec<String>,

    #[serde(default)]
    pub gone: bool,
}

pub fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

pub fn dialable(addrs: impl IntoIterator<Item = std::net::IpAddr>) -> Vec<std::net::IpAddr> {
    let mut v4 = Vec::new();
    let mut v6 = Vec::new();
    for a in addrs {
        match a {
            std::net::IpAddr::V4(x) if x.is_private() || x.is_link_local() => {
                if !v4.contains(&a) {
                    v4.push(a)
                }
            }
            std::net::IpAddr::V6(x) if (x.segments()[0] & 0xfe00) == 0xfc00 => {
                if !v6.contains(&a) {
                    v6.push(a)
                }
            }
            _ => {}
        }
    }
    v4.extend(v6);
    v4
}

pub fn build_rids(peers: &[Peer], pairing: bool) -> Vec<String> {
    let w = current_window();
    let mut v: Vec<String> = Vec::new();
    if pairing {
        v.push(PAIR_MARKER.into());
    }
    for p in peers
        .iter()
        .filter(|p| p.confirmed)
        .take(RID_SLOTS - v.len())
    {
        if let Some(s) = super::identity::unhex(&p.pair_secret) {
            v.push(rid(&s, w));
        }
    }
    while v.len() < RID_SLOTS {
        v.push(to_hex(&super::identity::random_bytes::<8>()));
    }

    use rand::seq::SliceRandom;
    v.shuffle(&mut rand::thread_rng());
    v
}

pub fn match_peer<'a>(peers: &'a [Peer], found: &Found) -> Option<&'a Peer> {
    let w = current_window();
    peers.iter().filter(|p| p.confirmed).find(|p| {
        let Some(s) = super::identity::unhex(&p.pair_secret) else {
            return false;
        };
        [w.saturating_sub(1), w, w + 1]
            .iter()
            .any(|win| found.rids.contains(&rid(&s, *win)))
    })
}

pub fn is_pairing(found: &Found) -> bool {
    found.rids.iter().any(|r| r == PAIR_MARKER)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod desktop {
    use std::collections::HashMap;

    use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};

    use super::*;
    use crate::error::{AppError, AppResult};

    fn err<E: std::fmt::Display>(e: E) -> AppError {
        AppError::General(format!("mDNS: {e}"))
    }

    pub struct Daemon {
        d: ServiceDaemon,

        instance: std::sync::Mutex<String>,

        own: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    }

    impl Daemon {
        pub fn new(_app: &tauri::AppHandle) -> AppResult<Self> {
            Self::standalone()
        }

        pub fn standalone() -> AppResult<Self> {
            let d = ServiceDaemon::new().map_err(err)?;
            Ok(Self {
                d,
                instance: std::sync::Mutex::new(String::new()),
                own: Default::default(),
            })
        }

        pub fn advertise(&self, port: u16, rids: &[String]) -> AppResult<()> {
            self.unadvertise();
            let instance = to_hex(&super::super::identity::random_bytes::<4>());
            *self.instance.lock().unwrap() = instance.clone();
            self.own.lock().unwrap().push(instance.clone());
            let ips: Vec<std::net::IpAddr> = if_addrs::get_if_addrs()
                .map_err(err)?
                .into_iter()
                .filter(|i| !i.is_loopback())
                .map(|i| i.ip())
                .filter(is_private_ip)
                .collect();
            if ips.is_empty() {
                return Err(AppError::General(
                    "No private network connection found".into(),
                ));
            }
            let mut props = HashMap::new();
            props.insert("v".to_string(), "1".to_string());
            props.insert("r".to_string(), rids.join(","));
            let host = format!("wt-{}.local.", instance);
            let info = ServiceInfo::new(SERVICE_TYPE, &instance, &host, &ips[..], port, props)
                .map_err(err)?;
            self.d.register(info).map_err(err)
        }

        pub fn unadvertise(&self) {
            let cur = self.instance.lock().unwrap().clone();
            if !cur.is_empty() {
                let _ = self.d.unregister(&format!("{}.{}", cur, SERVICE_TYPE));
            }
        }

        pub fn browse(&self, on_found: impl Fn(Found) + Send + Sync + 'static) -> AppResult<()> {
            let rx = self.d.browse(SERVICE_TYPE).map_err(err)?;
            let own = self.own.clone();
            std::thread::spawn(move || {
                while let Ok(ev) = rx.recv() {
                    if let ServiceEvent::ServiceRemoved(_, fullname) = &ev {
                        on_found(Found {
                            instance: fullname.clone(),
                            addrs: vec![],
                            rids: vec![],
                            gone: true,
                        });
                        continue;
                    }
                    if let ServiceEvent::ServiceResolved(info) = ev {
                        let name = info.get_fullname().to_string();
                        if own
                            .lock()
                            .unwrap()
                            .iter()
                            .any(|o| name.starts_with(o.as_str()))
                        {
                            continue;
                        }
                        let rids = info
                            .get_property_val_str("r")
                            .map(|s| s.split(',').map(str::to_string).collect())
                            .unwrap_or_default();
                        let port = info.get_port();
                        let addrs = dialable(info.get_addresses().iter().map(|a| a.to_ip_addr()))
                            .iter()
                            .map(|a| format!("{}:{}", fmt_ip(a), port))
                            .collect();
                        on_found(Found {
                            instance: name,
                            addrs,
                            rids,
                            gone: false,
                        });
                    }
                }
            });
            Ok(())
        }

        pub fn shutdown(self) {
            self.unadvertise();
            let _ = self.d.shutdown();
        }
    }

    fn fmt_ip(ip: &std::net::IpAddr) -> String {
        match ip {
            std::net::IpAddr::V4(v) => v.to_string(),
            std::net::IpAddr::V6(v) => format!("[{}]", v),
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub mod mobile {
    use tauri::AppHandle;
    use tauri_plugin_wt_native::WtNativeExt;

    use super::*;
    use crate::error::{AppError, AppResult};

    pub struct Daemon {
        app: AppHandle,
        instance: std::sync::Mutex<String>,
        own: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    }

    fn err(e: String) -> AppError {
        AppError::General(format!("mDNS: {e}"))
    }

    impl Daemon {
        pub fn new(app: &AppHandle) -> AppResult<Self> {
            Ok(Self {
                app: app.clone(),
                instance: std::sync::Mutex::new(String::new()),
                own: Default::default(),
            })
        }

        pub fn advertise(&self, port: u16, rids: &[String]) -> AppResult<()> {
            let instance = to_hex(&super::super::identity::random_bytes::<4>());
            *self.instance.lock().unwrap() = instance.clone();
            self.own.lock().unwrap().push(instance.clone());
            self.app
                .wt_native()
                .advertise(&instance, port, SERVICE_TYPE, rids)
                .map_err(err)
        }

        pub fn unadvertise(&self) {
            let _ = self.app.wt_native().stop_advertise();
        }

        pub fn browse(&self, on_found: impl Fn(Found) + Send + Sync + 'static) -> AppResult<()> {
            let own = self.own.clone();
            self.app
                .wt_native()
                .browse(SERVICE_TYPE, move |f| {
                    if own
                        .lock()
                        .unwrap()
                        .iter()
                        .any(|o| f.instance.starts_with(o.as_str()))
                    {
                        return;
                    }
                    if f.gone {
                        on_found(Found {
                            instance: f.instance,
                            addrs: vec![],
                            rids: vec![],
                            gone: true,
                        });
                        return;
                    }
                    let socks: Vec<std::net::SocketAddr> =
                        f.addrs.iter().filter_map(|a| a.parse().ok()).collect();
                    let ips = dialable(socks.iter().map(|s| s.ip()));
                    let addrs = ips
                        .iter()
                        .filter_map(|ip| {
                            socks.iter().find(|s| s.ip() == *ip).map(|s| s.to_string())
                        })
                        .collect();
                    on_found(Found {
                        instance: f.instance,
                        addrs,
                        rids: f.rids,
                        gone: false,
                    });
                })
                .map_err(err)
        }

        pub fn shutdown(self) {
            self.unadvertise();
            let _ = self.app.wt_native().stop_browse();
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use desktop::Daemon;
#[cfg(any(target_os = "android", target_os = "ios"))]
pub use mobile::Daemon;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan::identity::{now_secs, Peer};

    fn peer(secret: &[u8], confirmed: bool) -> Peer {
        Peer {
            id: "p".into(),
            label: "x".into(),
            public_key: String::new(),
            pair_secret: to_hex(secret),
            added_at: now_secs(),
            last_sync: None,
            confirmed,
        }
    }

    #[test]
    fn rids_fixed_size_and_matchable() {
        let p = peer(&[5u8; 32], true);
        let rids = build_rids(std::slice::from_ref(&p), false);
        assert_eq!(rids.len(), RID_SLOTS);
        let f = Found {
            instance: "i".into(),
            addrs: vec![],
            rids,
            gone: false,
        };
        assert!(match_peer(std::slice::from_ref(&p), &f).is_some());
        assert!(match_peer(&[peer(&[6u8; 32], true)], &f).is_none());
    }

    #[test]
    fn unconfirmed_peers_not_advertised_or_matched() {
        let p = peer(&[5u8; 32], false);
        let rids = build_rids(std::slice::from_ref(&p), true);
        assert_eq!(rids.len(), RID_SLOTS);
        let f = Found {
            instance: "i".into(),
            addrs: vec![],
            rids,
            gone: false,
        };
        assert!(is_pairing(&f));
        assert!(match_peer(std::slice::from_ref(&p), &f).is_none());
    }

    #[test]
    fn dialable_prefers_v4_and_drops_link_local_v6() {
        let ips: Vec<std::net::IpAddr> = [
            "fe80::1",
            "fd00::2",
            "192.168.1.5",
            "192.168.1.5",
            "8.8.8.8",
        ]
        .iter()
        .map(|s| s.parse().unwrap())
        .collect();
        let d: Vec<String> = dialable(ips).iter().map(|i| i.to_string()).collect();
        assert_eq!(d, vec!["192.168.1.5", "fd00::2"]);
    }

    #[test]
    fn private_ranges() {
        for ip in [
            "192.168.1.1",
            "10.0.0.5",
            "172.16.3.3",
            "169.254.1.1",
            "fd00::1",
            "fe80::1",
        ] {
            assert!(is_private_ip(&ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2001:4860::1"] {
            assert!(!is_private_ip(&ip.parse().unwrap()), "{ip}");
        }
    }
}
