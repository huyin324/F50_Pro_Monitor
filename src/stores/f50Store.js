import { reactive } from 'vue'
import { call, pickFolder, isTauri } from '../transport.js'
import { formatBytes } from '../utils/format.js'

const DEFAULT_CONFIG = {
  base_url: 'http://192.168.0.1',
  password: '',
  refresh_ms: 1000,
  sms_refresh_ms: 10000,
  monthly_quota_gb: 0,
  quota_unit: 'GB',
  quota_reset_day: 1,
  quota_auto_reset: true,
  quota_warn_pct: 80,
  quota_enabled: true,
  theme: 'light',
  sms_hex_lowercase: false,
  notify_enabled: false,
  notify_url: '',
  notify_new_sms: true,
  sms_icon_alert: true,
  launch_at_login: false,
  minimize_to_tray: true,
  log_max_lines: 300,
  export_dir: ''
}

const EMPTY_STATUS = {
  online: false, error: '尚未连接', ts: '',
  connected: false, connection_text: '未知', ppp_status: '', modem_main_state: '',
  dial_mode: '', opms_wan_mode: '', uptime_sec: 0, sim_status: '--', sim_slot: '',
  sim_pin_status: '', roaming: '', roam_setting_option: '', wifi_onoff_state: '',
  wifi_access_sta_num: 0, ssid: '', usb_port_switch: '',
  network_type: '', network_type_text: '--', network_provider: '--', plmn: '',
  signalbar: 0, rsrp: '', rsrq: '', sinr: '', nr_bands: '', nr_band_widths: '',
  nr_fcn: '', nr_pci: '', nr_cell_id: '', nr_tac: '', dl_ambr: '', ul_ambr: '', qci: '',
  net_select: '', network_mode_text: '--',
  dl_bps: 0, ul_bps: 0, dl_text: '0b/s', ul_text: '0b/s',
  monthly_rx_bytes: 0, monthly_tx_bytes: 0, monthly_total_bytes: 0,
  session_rx_bytes: 0, session_tx_bytes: 0, daily_total_bytes: 0,
  quota_bytes: 0, quota_used_pct: 0, quota_remaining_bytes: 0,
  quota_reset_day: 1, days_to_reset: 0, device_limit_bytes: 0, device_limit_switch: 0,
  sms_unread_num: 0, sms_nv_total: 0, sms_nv_rev_total: 0,
  cpu_temperature: null, cpu_usage: null, mem_usage: null, battery_value: -1, battery_charging: '',
  wan_ipaddr: '', ipv6_wan_ipaddr: '', lan_ipaddr: '', mac_address: '',
  iccid: '', imsi: '', imei: '', sim_msisdn: '', web_version: '', wa_inner_version: '',
  cr_version: '', hardware_version: '', model_name: '', loginfo: ''
}

export const state = reactive({
  config: { ...DEFAULT_CONFIG },
  status: { ...EMPTY_STATUS },
  deviceInfo: null,
  sms: { messages: [], unread: 0, capacity: {}, source: '', error: null },
  speedHistory: { dl: [], ul: [] },
  logs: [],
  progress: 0,
  busy: false,
  refreshing: false,
  lastUpdate: '',
  theme: 'light',
  runtime: isTauri() ? 'Tauri 原生窗口' : '浏览器预览模式',
  view: { info: false, settings: false, compose: false, diagnose: false },
  confirm: null,
  diagnoseResult: null,
  logFilter: { info: true, ok: true, warn: true, error: true },
  autoScroll: true,
  selectedSms: [],
  smsBusy: false,
  quotaWarned: false,
  knownSmsIds: new Set(),
  smsInitialized: false,
  smsIconAlertActive: false
})

let statusTimer = null
let smsTimer = null
let progressTimer = null
let smsAlertTimer = null
let browserAlertActive = false
let alertListenersInstalled = false
const BASE_TITLE = 'F50 Pro Monitor'

