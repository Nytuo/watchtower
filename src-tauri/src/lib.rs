pub mod commands;
pub mod error;
pub mod ssh;
pub mod vault;

use std::sync::Mutex;

use crate::commands::biometric;
use crate::commands::cloud;
use crate::commands::ftp;
use crate::commands::import_export;
use crate::commands::keygen;
use crate::commands::local_fs;
use crate::commands::sftp_commands;
use crate::commands::ssh_commands;
use crate::commands::sync;
use crate::commands::term;
use crate::commands::tunnel_commands;
use crate::commands::vault_commands;
use crate::ssh::session::SessionManager;
use crate::vault::store::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Mutex::new(VaultState::new()))
        .manage(tokio::sync::Mutex::new(SessionManager::new()))
        .manage::<sftp_commands::SharedTransferFlags>(Mutex::new(std::collections::HashMap::new()))
        .manage::<ssh_commands::SharedKbd>(
            tokio::sync::Mutex::new(std::collections::HashMap::new()),
        )
        .manage::<ftp::SharedFtp>(tokio::sync::Mutex::new(std::collections::HashMap::new()))
        .invoke_handler(tauri::generate_handler![
            vault_commands::vault_create,
            vault_commands::vault_open,
            vault_commands::vault_lock,
            vault_commands::vault_is_unlocked,
            vault_commands::vault_exists,
            vault_commands::vault_default_path,
            vault_commands::vault_current_path,
            vault_commands::vault_change_password,
            vault_commands::vault_reopen,
            vault_commands::vault_adopt_incoming,
            vault_commands::vault_discard_incoming,
            import_export::import_ssh_config,
            import_export::import_putty,
            import_export::import_securecrt,
            import_export::import_json,
            import_export::export_json,
            import_export::export_json_to,
            import_export::export_ssh_config,
            keygen::generate_ssh_key,
            sync::sync_status,
            sync::sync_push,
            sync::sync_pull,
            cloud::cloud_list_digitalocean,
            cloud::cloud_list_aws,
            cloud::cloud_list_azure,
            cloud::cloud_import_hosts,
            term::telnet_connect,
            term::pty_connect,
            term::mosh_connect,
            term::term_write,
            term::term_resize,
            term::term_close,
            term::term_start_log,
            term::term_stop_log,
            ftp::ftp_connect,
            ftp::ftp_connect_server,
            ftp::ftp_disconnect,
            ftp::ftp_list,
            ftp::ftp_mkdir,
            ftp::ftp_delete,
            ftp::ftp_rename,
            ftp::ftp_download,
            ftp::ftp_upload,
            vault_commands::vault_list_servers,
            vault_commands::vault_get_server,
            vault_commands::vault_add_server,
            vault_commands::vault_update_server,
            vault_commands::vault_delete_server,
            vault_commands::vault_mark_connected,
            vault_commands::vault_duplicate_server,
            vault_commands::vault_bulk_update_servers,
            vault_commands::vault_reorder_servers,
            vault_commands::vault_list_groups,
            vault_commands::vault_add_group,
            vault_commands::vault_update_group,
            vault_commands::vault_delete_group,
            vault_commands::vault_list_tags,
            vault_commands::vault_add_tag,
            vault_commands::vault_update_tag,
            vault_commands::vault_delete_tag,
            vault_commands::vault_list_snippets,
            vault_commands::vault_add_snippet,
            vault_commands::vault_update_snippet,
            vault_commands::vault_delete_snippet,
            vault_commands::vault_touch_snippet,
            vault_commands::vault_list_keychains,
            vault_commands::vault_add_keychain,
            vault_commands::vault_update_keychain,
            vault_commands::vault_delete_keychain,
            vault_commands::vault_list_port_forwardings,
            vault_commands::vault_add_port_forwarding,
            vault_commands::vault_update_port_forwarding,
            vault_commands::vault_delete_port_forwarding,
            vault_commands::vault_list_known_hosts,
            vault_commands::vault_add_known_host,
            vault_commands::vault_delete_known_host,
            vault_commands::vault_trust_known_host,
            vault_commands::vault_get_settings,
            vault_commands::vault_update_settings,
            ssh_commands::ssh_connect,
            ssh_commands::ssh_connect_adhoc,
            ssh_commands::ssh_submit_kbd,
            ssh_commands::ssh_test_connection,
            ssh_commands::ssh_start_log,
            ssh_commands::ssh_stop_log,
            ssh_commands::ssh_send_startup_command,
            ssh_commands::ssh_write,
            ssh_commands::ssh_resize,
            ssh_commands::ssh_disconnect,
            ssh_commands::ssh_detect_os,
            ssh_commands::ssh_list_sessions,
            ssh_commands::ssh_alive_sessions,
            sftp_commands::sftp_ls,
            sftp_commands::sftp_mkdir,
            sftp_commands::sftp_rename,
            sftp_commands::sftp_remove,
            sftp_commands::sftp_upload,
            sftp_commands::sftp_download,
            sftp_commands::sftp_download_recursive,
            sftp_commands::sftp_upload_recursive,
            sftp_commands::sftp_chmod,
            sftp_commands::sftp_copy,
            sftp_commands::sftp_cancel_transfer,
            tunnel_commands::tunnel_start,
            tunnel_commands::tunnel_stop,
            tunnel_commands::tunnel_list,
            tunnel_commands::tunnel_list_all,
            local_fs::local_home,
            local_fs::local_ls,
            biometric::biometric_available,
            biometric::biometric_has,
            biometric::biometric_store,
            biometric::biometric_retrieve,
            biometric::biometric_clear,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Emitter;
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> =
                        event.urls().into_iter().map(|u| u.to_string()).collect();
                    let _ = handle.emit("deep-link", urls);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
