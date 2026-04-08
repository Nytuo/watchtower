//! Per-record change tracking and merge for vault sync.
//!
//! Rather than adding timestamps to every struct (which older builds would
//! drop on save), changes are detected at save time by hashing each record and
//! stamping it with a hybrid logical clock when the hash differs from the one
//! last recorded. Deletes leave a tombstone. Everything lives in
//! `VaultData::sync_meta`, which older builds simply ignore.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::OnceLock;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::schema::VaultData;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct EntityMeta {
    pub hash: String,
    pub ts: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SyncMeta {
    #[serde(default)]
    pub vault_id: String,
    #[serde(default)]
    pub last_ts: String,
    #[serde(default)]
    pub entities: BTreeMap<String, EntityMeta>,
    #[serde(default)]
    pub tombstones: BTreeMap<String, String>,
}

fn node_id() -> &'static str {
    static NODE: OnceLock<String> = OnceLock::new();
    NODE.get_or_init(|| {
        let mut b = [0u8; 4];
        rand::thread_rng().fill_bytes(&mut b);
        b.iter().map(|x| format!("{:02x}", x)).collect()
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_ts(ts: &str) -> (u64, u32) {
    let mut it = ts.split('-');
    let wall = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ctr = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    (wall, ctr)
}

fn next_ts(last: &str, wall_now: u64) -> String {
    let (lw, lc) = parse_ts(last);
    let (wall, ctr) = if wall_now > lw {
        (wall_now, 0)
    } else {
        (lw, lc + 1)
    };
    format!("{:013}-{:06}-{}", wall, ctr, node_id())
}

fn hash_json<T: Serialize>(v: &T) -> String {
    let bytes = serde_json::to_vec(v).unwrap_or_default();
    let d = Sha256::digest(&bytes);
    d.iter().take(16).map(|x| format!("{:02x}", x)).collect()
}

fn settings_for_sync(s: &super::schema::VaultSettings) -> super::schema::VaultSettings {
    let mut c = s.clone();
    c.sync_mode = String::new();
    c.sync_url = None;
    c.sync_username = None;
    c.sync_password = None;
    c.sync_auto = false;
    c.auto_lock_minutes = 0;
    c.font_size = 0;
    c.font_family = String::new();
    c
}

fn all_records(data: &VaultData) -> Vec<(String, String)> {
    let mut v = Vec::new();
    for x in &data.servers {
        v.push((format!("server:{}", x.id), hash_json(x)));
    }
    for x in &data.groups {
        v.push((format!("group:{}", x.id), hash_json(x)));
    }
    for x in &data.tags {
        v.push((format!("tag:{}", x.id), hash_json(x)));
    }
    for x in &data.snippets {
        v.push((format!("snippet:{}", x.id), hash_json(x)));
    }
    for x in &data.keychains {
        v.push((format!("keychain:{}", x.id), hash_json(x)));
    }
    for x in &data.port_forwardings {
        v.push((format!("forward:{}", x.id), hash_json(x)));
    }
    for x in &data.known_hosts {
        v.push((format!("khost:{}:{}", x.host, x.port), hash_json(x)));
    }
    v.push((
        "settings:0".into(),
        hash_json(&settings_for_sync(&data.settings)),
    ));
    v
}

pub fn touch(data: &mut VaultData, salt: &[u8]) {
    touch_at(data, salt, now_ms());
}

fn touch_at(data: &mut VaultData, salt: &[u8], wall_now: u64) {
    let records = all_records(data);
    let meta = &mut data.sync_meta;
    if meta.vault_id.is_empty() {
        let mut h = Sha256::new();
        h.update(b"watchtower-vault-id");
        h.update(salt);
        meta.vault_id = h
            .finalize()
            .iter()
            .take(16)
            .map(|x| format!("{:02x}", x))
            .collect();
    }
    let mut seen = BTreeSet::new();
    for (key, hash) in records {
        seen.insert(key.clone());
        let changed = meta
            .entities
            .get(&key)
            .map(|e| e.hash != hash)
            .unwrap_or(true);
        if changed {
            let ts = next_ts(&meta.last_ts, wall_now);
            meta.last_ts = ts.clone();
            meta.entities.insert(key.clone(), EntityMeta { hash, ts });
            meta.tombstones.remove(&key);
        }
    }
    let gone: Vec<String> = meta
        .entities
        .keys()
        .filter(|k| !seen.contains(*k))
        .cloned()
        .collect();
    for key in gone {
        meta.entities.remove(&key);
        let ts = next_ts(&meta.last_ts, wall_now);
        meta.last_ts = ts.clone();
        meta.tombstones.insert(key, ts);
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Local,
    Remote,
}

struct Pick {
    side: Side,
    deleted: bool,
    ts: String,
}

fn pick(key: &str, l_has: bool, r_has: bool, lm: &SyncMeta, rm: &SyncMeta) -> Pick {
    let mut best: Option<(String, bool, Side)> = None;
    let mut consider = |ts: String, tomb: bool, side: Side| {
        let better = match &best {
            None => true,
            Some((bts, btomb, _)) => (ts.as_str(), tomb) > (bts.as_str(), *btomb),
        };
        if better {
            best = Some((ts, tomb, side));
        }
    };
    if l_has {
        consider(
            lm.entities
                .get(key)
                .map(|e| e.ts.clone())
                .unwrap_or_default(),
            false,
            Side::Local,
        );
    }
    if r_has {
        consider(
            rm.entities
                .get(key)
                .map(|e| e.ts.clone())
                .unwrap_or_default(),
            false,
            Side::Remote,
        );
    }
    if let Some(ts) = lm.tombstones.get(key) {
        consider(ts.clone(), true, Side::Local);
    }
    if let Some(ts) = rm.tombstones.get(key) {
        consider(ts.clone(), true, Side::Remote);
    }
    let (ts, deleted, side) = best.unwrap_or((String::new(), false, Side::Local));
    Pick { side, deleted, ts }
}

fn merge_vec<T: Clone + Serialize>(
    kind: &str,
    local: &[T],
    remote: &[T],
    lm: &SyncMeta,
    rm: &SyncMeta,
    id: impl Fn(&T) -> String,
    out: &mut SyncMeta,
) -> Vec<T> {
    let lmap: HashMap<String, &T> = local.iter().map(|x| (id(x), x)).collect();
    let rmap: HashMap<String, &T> = remote.iter().map(|x| (id(x), x)).collect();
    let mut order: Vec<String> = local.iter().map(&id).collect();
    for r in remote {
        let i = id(r);
        if !lmap.contains_key(&i) {
            order.push(i);
        }
    }
    let prefix = format!("{}:", kind);
    for k in lm.tombstones.keys().chain(rm.tombstones.keys()) {
        if let Some(i) = k.strip_prefix(&prefix) {
            if !lmap.contains_key(i) && !rmap.contains_key(i) && !order.iter().any(|o| o == i) {
                order.push(i.to_string());
            }
        }
    }
    let mut merged = Vec::new();
    for i in order {
        let key = format!("{}{}", prefix, i);
        let p = pick(&key, lmap.contains_key(&i), rmap.contains_key(&i), lm, rm);
        if p.deleted {
            out.tombstones.insert(key, p.ts);
            continue;
        }
        let src = match p.side {
            Side::Local => lmap.get(&i).or_else(|| rmap.get(&i)),
            Side::Remote => rmap.get(&i).or_else(|| lmap.get(&i)),
        };
        if let Some(item) = src {
            merged.push((*item).clone());
            out.entities.insert(
                key,
                EntityMeta {
                    hash: hash_json(*item),
                    ts: p.ts,
                },
            );
        }
    }
    merged
}

pub fn state_hash(m: &SyncMeta) -> String {
    hash_json(&(&m.entities, &m.tombstones))
}

pub fn merge(local: &VaultData, remote: &VaultData) -> AppResult<VaultData> {
    let (lm, rm) = (&local.sync_meta, &remote.sync_meta);
    if !lm.vault_id.is_empty() && !rm.vault_id.is_empty() && lm.vault_id != rm.vault_id {
        return Err(AppError::Vault(
            "These devices hold different vaults and cannot be merged".into(),
        ));
    }
    let mut out = SyncMeta {
        vault_id: if lm.vault_id.is_empty() {
            rm.vault_id.clone()
        } else {
            lm.vault_id.clone()
        },
        last_ts: std::cmp::max(lm.last_ts.clone(), rm.last_ts.clone()),
        ..Default::default()
    };

    let servers = merge_vec(
        "server",
        &local.servers,
        &remote.servers,
        lm,
        rm,
        |x| x.id.clone(),
        &mut out,
    );
    let groups = merge_vec(
        "group",
        &local.groups,
        &remote.groups,
        lm,
        rm,
        |x| x.id.clone(),
        &mut out,
    );
    let tags = merge_vec(
        "tag",
        &local.tags,
        &remote.tags,
        lm,
        rm,
        |x| x.id.clone(),
        &mut out,
    );
    let snippets = merge_vec(
        "snippet",
        &local.snippets,
        &remote.snippets,
        lm,
        rm,
        |x| x.id.clone(),
        &mut out,
    );
    let keychains = merge_vec(
        "keychain",
        &local.keychains,
        &remote.keychains,
        lm,
        rm,
        |x| x.id.clone(),
        &mut out,
    );
    let port_forwardings = merge_vec(
        "forward",
        &local.port_forwardings,
        &remote.port_forwardings,
        lm,
        rm,
        |x| x.id.clone(),
        &mut out,
    );
    let known_hosts = merge_vec(
        "khost",
        &local.known_hosts,
        &remote.known_hosts,
        lm,
        rm,
        |x| format!("{}:{}", x.host, x.port),
        &mut out,
    );

    let lts = lm
        .entities
        .get("settings:0")
        .map(|e| e.ts.as_str())
        .unwrap_or("");
    let rts = rm
        .entities
        .get("settings:0")
        .map(|e| e.ts.as_str())
        .unwrap_or("");
    let take_remote = rts > lts;
    let mut settings = if take_remote {
        remote.settings.clone()
    } else {
        local.settings.clone()
    };
    let l = &local.settings;
    settings.sync_mode = l.sync_mode.clone();
    settings.sync_url = l.sync_url.clone();
    settings.sync_username = l.sync_username.clone();
    settings.sync_password = l.sync_password.clone();
    settings.sync_auto = l.sync_auto;
    settings.auto_lock_minutes = l.auto_lock_minutes;
    settings.font_size = l.font_size;
    settings.font_family = l.font_family.clone();
    out.entities.insert(
        "settings:0".into(),
        EntityMeta {
            hash: hash_json(&settings_for_sync(&settings)),
            ts: std::cmp::max(lts, rts).to_string(),
        },
    );

    Ok(VaultData {
        servers,
        groups,
        tags,
        snippets,
        keychains,
        known_hosts,
        port_forwardings,
        settings,
        sync_meta: out,
    })
}

pub fn merge_adopting(local: &VaultData, remote: &VaultData) -> AppResult<VaultData> {
    let mut r = remote.clone();
    let remote_id = r.sync_meta.vault_id.clone();
    r.sync_meta.vault_id = local.sync_meta.vault_id.clone();
    let mut out = merge(local, &r)?;
    if !remote_id.is_empty() {
        out.sync_meta.vault_id = remote_id;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::schema::{ServerGroup, Tag};

    fn vault(salt: &[u8], t: u64) -> VaultData {
        let mut d = VaultData::default();
        touch_at(&mut d, salt, t);
        d
    }

    fn names(d: &VaultData) -> Vec<String> {
        let mut v: Vec<String> = d.tags.iter().map(|t| t.name.clone()).collect();
        v.sort();
        v
    }

    #[test]
    fn same_salt_same_vault_id() {
        assert_eq!(
            vault(b"s", 1).sync_meta.vault_id,
            vault(b"s", 2).sync_meta.vault_id
        );
        assert_ne!(
            vault(b"s", 1).sync_meta.vault_id,
            vault(b"t", 1).sync_meta.vault_id
        );
    }

    #[test]
    fn adopting_merge_unions_and_takes_remote_identity() {
        let mut a = vault(b"a", 1000);
        let mut b = vault(b"b", 1000);
        a.tags.push(Tag::new("mobile".into(), None));
        b.tags.push(Tag::new("desktop".into(), None));
        touch_at(&mut a, b"a", 2000);
        touch_at(&mut b, b"b", 2000);
        assert!(merge(&a, &b).is_err());
        let m = merge_adopting(&a, &b).unwrap();
        assert_eq!(names(&m), vec!["desktop", "mobile"]);
        assert_eq!(m.sync_meta.vault_id, b.sync_meta.vault_id);
        assert!(merge(&m, &b).is_ok());
        assert!(merge(&b, &m).is_ok());
    }

    #[test]
    fn different_vaults_refuse() {
        assert!(merge(&vault(b"a", 1), &vault(b"b", 1)).is_err());
    }

    #[test]
    fn disjoint_adds_are_unioned_both_ways() {
        let base = vault(b"s", 1000);
        let mut a = base.clone();
        let mut b = base.clone();
        a.tags.push(Tag::new("a".into(), None));
        b.tags.push(Tag::new("b".into(), None));
        touch_at(&mut a, b"s", 2000);
        touch_at(&mut b, b"s", 2001);
        let ab = merge(&a, &b).unwrap();
        let ba = merge(&b, &a).unwrap();
        assert_eq!(names(&ab), vec!["a", "b"]);
        assert_eq!(names(&ba), vec!["a", "b"]);
    }

    #[test]
    fn newer_edit_wins() {
        let mut base = vault(b"s", 1000);
        base.tags.push(Tag::new("t".into(), None));
        touch_at(&mut base, b"s", 1100);
        let mut a = base.clone();
        let mut b = base.clone();
        a.tags[0].name = "from-a".into();
        b.tags[0].name = "from-b".into();
        touch_at(&mut a, b"s", 2000);
        touch_at(&mut b, b"s", 3000);
        assert_eq!(names(&merge(&a, &b).unwrap()), vec!["from-b"]);
        assert_eq!(names(&merge(&b, &a).unwrap()), vec!["from-b"]);
    }

    #[test]
    fn delete_propagates_and_beats_older_edit() {
        let mut base = vault(b"s", 1000);
        base.tags.push(Tag::new("t".into(), None));
        base.groups.push(ServerGroup::new("g".into()));
        touch_at(&mut base, b"s", 1100);
        let mut a = base.clone();
        let mut b = base.clone();
        b.tags[0].name = "edited".into();
        touch_at(&mut b, b"s", 2000);
        a.tags.clear();
        touch_at(&mut a, b"s", 3000);
        assert!(merge(&a, &b).unwrap().tags.is_empty());
        assert!(merge(&b, &a).unwrap().tags.is_empty());
        assert_eq!(merge(&a, &b).unwrap().groups.len(), 1);
    }

    #[test]
    fn edit_after_delete_resurrects() {
        let mut base = vault(b"s", 1000);
        base.tags.push(Tag::new("t".into(), None));
        touch_at(&mut base, b"s", 1100);
        let mut a = base.clone();
        let mut b = base.clone();
        a.tags.clear();
        touch_at(&mut a, b"s", 2000);
        b.tags[0].name = "later".into();
        touch_at(&mut b, b"s", 3000);
        assert_eq!(names(&merge(&a, &b).unwrap()), vec!["later"]);
    }

    #[test]
    fn merge_is_idempotent() {
        let mut a = vault(b"s", 1000);
        a.tags.push(Tag::new("x".into(), None));
        touch_at(&mut a, b"s", 2000);
        let b = vault(b"s", 1500);
        let m = merge(&a, &b).unwrap();
        let mm = merge(&m, &b).unwrap();
        assert_eq!(names(&m), names(&mm));
        assert_eq!(m.sync_meta.entities, mm.sync_meta.entities);
    }

    #[test]
    fn clock_is_monotonic_with_skew() {
        let a = next_ts("0000000005000-000003-x", 1000);
        assert!(a.as_str() > "0000000005000-000003-x");
    }

    #[test]
    fn local_settings_survive_merge() {
        let mut a = vault(b"s", 1000);
        let mut b = vault(b"s", 1000);
        a.settings.font_size = 20;
        b.settings.font_size = 9;
        b.settings.theme = "light".into();
        touch_at(&mut b, b"s", 5000);
        let m = merge(&a, &b).unwrap();
        assert_eq!(m.settings.font_size, 20);
        assert_eq!(m.settings.theme, "light");
    }
}
