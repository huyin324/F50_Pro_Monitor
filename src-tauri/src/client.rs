//! F50 Pro 原生 80 端口客户端
//!
//! 与原版 Windows 端的根本差异：
//!  - 原版依赖 2333 端口 UFI 代理（/api/goform，需 APK 内嵌密钥）与 5555 ADB，
//!    F50 Pro 未开放这两个端口，导致硬件状态与短信全部为空。
//!  - 本实现只走 80 端口 goform；登录用 LD + 大写 SHA256；写操作用 AD 鉴权。
//!  - NR 小区 dump 必须单独请求，显式列出 dump 内的键会被固件清零。
use crate::config::{save_traffic, Config, TrafficState};
use crate::crypto::{auth_ad, encode_sms_body, login_password_hash, sms_time_string};
use base64::Engine;
use chrono::{Datelike, Local, NaiveDate};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) F50ProMonitor/1.0";
const PROTOCOL_JSON: &str = include_str!("../../protocol.json");

#[derive(Debug, Clone, Default)]
pub struct CapacityCache {
    pub total: u64,
    pub received: u64,
    pub sent: u64,
    pub draft: u64,
    pub sim_total: u64,
}

pub struct AppState {
    pub config: RwLock<Config>,
    pub traffic: Mutex<TrafficState>,
    pub capacity: Mutex<CapacityCache>,
    pub logged_in: Mutex<bool>,
    pub client: reqwest::Client,
    pub proto: Value,
    pub cmds: Cmds,
}

#[derive(Debug, Clone)]
pub struct Cmds {
    pub main: String,
    pub dump: String,
    pub device: String,
    pub versions: String,
    pub lock: String,
    pub loginfo: String,
    pub sms_capacity: String,
    pub ld: String,
    pub rd: String,
}

impl AppState {
    pub fn new(cfg: Config) -> Self {
        let proto: Value = serde_json::from_str(PROTOCOL_JSON).unwrap_or_else(|_| json!({}));
        let s = |k: &str| -> String {
            proto["commands"][k].as_str().unwrap_or("").to_string()
        };
        let cmds = Cmds {
            main: s("main"),
            dump: s("dump"),
            device: s("device"),
            versions: s("versions"),
            lock: s("lock"),
            loginfo: s("loginfo"),
            sms_capacity: s("sms_capacity"),
            ld: proto["auth"]["ld_cmd"].as_str().unwrap_or("LD").to_string(),
            rd: proto["auth"]["rd_cmd"].as_str().unwrap_or("RD").to_string(),
        };
        let jar = Arc::new(reqwest::cookie::Jar::default());
        let client = reqwest::Client::builder()
            .cookie_provider(jar)
            .timeout(Duration::from_secs(8))
            .build()
            .expect("创建 HTTP 客户端失败");
        Self {
            config: RwLock::new(cfg),
            traffic: Mutex::new(crate::config::load_traffic()),
            capacity: Mutex::new(CapacityCache::default()),
            logged_in: Mutex::new(false),
            client,
            proto,
            cmds,
        }
    }
}

/* ------------------------------------------------------------------ */
/* JSON 小工具                                                          */
/* ------------------------------------------------------------------ */

pub fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

pub fn num(v: Option<&Value>, d: f64) -> f64 {
    let s = text(v);
    if s.is_empty() {
        return d;
    }
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    cleaned.parse::<f64>().unwrap_or(d)
}

pub fn first<'a>(o: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for k in keys {
        if let Some(v) = o.get(*k) {
            match v {
                Value::Null => continue,
                Value::String(s) if s.is_empty() => continue,
                _ => return Some(v),
            }
        }
    }
    None
}

pub fn first_text(o: &Value, keys: &[&str]) -> String {
    text(first(o, keys))
}

/// 实时速率：与设备 web 首页 home.js → util.js::transUnit(x, true) 完全一致（入参 B/s）。
/// ×8 转比特后按 1024 进制取第一个 >=0.5 的单位，末尾加 /s，数字与单位间无空格。
pub fn format_web_speed(bytes_per_sec: f64) -> String {
    if bytes_per_sec <= 0.0 {
        return "0b/s".into();
    }
    let bits = bytes_per_sec * 8.0;
    let levels: [(f64, &str); 5] = [
        (1_099_511_627_776.0, "Tb"),
        (1_073_741_824.0, "Gb"),
        (1_048_576.0, "Mb"),
        (1024.0, "Kb"),
        (1.0, "b"),
    ];
    for (div, unit) in levels {
        let r = bits / div;
        if r >= 0.5 {
            let rounded = (r * 100.0).round() / 100.0;
            return format!("{}{}/s", rounded, unit);
        }
    }
    format!("{:.2}b/s", (bits * 100.0).round() / 100.0)
}

