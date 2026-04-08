//! Developer tool: acts as a second device for manual LAN-sync testing.
//!
//!   cargo run --example lan_peer -- pair <code-or-wt1:payload> [ip:port]
//!
//! Prints the short authentication string; compare it with the app's screen.

use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use watchtower_lib::lan::{identity, protocol, transport};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 || args[1] != "pair" {
        eprintln!("usage: lan_peer pair <code|wt1:...> [ip:port]");
        std::process::exit(2);
    }
    let input = &args[2];
    let id = identity::Identity::generate().unwrap();
    let qr = protocol::QrPayload::decode(input).ok();
    let addr = match (&qr, args.get(3)) {
        (_, Some(a)) => a.clone(),
        (Some(p), None) => p.addrs[0].clone(),
        _ => panic!("address required for typed codes"),
    };
    let mut sock = TcpStream::connect(&addr).await.expect("connect");
    let mode = if qr.is_some() { transport::MODE_PAIR_QR } else { transport::MODE_PAIR_CODE };
    sock.write_all(&[mode]).await.unwrap();
    let psk = match &qr {
        Some(p) => p.secret_bytes(),
        None => protocol::spake_key(&mut sock, input).await.expect("spake"),
    };
    let mut sec = transport::connect(sock, &id.private_bytes(), Some(&psk))
        .await
        .expect("noise handshake");
    let paired = protocol::pair_initiator(&mut sec, "CLI test peer").await.expect("pair");
    println!("paired with {:?}", paired.remote_label);
    println!("SAS: {}", transport::sas(&sec.handshake_hash));
    println!("remote fp: {}", identity::peer_id(&sec.remote_static));
}
