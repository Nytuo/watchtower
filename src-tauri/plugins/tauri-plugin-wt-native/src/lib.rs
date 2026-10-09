//! Thin Rust handle over the Swift / Kotlin implementations. Everything is
//! called from the app's Rust side; nothing is exposed to the WebView.

#![cfg(mobile)]

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "fr.nytuo.watchtower.wtnative";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_wt_native);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Found {
    pub instance: String,
    pub addrs: Vec<String>,
    pub rids: Vec<String>,
    #[serde(default)]
    pub gone: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdvertiseArgs<'a> {
    instance: &'a str,
    port: u16,
    service_type: &'a str,
    rids: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowseArgs {
    service_type: String,
    on_found: Channel<Found>,
}

#[derive(Serialize)]
struct SecretArgs<'a> {
    key: &'a str,
    value: Option<&'a str>,
}

#[derive(Deserialize)]
struct SecretReply {
    value: Option<String>,
}

#[derive(Serialize)]
struct KeepAliveArgs {
    active: bool,
    sessions: u32,
}

pub type Result<T> = std::result::Result<T, String>;

pub struct WtNative<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> WtNative<R> {
    fn run<T: serde::de::DeserializeOwned>(&self, cmd: &str, payload: impl Serialize) -> Result<T> {
        self.0
            .run_mobile_plugin(cmd, payload)
            .map_err(|e| e.to_string())
    }

    pub fn advertise(
        &self,
        instance: &str,
        port: u16,
        service_type: &str,
        rids: &[String],
    ) -> Result<()> {
        self.run(
            "advertise",
            AdvertiseArgs {
                instance,
                port,
                service_type,
                rids,
            },
        )
    }

    pub fn stop_advertise(&self) -> Result<()> {
        self.run("stop_advertise", ())
    }

    pub fn browse(
        &self,
        service_type: &str,
        on_found: impl Fn(Found) + Send + Sync + 'static,
    ) -> Result<()> {
        let channel = Channel::new(move |body: InvokeResponseBody| {
            if let Ok(f) = body.deserialize::<Found>() {
                on_found(f);
            }
            Ok(())
        });
        self.run(
            "browse",
            BrowseArgs {
                service_type: service_type.to_string(),
                on_found: channel,
            },
        )
    }

    pub fn stop_browse(&self) -> Result<()> {
        self.run("stop_browse", ())
    }

    /// Android Keystore-backed secret store (no-op reply elsewhere).
    pub fn secret_set(&self, key: &str, value: &str) -> Result<()> {
        self.run(
            "secret_set",
            SecretArgs {
                key,
                value: Some(value),
            },
        )
    }

    pub fn secret_get(&self, key: &str) -> Result<Option<String>> {
        let r: SecretReply = self.run("secret_get", SecretArgs { key, value: None })?;
        Ok(r.value)
    }

    pub fn secret_delete(&self, key: &str) -> Result<()> {
        self.run("secret_delete", SecretArgs { key, value: None })
    }

    /// Android: foreground service so sessions survive in the background.
    /// iOS: asks for a short background-task grace period.
    pub fn keepalive(&self, active: bool, sessions: u32) -> Result<()> {
        self.run("keepalive", KeepAliveArgs { active, sessions })
    }
}

pub trait WtNativeExt<R: Runtime> {
    fn wt_native(&self) -> &WtNative<R>;
}

impl<R: Runtime, T: Manager<R>> WtNativeExt<R> for T {
    fn wt_native(&self) -> &WtNative<R> {
        self.state::<WtNative<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("wt-native")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "WtNativePlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_wt_native)?;
            app.manage(WtNative(handle));
            Ok(())
        })
        .build()
}
