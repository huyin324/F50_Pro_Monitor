// 配置持久化：%APPDATA%\F50_Pro_Monitor\config.json（UTF-8，支持中文路径）
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub base_url: String,
    pub password: String,
    pub refresh_ms: u64,
    pub sms_refresh_ms: u64,
    pub monthly_quota_gb: f64,
    pub quota_unit: String,
    pub quota_reset_day: u32,
    pub quota_auto_reset: bool,
    pub quota_warn_pct: f64,
    pub quota_enabled: bool,
    pub theme: String,
    pub sms_hex_lowercase: bool,
    pub notify_enabled: bool,
    pub notify_url: String,
    pub notify_new_sms: bool,
    pub sms_icon_alert: bool,
    pub launch_at_login: bool,
    pub minimize_to_tray: bool,
    pub log_max_lines: usize,
    pub export_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            base_url: "http://192.168.0.1".into(),
            // 默认登录密码为空：首次使用需在「设置」里填写本机管理口令。
            // 用户级配置以明文保存在 %APPDATA%\F50_Pro_Monitor\config.json，请勿提交到公开仓库。
            password: String::new(),
            refresh_ms: 1000,
            sms_refresh_ms: 10000,
            monthly_quota_gb: 0.0,
            quota_unit: "GB".into(),
            quota_reset_day: 1,
            quota_auto_reset: true,
            quota_warn_pct: 80.0,
            quota_enabled: true,
            theme: "light".into(),
            sms_hex_lowercase: false,
            notify_enabled: false,
            notify_url: String::new(),
            notify_new_sms: true,
            sms_icon_alert: true,
            launch_at_login: false,
            minimize_to_tray: true,
            log_max_lines: 300,
            export_dir: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrafficState {
    pub date: String,
    pub baseline: u64,
    pub last_seen: u64,
    pub last_seen_at: i64,
}

pub fn config_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = base.join("F50_Pro_Monitor");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn load_config() -> Config {
    let p = config_dir().join("config.json");
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save_config(cfg: &Config) -> Result<(), String> {
    let p = config_dir().join("config.json");
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(p, s).map_err(|e| e.to_string())
}

/// 清除本机配置并恢复默认参数（默认地址 http://192.168.0.1、默认密码为空）。
/// 同时清掉流量基线，避免恢复默认后仍沿用旧账单周期；不会触碰设备。
pub fn reset_config() -> Result<Config, String> {
    let dir = config_dir();
    let cfg = Config::default();
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(dir.join("config.json"), s).map_err(|e| format!("写入默认配置失败: {}", e))?;
    // traffic.json 是本地流量基线缓存，属于配置的一部分，一并清除。
    let _ = fs::remove_file(dir.join("traffic.json"));
    Ok(cfg)
}

pub fn load_traffic() -> TrafficState {
    let p = config_dir().join("traffic.json");
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => TrafficState::default(),
    }
}

pub fn save_traffic(t: &TrafficState) {
    let p = config_dir().join("traffic.json");
    if let Ok(s) = serde_json::to_string_pretty(t) {
        let _ = fs::write(p, s);
    }
}
