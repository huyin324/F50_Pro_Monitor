// get_status / get_device_info 使用较大的 serde_json::json! 字面量，
// 默认递归上限 128 不足以展开，需提升到 512。
#![recursion_limit = "512"]

pub mod alert;
pub mod client;
pub mod commands;
pub mod config;
pub mod crypto;

use std::sync::Arc;
use tauri::{Manager, Wry};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial = config::load_config();
    let state = Arc::new(client::AppState::new(initial));

    tauri::Builder::<Wry>::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            // 新短信图标提醒的共享状态（活跃标记 + 代数，用于终止旧的跳动线程）
            app.manage(Arc::new(alert::AlertState::default()));
            let handle = app.handle();
            let show = MenuItem::with_id(handle, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(handle, &[&show, &quit])?;

            let mut builder = TrayIconBuilder::with_id(alert::TRAY_ID)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        // 点击托盘视为「已读」：停止跳动并恢复正常图标
                        alert::clear_all(tray.app_handle());
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::reset_config,
            commands::reconnect,
            alert::notify_new_sms,
            alert::clear_new_sms_alert,
            commands::get_status,
            commands::get_device_info,
            commands::get_sms,
            commands::send_sms,
            commands::delete_sms,
            commands::mark_sms_read,
            commands::set_network_mode,
            commands::set_mobile_data,
            commands::diagnose,
            commands::send_notification,
            commands::export_file,
            commands::open_url,
            commands::set_autostart,
            commands::get_autostart,
            commands::pick_folder
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
