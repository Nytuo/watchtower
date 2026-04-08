use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use crate::error::{AppError, AppResult};

/// A subprocess whose stdio is used as a bidirectional byte stream
/// (OpenSSH `ProxyCommand` semantics).
pub struct ProcStream {
    stdin: ChildStdin,
    stdout: ChildStdout,
    _child: Child,
}

pub fn spawn(command_template: &str, host: &str, port: u16) -> AppResult<ProcStream> {
    let cmd = command_template
        .replace("%h", host)
        .replace("%p", &port.to_string())
        .replace("%%", "%");

    let mut c = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&cmd);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&cmd);
        c
    };
    c.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);

    let mut child = c
        .spawn()
        .map_err(|e| AppError::Ssh(format!("ProxyCommand failed to start: {}", e)))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Ssh("ProxyCommand has no stdin".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Ssh("ProxyCommand has no stdout".into()))?;

    Ok(ProcStream {
        stdin,
        stdout,
        _child: child,
    })
}

impl AsyncRead for ProcStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProcStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.stdin).poll_write(cx, data)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdin).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdin).poll_shutdown(cx)
    }
}