/* ------------------------------------------------------------------ */
/* 日志                                                                 */
/* ------------------------------------------------------------------ */
export function log(level, msg) {
  const now = new Date()
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  state.logs.push({ t, level, msg: String(msg) })
  const max = Number(state.config.log_max_lines) || 300
  if (state.logs.length > max) state.logs.splice(0, state.logs.length - max)
}
export function clearLogs() { state.logs = [] }

function setProgress(v, decay = true) {
  state.progress = v
  if (progressTimer) clearTimeout(progressTimer)
  if (decay && v >= 100) {
    progressTimer = setTimeout(() => { state.progress = 0 }, 420)
  }
}

/* ------------------------------------------------------------------ */
/* 配置                                                                 */
/* ------------------------------------------------------------------ */
export function applyTheme(t) {
  state.theme = t || 'light'
  document.documentElement.classList.toggle('dark', state.theme === 'dark')
  document.body.classList.toggle('dark', state.theme === 'dark')
}

export async function loadConfig() {
  try {
    const cfg = await call('get_config')
    state.config = { ...DEFAULT_CONFIG, ...cfg, password: cfg.password || '' }
    applyTheme(state.config.theme)
    log('ok', `配置已加载：设备 ${state.config.base_url}，刷新 ${state.config.refresh_ms} ms`)
  } catch (e) {
    log('error', `读取配置失败：${e.message}`)
    applyTheme('light')
  }
}

export async function saveConfig(patch) {
  const next = { ...state.config, ...patch }
  await call('save_config', { cfg: next })
  state.config = next
  applyTheme(next.theme)
  log('info', '设置已保存，正在立即重新连接设备…')
  // 强制清会话 + 立即登录，不等下一次 1 秒轮询（地址/密码变更必须马上生效）
  const r = await reconnectNow()
  restartTimers()
  if (r.ok) log('ok', '已用新配置连接成功')
  else log(r.need_config ? 'warn' : 'error', `连接未成功：${r.error || '请核对设备地址与管理密码'}`)
  return r
}

/** 清除本机配置并恢复默认参数（默认地址 http://192.168.0.1，默认密码为空）。 */
export async function resetConfig() {
  const r = await call('reset_config')
  if (r?.ok === false) throw new Error(r.error || '重置失败')
  const cfg = await call('get_config')
  state.config = { ...DEFAULT_CONFIG, ...cfg, password: cfg.password || '' }
  applyTheme(state.config.theme)
  state.knownSmsIds = new Set()
  state.smsInitialized = false
  state.quotaWarned = false
  state.selectedSms = []
  state.sms = { messages: [], unread: 0, capacity: {}, source: '', error: null }
  state.status = { ...state.status, online: false }
  await clearSmsIconAlert()
  log('ok', '配置已清除并恢复默认：设备 http://192.168.0.1，登录密码为空（请在设置中填写）')
  restartTimers()
  // 不调用 refreshStatus：空密码时后端会直接拒绝登录，避免向设备发送 LOGIN 消耗尝试次数。
  applyStatus({
    online: false, need_config: true,
    error: '尚未设置 Web 登录密码，请在「设置 → 设备连接」中填写',
    ts: new Date().toLocaleTimeString('zh-CN', { hour12: false })
  })
  return cfg
}

/* ------------------------------------------------------------------ */
/* 新短信图标提醒                                                       */
/* ------------------------------------------------------------------ */
function faviconEl() {
  let el = document.querySelector('link[rel~="icon"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'icon'
    document.head.appendChild(el)
  }
  return el
}

/** 浏览器预览模式：页签图标换成红点版 + 标题闪烁，等效于 PC 端任务栏提醒。 */
function startBrowserAlert(count) {
  browserAlertActive = true
  state.smsIconAlertActive = true
  const el = faviconEl()
  el.href = '/app-icon-alert.svg'
  const alertTitle = `[● ${count} 条新短信] ${BASE_TITLE}`
  document.title = alertTitle
  let on = true
  if (smsAlertTimer) clearInterval(smsAlertTimer)
  smsAlertTimer = setInterval(() => {
    on = !on
    document.title = on ? alertTitle : BASE_TITLE
  }, 700)
}

