<h1 align="center">
	<img src="public/watchtower-logo-white.svg" alt="Watchtower Logo" width="auto" height="220">
</h1>

<div align="center">
	<h2>Watchtower</h2>
	<b>Modern SSH, SFTP, and Vault Manager</b>
	<br />
	<br />
	<a href="https://github.com/Nytuo/watchtower/issues/new?assignees=&labels=bug&template=01_BUG_REPORT.md&title=bug%3A+">Report a Bug</a>
	·
	<a href="https://github.com/Nytuo/watchtower/issues/new?assignees=&labels=enhancement&template=02_FEATURE_REQUEST.md&title=feat%3A+">Request a Feature</a>
	·
	<a href="https://github.com/Nytuo/watchtower/discussions">Ask a Question</a>
</div>

> [!WARNING]
> WatchTower is still in development, and not an active one for the moment. So, it may contain bugs and cause git issues. Use at your own risk.


---

## Table of Contents

- [Table of Contents](#table-of-contents)
- [About](#about)
- [Features](#features)
- [Technologies](#technologies)
- [Getting Started](#getting-started)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## About

Watchtower is a modern, cross-platform SSH, SFTP, and Vault manager built with Tauri, React, and Rust. It provides a beautiful, secure, and efficient interface for managing SSH connections, file transfers, and encrypted secrets. Designed for developers, sysadmins, and power users who need a reliable tool for remote server management and secure credential storage.

## Features

- **SSH Session Management:**
  - Connect to multiple SSH servers with tabbed sessions
  - Save, organize, and tag server profiles
  - Built-in terminal with color and font customization

- **SFTP File Transfers:**
  - Drag-and-drop uploads/downloads
  - Resume, pause, and monitor transfer progress
  - Secure file operations with detailed logs

- **Vault & Keychain:**
  - Store SSH keys, passwords, and secrets securely
  - Group and tag credentials for easy access
  - Import/export vault data

- **Port Forwarding:**
  - Manage SSH tunnels and port forwards
  - Quick setup for local/remote forwarding

- **Known Hosts & Security:**
  - Manage known hosts and fingerprints
  - Warnings for unknown or changed host keys

- **Modern UI:**
  - Responsive, dark/light themes
  - Customizable layout and sidebar
  - Toaster notifications and dialogs

- **Cross-Platform:**
  - Runs on macOS, Windows, and Linux

## Technologies

<div style="display: flex; align-items: center; gap: 10px;">
	<img src="https://img.shields.io/badge/Rust-black?style=for-the-badge&logo=rust"/>
	<img src="https://img.shields.io/badge/TypeScript-black?style=for-the-badge&logo=typescript"/>
	<img src="https://img.shields.io/badge/React-black?style=for-the-badge&logo=react"/>
	<img src="https://img.shields.io/badge/Vite-black?style=for-the-badge&logo=vite"/>
	<img src="https://img.shields.io/badge/Tauri-black?style=for-the-badge&logo=tauri"/>
</div>

## Getting Started

1. **Install dependencies:**
   - [Rust](https://www.rust-lang.org/tools/install)
   - [Node.js](https://nodejs.org/) & [pnpm](https://pnpm.io/)
2. **Clone the repository:**
   ```sh
   git clone https://github.com/Nytuo/watchtower.git
   cd watchtower
   ```
3. **Install JS dependencies:**
   ```sh
   pnpm install
   ```
4. **Run the app:**
   ```sh
   pnpm tauri dev
   ```

## Troubleshooting

- **macOS Gatekeeper:**
  - If you see a security warning, right-click the app and select "Open".
- **SSH Key Permissions:**
  - Ensure your SSH keys have correct permissions (`chmod 600`).
- **Vault Issues:**
  - If vault fails to unlock, check your master password and app logs.

## Contributing

Contributions are welcome! Please open issues or pull requests for bugs, features, or improvements.

## License

Watchtower is licensed under the **GNU General Public License v3**.
See [LICENSE](LICENSE) for details.
