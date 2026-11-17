// 隐藏 Windows 控制台窗口（发布版）；开发时设置环境变量 F50_SHOW_CONSOLE=1 可显示。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    f50_pro_monitor_lib::run();
}
