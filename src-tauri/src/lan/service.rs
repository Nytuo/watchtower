use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use super::discovery::{self, Daemon, Found};
use super::identity::{
    self, current_window, now_secs, peer_id, random_bytes, to_hex, Identity, Peer,
};
use super::protocol::{self, Exchange, Hello, QrPayload};
use super::transport::{self, MODE_PAIR_CODE, MODE_PAIR_QR, MODE_SYNC};
use crate::error::{AppError, AppResult};
use crate::vault::schema::VaultData;
use crate::vault::store::SharedVaultState;
use crate::vault::{crypto, meta, store};

const IO_TIMEOUT: Duration = Duration::from_secs(20);
const PAIRING_WINDOW: Duration = Duration::from_secs(120);
const PAIRING_ATTEMPTS: u8 = 3;

const NEARBY_TTL: u64 = 6 * 3600;
const UNCONFIRMED_TTL: u64 = 600;

fn gerr<E: std::fmt::Display>(e: E) -> AppError {
    AppError::General(e.to_string())
}

enum OfferKind {
    Qr([u8; 32]),
    Code(String),
}

struct PairingOffer {
    kind: OfferKind,
    expires: tokio::time::Instant,
    attempts_left: u8,
}

#[derive(Clone, Serialize)]
pub struct NearbyDevice {
    pub peer_id: Option<String>,
    pub label: Option<String>,
    pub pairing: bool,
    pub addrs: Vec<String>,
    #[serde(skip)]
    seen: u64,
}

pub struct LanState {
    identity: Identity,
    identity_path: std::path::PathBuf,
    label: String,
    port: u16,
    running: bool,
    daemon: Option<Daemon>,
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
    pairing: Option<PairingOffer>,
    nearby: HashMap<String, NearbyDevice>,

    pending: Option<(Vec<u8>, bool)>,
    busy: bool,

    discovery_error: Option<String>,

    seen_total: u32,
    last_seen: Option<u64>,
}

pub type SharedLan = Arc<Mutex<Option<LanState>>>;

pub fn new_shared() -> SharedLan {
    Arc::new(Mutex::new(None))
}

fn load_state(app: &AppHandle) -> AppResult<LanState> {
    let dir = app.path().app_data_dir().map_err(gerr)?;
    let path = identity::identity_path(&dir);
    let mut identity = identity::load_or_create(&path)?;
    let cutoff = now_secs().saturating_sub(UNCONFIRMED_TTL);
    identity
        .peers
        .retain(|p| p.confirmed || p.added_at >= cutoff);
    Ok(LanState {
        identity,
        identity_path: path,
        label: default_label(),
        port: 0,
        running: false,
        daemon: None,
        tasks: Vec::new(),
        pairing: None,
        nearby: HashMap::new(),
        pending: None,
        busy: false,
        discovery_error: None,
        seen_total: 0,
        last_seen: None,
    })
}

fn default_label() -> String {
    if cfg!(target_os = "ios") {
        "iPhone / iPad".into()
    } else if cfg!(target_os = "android") {
        "Android device".into()
    } else {
        std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .unwrap_or_else(|_| "Desktop".into())
    }
}

async fn with_state<R>(
    app: &AppHandle,
    lan: &SharedLan,
    f: impl FnOnce(&mut LanState) -> AppResult<R>,
) -> AppResult<R> {
    let mut g = lan.lock().await;
    if g.is_none() {
        *g = Some(load_state(app)?);
    }
    f(g.as_mut().expect("initialised"))
}

fn persist(s: &LanState) {
    if let Err(e) = identity::save(&s.identity_path, &s.identity) {
        tracing::warn!(error = %e, "could not save sync identity");
    }
}

fn emit(app: &AppHandle, kind: &str, data: serde_json::Value) {
    let _ = app.emit(
        "lan-event",
        serde_json::json!({ "kind": kind, "data": data }),
    );
}

fn local_addrs(port: u16) -> Vec<String> {
    if_addrs::get_if_addrs()
        .map(|v| {
            v.into_iter()
                .filter(|i| !i.is_loopback() && discovery::is_private_ip(&i.ip()))
                .filter(|i| i.ip().is_ipv4())
                .map(|i| format!("{}:{}", i.ip(), port))
                .collect()
        })
        .unwrap_or_default()
}

struct Snapshot {
    hello: Hello,
    blob: Vec<u8>,
}