fn now_text() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn days_to_reset(reset_day: u32) -> u32 {
    let n = Local::now();
    let today = n.date_naive();
    let d = reset_day.clamp(1, 28);
    let mut target = NaiveDate::from_ymd_opt(n.year(), n.month(), d).unwrap_or(today);
    if target <= today {
        let (y, m) = if n.month() == 12 {
            (n.year() + 1, 1)
        } else {
            (n.year(), n.month() + 1)
        };
        target = NaiveDate::from_ymd_opt(y, m, d).unwrap_or(today);
    }
    (target - today).num_days().max(0) as u32
}

fn offline(e: &str) -> Value {
    // 空密码属于本地配置缺失，前端据此显示「请填写密码」而不是笼统的连接失败。
    let need_config = e.contains("尚未设置 Web 登录密码");
    json!({ "online": false, "need_config": need_config, "error": e, "ts": now_text() })
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                 */
/* ------------------------------------------------------------------ */

async fn base(state: &AppState) -> String {
    let b = state.config.read().await.base_url.trim().trim_end_matches('/').to_string();
    if b.is_empty() {
        "http://192.168.0.1".into()
    } else {
        b
    }
}

async fn get_json(state: &AppState, path: &str) -> Result<Value, String> {
    let b = base(state).await;
    let url = format!("{}{}", b, path);
    let resp = state
        .client
        .get(&url)
        .header("Referer", format!("{}/index.html", b))
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("UNAUTHORIZED: HTTP 401".into());
    }
    let v: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
    if let Some(err) = v.get("Error").and_then(|x| x.as_str()) {
        if !err.is_empty() {
            return Err(format!("UNAUTHORIZED: {}", err));
        }
    }
    Ok(v)
}

async fn post_form(state: &AppState, form: &[(String, String)]) -> Result<Value, String> {
    let b = base(state).await;
    let url = format!("{}/goform/goform_set_cmd_process", b);
    let resp = state
        .client
        .post(&url)
        .header("Referer", format!("{}/index.html", b))
        .header("User-Agent", UA)
        .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        .form(form)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&body).unwrap_or_else(|_| json!({})))
}

pub async fn cmd_get(state: &AppState, commands: &str) -> Result<Value, String> {
    let path = format!(
        "/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd={}",
        commands
    );
    get_json(state, &path).await
}

/* ------------------------------------------------------------------ */
/* 会话                                                                 */
/* ------------------------------------------------------------------ */

pub async fn login(state: &AppState) -> Result<(), String> {
    // 关键：密码为空时【绝不】向设备发 LOGIN 请求。
    // 「恢复默认」后 1 秒轮询若用空密码反复登录，会消耗 psw_fail_num_str；
    // 等用户填好正确密码时设备已进入登录保护，下面的保护检查会直接「跳过登录」。
    let password = {
        let c = state.config.read().await;
        c.password.clone()
    };
    if password.is_empty() {
        *state.logged_in.lock().await = false;
        return Err("尚未设置 Web 登录密码，请在「设置 → 设备连接」中填写".into());
    }
    // 登录失败会消耗设备剩余尝试次数；锁定或余数不足时直接放弃，避免把账户锁死。
    let lock = cmd_get(state, &state.cmds.lock).await?;
    let remaining = num(lock.get("psw_fail_num_str"), 5.0);
    let lock_seconds = num(lock.get("login_lock_time"), 0.0);
    if lock_seconds > 0.0 || remaining < 3.0 {
        return Err(format!(
            "设备登录保护中（剩余 {} 次 / 锁定 {} 秒），已跳过登录",
            remaining as i64, lock_seconds as i64
        ));
    }
    let ld = text(cmd_get(state, &state.cmds.ld).await?.get("LD"));
    if ld.is_empty() {
        return Err("无法获取 LD 挑战值，请检查设备地址".into());
    }
    let pwd = login_password_hash(&password, &ld);
    let form = vec![
        ("isTest".into(), "false".into()),
        ("goformId".into(), "LOGIN".into()),
        ("password".into(), pwd),
    ];
    let r = post_form(state, &form).await?;
    let result = text(r.get("result"));
    if result != "0" && result != "4" {
        *state.logged_in.lock().await = false;
        return Err(format!(
            "登录失败 result={}（请核对管理密码；连续失败会锁定设备）",
            result
        ));
    }
    *state.logged_in.lock().await = true;
    Ok(())
}