/** 窗口重新获得焦点 / 用户点击页签时清除提醒并恢复图标。 */
export async function clearSmsIconAlert() {
  if (!browserAlertActive && !state.smsIconAlertActive) return
  browserAlertActive = false
  state.smsIconAlertActive = false
  if (smsAlertTimer) { clearInterval(smsAlertTimer); smsAlertTimer = null }
  document.title = BASE_TITLE
  const el = faviconEl()
  el.href = '/app-icon.svg'
  try { await call('clear_new_sms_alert') } catch { /* 后端不可用时忽略 */ }
}

export function installAlertListeners() {
  if (alertListenersInstalled) return
  alertListenersInstalled = true
  window.addEventListener('focus', () => { clearSmsIconAlert() })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clearSmsIconAlert()
  })
}

/** 设置面板里的「测试图标提醒」：手动触发一次，便于确认任务栏/托盘效果。 */
export async function testIconAlert() {
  try {
    const r = await call('notify_new_sms', { count: 1, preview: '测试提醒：来自设置面板' })
    if (!isTauri()) startBrowserAlert(1)
    if (r?.skipped) {
      log('info', '窗口当前在前台且已聚焦，按设计跳过图标提醒；最小化窗口后再试即可看到闪烁')
    } else {
      log('ok', '已触发图标提醒：任务栏闪烁 + 托盘图标跳动；切回窗口或点击托盘自动恢复')
    }
  } catch (e) {
    log('error', `图标提醒测试失败：${e.message}`)
  }
}

/* ------------------------------------------------------------------ */
/* 轮询                                                                 */
/* ------------------------------------------------------------------ */
/** 把后端返回的状态写入 UI；只在状态发生「变化」时记日志，避免 1 秒轮询刷屏。 */
function applyStatus(s, quiet = false) {
  const wasOffline = state.status.online === false
  const prevError = state.status.error
  if (s.online === false) {
    state.status = { ...state.status, ...s, online: false }
    if (!quiet && (!wasOffline || prevError !== s.error)) {
      log(s.need_config ? 'warn' : 'error', s.need_config ? `待配置：${s.error}` : `设备连接失败：${s.error}`)
    }
    return false
  }
  state.status = { ...state.status, ...s, online: true, need_config: false, error: null }
  state.lastUpdate = s.ts || new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const dl = state.speedHistory.dl
  const ul = state.speedHistory.ul
  dl.push(Number(s.dl_bps) || 0)
  ul.push(Number(s.ul_bps) || 0)
  if (dl.length > 60) dl.shift()
  if (ul.length > 60) ul.shift()
  checkQuota()
  if (!quiet && wasOffline) log('ok', '设备已连接，F50 Pro 原生接口就绪')
  return true
}

/**
 * 保存配置 / 填写密码后【立即】重新连接。
 * 走独立的 reconnect 命令（后端清会话并强制重新登录），不等 1 秒轮询，
 * 也不受 refreshStatus 的 state.refreshing 锁影响。
 */
export async function reconnectNow(quiet = false) {
  try {
    const s = await call('reconnect')
    const ok = applyStatus(s, quiet)
    return { ...s, ok }
  } catch (e) {
    const msg = e.message || String(e)
    applyStatus({ online: false, error: msg }, quiet)
    return { online: false, ok: false, error: msg }
  }
}

export async function refreshStatus(manual = false) {
  if (state.refreshing) return
  // 密码为空时不向后端发请求，后端也不会用空密码登录（避免消耗设备尝试次数）。
  if (!state.config.password) {
    applyStatus({
      online: false, need_config: true,
      error: '尚未设置 Web 登录密码，请在「设置 → 设备连接」中填写',
      ts: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    })
    return
  }
  state.refreshing = true
  if (manual) setProgress(12, false)
  try {
    applyStatus(await call('get_status'))
  } catch (e) {
    log('error', `状态刷新异常：${e.message}`)
  } finally {
    state.refreshing = false
    if (manual) setProgress(100)
  }
}