fn snapshot(vault: &SharedVaultState) -> AppResult<Snapshot> {
    let mut v = vault
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let path = v
        .file_path
        .clone()
        .ok_or_else(|| AppError::Vault("No vault file is open".into()))?;
    let kdf = v
        .kdf
        .clone()
        .ok_or_else(|| AppError::Vault("Vault is locked".into()))?;
    let key = v
        .key
        .clone()
        .ok_or_else(|| AppError::Vault("Vault is locked".into()))?;
    let data = v.get_data_mut()?;
    let before = meta::state_hash(&data.sync_meta);
    meta::touch(data, &kdf.salt);
    if meta::state_hash(&data.sync_meta) != before {
        store::save_vault(&path, &kdf, &key, data)?;
    }
    let hello = Hello {
        proto: protocol::PROTO,
        vault_id: data.sync_meta.vault_id.clone(),
        state_hash: meta::state_hash(&data.sync_meta),
        pull: false,
    };
    let blob = std::fs::read(&path)?;
    Ok(Snapshot { hello, blob })
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    UpToDate,
    Merged,
    NeedsPassword,
    DifferentVault,
    Imported,

    Served,
}

enum Applied {
    Unchanged,
    Merged,
    NeedsPassword,
}

fn merge_into(vault: &SharedVaultState, remote: VaultData, foreign: bool) -> AppResult<Applied> {
    let mut v = vault
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let path = v
        .file_path
        .clone()
        .ok_or_else(|| AppError::Vault("No vault file is open".into()))?;
    let kdf = v
        .kdf
        .clone()
        .ok_or_else(|| AppError::Vault("Vault is locked".into()))?;
    let key = v
        .key
        .clone()
        .ok_or_else(|| AppError::Vault("Vault is locked".into()))?;
    let local = v.get_data()?.clone();
    let mut merged = if foreign {
        meta::merge_adopting(&local, &remote)?
    } else {
        meta::merge(&local, &remote)?
    };
    if meta::state_hash(&merged.sync_meta) == meta::state_hash(&local.sync_meta)
        && merged.sync_meta.vault_id == local.sync_meta.vault_id
    {
        return Ok(Applied::Unchanged);
    }

    let _ = std::fs::copy(&path, path.with_extension("watchtower.bak"));
    store::save_vault(&path, &kdf, &key, &mut merged)?;
    v.data = Some(merged);
    Ok(Applied::Merged)
}

fn apply_blob(vault: &SharedVaultState, blob: &[u8], foreign: bool) -> AppResult<Applied> {
    if blob.is_empty() {
        return Ok(Applied::Unchanged);
    }
    let (my_salt, key) = {
        let v = vault
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        (
            v.kdf.as_ref().map(|k| k.salt),
            v.key
                .clone()
                .ok_or_else(|| AppError::Vault("Vault is locked".into()))?,
        )
    };
    if crypto::header_salt(blob) != my_salt {
        return Ok(Applied::NeedsPassword);
    }
    let plain = zeroize::Zeroizing::new(crypto::decrypt_with_key(blob, &key)?);
    let remote: VaultData = serde_json::from_slice(&plain)
        .map_err(|e| AppError::Vault(format!("Peer vault is corrupt: {e}")))?;
    merge_into(vault, remote, foreign)
}

fn outcome_of(a: Applied) -> Outcome {
    match a {
        Applied::Unchanged => Outcome::UpToDate,
        Applied::Merged => Outcome::Merged,
        Applied::NeedsPassword => Outcome::NeedsPassword,
    }
}

async fn finish_exchange(
    app: &AppHandle,
    lan: &SharedLan,
    peer: &str,
    ex: Exchange,
    foreign: bool,
) -> AppResult<Outcome> {
    let vault = app.state::<SharedVaultState>();
    let out = match ex {
        Exchange::UpToDate => Outcome::UpToDate,
        Exchange::Served => Outcome::Served,
        Exchange::DifferentVault => Outcome::DifferentVault,
        Exchange::Received(blob) => {
            let applied = apply_blob(&vault, &blob, foreign)?;
            if matches!(applied, Applied::NeedsPassword) {
                with_state(app, lan, |s| {
                    s.pending = Some((blob, foreign));
                    Ok(())
                })
                .await?;
            }
            outcome_of(applied)
        }
    };
    if matches!(out, Outcome::UpToDate | Outcome::Merged | Outcome::Served) {
        let peer = peer.to_string();
        with_state(app, lan, |s| {
            if let Some(p) = s.identity.peers.iter_mut().find(|p| p.id == peer) {
                p.last_sync = Some(now_secs());
            }
            persist(s);
            Ok(())
        })
        .await?;
    }
    if out == Outcome::Merged {
        let _ = app.emit("vault-changed", ());
    }
    emit(
        app,
        "synced",
        serde_json::json!({ "peer": peer, "outcome": out }),
    );
    Ok(out)
}