pub async fn ensure_login(state: &AppState) -> Result<(), String> {
    let logged = *state.logged_in.lock().await;
    if !logged {
        return login(state).await;
    }
    match cmd_get(state, &state.cmds.loginfo).await {
        Ok(v) if text(v.get("loginfo")).eq_ignore_ascii_case("ok") => Ok(()),
        _ => login(state).await,
    }
}

pub async fn get_authed_path(state: &AppState, path: &str) -> Result<Value, String> {
    ensure_login(state).await?;
    match get_json(state, path).await {
        Err(e) if e.contains("UNAUTHORIZED") => {
            login(state).await?;
            get_json(state, path).await
        }
        r => r,
    }
}

pub async fn cmd_authed(state: &AppState, commands: &str) -> Result<Value, String> {
    let path = format!(
        "/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd={}",
        commands
    );
    get_authed_path(state, &path).await
}

pub async fn get_ad(state: &AppState) -> Result<String, String> {
    let ver = cmd_authed(state, &state.cmds.versions).await?;
    let wa = first_text(&ver, &["wa_inner_version", "wa_version"]);
    let cr = text(ver.get("cr_version"));
    let rd = text(cmd_authed(state, &state.cmds.rd).await?.get("RD"));
    if rd.is_empty() {
        return Err("无法获取 RD，无法生成 AD 鉴权参数".into());
    }
    Ok(auth_ad(&wa, &cr, &rd))
}

pub async fn post_goform(state: &AppState, form: &[(String, String)]) -> Result<Value, String> {
    let make = |ad: String| -> Vec<(String, String)> {
        let mut f = vec![("isTest".into(), "false".into())];
        f.extend(form.iter().cloned());
        f.push(("AD".into(), ad));
        f
    };
    ensure_login(state).await?;
    let ad = get_ad(state).await?;
    match post_form(state, &make(ad)).await {
        Err(e) if e.contains("UNAUTHORIZED") => {
            login(state).await?;
            let ad2 = get_ad(state).await?;
            post_form(state, &make(ad2)).await
        }
        r => r,
    }
}

fn result_ok(r: &Value) -> bool {
    let s = text(r.get("result")).to_lowercase();
    s == "success" || s == "0"
}

/* ------------------------------------------------------------------ */
/* 状态                                                                 */
/* ------------------------------------------------------------------ */

pub async fn get_status(state: &AppState) -> Value {
    let main = match cmd_authed(state, &state.cmds.main).await {
        Ok(v) => v,
        Err(e) => return offline(&e),
    };
    // 单独请求：与主列表合并会让 B28 固件把 dump 字段清零。
    let dump = cmd_authed(state, &state.cmds.dump)
        .await
        .unwrap_or_else(|_| json!({}));
    build_status(state, &main, &dump).await
}