function checkQuota() {
  const c = state.config
  const s = state.status
  if (!c.quota_enabled || !s.quota_bytes) { state.quotaWarned = false; return }
  const pct = Number(s.quota_used_pct) || 0
  const warn = Number(c.quota_warn_pct) || 80
  if (pct >= warn && !state.quotaWarned) {
    state.quotaWarned = true
    log('warn', `月度套餐已使用 ${pct.toFixed(1)}%（${formatBytes(s.monthly_total_bytes)} / ${formatBytes(s.quota_bytes)}），超过预警阈值 ${warn}%`)
    if (c.notify_enabled && c.notify_url) {
      call('send_notification', {
        title: 'F50 Pro 流量预警',
        body: `本月已用 ${formatBytes(s.monthly_total_bytes)}，占套餐 ${pct.toFixed(1)}%`,
        url: c.notify_url, force: true
      }).catch(() => {})
    }
  }
  if (pct < warn) state.quotaWarned = false
}

export async function refreshSms(manual = false) {
  if (!state.config.password) return   // 未配置密码时不做任何需鉴权的请求
  if (state.smsBusy) return
  state.smsBusy = true
  try {
    const r = await call('get_sms')
    state.sms = { messages: r.messages || [], unread: r.unread || 0, capacity: r.capacity || {}, source: r.source || '', error: null }
    const ids = new Set(state.sms.messages.map(m => m.id))
    const fresh = [...ids].filter(id => !state.knownSmsIds.has(id))
    if (state.smsInitialized && fresh.length) {
      const items = state.sms.messages.filter(m => fresh.includes(m.id))
      log('ok', `收到 ${fresh.length} 条新短信`)
      // 窗口最小化 / 失焦时给出醒目图标提醒（Tauri：任务栏闪烁 + 托盘跳动；预览：标题 + 页签图标）
      if (state.config.sms_icon_alert !== false) {
        call('notify_new_sms', {
          count: fresh.length,
          preview: String(items[0]?.content || '').slice(0, 60)
        }).catch(e => log('warn', `图标提醒失败：${e.message}`))
        if (!isTauri() && (document.hidden || !document.hasFocus())) {
          startBrowserAlert(fresh.length)
        }
      }
      if (state.config.notify_enabled && state.config.notify_new_sms && state.config.notify_url) {
        for (const m of items.slice(0, 3)) {
          call('send_notification', {
            title: `F50 Pro 新短信 · ${m.number}`, body: m.content,
            url: state.config.notify_url, force: true
          }).catch(() => {})
        }
      }
    }
    state.knownSmsIds = ids
    state.smsInitialized = true
    if (manual) log('info', `短信刷新完成，共 ${state.sms.messages.length} 条（来源：${r.source || '--'}）`)
  } catch (e) {
    state.sms.error = e.message
    log('error', `短信读取失败：${e.message}`)
  } finally {
    state.smsBusy = false
  }
}

export async function refreshDeviceInfo() {
  try {
    state.deviceInfo = await call('get_device_info')
    log('ok', '设备信息已刷新')
  } catch (e) {
    log('error', `设备信息读取失败：${e.message}`)
  }
}

export async function runDiagnose() {
  setProgress(10, false)
  log('info', '开始接口自检（只读）…')
  try {
    state.diagnoseResult = await call('diagnose')
    const ok = (state.diagnoseResult.items || []).filter(i => i.ok).length
    const total = (state.diagnoseResult.items || []).length
    log('ok', `自检完成：${ok}/${total} 项通过`)
    state.view.diagnose = true
  } catch (e) {
    log('error', `自检失败：${e.message}`)
  } finally {
    setProgress(100)
  }
}

