use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::error::AppError;
use crate::ssh::session::SharedSessionManager;
use crate::vault::schema::{ConnectionLog, LogLevel};

pub struct TermSession {
    pub write_tx: mpsc::Sender<Vec<u8>>,
    pub resize_tx: mpsc::Sender<(u16, u16)>,
    pub shutdown_tx: mpsc::Sender<()>,
    pub alive: Arc<AtomicBool>,
    pub log_file: Arc<Mutex<Option<tokio::fs::File>>>,
}

fn emit_log(ch: &Channel<ConnectionLog>, level: LogLevel, message: &str, detail: Option<&str>) {
    let _ = ch.send(ConnectionLog {
        timestamp: crate::vault::schema::timestamp_now(),
        level,
        message: message.into(),
        detail: detail.map(String::from),
    });
}

async fn write_log(log_file: &Arc<Mutex<Option<tokio::fs::File>>>, data: &[u8]) {
    if let Some(f) = log_file.lock().await.as_mut() {
        let _ = f.write_all(data).await;
    }
}

// ---------------- Telnet ----------------

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;
const OPT_ECHO: u8 = 1;
const OPT_SGA: u8 = 3;
const OPT_TTYPE: u8 = 24;
const OPT_NAWS: u8 = 31;

#[derive(Default)]
struct TelnetParser {
    state: u8, // 0 data, 1 iac, 2 negotiate(command byte pending), 3 subneg, 4 subneg-iac
    neg_cmd: u8,
    sb: Vec<u8>,
}

impl TelnetParser {
    /// Feeds raw bytes; returns (clean terminal bytes, bytes to send back to the server).
    fn feed(&mut self, input: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut out = Vec::with_capacity(input.len());
        let mut reply = Vec::new();
        for &b in input {
            match self.state {
                0 => {
                    if b == IAC {
                        self.state = 1;
                    } else {
                        out.push(b);
                    }
                }
                1 => match b {
                    IAC => {
                        out.push(IAC);
                        self.state = 0;
                    }
                    SB => {
                        self.sb.clear();
                        self.state = 3;
                    }
                    WILL | WONT | DO | DONT => {
                        self.neg_cmd = b;
                        self.state = 2;
                    }
                    _ => self.state = 0,
                },
                2 => {
                    self.handle_negotiate(self.neg_cmd, b, &mut reply);
                    self.state = 0;
                }
                3 => {
                    if b == IAC {
                        self.state = 4;
                    } else {
                        self.sb.push(b);
                    }
                }
                4 => {
                    if b == SE {
                        self.handle_subneg(&mut reply);
                        self.state = 0;
                    } else {
                        self.sb.push(b);
                        self.state = 3;
                    }
                }
                _ => self.state = 0,
            }
        }
        (out, reply)
    }

    fn handle_negotiate(&self, cmd: u8, opt: u8, reply: &mut Vec<u8>) {
        match cmd {
            DO => {
                let ok = matches!(opt, OPT_SGA | OPT_NAWS | OPT_TTYPE);
                reply.extend_from_slice(&[IAC, if ok { WILL } else { WONT }, opt]);
            }
            WILL => {
                let ok = matches!(opt, OPT_ECHO | OPT_SGA);
                reply.extend_from_slice(&[IAC, if ok { DO } else { DONT }, opt]);
            }
            _ => {}
        }
    }

    fn handle_subneg(&self, reply: &mut Vec<u8>) {
        // IAC SB TTYPE SEND IAC SE  ->  IAC SB TTYPE IS "xterm-256color" IAC SE
        if self.sb.first() == Some(&OPT_TTYPE) && self.sb.get(1) == Some(&1) {
            reply.extend_from_slice(&[IAC, SB, OPT_TTYPE, 0]);
            reply.extend_from_slice(b"xterm-256color");
            reply.extend_from_slice(&[IAC, SE]);
        }
    }
}

fn naws(cols: u16, rows: u16) -> Vec<u8> {
    vec![
        IAC,
        SB,
        OPT_NAWS,
        (cols >> 8) as u8,
        (cols & 0xff) as u8,
        (rows >> 8) as u8,
        (rows & 0xff) as u8,
        IAC,
        SE,
    ]
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn telnet_connect(
    host: String,
    port: u16,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    on_log: Channel<ConnectionLog>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<String, AppError> {
    emit_log(
        &on_log,
        LogLevel::Info,
        &format!("Telnet {}:{}", host, port),
        None,
    );
    let mut stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| AppError::Ssh(format!("Telnet connection failed: {}", e)))?;
    stream.set_nodelay(true).ok();

    // Initial negotiation.
    let mut init = vec![
        IAC, WILL, OPT_NAWS, IAC, WILL, OPT_TTYPE, IAC, DO, OPT_SGA, IAC, WILL, OPT_SGA,
    ];
    init.extend_from_slice(&naws(cols, rows));
    stream.write_all(&init).await.ok();

    emit_log(&on_log, LogLevel::Success, "Connected", None);

    let session_id = Uuid::new_v4().to_string();
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u16, u16)>(8);
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    let alive = Arc::new(AtomicBool::new(true));
    let log_file: Arc<Mutex<Option<tokio::fs::File>>> = Arc::new(Mutex::new(None));

    let alive_pump = alive.clone();
    let log_pump = log_file.clone();
    tokio::spawn(async move {
        let mut parser = TelnetParser::default();
        let mut buf = vec![0u8; 8192];
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => break,
                Some(data) = write_rx.recv() => {
                    // Escape IAC in user input.
                    let mut esc = Vec::with_capacity(data.len());
                    for &b in &data { esc.push(b); if b == IAC { esc.push(IAC); } }
                    if stream.write_all(&esc).await.is_err() { break; }
                }
                Some((c, r)) = resize_rx.recv() => {
                    let _ = stream.write_all(&naws(c, r)).await;
                }
                n = stream.read(&mut buf) => {
                    match n {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let (clean, reply) = parser.feed(&buf[..n]);
                            if !reply.is_empty() { let _ = stream.write_all(&reply).await; }
                            if !clean.is_empty() {
                                write_log(&log_pump, &clean).await;
                                let _ = on_data.send(clean);
                            }
                        }
                    }
                }
            }
        }
        alive_pump.store(false, Ordering::Relaxed);
        let _ = on_data.send(b"\r\n\x1b[90m[connection closed]\x1b[0m\r\n".to_vec());
    });

    session_state.lock().await.term_sessions.insert(
        session_id.clone(),
        TermSession {
            write_tx,
            resize_tx,
            shutdown_tx,
            alive,
            log_file,
        },
    );
    Ok(session_id)
}