async fn build_status(state: &AppState, main: &Value, dump: &Value) -> Value {
    let cfg = state.config.read().await.clone();
    let cap = state.capacity.lock().await.clone();

    let ppp = text(main.get("ppp_status"));
    let connected = ppp.to_lowercase().contains("connected") && !ppp.to_lowercase().contains("disconnected");
    let ppp_map = &state.proto["ppp_status"];
    let connection_text = ppp_map
        .get(&ppp)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| if ppp.is_empty() { "未知".into() } else { ppp.clone() });

    let dl_raw = num(
        main.get("flux_realtime_rx_thrpt")
            .or_else(|| main.get("realtime_rx_thrpt")),
        0.0,
    );
    let ul_raw = num(
        main.get("flux_realtime_tx_thrpt")
            .or_else(|| main.get("realtime_tx_thrpt")),
        0.0,
    );

    let rx = num(first(main, &["monthly_rx_bytes", "flux_monthly_rx_bytes"]), 0.0) as u64;
    let tx = num(first(main, &["monthly_tx_bytes", "flux_monthly_tx_bytes"]), 0.0) as u64;
    let monthly_total = rx + tx;
    let session_rx = num(first(main, &["flux_realtime_rx_bytes", "realtime_rx_bytes"]), 0.0) as u64;
    let session_tx = num(first(main, &["flux_realtime_tx_bytes", "realtime_tx_bytes"]), 0.0) as u64;
    let uptime = num(first(main, &["flux_realtime_time", "realtime_time", "monthly_time"]), 0.0) as u64;

    let today = Local::now().format("%Y-%m-%d").to_string();
    let daily_total = {
        let mut t = state.traffic.lock().await;
        if t.date != today {
            t.date = today.clone();
            t.baseline = monthly_total;
        } else if t.baseline == 0 && monthly_total > 0 {
            t.baseline = monthly_total;
        }
        t.last_seen = monthly_total;
        t.last_seen_at = Local::now().timestamp();
        let d = monthly_total.saturating_sub(t.baseline);
        let snapshot = t.clone();
        drop(t);
        save_traffic(&snapshot);
        d
    };

    let unit_mul: f64 = match cfg.quota_unit.to_uppercase().as_str() {
        "TB" => 1024_f64.powi(4),
        "MB" => 1024_f64.powi(2),
        _ => 1024_f64.powi(3),
    };
    let quota_bytes = if cfg.quota_enabled {
        (cfg.monthly_quota_gb * unit_mul) as u64
    } else {
        0
    };
    let quota_pct = if quota_bytes > 0 {
        (monthly_total as f64 / quota_bytes as f64 * 100.0).min(100.0)
    } else {
        0.0
    };
    let reset_day = if cfg.quota_auto_reset {
        let d = num(first(main, &["flux_clear_date", "data_volume_clear_date"]), cfg.quota_reset_day as f64) as u32;
        if d == 0 { cfg.quota_reset_day } else { d }
    } else {
        cfg.quota_reset_day
    };

    let net_type = text(main.get("network_type"));
    let net_type_text = if net_type == "NR5G-SA" { "5G SA".into() } else if net_type.is_empty() { "未知".into() } else { net_type.clone() };
    let net_select = first_text(main, &["network_net_select", "net_select"]);
    let network_mode_text = state.proto["network_modes"]
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|m| m["value"].as_str() == Some(net_select.as_str()))
                .and_then(|m| m["label"].as_str())
        })
        .unwrap_or("自动 5G")
        .to_string();
    let signalbar = num(first(main, &["signalbar", "network_signalbar"]), 0.0).clamp(0.0, 5.0) as u32;
    let pin = first_text(main, &["sim_pin_status", "pin_status"]);
    let sim_status = if pin == "1" || pin == "2" || pin == "3" {
        "需要 PIN/PUK".to_string()
    } else if !text(main.get("sim_slot")).is_empty() {
        "已就绪".to_string()
    } else {
        "未检测到".to_string()
    };
    let cpu_temp = first(main, &["cpu_temperature"]).map(|v| num(Some(v), 0.0));
    let cpu_usage = first(main, &["cpu_utility"]).map(|v| num(Some(v), 0.0));
    let mem_usage = first(main, &["mem_utility"]).map(|v| num(Some(v), 0.0));

    let device_limit = parse_device_limit(main);

    json!({
        "online": true,
        "error": Value::Null,
        "ts": now_text(),

        "ppp_status": ppp,
        "connected": connected,
        "connection_text": connection_text,
        "modem_main_state": first_text(main, &["mc_modem_main_state", "modem_main_state"]),
        "dial_mode": text(main.get("dial_mode")),
        "opms_wan_mode": text(main.get("opms_wan_mode")),
        "uptime_sec": uptime,
        "sim_status": sim_status,
        "sim_slot": text(main.get("sim_slot")),
        "sim_pin_status": pin,
        "roaming": first_text(main, &["network_simcard_roam", "simcard_roam"]),
        "roam_setting_option": text(main.get("roam_setting_option")),
        "wifi_onoff_state": text(main.get("wifi_onoff_state")),
        "wifi_access_sta_num": num(main.get("wifi_access_sta_num"), 0.0) as u64,
        "ssid": text(main.get("wifi_chip1_ssid1_ssid")),
        "usb_port_switch": text(main.get("usb_port_switch")),

        "network_type": net_type,
        "network_type_text": net_type_text,
        "network_provider": first_text(main, &["network_provider_fullname", "network_provider"]),
        "plmn": text(dump.get("plmn")),
        "signalbar": signalbar,
        "rsrp": first_text(dump, &["nr_rsrp", "Z5g_rsrp", "5g_rsrp", "lte_rsrp", "Nr_signal_strength"]),
        "rsrq": first_text(dump, &["nr_rsrq", "Z5g_rsrq", "5g_rsrq", "lte_rsrq"]),
        "sinr": first_text(dump, &["Nr_snr", "nr_snr", "Z5g_snr", "5g_snr", "lte_snr"]),
        "nr_signal_strength": text(dump.get("Nr_signal_strength")),
        "nr_bands": first_text(dump, &["Nr_bands", "nr5g_action_band"]),
        "nr_band_widths": text(dump.get("Nr_band_widths")),
        "nr_fcn": text(dump.get("Nr_fcn")),
        "nr_pci": text(dump.get("Nr_pci")),
        "nr_cell_id": text(dump.get("Nr_cell_id")),
        "nr_tac": text(dump.get("nr_tac")),
        "dl_ambr": text(main.get("dl_ambr")),
        "ul_ambr": text(main.get("ul_ambr")),
        "qci": text(main.get("qci")),
        "net_select": net_select,
        "network_mode_text": network_mode_text,

        "dl_bps": dl_raw,
        "ul_bps": ul_raw,
        "dl_text": format_web_speed(dl_raw),
        "ul_text": format_web_speed(ul_raw),

        "monthly_rx_bytes": rx,
        "monthly_tx_bytes": tx,
        "monthly_total_bytes": monthly_total,
        "session_rx_bytes": session_rx,
        "session_tx_bytes": session_tx,
        "daily_total_bytes": daily_total,
        "quota_bytes": quota_bytes,
        "quota_used_pct": quota_pct,
        "quota_remaining_bytes": if quota_bytes > monthly_total { quota_bytes - monthly_total } else { 0u64 },
        "quota_reset_day": reset_day,
        "days_to_reset": days_to_reset(reset_day),
        "device_limit_bytes": device_limit,
        "device_limit_switch": num(first(main, &["flux_data_volume_limit_switch", "data_volume_limit_switch"]), 0.0) as u64,

        "sms_unread_num": num(first(main, &["sms_unread_num", "sms_dev_unread_num"]), 0.0) as u64,
        "sms_nv_total": cap.total,
        "sms_nv_rev_total": cap.received,

        "cpu_temperature": cpu_temp,
        "cpu_usage": cpu_usage,
        "mem_usage": mem_usage,
        "battery_value": num(main.get("battery_value"), -1.0) as i64,
        "battery_charging": text(main.get("battery_charging")),

        "wan_ipaddr": text(main.get("wan_ipaddr")),
        "ipv6_wan_ipaddr": text(main.get("ipv6_wan_ipaddr")),
        "lan_ipaddr": text(main.get("lan_ipaddr")),
        "mac_address": text(main.get("mac_address")),
        "iccid": text(main.get("iccid")),
        "imsi": text(main.get("imsi")),
        "imei": text(main.get("imei")),
        "sim_msisdn": text(main.get("sim_msisdn")),
        "web_version": text(main.get("web_version")),
        "wa_inner_version": text(main.get("wa_inner_version")),
        "cr_version": text(main.get("cr_version")),
        "hardware_version": text(main.get("hardware_version")),
        "model_name": text(main.get("model_name")),
        "loginfo": text(main.get("loginfo"))
    })
}

