# F50 Pro Monitor · 技术文档

> 协议细节、原版失效根因、真机验证结果与构建环境踩坑记录。
> 面向使用者的功能介绍、多系统用法与免责声明请见 [项目主页 README](../README.md)。

面向 **中兴 F50 Pro（MU3356 / 固件 F50ProV1.0.0B28）** 的 Windows x86_64 桌面监控工具。
技术栈与原版 Windows 端一致：**Tauri 2（Rust）+ Vue 3 + Vite**。

参考项目：[koldllc/f50-monitor](https://github.com/koldllc/f50-monitor)（原版）、
[machao2024/F50PRO-monitor](https://github.com/machao2024/F50PRO-monitor)、
[Curtion/zte-f50-pro-sms-notice](https://github.com/Curtion/zte-f50-pro-sms-notice)、
[againrivers/zte-f50pro-b28-root](https://github.com/againrivers/zte-f50pro-b28-root)、
[Tai1win10c/zte-f50pro-macos-toolkit](https://github.com/Tai1win10c/zte-f50pro-macos-toolkit)。

> 默认设备地址 `http://192.168.0.1`，**默认登录密码为空**（首次使用需在设置中填写，代码中不内置任何真实口令）。
> 所有探测与验证均在**只读**前提下完成，未修改设备密码、IP、网络配置，也未重启设备。

---

## 一、原版在 F50 Pro 上失效的根因（逐项定位）

| # | 现象 | 根因 | 本工具修复方案 |
|---|---|---|---|
| 1 | 无法查看短信 | 原版 Windows 端 `fetcher.rs` 从 **2333 端口 UFI 代理** `/api/goform/goform_get_cmd_process` 取短信；F50 Pro 未开放 2333，且 UFI 签名需 APK 内嵌密钥（`againrivers` 项目明确说明密钥不随仓库分发） | 改为 **80 端口原生** `/goform/goform_get_cmd_process?cmd=sms_data_total&mem_store=1&tags=100`，并保留 `mem_store=0&tags=10` 兜底；真机取回 6 条短信 |
| 2 | 无法获取硬件/连接状态 | 原版 CPU/内存/温度依赖 **5555 ADB** 与 2333 UFI；本机 F50 Pro 两个端口均关闭。且原版把 `nr_rsrp/nr_rsrq/Nr_snr/plmn` 等 dump 内部键与主状态一起显式请求 | 改为 80 端口读取 `ppp_status / mc_modem_main_state / sim_slot / wifi_access_sta_num / cpu_temperature / opms_wan_mode / wan_ipaddr` 等，并把 `network_information` **单独请求** |
| 3 | 信号与频段全部为空 | 真机验证：同一 GET 请求中若显式出现 `nr_rsrp`、`Nr_bands`、`plmn` 等 dump 键，B28 固件会把对应字段**清空**（`network_information` 单独请求返回 `nr_rsrp=-80`、`plmn=46015`；合并请求返回空串） | 拆分为「主轮询」+「NR 小区 dump」两次独立 GET；`protocol.json` 中记录该约束 |
| 4 | 登录偶发失败 / 账户被锁 | 固件 `js/util.js` 的 SHA256 输出为 **大写十六进制**，内层大写结果原样参与外层拼接；小写哈希会被判密码错误并消耗 `psw_fail_num_str` | `crypto.rs::sha256_upper`、`server/api.js::sha256Upper` 统一输出大写；登录前检查 `psw_fail_num_str / login_lock_time`，剩余次数 <3 或锁定中直接放弃，不盲目重试 |
| 5 | 速率单位与 web 不一致 | 原版把 `realtime_rx_thrpt` 当作字节/秒显示 `B/s / KB/s`；设备 web 首页实际用 `flux_realtime_*_thrpt`（**字节/秒**）经 `transUnit(x,true)` ×8 转比特、1024 进制显示 `b/s / Kb/s / Mb/s / Gb/s` | 见下方「速率单位」章节，前后端统一实现 web 的换算 |

---

## 二、功能清单

### 原版能力（已修复为 F50 Pro 可用）
- 实时下载/上传速率（1 秒刷新）+ 贝塞尔平滑波形；**单位与 Web 管理端完全一致**
- 蜂窝信号：制式、信号格、RSRP / RSRQ / SINR、频段 n41、带宽、PLMN、小区 ID / PCI / ARFCN / TAC、AMBR 签约速率
- 硬件 / 连接状态：数据连接 `ppp_status`、调制解调器状态、SIM 卡与 PIN、Wi-Fi 开关/SSID/接入数、CPU 温度、供电、漫游、WAN/LAN IP、会话时长
- 流量：本月下载/上传/合计、今日用量、本次连接、账单重置日与倒计时
- 短信：收件箱、未读角标、Base64(UTF-8) 解码、日期解析（`YY,MM,DD,HH,mm,ss,+0800`）、验证码一键提取复制、复制全文/号码
- 运营商标识、日志板块、自检诊断、开机自启、系统托盘、一键打开后台

### 本次新增
| 功能 | 说明 | 来源 / 需求 |
|---|---|---|
| **右上角 ⓘ 设备信息** | 分组展示 SIM 卡号、ICCID、IMSI、IMEI(含卡槽 2)、固件版本 `web_version`、软件内部版本、定制/基带版本、硬件版本、设备型号、市场名称、PLMN、运营商、PDP 类型、IP/MAC、小区信息、短信容量；支持脱敏显示与一键复制全部 | 本次需求 |
| **月度流量套餐额度** | 设置中填写额度（GB/MB/TB）、账单日（可跟随设备 `flux_clear_date`）、预警阈值；主界面显示进度条、已用/剩余/百分比、重置倒计时、超额提示；额度只存本机，**不修改设备配置** | 本次需求 |
| **速率实时刷新 + 单位对齐** | 1 秒轮询 `flux_realtime_*_thrpt`，按 web 的 `transUnit` 显示；同时展示原始 B/s 值 | 本次需求 |
| **设置内「恢复默认」** | 设置弹窗左下角新增「恢复默认」，点击后走二次确认；确认后清除本机配置文件与流量基线，恢复默认参数（Web 地址 `http://192.168.0.1`、**登录密码为空**、套餐/通知/导出目录/主题/自启全部重置）。只影响本机，不向设备下发指令 | 本次需求 |
| **填密码后立即连接** | 保存设置或在密码框按回车/失焦/点「测试连接」，都会立即清会话 → 强制重新登录 → 取一次状态，不等 1 秒轮询；密码为空时**绝不向设备发 LOGIN**，避免消耗 `psw_fail_num_str` 把账户锁死 | 用户反馈修复 |
| **新短信图标醒目提醒** | 窗口最小化或失焦时收到新短信：`request_user_attention(Critical)` 让任务栏按钮持续闪烁；窗口图标与系统托盘图标切换成红色告警图标并以 450ms 间隔跳动；窗口重新获得焦点/点击托盘后自动恢复。浏览器预览模式用标题闪烁 + 红色页签图标兜底，可在设置中开关，并有「测试图标提醒」按钮即时验证 | 本次需求 |
| 网络模式切换 | 自动 5G / NSA / SA / 仅 4G / 4G-3G / 仅 3G，`SET_BEARER_PREFERENCE` | F50PRO-monitor |
| 移动数据开关 | `CONNECT_NETWORK` / `DISCONNECT_NETWORK`，以 `ppp_status` 轮询结果为准 | F50PRO-monitor |
| 短信发送 / 删除 / 标记已读 | UTF-16BE 十六进制编码、`AD` 鉴权、`sms_time` 时区串 | zte-f50-pro-sms-notice / api.md |
| 新短信与流量预警转发 | Bark 占位符 URL 或通用 Webhook（企业微信机器人等），支持测试通知 | zte-f50-pro-sms-notice |
| 接口自检 | 一次性只读探测全部接口并展示原始响应片段，便于适配新固件 | 原版诊断思路 |
| √ 勾选样式 / 进度条 / 运行日志 / 应用 ICON | 按用户 GUI 规范实现；导出目录支持中文与 SMB/UNC 路径 | 用户规范 |

> **安全约定**：所有会改变设备状态的写操作（开关数据、切模式、发/删短信、标记已读）均需弹窗**二次确认**，默认不自动执行，并在运行日志留痕。
> B28 固件未通过 80 端口提供 `cpu_utility` / `mem_utility`，界面以 `--` 占位，**不伪造数据**。

---

## 三、快速开始

### 方式 A：一键启动（立即可用，无需 Rust）
双击 **`一键启动.bat`**（或 `start.bat`）。脚本会：
1. 检查 Node.js 18+；缺 `node_modules` 时自动执行 `npm install`；
2. 后台启动 Vite 开发服务器 `http://127.0.0.1:1420`（Node 中间件直连设备，无 CORS 限制）；
3. 自动打开默认浏览器。

此模式下 `server/api.js` 与 Rust 后端实现**同一套命令与字段**（共用 `protocol.json`），功能完全一致，仅窗口由浏览器承载。

### 方式 B：直接运行已编译的原生 exe（推荐）
项目根目录已附带编译好的 **`F50_Pro_Monitor.exe`**（28.4 MB，x86_64，release 优化构建）
与同目录的 **`WebView2Loader.dll`**（GNU 工具链产物的动态依赖，**两者必须放在同一目录**）。
双击 **`运行原生版.bat`**（或 `native.bat`）即可启动原生窗口 + 系统托盘，无需 Node、无需 Rust。
唯一外部依赖是 **WebView2 Runtime**（本机已装 `157.0.4341.46`；Win10/11 通常自带，缺失时程序会给出官方下载提示）。
若单独把 exe 拷到别处，请务必一并复制 `WebView2Loader.dll`，否则会启动失败。

> 平台说明：原生 exe 面向 **Windows 10/11 x86_64**；Linux / macOS / Windows ARM 请使用「方式 A」浏览器预览模式（Node 18+ 即可，后端 `server/api.js` 跨平台）。

> ⚠️ **默认登录密码为空**。首次启动（或点过「恢复默认」后）请在「设置 → 设备连接」里填入本机 Web 管理密码；**输入后按回车、离开输入框或点「测试连接」即会立即保存并连接**，也可直接点「保存设置」。密码为空时工具不会向设备发送任何 LOGIN 请求，因此不会消耗设备的剩余尝试次数。

### 方式 C：从源码重新构建

| 路线 | 适用环境 | 命令 | 产物 |
|---|---|---|---|
| 标准 MSVC（Tauri 官方路线） | 已装 VS 2022「使用 C++ 的桌面开发」+ Windows SDK | `构建可执行程序.bat` / `npm run tauri:build` | `src-tauri\target\release\f50-pro-monitor.exe`（`--no-bundle`，需安装包时去掉该参数并备好 NSIS/WiX） |
| 本机 GNU 工具链（**已实测通过**） | 本机中文用户名 + 无 MSVC，改用 MinGW-w64 | `构建原生版_本机GNU.bat` / `build_native_gnu.bat` | 项目根目录 `F50_Pro_Monitor.exe` + `WebView2Loader.dll` |

两条路线共用同一份 `src-tauri/` 源码与 `protocol.json`。GNU 脚本会先 `npm run build` 刷新 `dist/`，再执行
`cargo build --release -j 2 --features custom-protocol`，最后复制 exe 与 DLL 到项目根目录。

> ⚠️ **生产构建必须带 `--features custom-protocol`**。Tauri 的 `tauri-build::is_dev()` 在 `tauri` crate 未启用 `custom-protocol` 时返回 `true`，`generate_context!()` 会忽略 `frontendDist`、改为加载 `build.devUrl`（`http://127.0.0.1:1420`）。此时双击 exe 会看到 Edge 的「嗯… 无法访问此页面 / 127.0.0.1 拒绝连接 / ERR_CONNECTION_REFUSED」。`Cargo.toml` 已声明该 feature，`package.json` 的 `tauri:build` 与 GNU 构建脚本都已显式带上；**开发调试 `tauri dev` 则不带**，以便使用 Vite 开发服务器的 HMR。

#### 原生 exe 构建环境：四个必须绕开的坑（本机实测定位）

1. **中文用户名 + MinGW `ld.exe`**：`ld.exe` 是 ANSI 程序，无法打开 `C:\Users\<中文用户名>\.rustup\...` 下的标准库 `.rlib`，报 `cannot find libcore-*.rlib` / `requires 'branch' lang_item`。`rustup` 的目录联接（junction）会被自动解析回中文真实路径，因此必须把 `stable-x86_64-pc-windows-gnu` **复制**到纯 ASCII 路径，并直接调用复制后的原生 `cargo.exe`，让 rustc 的 sysroot 全程为 ASCII。
2. **中文临时目录**：`dlltool.exe` 在 `%LOCALAPPDATA%\Temp`（含中文用户名）创建临时文件失败，报 `Cannot create temporary file in C:\Users\????\AppData\Local\Temp`。构建脚本把 `TMP/TEMP/TMPDIR` 指向纯 ASCII 的 `_rusttmp`。
3. **工具链目标目录混用 / 并行 OOM**：MSVC 与 GNU 工具链共用 `target/debug` 会导致元数据串味（表现为第三方 crate 里 `Option / Some / drop / derive` 全部找不到）。脚本使用独立的 `target-gnu2`、关闭增量编译、`-j 1`，避免并行 rustc 触发 `memory allocation ... failed` 写出损坏的 `.rmeta`。
4. **漏掉 `custom-protocol` feature**：缺它时 exe 不带内嵌前端资源，启动后去连 `devUrl`，显示 `ERR_CONNECTION_REFUSED`。修复见上方说明；判断依据是 `strings F50_Pro_Monitor.exe` 里应能查到 `/assets/index-*.js` 与 `tauri://localhost`。

> 构建期共修正 3 处源码/配置问题：`lib.rs` 增加 `#![recursion_limit = "512"]`（大 `json!` 字面量超出默认 128 递归上限）；`crypto.rs::encode_sms_body` 拆分 `if` 表达式消除 E0716 临时值借用错误；`Cargo.toml` 声明并启用 `custom-protocol`。

---

## 四、接口协议要点（F50 Pro B28 真机验证）

### 4.1 登录与写鉴权
```
GET  /goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=LD
POST /goform/goform_set_cmd_process
     isTest=false&goformId=LOGIN&password=UPPER(SHA256(UPPER(SHA256(密码)) + LD))
→ {"result":0}   成功码 0 / 4

GET  cmd=Language,cr_version,wa_inner_version     # wa=F50ProV1.0.0B28, cr=MU3356V1.0.0B28
GET  cmd=RD                                       # RD=会话随机串
AD = UPPER(SHA256(UPPER(SHA256(wa + cr)) + RD))   # 所有写操作必须带 AD
GET  cmd=loginfo                                  # ok = 会话有效
GET  cmd=psw_fail_num_str,login_lock_time          # 登录保护状态
```

### 4.2 命令分组（`protocol.json`）
| 组 | 内容 | 说明 |
|---|---|---|
| `commands.main` | 速率、连接、SIM、Wi-Fi、流量、设备身份等 | **禁止**包含 `Nr_* / nr_* / plmn / sms_nv_*` |
| `commands.dump` | 仅 `network_information` | 必须单独请求，返回 NR 小区 dump |
| `commands.device` | SIM/固件/网络/地址全量字段 | 设备信息弹窗使用 |
| `commands.sms_capacity` | `sms_capacity_info` | 短信容量（真机 150，已存 6） |
| `sms.path` | `sms_data_total&mem_store=1&tags=100...` | 主路径；`mem_store=0&tags=10` 兜底 |

### 4.3 速率单位（与 web 端一致）
设备 web 首页 `js/home.js` → `util.js::transUnit(x, true)` → `getDisplayVolume(x, true)`：

| 步骤 | 规则 |
|---|---|
| 原始字段 | `flux_realtime_rx_thrpt` / `flux_realtime_tx_thrpt`，单位 **B/s** |
| 换算 | `bits = bytes × 8` |
| 单位阶梯（1024 进制） | `Tb(2^40) → Gb(2^30) → Mb(2^20) → Kb(2^10) → b`，取第一个 `bits/divisor >= 0.5` |
| 显示 | `数值 + 单位 + /s`，例如 `13.81Mb/s`、`8.34Kb/s`；0 显示 `0b/s` |
| 注意 | `util.js::formatBandwidth(kbps)` 只用于 `dl_ambr / ul_ambr` 签约速率（`1000000 kbps → 1 Gbps`），**不适用于实时速率** |

### 4.4 短信
- 内容：`Base64(UTF-8)`；日期：`YY,MM,DD,HH,mm,ss,+0800`（兼容 6 字段旧格式）
- `tag=1` 未读；`mem_store=1&tags=100` 取全部
- 发送：`goformId=SEND_SMS`、`MessageBody` 为 UTF-16BE 大写十六进制、`encode_type=UNICODE`、`ID=-1`、`sms_time=YY;MM;DD;HH;MM;SS;+8`
- 删除：`DELETE_SMS`，`msg_id` 多个用 `;` 分隔并以 `;` 结尾；已读：`SET_MSG_READ&tag=0`

### 4.5 配置默认值与「恢复默认」

| 项 | 默认值 | 说明 |
|---|---|---|
| Web 管理地址 | `http://192.168.0.1` | 不带 `/#home` 片段 |
| **Web 登录密码** | **空字符串** | 首次使用必须手动填写，代码中不内置任何真实口令 |
| 状态 / 短信刷新 | `1000 ms` / `10000 ms` | 速率 1 秒刷新 |
| 月度套餐额度 | `0`（未启用额度内容） | 只存本机，不写设备 |
| 新短信图标提醒 | 开启 | 可在「设置 → 通知」关闭 |
| 主题 / 日志 / 导出目录 | 浅色 / 300 行 / 空 | 空目录时导出会提示先设置 |

「恢复默认」走 `reset_config` 命令：Node 与 Rust 后端都会用默认配置覆盖写回 `config.json`、删除 `traffic.json` 流量基线、清空登录会话与短信容量缓存，并移除可能存在的开机自启注册表项。前端随后重新加载配置、重启轮询并把状态置为「待填写密码」。**全程只读设备，不下发任何写指令。**

#### 为什么填了密码还连不上（已修复）

| 原问题 | 根因 | 修复 |
|---|---|---|
| 恢复默认后即使填对密码也连不上 | 空密码时 1 秒轮询仍向设备发 `LOGIN`，失败会递减 `psw_fail_num_str`；等用户填好密码，设备已进入登录保护（`remaining < 3` 或锁定），`login()` 开头直接「跳过登录」 | `login()` 开头先判空密码，抛 `needConfig` 标记错误并**立即返回，不发任何请求**；`withAuth` 对该错误不做二次重试；前端空密码时直接短路，不请求后端 |
| 保存密码后仍停在离线，要等一会儿 | `saveConfig` 只调用了 `refreshStatus()`，而 1 秒定时轮询常把 `state.refreshing` 置为 true，导致这次刷新被静默跳过；且没有强制重新登录 | 新增 `reconnect` 命令（Node + Rust）：清会话 → 强制 `login()` → 立即取状态。`saveConfig` 保存后直接走这条独立路径，绕开 `refreshing` 锁，并把结果立刻写进 UI 与日志 |
| 一次请求可能连发两次 LOGIN | `withAuth` 的 catch 用 `/登录/` 宽泛匹配，密码错误也会触发重试 | 改为只匹配会话/认证类错误，并显式跳过 `needConfig` |

设置面板提供三种「立即连接」入口：密码框按回车、密码框失焦（仅在因缺密码而离线时自动触发）、`测试连接（保存并立即连接）` 按钮；结果会直接显示在设置面板里（✓ 已连接 / ✗ 失败原因）。

---

## 五、真机验证结果（2026-11-17，只读）

| 项目 | 结果 |
|---|---|
| 设备连通 | `192.168.0.1` 可达，80 端口开放；5555 / 2333 均关闭 |
| 登录 | `LOGIN → {"result":0}`，取得 `JSESSIONID`；`loginfo=ok` |
| 速率 | `flux_realtime_rx_thrpt` 原始值 1,067 B/s → `8.34Kb/s`；峰值采样 1,809,471 B/s → `13.81Mb/s` |
| 连接状态 | `ppp_status=ipv4_ipv6_connected`、`mc_modem_main_state=modem_init_complete`、`sim_slot=11`、Wi-Fi 3 台、`cpu_temperature=44°C` |
| 信号 dump | `plmn=46015`、`nr_rsrp=-80`、`nr_rsrq=-6`、`Nr_snr=25`、`Nr_bands=41`(n41)、`Nr_band_widths=100000`(100 MHz)、`Nr_pci=257` |
| 设备信息 | SIM 卡号、ICCID、IMSI、IMEI、固件 `F50ProV1.0.0B28`、硬件 `F50ProHW1.0`、型号 `MU3356`、运营商均已正确读取（真实卡号/串号已脱敏，不在文档中留存） |
| 短信 | 取回 6 条、未读 1 条；容量 150；中文正文 Base64 解码正常；验证码可提取 |
| 流量 | `monthly_rx_bytes + monthly_tx_bytes` ≈ 953 MB；`flux_clear_date=1`（每月 1 号重置） |
| 接口自检 | 8/8 项通过 |
| 前端构建 | `npm run build` 通过（31 modules，Vue 3 + Vite 5，产物 `dist/assets/index-B3lOuS63.js`） |
| 启动脚本 | 10 个 `.bat` 全部满足 CRLF + GBK + 无 BOM；探针实测输出 `REACHED_LAUNCH_LINE` |
| Rust 静态检查 | `cargo check -j 2` → `Finished dev profile`，0 error（GNU 工具链 / 纯 ASCII 路径） |
| Rust 原生构建 | `cargo build --release -j 2` → `Finished release profile in 10m31s`，0 error；产物 `f50-pro-monitor.exe` 28,393,506 B（PE64，含 `.rsrc` 资源段） |
| 原生构建脚本 | `构建原生版_本机GNU.bat` 端到端跑通两次：前端构建 → `cargo build --release -j 2 [--features custom-protocol]` → 复制 exe 与 DLL，0 error（6m35s / 2m34s 增量） |
| 原生 exe 冒烟 | 补齐 `WebView2Loader.dll` 后在项目根目录 `timeout -k 2 5 ./F50_Pro_Monitor.exe` → 退出码 137/124（存活至超时被 kill，无立即崩溃）；本机 WebView2 Runtime `157.0.4341.46` 已安装 |
| **原生窗口界面回归** | 实际启动 exe 并截屏确认：不再是 `ERR_CONNECTION_REFUSED`，完整渲染出监控面板（5G / 中国广电、RSRP `-80 dBm`、SINR `25 dB`、n41、月度流量 10.63 GB、短信列表 3 条、运行日志、硬件/连接状态），**证明 Tauri IPC 已成功取到真机数据** |
| 恢复默认（预览模式） | `reset_config` → `base_url=http://192.168.0.1`、`password=""`、`sms_icon_alert=true`、其余全部默认；`get_config` 复核一致；测试后立即还原原配置（密码长度 8） |
| 图标提醒命令（预览模式） | `notify_new_sms` → `{ok:true, skipped:true, mode:"browser"}`；`clear_new_sms_alert` → `{ok:true}`，命令通路正常 |
| Rust 静态检查（新功能） | `cargo check -j 1 --features custom-protocol` → `Finished dev profile in 6.50s`，0 error |
| **恢复默认 → 填密码 → 立即连接回归** | `reset_config` → 空密码 `get_status`/`reconnect` 均返回 `need_config:true`；**空密码轮询 10 次后设备 `psw_fail_num_str` 仍为 5、`login_lock_time` 仍为 0**（未消耗尝试次数）；填入密码后 `reconnect` → `online=true`、`已连接 · IPv4/IPv6`、`中国广电`；后续 `get_status` 仍 `online=true`；测试后原配置已还原 |
| 速率单位回归 | `100 B/s → 0.78Kb/s`、`1343 B/s → 10.49Kb/s`、`1809471 B/s → 13.81Mb/s`；真机 `1067 B/s → 8.34Kb/s` |
| API 端到端回归 | `get_status` 225ms / `get_sms` 70ms（7 条）/ `get_device_info` 301ms / `diagnose` 206ms（8/8），全部 `online=true` |

---

## 六、目录结构

```
F50_Pro_Monitor/
├─ F50_Pro_Monitor.exe                     # ★ 已编译的原生窗口程序（x86_64 release）
├─ WebView2Loader.dll                      # ★ 原生 exe 的动态依赖，必须与 exe 同目录
├─ 运行原生版.bat / native.bat             # ★ 一键启动原生 exe
├─ 一键启动.bat / start.bat                # 浏览器预览模式（一键可用）
├─ 启动Tauri开发版.bat / tauri_dev.bat     # Tauri 原生窗口调试（MSVC 路线）
├─ 构建可执行程序.bat / build_exe.bat      # MSVC 路线打包 exe / NSIS / MSI
├─ 构建原生版_本机GNU.bat / build_native_gnu.bat  # ★ 本机 GNU 路线（已实测）
├─ protocol.json                           # 两端共用的协议常量（命令列表/单位/模式/状态码）
├─ package.json / vite.config.js / index.html
├─ public/app-icon.svg                     # 应用 ICON（SVG）
├─ public/app-icon-alert.svg               # 新短信告警 ICON（红色角标，预览模式页签用）
├─ scripts/make_icons.py                   # 生成 PNG/ICO 图标
├─ scripts/make_launchers.py               # 生成 CRLF+GBK 的 .bat
├─ server/
│  ├─ api.js                               # Node 后端（预览模式，与 Rust 行为一致）
│  └─ vitePlugin.js                        # /api/<cmd> 中间件
├─ src/
│  ├─ main.js / App.vue / transport.js     # 入口、布局、Tauri/Browser 双通道
│  ├─ styles/theme.css                     # 扁平化浅/深主题、√ 勾选、进度条
│  ├─ utils/format.js                      # formatWebSpeed / formatBandwidth / 验证码提取
│  ├─ stores/f50Store.js                   # 轮询、日志、二次确认、恢复默认、图标提醒
│  └─ components/                          # Header/Speed/Signal/Traffic/Hardware/Sms/Log/弹窗
└─ src-tauri/
   ├─ Cargo.toml / build.rs / tauri.conf.json / capabilities/default.json
   ├─ icons/                               # 32/128/256 PNG + 多尺寸 ICO + 32x32[-alert].rgba 告警图标
   └─ src/
      ├─ main.rs / lib.rs                  # 入口、托盘（id=f50-main）、命令注册
      ├─ config.rs / crypto.rs             # 配置持久化与恢复默认、大写 SHA256 / AD / UTF-16 编码
      ├─ client.rs                        # HTTP、登录、状态派生、短信、写操作、诊断
      ├─ alert.rs                         # 任务栏闪烁 + 托盘/窗口图标跳动
      └─ commands.rs                      # Tauri IPC 命令、恢复默认、导出、开机自启、打开后台
```

---

## 七、已知限制与注意事项

1. **原生 exe 已产出，但走的是 GNU 工具链**：本机没有 VS 2022 MSVC `link.exe`，改用 MinGW-w64 + `stable-x86_64-pc-windows-gnu` 编译，链接期有一条无害警告 `.rsrc merge failure: multiple non-default manifests`（图标与应用清单仍已写入 `.rsrc`，冒烟启动正常）。GNU 产物会动态依赖 `WebView2Loader.dll`，**必须与 exe 同目录**；MSVC 路线通常静态链接 `WebView2LoaderStatic.lib`，不需要该 DLL。若需要官方 NSIS/MSI 安装包，请在装有 VS 2022「使用 C++ 的桌面开发」的机器上执行 `构建可执行程序.bat`；GNU 路线只产出独立 exe。`一键启动.bat` 的浏览器模式完全不依赖 Rust 工具链。
2. **原生窗口已验证但只做了只读回归**：已实际启动 exe 并截屏确认界面与 Tauri IPC 均能取到真机数据；写操作按钮（发/删短信、切网、开关数据）仍未在原生窗口里实际点击下发，见下一条。
3. **未对设备执行写操作验证**：为避免改变设备状态与产生短信费用，发送/删除短信、切换网络模式、开关移动数据仅按参考项目与 web 前端源码实现了协议，未实际下发；使用前请确认并在测试设备上验证。
4. **CPU/内存占用**：B28 固件 80 端口返回空值，界面显示 `--`；如需该指标，可开启设备 ADB 5555 后另行扩展。
5. **密码存储**：管理密码以明文保存在 `%APPDATA%\F50_Pro_Monitor\config.json`（预览模式为 `.runtime/config.json`）。请勿把配置或整个目录上传到公开仓库；分享日志/设备信息前请脱敏 IMSI / ICCID / IMEI / SIM 卡号。
6. **登录会话**：约 10 分钟过期，工具通过 `loginfo` 自动检测并重新登录；登录失败不会盲目重试，以免触发设备锁定。

---

## 八、版本记录

### V1.0（2026-11-17）
- **适配修复**：短信改走 80 端口原生 `sms_data_total`；硬件/连接状态改走原生状态字段；`network_information` 与 `sms_capacity_info` 从主轮询拆出独立请求；登录哈希统一大写 SHA256 并加入登录锁定保护。
- **速率**：改用 `flux_realtime_*_thrpt`（B/s）→ `transUnit(x,true)` → `b/s / Kb/s / Mb/s / Gb/s / Tb/s`，1 秒实时刷新；`formatBandwidth` 仅保留给 AMBR 签约速率。
- **新增**：右上角 ⓘ 设备信息弹窗（SIM/ICCID/IMSI/IMEI/固件/硬件/网络，支持脱敏与复制）；设置内月度流量套餐额度（GB/MB/TB、账单日、预警、进度条）；网络模式/移动数据开关；短信发送/删除/标记已读；Webhook/Bark 通知；接口自检；导出中文与 UNC 路径。
- **安全**：所有写操作统一 `ConfirmModal` + `guardedAction()` 二次确认，默认不执行并写运行日志。
- **交付**：`F50_Pro_Monitor.exe` + `WebView2Loader.dll` 原生程序、浏览器预览模式、10 个 CRLF+GBK 启动脚本、应用 ICON、共用 `protocol.json`、完整 README；版本化压缩包 `F50_Pro_Monitor_v1.0.1_Windows_x64.zip`（已排除 `.runtime` 配置，避免密码泄漏）。
- **构建修复**：`lib.rs` 递归上限 512；`crypto.rs` 消除 E0716；ASCII 工具链/TMP/独立 target/`-j 2` 三步绕开中文路径与并行 OOM 问题；补齐 GNU 产物的 `WebView2Loader.dll` 依赖。

### V1.0.1（2026-11-17，原生窗口启动修复）
- **修复**：双击 `F50_Pro_Monitor.exe` 显示「嗯… 无法访问此页面 / 127.0.0.1 拒绝连接 / ERR_CONNECTION_REFUSED」。
- **根因**：用 `cargo build --release` 直接编译时未启用 Tauri 的 `custom-protocol` feature，`tauri-build::is_dev()` 返回 `true`，`generate_context!()` 忽略内嵌的 `frontendDist` 而去加载 `build.devUrl`。
- **改动**：`src-tauri/Cargo.toml` 新增 `[features] custom-protocol = ["tauri/custom-protocol"]`；`package.json` 的 `tauri:build` 加 `--features custom-protocol`；`scripts/make_launchers.py` 生成的 GNU 构建脚本同步加该参数；重编译 exe（28,434,970 B）。
- **验证**：exe 内可查到 `/assets/index-*.js` 与 `tauri://localhost`；实际启动截屏显示完整监控面板与真机数据，错误页消失。
- **注意**：`tauri dev` 仍**不**带该 feature，以保留 Vite HMR；只有生产构建才需要。

### V1.0.1 增补（同日，两项新需求）
- **设置内「恢复默认」**：新增 `reset_config` 命令（Node + Rust 双后端）、`f50Store.resetConfig()`、`SettingsModal` 危险色按钮 + `ConfirmModal` 二次确认（提示文案明确「只清本机、不下发设备指令」）。默认 Web 地址 `http://192.168.0.1`、**默认登录密码改为空**，并清除 `traffic.json` 流量基线、登录会话、短信容量缓存与开机自启项。
- **新短信图标醒目提醒**：新增 `src-tauri/src/alert.rs`；`request_user_attention(Critical)` 实现任务栏持续闪烁；嵌入 `32x32.rgba` / `32x32-alert.rgba` 两组原始 RGBA 图标，用 `Image::new_owned` 在窗口图标与托盘图标间以 450ms 交替切换形成「跳动/变色」；窗口聚焦、点击托盘、超时（约 108 秒）自动恢复。预览模式用 `app-icon-alert.svg` + 标题闪烁兜底，设置里可开关 `sms_icon_alert`。
- **构建稳健性**：GNU 构建脚本并行度由 `-j 2` 降为 `-j 1`，规避本机并行 rustc 的 OOM / `STATUS_STACK_BUFFER_OVERRUN`。
- **版本一致性**：`package.json` / `Cargo.toml` / `tauri.conf.json` 与界面文字统一为 1.0.1。
- **连接修复（用户反馈）**：恢复默认后填入正确密码仍连不上。新增 `reconnect` 命令（Node + Rust）实现「清会话 → 立即强制登录 → 取状态」；`saveConfig` 保存后直接走该独立路径绕开 `state.refreshing` 锁；`login()` 增加空密码保护（`needConfig` 标记，绝不发 LOGIN）；`withAuth` 不再对密码错误/配置缺失做二次重试；前端抽出 `applyStatus()` 按状态变化记日志、空密码时短路轮询；设置面板新增「测试连接」按钮、密码框回车/失焦自动连接与结果提示。

---

## 九、常见问题

**Q：双击 exe 出现「嗯… 无法访问此页面，127.0.0.1 拒绝连接，ERR_CONNECTION_REFUSED」？**
A：这是用不带 `--features custom-protocol` 的方式重新编译了 exe（例如直接执行 `cargo build --release`）。此时窗口会去连开发服务器 `http://127.0.0.1:1420`，而它并没有启动。解决：改用 `构建原生版_本机GNU.bat` / `build_native_gnu.bat`（已内置该 feature），或执行 `npm run tauri:build`；临时应急也可以先双击 `一键启动.bat` 把 Vite 服务跑起来，再打开 exe。

**Q：窗口一片空白 / 启动即退出？**
A：检查 `WebView2Loader.dll` 是否与 exe 在同一目录，以及系统是否安装 WebView2 Runtime。`运行原生版.bat` 会自动检查 DLL 并给出提示。

**Q：界面数据不刷新？**
A：确认设备地址与密码（设置内可改），并用顶部「自检」按钮查看 8 项接口是否全部通过；登录会话约 10 分钟过期，工具会自动重新登录。**默认密码是空的**，首次启动或点过「恢复默认」后必须手动填写 Web 管理密码。

**Q：点了「恢复默认」后读不到数据 / 填了密码还是连不上？**
A：V1.0.1 已修复。默认密码是空的，工具**不会**用空密码去登录设备（否则会消耗设备剩余尝试次数并触发登录保护，导致之后填对密码也被拒）。填入密码后按回车、离开输入框或点「测试连接（保存并立即连接）」，工具会立即清会话、强制重新登录并刷新状态，无需等待轮询、也无需先关闭设置窗口。面板上会直接显示 ✓/✗ 结果。若仍失败，检查地址是否带 `/#home`（不要带）、密码是否正确，并用「运行接口自检」看 8 项是否通过；若提示「设备登录保护中」，请等锁定期结束再试，工具不会盲目重试。

**Q：新短信来了但图标没闪？**
A：确认「设置 → 新短信通知」里的 `新短信图标闪烁提醒` 已勾选；窗口在前台且获得焦点时按设计不会打扰，只有最小化 / 失焦才闪烁。预览模式闪烁的是浏览器页签标题与 favicon，不是 Windows 任务栏。可点「测试图标提醒」按钮立即触发一次（建议先把窗口最小化）。