// ---------------- PTY subprocess (mosh, local) ----------------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_connect(
    argv: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    on_log: Channel<ConnectionLog>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<String, AppError> {
    if argv.is_empty() {
        return Err(AppError::General("No command given".into()));
    }
    emit_log(
        &on_log,
        LogLevel::Info,
        &format!("Starting: {}", argv.join(" ")),
        None,
    );

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::General(format!("PTY open failed: {}", e)))?;

    let mut cmd = CommandBuilder::new(&argv[0]);
    for a in &argv[1..] {
        cmd.arg(a);
    }
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::General(format!("Could not start '{}': {}", argv[0], e)))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::General(format!("PTY reader failed: {}", e)))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::General(format!("PTY writer failed: {}", e)))?;
    let master: Arc<std::sync::Mutex<Box<dyn MasterPty + Send>>> =
        Arc::new(std::sync::Mutex::new(pair.master));

    emit_log(&on_log, LogLevel::Success, "Process started", None);

    let session_id = Uuid::new_v4().to_string();
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u16, u16)>(8);
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    let alive = Arc::new(AtomicBool::new(true));
    let log_file: Arc<Mutex<Option<tokio::fs::File>>> = Arc::new(Mutex::new(None));

    // Blocking reader thread -> async channel.
    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(64);
    let alive_reader = alive.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
        alive_reader.store(false, Ordering::Relaxed);
    });

    let alive_pump = alive.clone();
    let log_pump = log_file.clone();
    let writer = Arc::new(std::sync::Mutex::new(writer));
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    let _ = child.kill();
                    break;
                }
                Some(data) = write_rx.recv() => {
                    let w = writer.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        if let Ok(mut w) = w.lock() { let _ = w.write_all(&data); let _ = w.flush(); }
                    }).await;
                }
                Some((c, r)) = resize_rx.recv() => {
                    let m = master.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        if let Ok(m) = m.lock() {
                            let _ = m.resize(PtySize { rows: r, cols: c, pixel_width: 0, pixel_height: 0 });
                        }
                    }).await;
                }
                out = out_rx.recv() => {
                    match out {
                        Some(bytes) => {
                            write_log(&log_pump, &bytes).await;
                            let _ = on_data.send(bytes);
                        }
                        None => break,
                    }
                }
            }
        }
        alive_pump.store(false, Ordering::Relaxed);
        let _ = on_data.send(b"\r\n\x1b[90m[process exited]\x1b[0m\r\n".to_vec());
    });

    session_state.lock().await.term_sessions.insert(
        session_id.clone(),
        TermSession {
            write_tx,
            resize_tx,
            shutdown_tx,
            alive,
            log_file,
        },
    );
    Ok(session_id)
}

// ---------------- shared term commands ----------------

#[tauri::command]
pub async fn term_write(
    session_id: String,
    data: Vec<u8>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    if let Some(t) = manager.term_sessions.get(&session_id) {
        let _ = t.write_tx.send(data).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn term_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    if let Some(t) = manager.term_sessions.get(&session_id) {
        let _ = t.resize_tx.send((cols, rows)).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn term_close(
    session_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    if let Some(t) = session_state.lock().await.term_sessions.remove(&session_id) {
        let _ = t.shutdown_tx.send(()).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn term_start_log(
    session_id: String,
    path: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let t = manager
        .term_sessions
        .get(&session_id)
        .ok_or_else(|| AppError::General("Session not found".into()))?;
    let f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| AppError::General(format!("Cannot open log file: {}", e)))?;
    *t.log_file.lock().await = Some(f);
    Ok(())
}

#[tauri::command]
pub async fn term_stop_log(
    session_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    if let Some(t) = session_state.lock().await.term_sessions.get(&session_id) {
        *t.log_file.lock().await = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn mosh_connect(
    server_id: String,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    on_log: Channel<ConnectionLog>,
    vault_state: State<'_, crate::vault::store::SharedVaultState>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<String, AppError> {
    let argv = {
        let vault = vault_state
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        let data = vault.get_data()?;
        let s = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", server_id)))?;
        build_mosh_argv(
            &s.host,
            s.port,
            &s.username,
            s.advanced.mosh_port_range.as_deref(),
        )
    };
    pty_connect(argv, None, cols, rows, on_data, on_log, session_state).await
}

pub fn build_mosh_argv(
    host: &str,
    port: u16,
    username: &str,
    mosh_port_range: Option<&str>,
) -> Vec<String> {
    let target = if username.is_empty() {
        host.to_string()
    } else {
        format!("{}@{}", username, host)
    };
    let mut argv = vec!["mosh".to_string()];
    if let Some(range) = mosh_port_range.filter(|r| !r.is_empty()) {
        argv.push("-p".into());
        argv.push(range.to_string());
    }
    if port != 22 {
        argv.push("--ssh".into());
        argv.push(format!("ssh -p {}", port));
    }
    argv.push(target);
    argv
}