fn parse_device_limit(d: &Value) -> u64 {
    let size = first_text(d, &["flux_data_volume_limit_size", "data_volume_limit_size"]);
    let unit = first_text(d, &["flux_data_volume_limit_unit", "data_volume_limit_unit"]).to_lowercase();
    if size.is_empty() || size == "0" {
        return 0;
    }
    let n: f64 = size.parse().unwrap_or(0.0);
    if n <= 0.0 {
        return 0;
    }
    let mul = match unit.as_str() {
        "gb" | "1" | "g" => 1024_f64.powi(3),
        "mb" | "0" | "m" => 1024_f64.powi(2),
        "tb" | "2" | "t" => 1024_f64.powi(4),
        _ => {
            if n < 1000.0 {
                1024_f64.powi(3)
            } else {
                1024_f64.powi(2)
            }
        }
    };
    (n * mul) as u64
}

/* ------------------------------------------------------------------ */
/* 设备信息                                                             */
/* ------------------------------------------------------------------ */

pub async fn get_device_info(state: &AppState) -> Result<Value, String> {
    let d = cmd_authed(state, &state.cmds.device).await?;
    let dump = cmd_authed(state, &state.cmds.dump)
        .await
        .unwrap_or_else(|_| json!({}));
    let s = get_status(state).await;
    let cap = cmd_authed(state, &state.cmds.sms_capacity)
        .await
        .unwrap_or_else(|_| json!({}));
    let cached = state.capacity.lock().await.clone();
    Ok(json!({
        "sim_msisdn": first_text(&d, &["sim_msisdn"]).if_empty(text(s.get("sim_msisdn"))),
        "iccid": first_text(&d, &["sim_iccid", "iccid"]).if_empty(text(s.get("iccid"))),
        "imsi": first_text(&d, &["sim_imsi", "imsi"]).if_empty(text(s.get("imsi"))),
        "imei": first_text(&d, &["imei"]).if_empty(text(s.get("imei"))),
        "imei_0": text(d.get("imei_0")),
        "imei_1": text(d.get("imei_1")),
        "web_version": first_text(&d, &["web_version"]).if_empty(text(s.get("web_version"))),
        "wa_inner_version": first_text(&d, &["wa_inner_version"]).if_empty(text(s.get("wa_inner_version"))),
        "wa_version": text(d.get("wa_version")),
        "cr_version": first_text(&d, &["cr_version"]).if_empty(text(s.get("cr_version"))),
        "hardware_version": first_text(&d, &["hardware_version"]).if_empty(text(s.get("hardware_version"))),
        "model_name": first_text(&d, &["model_name"]).if_empty(text(s.get("model_name"))),
        "market_name": text(d.get("market_name")),
        "network_provider": first_text(&d, &["network_provider_fullname"]).if_empty(text(s.get("network_provider"))),
        "plmn": first_text(&dump, &["plmn"]).if_empty(format!("{}{}", text(d.get("network_rmcc")), text(d.get("network_rmnc")))),
        "network_type": first_text(&d, &["network_type"]).if_empty(text(s.get("network_type"))),
        "net_select": first_text(&d, &["network_net_select", "net_select"]).if_empty(text(s.get("net_select"))),
        "opms_wan_mode": first_text(&d, &["opms_wan_mode"]).if_empty(text(s.get("opms_wan_mode"))),
        "ppp_status": first_text(&d, &["ppp_status"]).if_empty(text(s.get("ppp_status"))),
        "ssid": text(d.get("wifi_chip1_ssid1_ssid")),
        "lan_ipaddr": first_text(&d, &["lan_ipaddr"]).if_empty(text(s.get("lan_ipaddr"))),
        "wan_ipaddr": first_text(&d, &["wan_ipaddr"]).if_empty(text(s.get("wan_ipaddr"))),
        "ipv6_wan_ipaddr": first_text(&d, &["ipv6_wan_ipaddr"]).if_empty(text(s.get("ipv6_wan_ipaddr"))),
        "mac_address": first_text(&d, &["mac_address"]).if_empty(text(s.get("mac_address"))),
        "local_domain": text(d.get("LocalDomain")),
        "station_ip_addr": text(d.get("station_ip_addr")),
        "pdp_type": first_text(&d, &["pdp_type_ui", "apn_pdp_type"]),
        "cpu_temperature": first_text(&d, &["cpu_temperature"]).if_empty(text(s.get("cpu_temperature"))),
        "dl_ambr": first_text(&d, &["dl_ambr"]).if_empty(text(s.get("dl_ambr"))),
        "ul_ambr": first_text(&d, &["ul_ambr"]).if_empty(text(s.get("ul_ambr"))),
        "nr_bands": text(dump.get("Nr_bands")),
        "nr_cell_id": text(dump.get("Nr_cell_id")),
        "nr_pci": text(dump.get("Nr_pci")),
        "nr_fcn": text(dump.get("Nr_fcn")),
        "nr_tac": text(dump.get("nr_tac")),
        "wifi_access_sta_num": num(first(&d, &["wifi_access_sta_num"]), num(s.get("wifi_access_sta_num"), 0.0)) as u64,
        "sms_capacity_total": text(cap.get("sms_nv_total")).if_empty(cached.total.to_string()),
        "sms_capacity_used": text(cap.get("sms_nv_rev_total")).if_empty(cached.received.to_string()),
        "firmware_label": first_text(&d, &["web_version", "wa_inner_version"]).if_empty(text(s.get("web_version"))),
        "fetched_at": now_text()
    }))
}