function restartTimers() {
  if (statusTimer) clearInterval(statusTimer)
  if (smsTimer) clearInterval(smsTimer)
  const ms = Math.max(500, Number(state.config.refresh_ms) || 1000)
  const smsMs = Math.max(3000, Number(state.config.sms_refresh_ms) || 10000)
  statusTimer = setInterval(() => refreshStatus(false), ms)
  smsTimer = setInterval(() => refreshSms(false), smsMs)
  log('info', `轮询已启动：状态 ${ms} ms / 短信 ${smsMs} ms`)
}

export async function initApp() {
  log('info', `F50 Pro Monitor v1.0.1 启动 · ${state.runtime}`)
  installAlertListeners()
  await loadConfig()
  restartTimers()
  await Promise.all([refreshStatus(true), refreshSms(true)])
  setProgress(100)
}

/* ------------------------------------------------------------------ */
/* 写操作（统一二次确认 + 日志留痕）                                      */
/* ------------------------------------------------------------------ */
export function askConfirm(payload) {
  return new Promise(resolve => {
    state.confirm = { ...payload, resolve }
  })
}
export function resolveConfirm(ok) {
  const c = state.confirm
  state.confirm = null
  if (c?.resolve) c.resolve(!!ok)
}

export async function guardedAction({ title, message, detail, danger = false, action, success }) {
  const ok = await askConfirm({ title, message, detail, danger })
  if (!ok) { log('info', `已取消：${title}`); return false }
  state.busy = true
  setProgress(20, false)
  try {
    const r = await action()
    const pass = r?.ok !== false
    if (!pass) throw new Error(r?.error || '设备返回失败')
    log('ok', success || `${title} 成功`)
    setProgress(100)
    await refreshStatus(true)
    await refreshSms(false)
    return true
  } catch (e) {
    log('error', `${title} 失败：${e.message}`)
    setProgress(100)
    return false
  } finally {
    state.busy = false
  }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */
export async function copyText(text, label = '内容') {
  try {
    await navigator.clipboard.writeText(String(text))
    log('ok', `${label}已复制到剪贴板`)
    return true
  } catch {
    // WebView2 / http 环境下降级
    try {
      const ta = document.createElement('textarea')
      ta.value = String(text)
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      log('ok', `${label}已复制到剪贴板`)
      return true
    } catch (e) {
      log('error', `复制失败：${e.message}`)
      return false
    }
  }
}

/** 拼接导出路径：原生支持中文与 UNC/SMB（\\host\share\dir） */
export function joinPath(dir, name) {
  const d = String(dir || '').replace(/[\\/]+$/, '')
  if (!d) return name
  const sep = d.includes('\\') ? '\\' : '/'
  return `${d}${sep}${name}`
}

export async function chooseExportDir() {
  const p = await pickFolder()
  if (p) {
    state.config.export_dir = p
    log('ok', `导出目录：${p}`)
  } else {
    log('info', '未选择目录（预览模式可直接填写 UNC 路径）')
  }
  return p
}

export async function exportText(filename, content) {
  const dir = state.config.export_dir
  if (!dir) {
    log('warn', '请先在「设置 → 导出目录」中指定目录（支持 SMB 网络磁盘与中文路径）')
    state.view.settings = true
    return false
  }
  const p = joinPath(dir, filename)
  try {
    const r = await call('export_file', { path: p, content })
    if (r?.ok === false) throw new Error(r.error || '写入失败')
    log('ok', `已导出：${p}（${formatBytes(r.bytes || content.length)}）`)
    return true
  } catch (e) {
    log('error', `导出失败：${e.message}`)
    return false
  }
}

export async function openWeb(url) {
  try {
    const r = await call('open_url', { url })
    if (r?.ok === false) log('info', r.message || '请在浏览器打开 ' + url)
  } catch (e) {
    log('warn', `打开后台失败：${e.message}`)
  }
}
