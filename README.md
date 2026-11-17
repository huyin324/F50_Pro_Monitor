# F50 Pro Monitor

> 面向 **中兴 F50 Pro（MU3356 / 固件 F50ProV1.0.0B28）** 的桌面监控工具。
> 通过设备原生 80 端口 `goform` 接口，实时查看速率、信号、流量、短信与硬件状态。
> **Tauri 2（Rust）+ Vue 3 + Vite 5**，同时提供原生窗口版与浏览器预览版。

**版本 V1.0.1** · 仅面向自有设备的只读监控与学习研究 · 使用前请阅读[免责声明](#四免责声明)

参考项目：[koldllc/f50-monitor](https://github.com/koldllc/f50-monitor)（原版）、
[machao2024/F50PRO-monitor](https://github.com/machao2024/F50PRO-monitor)、
[Curtion/zte-f50-pro-sms-notice](https://github.com/Curtion/zte-f50-pro-sms-notice)、
[againrivers/zte-f50pro-b28-root](https://github.com/againrivers/zte-f50pro-b28-root)、
[Tai1win10c/zte-f50pro-macos-toolkit](https://github.com/Tai1win10c/zte-f50pro-macos-toolkit)。

---

## 一、功能一览

| 模块 | 已实现能力 |
|---|---|
| **实时速率** | 1 秒轮询 `flux_realtime_*_thrpt` + 贝塞尔平滑波形；单位与设备 Web 管理端一致（`b/s → Kb/s → Mb/s → Gb/s → Tb/s`），同时显示原始 B/s |
| **蜂窝信号** | 制式 / 信号格 / RSRP / RSRQ / SINR / 频段（n41）/ 带宽 / PLMN / 小区 ID / PCI / ARFCN / TAC / AMBR 签约速率 |
| **硬件与连接** | `ppp_status`、调制解调器状态、SIM 卡与 PIN、Wi-Fi 开关 / SSID / 接入数、CPU 温度、供电、漫游、WAN/LAN IP、会话时长 |
| **流量与套餐** | 本月下载 / 上传 / 合计、今日用量、本次连接、账单日与重置倒计时；**本机自定义月度额度**（GB/MB/TB、预警阈值、进度条、剩余量、超额提示），额度不写入设备 |
| **短信** | 收件箱、未读角标、Base64(UTF-8) 中文解码、日期解析、验证码一键提取复制、发送 / 删除 / 标记已读（均需二次确认） |
| **设备信息** | 右上角 ⓘ 弹窗：SIM 卡号、ICCID、IMSI、IMEI（含卡槽 2）、固件 / 基带 / 硬件版本、型号、市场名称、运营商、IP/MAC、小区信息、短信容量；支持脱敏显示与一键复制 |
| **提醒** | 新短信到达时**任务栏闪烁 + 窗口/托盘图标红色跳动**（窗口最小化或失焦时），重新聚焦自动恢复；Bark / 通用 Webhook 转发；流量超额预警 |
| **运维** | 8 项只读接口自检、运行日志、导出中文与 SMB/UNC 路径、系统托盘、开机自启、一键打开设备后台 |
| **设置** | 主题、刷新间隔、通知地址、日志行数、**恢复默认**（二次确认）、**测试连接**（填密码立即重连）、图标提醒开关 |
<img width="1806" height="1185" alt="工具截图" src="https://github.com/user-attachments/assets/1cb3cddd-f02c-40bb-869f-20620eb89ef1" />


---

## 二、技术特点

1. **双后端、同一份协议常量**：Rust/Tauri 后端与 Node/Vite 中间件后端共用 `protocol.json`，命令名、字段派生、单位换算完全一致。原生窗口与浏览器预览功能等价，仅窗口载体不同。
2. **逐项修正原版在 F50 Pro 上的失效点**（详见[技术文档](docs/TECHNICAL.md)）：
   - 原版依赖 **2333 端口 UFI 代理**取短信（需 APK 内嵌密钥）与 **5555 ADB** 取硬件状态；F50 Pro 两个端口均未开放 → 改为 80 端口原生 `sms_data_total` 与主状态字段。
   - B28 固件在合并请求中显式出现 `Nr_* / plmn / sms_nv_*` 等 dump 键时会**清空**对应字段 → `network_information`、`sms_capacity_info` 拆成独立请求。
   - 固件 `util.js` 的 SHA256 输出为**大写十六进制**，内层大写结果原样参与外层拼接；小写会被判密码错误并消耗 `psw_fail_num_str`。
   - 实时速率原始量纲是 **B/s**，按 web 的 `transUnit(x, true)` ×8 转比特、1024 进制显示；`formatBandwidth` 只用于 AMBR 签约速率。
3. **设备安全优先**：登录前读取 `psw_fail_num_str` / `login_lock_time`，剩余次数不足或锁定中直接放弃；**密码为空时绝不发送 LOGIN**（避免恢复默认后轮询把账户锁死）；会话约 10 分钟过期，用 `loginfo` 检测并重新登录，失败不盲目重试。
4. **保存即连**：新增 `reconnect` 命令，配置变更后清会话 → 强制重新登录 → 立即取状态，绕开轮询的 `refreshing` 锁，不等下一次刷新。
5. **原生系统能力**：`request_user_attention(Critical)` 实现 Windows 任务栏持续闪烁；嵌入两组原始 RGBA 图标，以 450ms 在窗口 / 托盘图标间交替切换实现「变色 / 跳动」。浏览器模式用标题闪烁 + 红色 favicon 兜底。
6. **GUI 面向非程序员**：表单化设置、危险操作二次确认、运行日志、进度条、√ 勾选、浅 / 深主题；`.bat` 启动脚本统一 **CRLF + GBK + 无 BOM**，规避 cmd.exe 中文乱码与裸 LF 导致 `goto` 失效的陷阱。
7. **只读优先**：默认只做只读轮询；月度套餐额度只保存在本机，不修改设备任何配置。

---

## 三、使用方式（常见操作系统）

| 操作系统 | 原生窗口版 | 浏览器预览版 |
|---|---|---|
| **Windows 10 / 11 x86_64** | ✅ 推荐（需 WebView2 Runtime，Win10/11 通常自带） | ✅ |
| Windows ARM64 | ❌ 未提供构建 | ✅ |
| Linux x86_64 / ARM64 | ❌ Tauri 端未适配 | ✅ Node.js 18+ |
| macOS Intel / Apple Silicon | ❌ Tauri 端未适配 | ✅ Node.js 18+ |
| 其他平台 | — | 需 Node.js 18+，且本机可访问设备 80 端口 |

### Windows：开箱即用（推荐）

从 **Releases** 下载 `F50_Pro_Monitor_v1.0.1_Windows_x64_runtime.zip`，解压到任意目录后：

- 双击 **`运行原生版.bat`**（或 `native.bat`）启动原生窗口 + 系统托盘，**无需安装 Node / Rust**；
- `F50_Pro_Monitor.exe` 必须与 `WebView2Loader.dll` 放在**同一目录**；
- 或双击 **`一键启动.bat`**（或 `start.bat`）走浏览器模式，自动打开 `http://127.0.0.1:1420`。

> 首次启动或点过「恢复默认」后，**默认登录密码为空**。在「设置 → 设备连接」填入本机 Web 管理密码，按回车、离开输入框或点「测试连接」即会立即保存并连接，设置面板直接显示 ✓ / ✗ 结果，无需等待轮询，也无需先关闭设置窗口。

### Linux / macOS / 其他平台：浏览器预览模式

```bash
cd F50_Pro_Monitor
npm install          # 需要 Node.js 18+
npm run dev           # 等价于 node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1420
# 浏览器打开 http://127.0.0.1:1420
```

`server/vitePlugin.js` 把 `/api/<cmd>` 转发到 `server/api.js`，由 Node 直接访问设备，因此**没有 CORS 限制**；功能与原生版一致。若设备不在 `192.168.0.1`，在设置里修改 Web 管理地址即可（不要带 `/#home` 等片段）。

> Release 的 runtime 压缩包已内置 `node_modules`，解压后即使没有 Node 也能跑浏览器模式（需系统已装 Node.js 18+ 来执行 `node`）；Linux / macOS 请使用源码包自行 `npm install`。

### 开发者：从源码构建

| 路线 | 环境 | 命令 |
|---|---|---|
| Tauri 官方 MSVC 路线 | Windows + VS 2022「使用 C++ 的桌面开发」+ Windows SDK + Rust `stable-x86_64-pc-windows-msvc` | `npm install && npm run tauri:build`（脚本已带 `--no-bundle --features custom-protocol`） |
| MinGW GNU 路线（本项目实测） | Windows + MinGW-w64 + Rust `stable-x86_64-pc-windows-gnu`；中文用户名需把工具链放到纯 ASCII 路径 | `构建原生版_本机GNU.bat` / `build_native_gnu.bat` |

> ⚠️ **生产构建必须带 `--features custom-protocol`**：未启用时 `tauri-build::is_dev()` 返回 true，窗口会去加载 `build.devUrl` 而显示 `ERR_CONNECTION_REFUSED`。`tauri dev` 则**不**带该 feature，以保留 Vite HMR。

---

## 四、免责声明

1. **非官方项目**：本项目与中兴通讯（ZTE）及任何运营商没有隶属、授权或背书关系。「F50 Pro」「MU3356」等名称仅用于说明适配机型，商标与品牌归各自所有者所有。
2. **使用范围**：仅供个人在**自己合法拥有或已获授权管理**的设备上进行只读状态监控与学习研究。请遵守所在地法律法规、设备保修条款与运营商服务协议；**不得用于未授权访问他人设备**。
3. **协议来源**：接口字段与鉴权方式来自设备公开 Web 前端脚本及公开开源项目，仅用于兼容性适配；不绕过任何访问控制、不破解固件、不提取或分发任何密钥。
4. **写操作风险**：「发送 / 删除短信、切换网络模式、开关移动数据」等写操作虽统一二次确认，但一旦由使用者确认执行，可能产生短信费用、改变联网状态或影响设备配置，风险由使用者自行承担。本项目**未对这些写操作做真机下发验证**，请在测试设备上自行确认后再使用。
5. **隐私与数据**：登录密码以**明文**保存在本机配置（`%APPDATA%\F50_Pro_Monitor\config.json`，预览模式为 `.runtime/config.json`）。**请勿上传该配置文件、运行日志、短信导出、界面截图，或任何含真实手机号 / IMSI / ICCID / IMEI / 短信正文的内容**；对外分享前请先脱敏。本仓库与 Release 资产均**不含任何用户数据**。
6. **不改动设备**：默认只读轮询，不会修改设备密码、IP、网络配置，也不会重启设备；月度套餐额度仅保存在本机。
7. **按「现状」提供**：本软件不提供任何明示或暗示的担保，包括但不限于适销性、特定用途适用性与不侵权。作者及贡献者不对因使用或无法使用本软件导致的数据丢失、设备异常、账户锁定、资费产生、服务中断或任何间接损失承担责任。
8. **固件差异**：验证基于 `F50ProV1.0.0B28`，其他固件版本接口可能不同；请先用内置「接口自检」确认 8 项全部通过再使用。

---

## 文档与目录

- [技术文档：协议细节、根因定位、真机验证、构建环境踩坑](docs/TECHNICAL.md)
- `protocol.json`：两端共用的协议常量（命令分组 / 单位 / 网络模式 / 状态码）
- `server/`：Node 预览后端与 `/api` 中间件 · `src-tauri/`：Rust/Tauri 原生后端 · `src/`：Vue 3 前端
- `scripts/make_launchers.py`：生成 CRLF + GBK 的 `.bat` · `scripts/make_icons.py`：生成应用图标
- `dist/`：`npm run build` 产物（原生 exe 编译时内嵌）