trait IfEmpty {
    fn if_empty(self, other: String) -> String;
}
impl IfEmpty for String {
    fn if_empty(self, other: String) -> String {
        if self.is_empty() { other } else { self }
    }
}

/* ------------------------------------------------------------------ */
/* 短信                                                                 */
/* ------------------------------------------------------------------ */

fn sms_path(mem: u32, tags: u32, page: u32, size: u32) -> String {
    format!(
        "/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=sms_data_total&page={}&data_per_page={}&mem_store={}&tags={}&order_by=order%20by%20id%20desc",
        page, size, mem, tags
    )
}

fn parse_sms_date(raw: &str) -> String {
    let head = raw.split('+').next().unwrap_or("").trim();
    let p: Vec<&str> = head
        .split(|c| c == ',' || c == ';')
        .map(|x| x.trim())
        .collect();
    if p.len() < 6 {
        return raw.to_string();
    }
    let yy: i32 = p[0].parse().unwrap_or(0);
    let year = if yy > 70 { 1900 + yy } else { 2000 + yy };
    format!(
        "{:04}-{:0>2}-{:0>2} {:0>2}:{:0>2}:{:0>2}",
        year, p[1], p[2], p[3], p[4], p[5]
    )
}

fn decode_sms_content(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    match base64::engine::general_purpose::STANDARD.decode(raw) {
        Ok(b) => String::from_utf8_lossy(&b).to_string(),
        Err(_) => raw.to_string(),
    }
}

