pub mod commands;
pub mod error;
pub mod ssh;
pub mod vault;

use std::sync::Mutex;

use crate::commands::sftp_commands;
use crate::commands::ssh_commands;
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
        .manage(Mutex::new(VaultState::new()))
        .manage(tokio::sync::Mutex::new(SessionManager::new()))
        .invoke_handler(tauri::generate_handler![
            vault_commands::vault_create,
            vault_commands::vault_open,
            vault_commands::vault_lock,
            vault_commands::vault_is_unlocked,
            vault_commands::vault_exists,
            vault_commands::vault_change_password,
            vault_commands::vault_list_servers,
            vault_commands::vault_get_server,
            vault_commands::vault_add_server,
            vault_commands::vault_update_server,
            vault_commands::vault_delete_server,
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
            ssh_commands::ssh_send_startup_command,
            ssh_commands::ssh_write,
            ssh_commands::ssh_resize,
            ssh_commands::ssh_disconnect,
            ssh_commands::ssh_detect_os,
            ssh_commands::ssh_list_sessions,
            sftp_commands::sftp_ls,
            sftp_commands::sftp_mkdir,
            sftp_commands::sftp_rename,
            sftp_commands::sftp_remove,
            sftp_commands::sftp_upload,
            sftp_commands::sftp_download,
            sftp_commands::sftp_download_recursive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
