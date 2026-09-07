use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::AppError;
use crate::vault::schema::{AuthMethod, Protocol, ServerEntry};
use crate::vault::store::{self, SharedVaultState};

type HmacSha256 = Hmac<Sha256>;

fn hmac(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut m = HmacSha256::new_from_slice(key).unwrap();
    m.update(msg);
    m.finalize().into_bytes().to_vec()
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}
fn sha256_hex(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    hex(&h.finalize())
}

// ---------------- AWS EC2 (SigV4) ----------------

fn xml_between<'a>(s: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let a = s.find(&open)? + open.len();
    let b = s[a..].find(&close)? + a;
    Some(&s[a..b])
}
fn xml_all<'a>(s: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(rel) = s[i..].find(&open) {
        let start = i + rel + open.len();
        if let Some(rel2) = s[start..].find(&close) {
            out.push(&s[start..start + rel2]);
            i = start + rel2 + close.len();
        } else {
            break;
        }
    }
    out
}

#[tauri::command]
pub async fn cloud_list_aws(
    access_key: String,
    secret_key: String,
    region: String,
    session_token: Option<String>,
) -> Result<Vec<CloudHost>, AppError> {
    let host = format!("ec2.{}.amazonaws.com", region);
    let service = "ec2";
    let now = time_now_utc();
    let amz_date = now.0;
    let date_stamp = now.1;

    let payload = "Action=DescribeInstances&Version=2016-11-15";
    let payload_hash = sha256_hex(payload.as_bytes());

    let mut canonical_headers = format!(
        "content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:{}\nx-amz-date:{}\n",
        host, amz_date
    );
    let mut signed_headers = "content-type;host;x-amz-date".to_string();
    if let Some(tok) = &session_token {
        canonical_headers.push_str(&format!("x-amz-security-token:{}\n", tok));
        signed_headers = "content-type;host;x-amz-date;x-amz-security-token".to_string();
    }

    let canonical_request = format!(
        "POST\n/\n\n{}\n{}\n{}",
        canonical_headers, signed_headers, payload_hash
    );
    let scope = format!("{}/{}/{}/aws4_request", date_stamp, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        scope,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac(
        format!("AWS4{}", secret_key).as_bytes(),
        date_stamp.as_bytes(),
    );
    let k_region = hmac(&k_date, region.as_bytes());
    let k_service = hmac(&k_region, service.as_bytes());
    let k_signing = hmac(&k_service, b"aws4_request");
    let signature = hex(&hmac(&k_signing, string_to_sign.as_bytes()));

    let auth = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        access_key, scope, signed_headers, signature
    );

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("https://{}/", host))
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded; charset=utf-8",
        )
        .header("X-Amz-Date", &amz_date)
        .header("Authorization", auth)
        .body(payload);
    if let Some(tok) = &session_token {
        req = req.header("X-Amz-Security-Token", tok);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::General(format!("AWS request failed: {}", e)))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::General(format!(
            "AWS EC2 error {}: {}",
            status,
            xml_between(&body, "Message").unwrap_or(&body)
        )));
    }

    let mut hosts = Vec::new();
    for item in xml_all(&body, "instancesSet") {
        for inst in split_items(item) {
            let id = xml_between(inst, "instanceId").unwrap_or("").to_string();
            let state = xml_between(inst, "name").unwrap_or("").to_string();
            let public_ip = xml_between(inst, "ipAddress").map(String::from);
            let private_ip = xml_between(inst, "privateIpAddress").map(String::from);
            let mut name = id.clone();
            for tag in split_items(xml_between(inst, "tagSet").unwrap_or("")) {
                if xml_between(tag, "key") == Some("Name") {
                    if let Some(v) = xml_between(tag, "value") {
                        name = v.to_string();
                    }
                }
            }
            hosts.push(CloudHost {
                id,
                name,
                public_ip,
                private_ip,
                region: region.clone(),
                status: state,
            });
        }
    }
    Ok(hosts)
}

fn split_items(s: &str) -> Vec<&str> {
    // <item>...</item> blocks, non-nested-aware (best effort for EC2 shapes)
    xml_all(s, "item")
}

fn time_now_utc() -> (String, String) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil date from days since epoch
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mth <= 2 { y + 1 } else { y };
    let ds = format!("{:04}{:02}{:02}", year, mth, d);
    (format!("{}T{:02}{:02}{:02}Z", ds, h, m, s), ds)
}

// ---------------- Azure ----------------