async fn fetch_sms(state: &AppState, path: &str) -> Result<Vec<Value>, String> {
    let v = get_authed_path(state, path).await?;
    Ok(v.get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default())
}

pub async fn get_sms(state: &AppState) -> Result<Value, String> {
    let mut raw = fetch_sms(state, &sms_path(1, 100, 0, 100)).await?;
    let mut source = "SIM / 全部";
    if raw.is_empty() {
        let fb = fetch_sms(state, &sms_path(0, 10, 0, 100)).await?;
        if !fb.is_empty() {
            raw = fb;
            source = "设备 / 全部";
        }
    }
    let mut messages: Vec<Value> = raw
        .iter()
        .map(|m| {
            let id = text(m.get("id"));
            let date_raw = text(m.get("date"));
            let tag = text(m.get("tag"));
            let content_raw = text(m.get("content"));
            json!({
                "id": id,
                "number": text(m.get("number")),
                "local_number": text(m.get("local_number")),
                "content": decode_sms_content(&content_raw),
                "date_raw": date_raw,
                "date": parse_sms_date(&date_raw),
                "tag": tag,
                "unread": tag == "1",
                "store": source
            })
        })
        .collect();
    messages.sort_by(|a, b| {
        let x = text(b.get("id")).parse::<u64>().unwrap_or(0);
        let y = text(a.get("id")).parse::<u64>().unwrap_or(0);
        x.cmp(&y)
    });
    let unread = messages
        .iter()
        .filter(|m| m["unread"].as_bool().unwrap_or(false))
        .count();

    let cap = cmd_authed(state, &state.cmds.sms_capacity)
        .await
        .unwrap_or_else(|_| json!({}));
    let cache = CapacityCache {
        total: num(cap.get("sms_nv_total"), 0.0) as u64,
        received: num(cap.get("sms_nv_rev_total"), 0.0) as u64,
        sent: num(cap.get("sms_nv_send_total"), 0.0) as u64,
        draft: num(cap.get("sms_nv_draftbox_total"), 0.0) as u64,
        sim_total: num(cap.get("sms_sim_total"), 0.0) as u64,
    };
    *state.capacity.lock().await = cache.clone();
    Ok(json!({
        "ok": true,
        "messages": messages,
        "unread": unread,
        "capacity": {
            "total": cache.total, "received": cache.received, "sent": cache.sent,
            "draft": cache.draft, "sim_total": cache.sim_total
        },
        "source": source
    }))
}

/* ------------------------------------------------------------------ */
/* 写操作                                                              */
/* ------------------------------------------------------------------ */

pub async fn send_sms(state: &AppState, number: &str, content: &str) -> Result<Value, String> {
    let lowercase = state.config.read().await.sms_hex_lowercase;
    let body = encode_sms_body(content, lowercase);
    let form = vec![
        ("goformId".into(), "SEND_SMS".into()),
        ("notCallback".into(), "true".into()),
        ("Number".into(), number.to_string()),
        ("sms_time".into(), sms_time_string()),
        ("MessageBody".into(), body),
        ("ID".into(), "-1".into()),
        ("encode_type".into(), "UNICODE".into()),
    ];
    let r = post_goform(state, &form).await?;
    Ok(json!({ "ok": result_ok(&r), "raw": r }))
}

pub async fn delete_sms(state: &AppState, ids: &[String]) -> Result<Value, String> {
    let msg_id = if ids.is_empty() { String::new() } else { format!("{};", ids.join(";")) };
    let form = vec![
        ("goformId".into(), "DELETE_SMS".into()),
        ("notCallback".into(), "true".into()),
        ("msg_id".into(), msg_id),
    ];
    let r = post_goform(state, &form).await?;
    Ok(json!({ "ok": result_ok(&r), "raw": r }))
}

