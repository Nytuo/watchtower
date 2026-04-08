use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::connect_async;

use crate::error::{AppError, AppResult};
use crate::ssh::proc;
use crate::ssh::ws::WsByteStream;
use crate::vault::schema::{ProxyConfig, ProxyType, Transport};

pub trait DuplexStream: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> DuplexStream for T {}

pub type BoxedStream = Box<dyn DuplexStream>;

pub async fn open(
    host: &str,
    port: u16,
    transport: &Transport,
    proxy: Option<&ProxyConfig>,
    timeout: Duration,
) -> AppResult<BoxedStream> {
    match transport {
        Transport::Direct => {
            let tcp = connect_tcp(host, port, proxy, timeout).await?;
            Ok(Box::new(tcp))
        }
        Transport::Websocket { url, .. } => {
            let (ws, _resp) = tokio::time::timeout(timeout, connect_async(url.as_str()))
                .await
                .map_err(|_| AppError::Ssh(format!("WebSocket connection to {} timed out", url)))?
                .map_err(|e| {
                    AppError::Ssh(format!("WebSocket connection to {} failed: {}", url, e))
                })?;
            Ok(Box::new(WsByteStream::new(ws)))
        }
        Transport::Command { command } => {
            let stream = proc::spawn(command, host, port)?;
            Ok(Box::new(stream))
        }
    }
}

pub async fn connect_tcp(
    host: &str,
    port: u16,
    proxy: Option<&ProxyConfig>,
    timeout: Duration,
) -> AppResult<TcpStream> {
    match proxy {
        None => {
            let stream = tokio::time::timeout(timeout, TcpStream::connect((host, port)))
                .await
                .map_err(|_| AppError::Ssh(format!("Connection to {}:{} timed out", host, port)))?
                .map_err(|e| {
                    AppError::Ssh(format!("TCP connection to {}:{} failed: {}", host, port, e))
                })?;
            stream.set_nodelay(true).ok();
            Ok(stream)
        }
        Some(p) => {
            let mut stream =
                tokio::time::timeout(timeout, TcpStream::connect((p.host.as_str(), p.port)))
                    .await
                    .map_err(|_| AppError::Ssh(format!("Proxy {}:{} timed out", p.host, p.port)))?
                    .map_err(|e| AppError::Ssh(format!("Proxy connection failed: {}", e)))?;
            stream.set_nodelay(true).ok();

            match p.proxy_type {
                ProxyType::Socks5 => {
                    socks5_connect(
                        &mut stream,
                        host,
                        port,
                        p.username.as_deref(),
                        p.password.as_deref(),
                    )
                    .await?
                }
                ProxyType::Socks4 => socks4a_connect(&mut stream, host, port).await?,
                ProxyType::Http => {
                    http_connect(
                        &mut stream,
                        host,
                        port,
                        p.username.as_deref(),
                        p.password.as_deref(),
                    )
                    .await?
                }
            }
            Ok(stream)
        }
    }
}

async fn socks5_connect(
    s: &mut TcpStream,
    host: &str,
    port: u16,
    user: Option<&str>,
    pass: Option<&str>,
) -> AppResult<()> {
    if user.is_some() {
        s.write_all(&[0x05, 0x02, 0x00, 0x02]).await?;
    } else {
        s.write_all(&[0x05, 0x01, 0x00]).await?;
    }
    let mut resp = [0u8; 2];
    s.read_exact(&mut resp).await?;
    if resp[0] != 0x05 {
        return Err(AppError::Ssh("SOCKS5 proxy sent bad version".into()));
    }
    match resp[1] {
        0x00 => {}
        0x02 => {
            let u = user.unwrap_or("");
            let p = pass.unwrap_or("");
            let mut auth = vec![0x01u8, u.len() as u8];
            auth.extend_from_slice(u.as_bytes());
            auth.push(p.len() as u8);
            auth.extend_from_slice(p.as_bytes());
            s.write_all(&auth).await?;
            let mut ar = [0u8; 2];
            s.read_exact(&mut ar).await?;
            if ar[1] != 0x00 {
                return Err(AppError::Ssh("SOCKS5 proxy authentication failed".into()));
            }
        }
        0xff => {
            return Err(AppError::Ssh(
                "SOCKS5 proxy rejected all auth methods".into(),
            ))
        }
        _ => return Err(AppError::Ssh("SOCKS5 proxy chose unsupported auth".into())),
    }

    let mut req = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
    req.extend_from_slice(host.as_bytes());
    req.extend_from_slice(&port.to_be_bytes());
    s.write_all(&req).await?;

    let mut head = [0u8; 4];
    s.read_exact(&mut head).await?;
    if head[1] != 0x00 {
        return Err(AppError::Ssh(format!(
            "SOCKS5 proxy refused connection (code {})",
            head[1]
        )));
    }
    let skip = match head[3] {
        0x01 => 4,
        0x04 => 16,
        0x03 => {
            let mut l = [0u8; 1];
            s.read_exact(&mut l).await?;
            l[0] as usize
        }
        _ => return Err(AppError::Ssh("SOCKS5 proxy sent bad address type".into())),
    };
    let mut discard = vec![0u8; skip + 2];
    s.read_exact(&mut discard).await?;
    Ok(())
}

async fn socks4a_connect(s: &mut TcpStream, host: &str, port: u16) -> AppResult<()> {
    let mut req = vec![0x04, 0x01];
    req.extend_from_slice(&port.to_be_bytes());
    req.extend_from_slice(&[0, 0, 0, 1]);
    req.push(0);
    req.extend_from_slice(host.as_bytes());
    req.push(0);
    s.write_all(&req).await?;

    let mut resp = [0u8; 8];
    s.read_exact(&mut resp).await?;
    if resp[1] != 0x5a {
        return Err(AppError::Ssh(format!(
            "SOCKS4 proxy refused connection (code {})",
            resp[1]
        )));
    }
    Ok(())
}

async fn http_connect(
    s: &mut TcpStream,
    host: &str,
    port: u16,
    user: Option<&str>,
    pass: Option<&str>,
) -> AppResult<()> {
    let mut req = format!(
        "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Connection: keep-alive\r\n"
    );
    if let Some(u) = user {
        let token =
            data_encoding::BASE64.encode(format!("{}:{}", u, pass.unwrap_or("")).as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", token));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await?;

    let mut buf = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    loop {
        let n = s.read(&mut byte).await?;
        if n == 0 {
            return Err(AppError::Ssh("HTTP proxy closed the connection".into()));
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err(AppError::Ssh(
                "HTTP proxy sent an oversized response".into(),
            ));
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let status_ok = head
        .lines()
        .next()
        .map(|l| l.contains(" 200 ") || l.ends_with(" 200"))
        .unwrap_or(false);
    if !status_ok {
        return Err(AppError::Ssh(format!(
            "HTTP proxy CONNECT failed: {}",
            head.lines().next().unwrap_or("no status line")
        )));
    }
    Ok(())
}