async fn accept_loop(app: AppHandle, lan: SharedLan, listener: TcpListener) {
    loop {
        let Ok((sock, addr)) = listener.accept().await else {
            continue;
        };
        if !discovery::is_private_ip(&addr.ip()) {
            continue;
        }
        let (app, lan) = (app.clone(), lan.clone());
        tauri::async_runtime::spawn(async move {
            let claimed = with_state(&app, &lan, |s| {
                if s.busy {
                    Ok(false)
                } else {
                    s.busy = true;
                    Ok(true)
                }
            })
            .await
            .unwrap_or(false);
            if !claimed {
                return;
            }
            let r = tokio::time::timeout(IO_TIMEOUT * 3, handle_conn(&app, &lan, sock, addr)).await;
            if let Ok(Err(e)) = &r {
                tracing::debug!(error = %e, "lan connection ended");
            }
            let _ = with_state(&app, &lan, |s| {
                s.busy = false;
                Ok(())
            })
            .await;
        });
    }
}

async fn handle_conn(
    app: &AppHandle,
    lan: &SharedLan,
    mut sock: TcpStream,
    _addr: SocketAddr,
) -> AppResult<()> {
    let mut mode = [0u8; 1];
    tokio::time::timeout(IO_TIMEOUT, sock.read_exact(&mut mode))
        .await
        .map_err(gerr)?
        .map_err(gerr)?;
    let (priv_key, label) = with_state(app, lan, |s| {
        Ok((s.identity.private_bytes(), s.label.clone()))
    })
    .await?;
    match mode[0] {
        MODE_SYNC => {
            let mut sec =
                tokio::time::timeout(IO_TIMEOUT, transport::accept(sock, &priv_key, None))
                    .await
                    .map_err(gerr)??;
            let peer = with_state(app, lan, |s| {
                Ok(s.identity
                    .find_by_key(&sec.remote_static)
                    .filter(|p| p.confirmed)
                    .map(|p| p.id.clone()))
            })
            .await?
            .ok_or_else(|| AppError::General("unknown device".into()))?;
            let vault = app.state::<SharedVaultState>();
            let snap = snapshot(&vault)?;
            let ex = tokio::time::timeout(
                IO_TIMEOUT * 2,
                protocol::sync_responder(&mut sec, &snap.hello, &snap.blob),
            )
            .await
            .map_err(gerr)??;
            finish_exchange(app, lan, &peer, ex, false).await?;
            Ok(())
        }
        m @ (MODE_PAIR_QR | MODE_PAIR_CODE) => {
            let secret_src = with_state(app, lan, |s| {
                let Some(o) = s.pairing.as_mut() else {
                    return Ok(None);
                };
                if o.expires <= tokio::time::Instant::now() || o.attempts_left == 0 {
                    s.pairing = None;
                    return Ok(None);
                }
                o.attempts_left -= 1;
                let res = match (&o.kind, m) {
                    (OfferKind::Qr(k), MODE_PAIR_QR) => Some(Ok(*k)),
                    (OfferKind::Code(c), MODE_PAIR_CODE) => Some(Err(c.clone())),
                    _ => None,
                };
                if o.attempts_left == 0 {}
                Ok(res)
            })
            .await?
            .ok_or_else(|| AppError::General("no pairing window".into()))?;
            let psk = match secret_src {
                Ok(k) => k,
                Err(code) => {
                    tokio::time::timeout(IO_TIMEOUT, protocol::spake_key(&mut sock, &code))
                        .await
                        .map_err(gerr)??
                }
            };
            let mut sec =
                tokio::time::timeout(IO_TIMEOUT, transport::accept(sock, &priv_key, Some(&psk)))
                    .await
                    .map_err(gerr)??;
            let paired =
                tokio::time::timeout(IO_TIMEOUT, protocol::pair_responder(&mut sec, &label))
                    .await
                    .map_err(gerr)??;
            let sas = transport::sas(&sec.handshake_hash);
            let peer = new_peer(&sec.remote_static, &paired);
            let pid = peer.id.clone();
            let plabel = peer.label.clone();
            with_state(app, lan, |s| {
                s.identity.upsert(peer);
                s.pairing = None;
                persist(s);
                Ok(())
            })
            .await?;
            emit(
                app,
                "pair",
                serde_json::json!({ "peer_id": pid, "label": plabel, "sas": sas }),
            );
            Ok(())
        }
        _ => Err(AppError::General("unknown mode".into())),
    }
}