pub async fn mark_sms_read(state: &AppState, ids: &[String]) -> Result<Value, String> {
    let msg_id = if ids.is_empty() { String::new() } else { format!("{};", ids.join(";")) };
    let form = vec![
        ("goformId".into(), "SET_MSG_READ".into()),
        ("msg_id".into(), msg_id),
        ("tag".into(), "0".into()),
    ];
    let r = post_goform(state, &form).await?;
    Ok(json!({ "ok": result_ok(&r), "raw": r }))
}

pub async fn set_network_mode(state: &AppState, mode: &str) -> Result<Value, String> {
    let valid = state.proto["network_modes"]
        .as_array()
        .map(|a| a.iter().any(|m| m["value"].as_str() == Some(mode)))
        .unwrap_or(false);
    if !valid {
        return Err("未知网络模式".into());
    }
    let form = vec![
        ("goformId".into(), "SET_BEARER_PREFERENCE".into()),
        ("BearerPreference".into(), mode.to_string()),
    ];
    let r = post_goform(state, &form).await?;
    Ok(json!({ "ok": result_ok(&r), "raw": r }))
}

pub async fn set_mobile_data(state: &AppState, enabled: bool) -> Result<Value, String> {
    let form = vec![
        ("goformId".into(), if enabled { "CONNECT_NETWORK" } else { "DISCONNECT_NETWORK" }.into()),
        ("notCallback".into(), "true".into()),
    ];
    let r = post_goform(state, &form).await?;
    Ok(json!({ "ok": result_ok(&r), "raw": r }))
}

/* ------------------------------------------------------------------ */
/* 通知 / 诊断                                                          */
/* ------------------------------------------------------------------ */

pub async fn send_notification(
    state: &AppState,
    title: &str,
    body: &str,
    url_override: &str,
    force: bool,
) -> Result<Value, String> {
    let cfg = state.config.read().await.clone();
    if !force && (!cfg.notify_enabled || cfg.notify_url.is_empty()) {
        return Ok(json!({ "ok": false, "skipped": true, "error": "未启用通知或未配置地址" }));
    }
    let url = if url_override.is_empty() { cfg.notify_url.clone() } else { url_override.to_string() };
    if url.is_empty() {
        return Ok(json!({ "ok": false, "error": "通知地址为空" }));
    }
    let result = if url.contains("{title}") || url.contains("{body}") {
        let u = url
            .replace("{title}", &urlencoding_percent(title))
            .replace("{body}", &urlencoding_percent(body));
        state.client.get(&u).send().await.map(|r| r.status().is_success())
    } else {
        let payload = json!({ "title": title, "body": body, "source": "F50_Pro_Monitor" });
        state.client.post(&url).json(&payload).send().await.map(|r| r.status().is_success())
    };
    match result {
        Ok(ok) => Ok(json!({ "ok": ok })),
        Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
    }
}

fn urlencoding_percent(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(b) {
            out.push(*b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub async fn diagnose(state: &AppState) -> Value {
    let cases: Vec<(&str, String)> = vec![
        ("登录保护状态", state.cmds.lock.clone()),
        ("版本信息(AD 依据)", state.cmds.versions.clone()),
        ("RD 挑战值", state.cmds.rd.clone()),
        ("主状态轮询", state.cmds.main.clone()),
        ("NR 小区 dump", state.cmds.dump.clone()),
        ("短信容量", state.cmds.sms_capacity.clone()),
        ("登录状态", state.cmds.loginfo.clone()),
    ];
    let _ = ensure_login(state).await;
    let mut items: Vec<Value> = Vec::new();
    for (name, q) in cases {
        match cmd_get(state, &q).await {
            Ok(d) => items.push(json!({
                "name": name, "ok": true, "cmd": q,
                "keys": d.as_object().map(|m| m.len()).unwrap_or(0),
                "sample": serde_json::to_string(&d).unwrap_or_default().chars().take(700).collect::<String>()
            })),
            Err(e) => items.push(json!({ "name": name, "ok": false, "cmd": q, "keys": 0, "sample": e })),
        }
    }
    let p = sms_path(1, 100, 0, 100);
    match fetch_sms(state, &p).await {
        Ok(v) => items.push(json!({ "name": "短信列表(原生 80)", "ok": true, "cmd": p, "keys": v.len(), "sample": format!("返回 {} 条", v.len()) })),
        Err(e) => items.push(json!({ "name": "短信列表(原生 80)", "ok": false, "cmd": p, "keys": 0, "sample": e })),
    }
    json!({
        "base_url": base(state).await,
        "logged_in": *state.logged_in.lock().await,
        "cookie": "由 reqwest CookieStore 自动维护",
        "items": items
    })
}
