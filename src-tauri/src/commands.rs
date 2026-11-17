//! Tauri IPC 命令层：与 server/api.js 的命令名、参数名、返回结构一一对应。
use crate::client::{self, AppState};
use crate::config::{self, Config};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;

#[cfg(windows)]
fn hidden_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new(program);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW，避免闪黑框
    c
}
#[cfg(not(windows))]
fn hidden_command(program: &str) -> std::process::Command {
    std::process::Command::new(program)
}

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "F50_Pro_Monitor";

#[tauri::command]
pub async fn get_config(state: State<'_, Arc<AppState>>) -> Result<Config, String> {
    Ok(state.config.read().await.clone())
}

#[tauri::command]
pub async fn save_config(cfg: Config, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    config::save_config(&cfg)?;
    *state.config.write().await = cfg;
    *state.logged_in.lock().await = false; // 地址/密码变更后强制重新登录
    let _ = set_autostart_impl(state.config.read().await.launch_at_login);
    Ok(json!({ "ok": true }))
}

/// 保存配置 / 填写密码后【立即】重新连接：清会话 → 强制重新登录 → 取一次状态。
/// 不等 1 秒轮询，也不受前端 refreshing 锁影响。
#[tauri::command]
pub async fn reconnect(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    *state.logged_in.lock().await = false;
    match client::login(state.inner()).await {
        Ok(()) => Ok(client::get_status(state.inner()).await),
        Err(e) => Ok(json!({
            "online": false,
            "need_config": e.contains("尚未设置 Web 登录密码"),
            "error": e
        })),
    }
}

/// 恢复默认：清除本机配置文件与流量基线，重置内存态并强制重新登录。
/// 只影响本机，不向设备下发任何指令。
#[tauri::command]
pub async fn reset_config(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    let cfg = config::reset_config()?;
    *state.config.write().await = cfg.clone();
    *state.traffic.lock().await = config::TrafficState::default();
    *state.capacity.lock().await = client::CapacityCache::default();
    *state.logged_in.lock().await = false;
    // 默认 launch_at_login=false，顺手移除可能存在的开机自启项（不存在时忽略报错）。
    let _ = set_autostart_impl(false);
    Ok(json!({ "ok": true, "config": cfg }))
}

#[tauri::command]
pub async fn get_status(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(client::get_status(state.inner()).await)
}

#[tauri::command]
pub async fn get_device_info(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::get_device_info(state.inner()).await
}

#[tauri::command]
pub async fn get_sms(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::get_sms(state.inner()).await
}

#[tauri::command]
pub async fn send_sms(number: String, content: String, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::send_sms(state.inner(), &number, &content).await
}

#[tauri::command]
pub async fn delete_sms(ids: Vec<String>, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::delete_sms(state.inner(), &ids).await
}

#[tauri::command]
pub async fn mark_sms_read(ids: Vec<String>, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::mark_sms_read(state.inner(), &ids).await
}

#[tauri::command]
pub async fn set_network_mode(mode: String, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::set_network_mode(state.inner(), &mode).await
}

#[tauri::command]
pub async fn set_mobile_data(enabled: bool, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    client::set_mobile_data(state.inner(), enabled).await
}

#[tauri::command]
pub async fn diagnose(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    Ok(client::diagnose(state.inner()).await)
}

#[tauri::command]
pub async fn send_notification(
    title: String,
    body: String,
    url: Option<String>,
    force: Option<bool>,
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    client::send_notification(
        state.inner(),
        &title,
        &body,
        url.as_deref().unwrap_or(""),
        force.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn export_file(path: String, content: String) -> Result<Value, String> {
    // std::fs 原生支持中文路径与 UNC/SMB 网络磁盘路径（\\host\share\...）
    let bytes = content.as_bytes().len();
    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("写入失败: {}（路径: {}）", e, path))?;
    Ok(json!({ "ok": true, "bytes": bytes }))
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<Value, String> {
    let _ = hidden_command("cmd")
        .args(["/C", "start", "", &url])
        .status();
    Ok(json!({ "ok": true }))
}

fn set_autostart_impl(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let status = if enabled {
        let value = format!("\"{}\" --autostart", exe);
        hidden_command("reg")
            .args(["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", &value, "/f"])
            .status()
    } else {
        hidden_command("reg")
            .args(["delete", RUN_KEY, "/v", RUN_NAME, "/f"])
            .status()
    };
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("注册表操作失败（开机自启）".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<Value, String> {
    set_autostart_impl(enabled)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn get_autostart() -> Result<bool, String> {
    Ok(hidden_command("reg")
        .args(["query", RUN_KEY, "/v", RUN_NAME])
        .status()
        .map(|s| s.success())
        .unwrap_or(false))
}

#[tauri::command]
pub async fn pick_folder() -> Result<Value, String> {
    // 前端优先使用 @tauri-apps/plugin-dialog 的原生对话框；此处返回提示信息作为兜底。
    Ok(json!({ "ok": false, "path": Value::Null, "message": "请使用原生目录选择对话框" }))
}