fn new_peer(remote_static: &[u8], p: &protocol::Paired) -> Peer {
    Peer {
        id: peer_id(remote_static),
        label: p.remote_label.clone(),
        public_key: to_hex(remote_static),
        pair_secret: to_hex(&p.pair_secret),
        added_at: now_secs(),
        last_sync: None,
        confirmed: false,
    }
}

#[derive(Serialize)]
pub struct LanStatus {
    pub running: bool,
    pub port: u16,
    pub fingerprint: String,
    pub label: String,
    pub pairing_open: bool,
    pub pending_password: bool,
    pub discovery_error: Option<String>,
    pub seen_total: u32,
    pub last_seen: Option<u64>,
    pub peers: Vec<PeerView>,
}

#[derive(Serialize)]
pub struct PeerView {
    pub id: String,
    pub label: String,
    pub confirmed: bool,
    pub last_sync: Option<u64>,
}

fn status_of(s: &LanState) -> LanStatus {
    LanStatus {
        running: s.running,
        port: s.port,
        fingerprint: s.identity.fingerprint(),
        label: s.label.clone(),
        pairing_open: s
            .pairing
            .as_ref()
            .map(|o| o.expires > tokio::time::Instant::now())
            .unwrap_or(false),
        pending_password: s.pending.is_some(),
        discovery_error: s.discovery_error.clone(),
        seen_total: s.seen_total,
        last_seen: s.last_seen,
        peers: s
            .identity
            .peers
            .iter()
            .map(|p| PeerView {
                id: p.id.clone(),
                label: p.label.clone(),
                confirmed: p.confirmed,
                last_sync: p.last_sync,
            })
            .collect(),
    }
}

#[tauri::command]
pub async fn lan_status(app: AppHandle, lan: State<'_, SharedLan>) -> Result<LanStatus, AppError> {
    with_state(&app, &lan, |s| Ok(status_of(s))).await
}

fn sanitize_label(l: &str) -> String {
    let t: String = l.chars().filter(|c| !c.is_control()).take(48).collect();
    let t = t.trim().to_string();
    if t.is_empty() {
        default_label()
    } else {
        t
    }
}

