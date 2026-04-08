# Flatpak packaging

`fr.nytuo.watchtower.yml` builds Watchtower from source inside the Flatpak sandbox,
the way Flathub requires: no network access at build time, every cargo crate and
npm package is listed in `cargo-sources.json` / `node-sources.json`.

## Regenerate the offline sources

Whenever `src-tauri/Cargo.lock` or `package-lock.json` changes (the
`flatpak-check` workflow fails when they are stale):

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install aiohttp toml tomlkit "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
curl -O https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
python3 flatpak-cargo-generator.py src-tauri/Cargo.lock -o packaging/flatpak/cargo-sources.json
python3 -m flatpak_node_generator npm package-lock.json -o packaging/flatpak/node-sources.json
```

## Build locally

```sh
flatpak install flathub org.gnome.Sdk//50 org.gnome.Platform//50 \
  org.freedesktop.Sdk.Extension.rust-stable//25.08 org.freedesktop.Sdk.Extension.node24//25.08
flatpak-builder --force-clean --user --install build-dir packaging/flatpak/fr.nytuo.watchtower.yml
flatpak run fr.nytuo.watchtower
```

## Host tools (SFTP mounts, mosh)

Mounting a server as a drive needs `sshfs` and FUSE, and mosh sessions need
`mosh`; neither can run inside the sandbox. In a Flatpak, Watchtower runs them
on the host with `flatpak-spawn --host` (see `src-tauri/src/sandbox.rs`).

That permission lets the app run any command on the host, so it is **not**
granted by the manifest (Flathub would reject it for this app). Users who want
these features install the tools on their system and opt in, either in Flatseal
(*Session Bus → Talk* → add `org.freedesktop.Flatpak`) or with:

```sh
flatpak override --user --talk-name=org.freedesktop.Flatpak fr.nytuo.watchtower
```

Without it, the mount dialog shows this hint instead of failing.

## Publishing to Flathub

The local manifest builds the working tree (`type: dir`). Flathub needs a
pinned source, so `flathub_sync.py` swaps the `type: dir` source for a git
source at a release tag, and adds the release to the
metainfo.

- **Updates** — `.github/workflows/flathub-publish.yml` runs when a GitHub
  Release is published and opens a pull request on
  [flathub/fr.nytuo.watchtower](https://github.com/flathub/fr.nytuo.watchtower).
  Flathub test-builds the PR; merge it to publish. Needs the `FLATHUB_TOKEN`
  secret (classic PAT, `public_repo` scope, from a maintainer of that repo).
- **Initial submission** — until Flathub accepts the app, that repo does not
  exist and the workflow only uploads the `flathub-files` artifact. Those files
  go in a branch of your fork of [flathub/flathub](https://github.com/flathub/flathub)
  based on `new-pr`, submitted as a pull request against `new-pr`.
