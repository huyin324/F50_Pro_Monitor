//! 新短信到达时的醒目图标提醒（对标微信 PC 端来消息）
//!
//! - 任务栏：`request_user_attention(Critical)`，Windows 会持续闪烁窗口与任务栏按钮
//!   直到应用重新获得焦点（等价于 FlashWindowEx 的 FLASHW_ALL | FLASHW_TIMERNOFG）。
//! - 图标「变色 / 跳动」：窗口图标、任务栏图标与系统托盘图标在「正常图标」和
//!   「红色告警图标」之间以 450ms 间隔交替切换，形成跳动效果。
//! - 窗口重新获得焦点、用户点击托盘、或前端 focus 事件都会调用 `clear_all` 立即恢复。
//!
//! 该能力只在 Tauri 原生窗口可用；浏览器预览模式由前端用标题闪烁 + 红色 favicon 兜底。

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, UserAttentionType};

pub const TRAY_ID: &str = "f50-main";
const WINDOW_ID: &str = "main";

// 直接嵌入原始 RGBA（32×32×4），避免依赖 tauri 的 image-png feature。
const ICON_NORMAL: &[u8] = include_bytes!("../icons/32x32.rgba");
const ICON_ALERT: &[u8] = include_bytes!("../icons/32x32-alert.rgba");
const ICON_W: u32 = 32;
const ICON_H: u32 = 32;

fn icon(bytes: &[u8]) -> tauri::image::Image<'static> {
    tauri::image::Image::new_owned(bytes.to_vec(), ICON_W, ICON_H)
}

const BLINK_MS: u64 = 450;
const MAX_BLINKS: u32 = 240; // 最多约 108 秒，避免用户离开后一直跳动

#[derive(Default)]
pub struct AlertState {
    active: AtomicBool,
    generation: AtomicU64,
}

/// 恢复常态：正常图标 + 取消任务栏闪烁。
fn restore(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(icon(ICON_NORMAL)));
    }
    if let Some(w) = app.get_webview_window(WINDOW_ID) {
        let _ = w.set_icon(icon(ICON_NORMAL));
        let _ = w.request_user_attention(None);
    }
}

/// 停止跳动并恢复图标（供托盘点击、focus 事件与命令共用）。
pub fn clear_all(app: &AppHandle) {
    let state = app.state::<Arc<AlertState>>();
    state.active.store(false, Ordering::SeqCst);
    state.generation.fetch_add(1, Ordering::SeqCst);
    restore(app);
}

#[tauri::command]
pub fn notify_new_sms(
    count: Option<u32>,
    preview: Option<String>,
    app: AppHandle,
) -> Result<Value, String> {
    let w = app
        .get_webview_window(WINDOW_ID)
        .ok_or_else(|| "找不到主窗口".to_string())?;
    let minimized = w.is_minimized().unwrap_or(false);
    let focused = w.is_focused().unwrap_or(false);
    // 窗口在前台且已获得焦点时不需要图标提醒（界面本身就能看到新短信）。
    if !minimized && focused {
        return Ok(json!({ "ok": true, "skipped": true, "reason": "window focused" }));
    }
    let n = count.unwrap_or(1);
    let _ = preview; // 预留给后续托盘气泡 / Toast

    // 1) 任务栏与窗口持续闪烁，直到用户把窗口切回前台
    let _ = w.request_user_attention(Some(UserAttentionType::Critical));

    // 2) 立刻把窗口/任务栏图标换成红色告警版
    let _ = w.set_icon(icon(ICON_ALERT));
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(icon(ICON_ALERT)));
    }

    // 3) 后台线程交替切换托盘 / 任务栏图标，形成「跳动」；聚焦或超时后自动恢复
    let state: Arc<AlertState> = app.state::<Arc<AlertState>>().inner().clone();
    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.active.store(true, Ordering::SeqCst);
    let handle = app.clone();
    std::thread::spawn(move || {
        for i in 0..MAX_BLINKS {
            if !state.active.load(Ordering::SeqCst)
                || state.generation.load(Ordering::SeqCst) != gen
            {
                // 已被 clear_all 取消，或已有新一轮提醒接管，交给新线程处理图标。
                return;
            }
            std::thread::sleep(Duration::from_millis(BLINK_MS));
            let is_focused = handle
                .get_webview_window(WINDOW_ID)
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false);
            if is_focused {
                break;
            }
            let bytes = if i % 2 == 0 { ICON_NORMAL } else { ICON_ALERT };
            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                let _ = tray.set_icon(Some(icon(bytes)));
            }
            if let Some(w) = handle.get_webview_window(WINDOW_ID) {
                let _ = w.set_icon(icon(bytes));
            }
        }
        if state.generation.load(Ordering::SeqCst) == gen {
            state.active.store(false, Ordering::SeqCst);
            restore(&handle);
        }
    });

    Ok(json!({ "ok": true, "skipped": false, "count": n, "minimized": minimized }))
}

#[tauri::command]
pub fn clear_new_sms_alert(app: AppHandle) -> Result<Value, String> {
    clear_all(&app);
    Ok(json!({ "ok": true }))
}