#[tauri::command]
pub async fn lan_start(
    label: Option<String>,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<LanStatus, AppError> {
    let shared: SharedLan = lan.inner().clone();
    if with_state(&app, &shared, |s| Ok(s.running)).await? {
        return with_state(&app, &shared, |s| Ok(status_of(s))).await;
    }
    let listener = TcpListener::bind("0.0.0.0:0").await.map_err(gerr)?;
    let port = listener.local_addr().map_err(gerr)?.port();

    let daemon = Daemon::new(&app);
    let mut disc_err = daemon.as_ref().err().map(|e| e.to_string());
    let daemon = daemon.ok();
    let accept = tauri::async_runtime::spawn(accept_loop(app.clone(), shared.clone(), listener));

    let adv = {
        let (app, shared) = (app.clone(), shared.clone());
        tauri::async_runtime::spawn(async move {
            let mut last: Option<(u64, bool, String)> = None;
            loop {
                let key = with_state(&app, &shared, |s| {
                    let pairing = s
                        .pairing
                        .as_ref()
                        .map(|o| o.expires > tokio::time::Instant::now())
                        .unwrap_or(false);

                    let peers: String = s
                        .identity
                        .peers
                        .iter()
                        .filter(|p| p.confirmed)
                        .map(|p| p.id.as_str())
                        .collect::<Vec<_>>()
                        .join(",");
                    Ok((current_window(), pairing, peers))
                })
                .await;
                let Ok(key) = key else { break };
                if last.as_ref() != Some(&key) {
                    let started = with_state(&app, &shared, |s| Ok(s.running))
                        .await
                        .unwrap_or(false);
                    if !started {
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        continue;
                    }
                    let _ = with_state(&app, &shared, |s| {
                        let rids = discovery::build_rids(&s.identity.peers, key.1);
                        if let Some(d) = &s.daemon {
                            let r = d.advertise(s.port, &rids);
                            tracing::info!(
                                port = s.port,
                                pairing = key.1,
                                ok = r.is_ok(),
                                "lan advertise"
                            );
                            s.discovery_error = r.err().map(|e| {
                                tracing::warn!(error = %e, "advertise failed");
                                e.to_string()
                            });
                        }
                        Ok(())
                    })
                    .await;
                    last = Some(key);
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        })
    };

    with_state(&app, &shared, |s| {
        s.label = sanitize_label(label.as_deref().unwrap_or(&s.label));
        s.port = port;
        s.running = true;
        s.tasks.push(accept);
        s.tasks.push(adv);
        if let Some(d) = &daemon {
            let (app2, shared2) = (app.clone(), shared.clone());
            if let Err(e) = d.browse(move |found| {
                let (app3, shared3) = (app2.clone(), shared2.clone());
                tauri::async_runtime::spawn(async move {
                    record_found(&app3, &shared3, found).await;
                });
            }) {
                disc_err = Some(e.to_string());
            }
        }
        s.discovery_error = disc_err.take();
        s.daemon = daemon;
        Ok(())
    })
    .await?;
    with_state(&app, &shared, |s| Ok(status_of(s))).await
}

async fn record_found(app: &AppHandle, lan: &SharedLan, found: Found) {
    let _ = with_state(app, lan, |s| {
        if found.gone {
            s.nearby.remove(&found.instance);
            return Ok(());
        }
        s.seen_total += 1;
        s.last_seen = Some(now_secs());
        let m = discovery::match_peer(&s.identity.peers, &found);
        let pairing = discovery::is_pairing(&found);
        if m.is_none() && !pairing {
            return Ok(());
        }
        let dev = NearbyDevice {
            peer_id: m.map(|p| p.id.clone()),
            label: m.map(|p| p.label.clone()),
            pairing,
            addrs: found.addrs.clone(),
            seen: now_secs(),
        };

        if let Some(pid) = &dev.peer_id {
            s.nearby.retain(|_, d| d.peer_id.as_ref() != Some(pid));
        }
        if found.addrs.is_empty() {
            return Ok(());
        }
        s.nearby.insert(found.instance.clone(), dev);
        Ok(())
    })
    .await;
    emit(app, "nearby", serde_json::Value::Null);
}

pub async fn shutdown(lan: &SharedLan) {
    if let Some(s) = lan.lock().await.as_mut() {
        for t in s.tasks.drain(..) {
            t.abort();
        }
        if let Some(d) = s.daemon.take() {
            d.shutdown();
        }
        s.running = false;
        s.discovery_error = None;
        s.seen_total = 0;
        s.last_seen = None;
        s.pairing = None;
        s.nearby.clear();
        s.pending = None;
        s.busy = false;
    }
}

#[tauri::command]
pub async fn lan_stop(lan: State<'_, SharedLan>) -> Result<(), AppError> {
    shutdown(&lan).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_nearby(
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<Vec<NearbyDevice>, AppError> {
    with_state(&app, &lan, |s| {
        let cutoff = now_secs().saturating_sub(NEARBY_TTL);
        s.nearby.retain(|_, d| d.seen >= cutoff);
        Ok(s.nearby.values().cloned().collect())
    })
    .await
}

#[tauri::command]
pub async fn lan_set_label(
    label: String,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<(), AppError> {
    with_state(&app, &lan, |s| {
        s.label = sanitize_label(&label);
        Ok(())
    })
    .await
}

#[derive(Serialize)]
pub struct PairOffer {
    pub kind: String,
    pub qr_text: Option<String>,
    pub qr_svg: Option<String>,
    pub code: Option<String>,
    pub addrs: Vec<String>,
    pub expires_in: u64,
}

#[tauri::command]
pub async fn lan_pair_offer(
    kind: String,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<PairOffer, AppError> {
    with_state(&app, &lan, |s| {
        if !s.running {
            return Err(AppError::General("Start nearby sync first".into()));
        }
        let addrs = local_addrs(s.port);
        let expires = tokio::time::Instant::now() + PAIRING_WINDOW;
        let (offer_kind, qr_text, qr_svg, code) = if kind == "code" {
            let n = u32::from_be_bytes(random_bytes::<4>()) % 1_000_000;
            let code = format!("{:03}-{:03}", n / 1000, n % 1000);
            (OfferKind::Code(code.clone()), None, None, Some(code))
        } else {
            let secret = random_bytes::<32>();
            let text = QrPayload {
                v: 1,
                addrs: addrs.clone(),
                secret: to_hex(&secret),
                fp: s.identity.fingerprint(),
            }
            .encode();
            let svg = qrcode::QrCode::new(text.as_bytes())
                .map(|q| {
                    q.render::<qrcode::render::svg::Color>()
                        .min_dimensions(240, 240)
                        .quiet_zone(true)
                        .build()
                })
                .map_err(gerr)?;
            (OfferKind::Qr(secret), Some(text), Some(svg), None)
        };
        s.pairing = Some(PairingOffer {
            kind: offer_kind,
            expires,
            attempts_left: PAIRING_ATTEMPTS,
        });
        Ok(PairOffer {
            kind,
            qr_text,
            qr_svg,
            code,
            addrs,
            expires_in: PAIRING_WINDOW.as_secs(),
        })
    })
    .await
}

#[tauri::command]
pub async fn lan_pair_cancel(app: AppHandle, lan: State<'_, SharedLan>) -> Result<(), AppError> {
    with_state(&app, &lan, |s| {
        s.pairing = None;
        Ok(())
    })
    .await
}

#[derive(Serialize)]
pub struct PairResult {
    pub peer_id: String,
    pub label: String,
    pub sas: String,
}

async fn dial(addrs: &[String]) -> AppResult<TcpStream> {
    let mut last = AppError::General("No address to connect to".into());

    let mut parsed: Vec<SocketAddr> = addrs.iter().filter_map(|a| a.parse().ok()).collect();
    parsed.sort_by_key(|s| s.is_ipv6());
    for sa in parsed {
        if !discovery::is_private_ip(&sa.ip())
            || matches!(sa.ip(), std::net::IpAddr::V6(v) if (v.segments()[0] & 0xffc0) == 0xfe80)
        {
            continue;
        }
        match tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(sa)).await {
            Ok(Ok(s)) => return Ok(s),
            Ok(Err(e)) => last = gerr(e),
            Err(_) => last = AppError::General("Connection timed out".into()),
        }
    }
    Err(last)
}

#[tauri::command]
pub async fn lan_pair_join(
    input: String,
    addr: Option<String>,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<PairResult, AppError> {
    let (priv_key, label, nearby_pairing) = with_state(&app, &lan, |s| {
        Ok((
            s.identity.private_bytes(),
            s.label.clone(),
            s.nearby
                .values()
                .find(|d| d.pairing)
                .map(|d| d.addrs.clone())
                .unwrap_or_default(),
        ))
    })
    .await?;

    let qr = QrPayload::decode(&input).ok();
    let (mode, addrs) = match &qr {
        Some(p) => (MODE_PAIR_QR, p.addrs.clone()),
        None => (
            MODE_PAIR_CODE,
            match addr {
                Some(a) if !a.trim().is_empty() => vec![a.trim().to_string()],
                _ => nearby_pairing,
            },
        ),
    };
    let mut sock = dial(&addrs).await?;
    sock.write_all(&[mode]).await.map_err(gerr)?;
    let psk = match &qr {
        Some(p) => p.secret_bytes(),
        None => tokio::time::timeout(IO_TIMEOUT, protocol::spake_key(&mut sock, &input))
            .await
            .map_err(gerr)??,
    };
    let mut sec = tokio::time::timeout(IO_TIMEOUT, transport::connect(sock, &priv_key, Some(&psk)))
        .await
        .map_err(|_| AppError::General("Pairing timed out".into()))?
        .map_err(|_| AppError::General("Pairing failed — wrong code or window closed".into()))?;
    if let Some(p) = &qr {
        if peer_id(&sec.remote_static) != p.fp {
            return Err(AppError::General(
                "That is not the device whose QR code was scanned".into(),
            ));
        }
    }
    let paired = tokio::time::timeout(IO_TIMEOUT, protocol::pair_initiator(&mut sec, &label))
        .await
        .map_err(gerr)??;
    let sas = transport::sas(&sec.handshake_hash);
    let peer = new_peer(&sec.remote_static, &paired);
    let result = PairResult {
        peer_id: peer.id.clone(),
        label: peer.label.clone(),
        sas,
    };
    with_state(&app, &lan, |s| {
        s.identity.upsert(peer);
        persist(s);
        Ok(())
    })
    .await?;
    Ok(result)
}

#[tauri::command]
pub async fn lan_pair_confirm(
    peer_id: String,
    accept: bool,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<(), AppError> {
    with_state(&app, &lan, |s| {
        if accept {
            if let Some(p) = s.identity.peers.iter_mut().find(|p| p.id == peer_id) {
                p.confirmed = true;
            }
        } else {
            s.identity.peers.retain(|p| p.id != peer_id);
        }
        persist(s);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn lan_forget(
    peer_id: Option<String>,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<(), AppError> {
    with_state(&app, &lan, |s| {
        match peer_id {
            Some(id) => s.identity.peers.retain(|p| p.id != id),
            None => s.identity.peers.clear(),
        }
        persist(s);
        Ok(())
    })
    .await
}

async fn open_session(
    app: &AppHandle,
    lan: &SharedLan,
    peer: &str,
    addr: Option<String>,
) -> AppResult<transport::Secure<TcpStream>> {
    let (priv_key, p, nearby_addrs) = with_state(app, lan, |s| {
        let p = s
            .identity
            .peers
            .iter()
            .find(|p| p.id == peer && p.confirmed)
            .cloned()
            .ok_or_else(|| AppError::General("Unknown or unconfirmed device".into()))?;
        let na = s
            .nearby
            .values()
            .find(|d| d.peer_id.as_deref() == Some(peer))
            .map(|d| d.addrs.clone())
            .unwrap_or_default();
        Ok((s.identity.private_bytes(), p, na))
    })
    .await?;
    let addrs = match addr {
        Some(a) if !a.trim().is_empty() => vec![a.trim().to_string()],
        _ => nearby_addrs,
    };
    if addrs.is_empty() {
        return Err(AppError::General(
            "Device not found on this network. Make sure it has Sync nearby open, or enter its address.".into(),
        ));
    }
    let mut sock = dial(&addrs).await?;
    sock.write_all(&[MODE_SYNC]).await.map_err(gerr)?;
    let sec = tokio::time::timeout(IO_TIMEOUT, transport::connect(sock, &priv_key, None))
        .await
        .map_err(|_| AppError::General("Connection timed out".into()))??;
    if to_hex(&sec.remote_static) != p.public_key {
        return Err(AppError::General(
            "That device is not the one you paired with".into(),
        ));
    }
    Ok(sec)
}

#[tauri::command]
pub async fn lan_sync(
    peer_id: String,
    addr: Option<String>,
    merge_foreign: Option<bool>,
    app: AppHandle,
    lan: State<'_, SharedLan>,
    vault: State<'_, SharedVaultState>,
) -> Result<Outcome, AppError> {
    let shared: SharedLan = lan.inner().clone();
    let foreign = merge_foreign.unwrap_or(false);
    let mut snap = snapshot(&vault)?;
    snap.hello.pull = foreign;
    let mut sec = open_session(&app, &shared, &peer_id, addr).await?;
    let ex = tokio::time::timeout(
        IO_TIMEOUT * 2,
        protocol::sync_initiator(&mut sec, &snap.hello, &snap.blob),
    )
    .await
    .map_err(|_| AppError::General("Sync timed out".into()))??;
    finish_exchange(&app, &shared, &peer_id, ex, foreign).await
}

#[tauri::command]
pub async fn lan_pull_vault(
    peer_id: String,
    addr: Option<String>,
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<Outcome, AppError> {
    let shared: SharedLan = lan.inner().clone();
    let dest = store::default_vault_path();
    if dest.exists() {
        return Err(AppError::General(
            "A vault already exists on this device".into(),
        ));
    }
    let hello = Hello {
        proto: protocol::PROTO,
        vault_id: String::new(),
        state_hash: String::new(),
        pull: false,
    };
    let mut sec = open_session(&app, &shared, &peer_id, addr).await?;
    let ex = tokio::time::timeout(
        IO_TIMEOUT * 2,
        protocol::sync_initiator(&mut sec, &hello, &[]),
    )
    .await
    .map_err(|_| AppError::General("Sync timed out".into()))??;
    match ex {
        Exchange::Received(blob) if blob.len() > 5 && &blob[0..4] == crypto::VAULT_MAGIC => {
            store::write_private(&dest, &blob)?;
            emit(
                &app,
                "synced",
                serde_json::json!({ "peer": peer_id, "outcome": Outcome::Imported }),
            );
            Ok(Outcome::Imported)
        }
        _ => Err(AppError::General(
            "The other device has no vault to share (is it unlocked?)".into(),
        )),
    }
}

#[tauri::command]
pub async fn lan_apply_pending(
    password: String,
    app: AppHandle,
    lan: State<'_, SharedLan>,
    vault: State<'_, SharedVaultState>,
) -> Result<Outcome, AppError> {
    let (blob, foreign) = with_state(&app, &lan, |s| {
        s.pending
            .clone()
            .ok_or_else(|| AppError::General("Nothing waiting to be merged".into()))
    })
    .await?;
    let (plain, _, _) = crypto::decrypt(&blob, &password)?;
    let plain = zeroize::Zeroizing::new(plain);
    let remote: VaultData = serde_json::from_slice(&plain)
        .map_err(|e| AppError::Vault(format!("Peer vault is corrupt: {e}")))?;
    let applied = merge_into(&vault, remote, foreign)?;
    with_state(&app, &lan, |s| {
        s.pending = None;
        Ok(())
    })
    .await?;
    if matches!(applied, Applied::Merged) {
        let _ = app.emit("vault-changed", ());
    }
    Ok(outcome_of(applied))
}

#[tauri::command]
pub async fn lan_discard_pending(
    app: AppHandle,
    lan: State<'_, SharedLan>,
) -> Result<(), AppError> {
    with_state(&app, &lan, |s| {
        s.pending = None;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::schema::Tag;

    fn state_with(
        pw: &str,
        dir: &std::path::Path,
        mutate: impl FnOnce(&mut VaultData),
    ) -> SharedVaultState {
        let path = dir.join("v.watchtower");
        let (mut data, kdf, key) = store::create_vault(&path, pw).unwrap();
        mutate(&mut data);
        store::save_vault(&path, &kdf, &key, &mut data).unwrap();
        let mut v = crate::vault::store::VaultState::new();
        v.data = Some(data);
        v.file_path = Some(path);
        v.kdf = Some(kdf);
        v.key = Some(key);
        std::sync::Mutex::new(v)
    }

    #[test]
    fn same_key_vaults_merge_via_blob() {
        let d1 = std::env::temp_dir().join(format!("wt-a-{}", to_hex(&random_bytes::<4>())));
        std::fs::create_dir_all(&d1).unwrap();
        let a = state_with("pw", &d1, |d| d.tags.push(Tag::new("on-a".into(), None)));

        let blob_a = std::fs::read(a.lock().unwrap().file_path.clone().unwrap()).unwrap();
        let d2 = std::env::temp_dir().join(format!("wt-b-{}", to_hex(&random_bytes::<4>())));
        std::fs::create_dir_all(&d2).unwrap();
        let path_b = d2.join("v.watchtower");
        std::fs::write(&path_b, &blob_a).unwrap();
        let (mut data_b, kdf_b, key_b) = store::open_vault(&path_b, "pw").unwrap();
        data_b.tags.push(Tag::new("on-b".into(), None));
        store::save_vault(&path_b, &kdf_b, &key_b, &mut data_b).unwrap();
        let blob_b = std::fs::read(&path_b).unwrap();

        assert!(matches!(
            apply_blob(&a, &blob_b, false).unwrap(),
            Applied::Merged
        ));
        let names: Vec<String> = a
            .lock()
            .unwrap()
            .data
            .as_ref()
            .unwrap()
            .tags
            .iter()
            .map(|t| t.name.clone())
            .collect();
        assert!(names.contains(&"on-a".to_string()) && names.contains(&"on-b".to_string()));

        assert!(matches!(
            apply_blob(&a, &blob_b, false).unwrap(),
            Applied::Unchanged
        ));
        let _ = std::fs::remove_dir_all(d1);
        let _ = std::fs::remove_dir_all(d2);
    }

    #[test]
    fn different_salt_needs_password() {
        let d1 = std::env::temp_dir().join(format!("wt-c-{}", to_hex(&random_bytes::<4>())));
        let d2 = std::env::temp_dir().join(format!("wt-d-{}", to_hex(&random_bytes::<4>())));
        std::fs::create_dir_all(&d1).unwrap();
        std::fs::create_dir_all(&d2).unwrap();
        let a = state_with("pw", &d1, |_| {});
        let b = state_with("pw2", &d2, |_| {});
        let blob_b = std::fs::read(b.lock().unwrap().file_path.clone().unwrap()).unwrap();
        assert!(matches!(
            apply_blob(&a, &blob_b, false).unwrap(),
            Applied::NeedsPassword
        ));
        let _ = std::fs::remove_dir_all(d1);
        let _ = std::fs::remove_dir_all(d2);
    }
}