#[tauri::command]
pub async fn cloud_list_azure(
    tenant_id: String,
    client_id: String,
    client_secret: String,
    subscription_id: String,
) -> Result<Vec<CloudHost>, AppError> {
    let client = reqwest::Client::new();
    let token: serde_json::Value = client
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            tenant_id
        ))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("scope", "https://management.azure.com/.default"),
        ])
        .send()
        .await
        .map_err(|e| AppError::General(format!("Azure auth failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::General(format!("Azure auth bad response: {}", e)))?;
    let bearer = token
        .get("access_token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            AppError::General(format!(
                "Azure auth error: {}",
                token
                    .get("error_description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("no token")
            ))
        })?
        .to_string();

    let vms: serde_json::Value = client
        .get(format!(
            "https://management.azure.com/subscriptions/{}/providers/Microsoft.Compute/virtualMachines?api-version=2023-07-01",
            subscription_id
        ))
        .bearer_auth(&bearer)
        .send()
        .await
        .map_err(|e| AppError::General(format!("Azure VM list failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::General(format!("Azure VM list bad response: {}", e)))?;

    let mut hosts = Vec::new();
    let empty = vec![];
    for vm in vms
        .get("value")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
    {
        let name = vm
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("vm")
            .to_string();
        let id = vm
            .get("id")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();
        let region = vm
            .get("location")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();

        // Resolve the primary NIC's private + public IP.
        let (mut priv_ip, mut pub_ip) = (None, None);
        if let Some(nic_id) = vm
            .pointer("/properties/networkProfile/networkInterfaces/0/id")
            .and_then(|n| n.as_str())
        {
            if let Ok(nic) = client
                .get(format!(
                    "https://management.azure.com{}?api-version=2023-05-01",
                    nic_id
                ))
                .bearer_auth(&bearer)
                .send()
                .await
            {
                if let Ok(nic) = nic.json::<serde_json::Value>().await {
                    priv_ip = nic
                        .pointer("/properties/ipConfigurations/0/properties/privateIPAddress")
                        .and_then(|n| n.as_str())
                        .map(String::from);
                    if let Some(pip_id) = nic
                        .pointer("/properties/ipConfigurations/0/properties/publicIPAddress/id")
                        .and_then(|n| n.as_str())
                    {
                        if let Ok(pip) = client
                            .get(format!(
                                "https://management.azure.com{}?api-version=2023-05-01",
                                pip_id
                            ))
                            .bearer_auth(&bearer)
                            .send()
                            .await
                        {
                            if let Ok(pip) = pip.json::<serde_json::Value>().await {
                                pub_ip = pip
                                    .pointer("/properties/ipAddress")
                                    .and_then(|n| n.as_str())
                                    .map(String::from);
                            }
                        }
                    }
                }
            }
        }

        hosts.push(CloudHost {
            id,
            name,
            public_ip: pub_ip,
            private_ip: priv_ip,
            region,
            status: "".into(),
        });
    }
    Ok(hosts)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudHost {
    pub id: String,
    pub name: String,
    pub public_ip: Option<String>,
    pub private_ip: Option<String>,
    pub region: String,
    pub status: String,
}

#[tauri::command]
pub async fn cloud_list_digitalocean(token: String) -> Result<Vec<CloudHost>, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.digitalocean.com/v2/droplets?per_page=200")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| AppError::General(format!("DigitalOcean request failed: {}", e)))?;

    if !resp.status().is_success() {
        return Err(AppError::General(format!(
            "DigitalOcean API returned {}",
            resp.status()
        )));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::General(format!("Bad DigitalOcean response: {}", e)))?;

    let mut hosts = Vec::new();
    if let Some(droplets) = body.get("droplets").and_then(|d| d.as_array()) {
        for d in droplets {
            let networks = d.get("networks");
            let pick = |kind: &str| -> Option<String> {
                networks
                    .and_then(|n| n.get("v4"))
                    .and_then(|v| v.as_array())
                    .and_then(|arr| {
                        arr.iter()
                            .find(|net| net.get("type").and_then(|t| t.as_str()) == Some(kind))
                            .and_then(|net| net.get("ip_address").and_then(|i| i.as_str()))
                            .map(String::from)
                    })
            };
            hosts.push(CloudHost {
                id: d.get("id").map(|i| i.to_string()).unwrap_or_default(),
                name: d
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("droplet")
                    .to_string(),
                public_ip: pick("public"),
                private_ip: pick("private"),
                region: d
                    .get("region")
                    .and_then(|r| r.get("slug"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
                status: d
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }
    Ok(hosts)
}

#[derive(Debug, Serialize)]
pub struct CloudImportResult {
    pub added: usize,
    pub skipped: usize,
}

#[tauri::command]
pub async fn cloud_import_hosts(
    hosts: Vec<CloudHost>,
    username: String,
    use_private_ip: bool,
    group_name: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<CloudImportResult, AppError> {
    let username = if username.is_empty() {
        "root".to_string()
    } else {
        username
    };

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let kdf = vault.kdf.clone();
    let key = vault.key.clone();
    let data = vault.get_data_mut()?;

    let group_id = group_name.and_then(|name| {
        if name.is_empty() {
            return None;
        }
        if let Some(g) = data.groups.iter().find(|g| g.name == name) {
            Some(g.id.clone())
        } else {
            let g = crate::vault::schema::ServerGroup::new(name);
            let id = g.id.clone();
            data.groups.push(g);
            Some(id)
        }
    });

    let existing: std::collections::HashSet<String> =
        data.servers.iter().map(|s| s.host.clone()).collect();

    let mut added = 0;
    let mut skipped = 0;
    for h in hosts {
        let ip = if use_private_ip {
            h.private_ip.or(h.public_ip)
        } else {
            h.public_ip.or(h.private_ip)
        };
        let Some(host) = ip else {
            skipped += 1;
            continue;
        };
        if existing.contains(&host) {
            skipped += 1;
            continue;
        }
        let mut e = ServerEntry::new(
            h.name.clone(),
            host,
            22,
            username.clone(),
            AuthMethod::Agent,
            Protocol::Ssh,
        );
        e.group_id = group_id.clone();
        e.notes = Some(format!("Cloud import ({})", h.region));
        data.servers.push(e);
        added += 1;
    }

    if let (Some(path), Some(kdf), Some(key)) = (file_path, kdf, key) {
        store::save_vault(&path, &kdf, &key, data)?;
    }
    Ok(CloudImportResult { added, skipped })
}
