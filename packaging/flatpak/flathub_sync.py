#!/usr/bin/env python3
"""Build the file set for the Flathub repo from the local Flatpak packaging.

The local manifest builds the working tree (a `type: dir` source). Flathub
needs a pinned source, so it is swapped for a git source at the release tag
and commit. The
desktop entry, metainfo and generated cargo/npm sources are copied alongside,
and the release is added to the metainfo if it is not listed yet.

    flathub_sync.py --manifest flatpak/fr.nytuo.app.yml --url https://github.com/o/r.git \
        --tag v1.2.3 --commit <sha> --version 1.2.3 --out flathub-out
"""
import argparse
import datetime
import pathlib
import re
import shutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--url", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--date", default=datetime.date.today().isoformat())
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()

    src_dir = args.manifest.parent
    app_id = args.manifest.stem
    args.out.mkdir(parents=True, exist_ok=True)

    manifest = args.manifest.read_text()
    # The `- type: dir` entry and its more-indented lines (path, skip, ...).
    dir_source = re.compile(r"^([ \t]*)- type: dir\n(?:\1[ \t]+\S[^\n]*\n)*", re.M)
    match = dir_source.search(manifest)
    if not match:
        raise SystemExit(f"{args.manifest}: no `type: dir` source to pin")
    indent = match.group(1)
    git_source = (
        f"{indent}- type: git\n"
        f"{indent}  url: {args.url}\n"
        f"{indent}  tag: {args.tag}\n"
        f"{indent}  commit: {args.commit}\n"
    )
    manifest = manifest[: match.start()] + git_source + manifest[match.end():]
    (args.out / args.manifest.name).write_text(manifest)

    for name in (f"{app_id}.desktop", "cargo-sources.json", "node-sources.json"):
        if (src_dir / name).exists():
            shutil.copy2(src_dir / name, args.out / name)

    metainfo = (src_dir / f"{app_id}.metainfo.xml").read_text()
    if f'<release version="{args.version}"' not in metainfo:
        metainfo = re.sub(
            r"^([ \t]*)<releases>\n",
            lambda m: f'{m.group(0)}{m.group(1)}  <release version="{args.version}" date="{args.date}"/>\n',
            metainfo,
            count=1,
            flags=re.M,
        )
    (args.out / f"{app_id}.metainfo.xml").write_text(metainfo)


if __name__ == "__main__":
    main()
