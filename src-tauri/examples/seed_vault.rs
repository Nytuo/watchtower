//! Developer tool: adds an SSH test server (inline key auth) to a vault file.
//!   cargo run --example seed_vault -- <vault> <password> <name> <host> <port> <user> <private-key-file>

use watchtower_lib::vault::schema::{AuthMethod, Protocol, ServerEntry};
use watchtower_lib::vault::store;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 8 {
        eprintln!("usage: seed_vault <vault> <password> <name> <host> <port> <user> <keyfile>");
        std::process::exit(2);
    }
    let path = std::path::Path::new(&a[1]);
    let (mut data, kdf, key) = store::open_vault(path, &a[2]).expect("open vault");
    let pk = std::fs::read_to_string(&a[7]).expect("read key");
    data.servers.push(ServerEntry::new(
        a[3].clone(),
        a[4].clone(),
        a[5].parse().unwrap(),
        a[6].clone(),
        AuthMethod::Key { private_key: pk, passphrase: None },
        Protocol::Ssh,
    ));
    store::save_vault(path, &kdf, &key, &mut data).expect("save");
    println!("servers now: {}", data.servers.len());
}
