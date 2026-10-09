// Commands are called from Rust only (no invoke handler), so the WebView
// cannot reach this plugin directly.
const COMMANDS: &[&str] = &[
    "advertise",
    "stop_advertise",
    "browse",
    "stop_browse",
    "secret_set",
    "secret_get",
    "secret_delete",
    "keepalive",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
