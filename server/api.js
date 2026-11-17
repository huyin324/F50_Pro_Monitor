/**
 * F50_Pro_Monitor · Node 预览后端（与 Rust/Tauri 后端共用 protocol.json）
 *
 * 用途：
 *  1. 一键启动.bat 的浏览器预览模式：Vite 中间件把 /api/<cmd> 转发到这里，
 *     由 Node 直接访问 192.168.0.1，无需 Rust 工具链即可完整使用全部功能。
 *  2. 作为 Rust 后端的行为参照实现（同一份协议常量、同一套字段派生规则）。
 *
 * 安全约定：默认只做只读轮询；所有写操作均由前端二次确认后显式调用。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
const RUNTIME = path.join(ROOT, '.runtime')
const CONFIG_FILE = path.join(RUNTIME, 'config.json')
const TRAFFIC_FILE = path.join(RUNTIME, 'traffic.json')
export const PROTOCOL = JSON.parse(fs.readFileSync(path.join(ROOT, 'protocol.json'), 'utf8'))

fs.mkdirSync(RUNTIME, { recursive: true })

export const DEFAULT_CONFIG = {
  base_url: 'http://192.168.0.1',
  // 默认登录密码为空：首次使用请在「设置」中填写本机管理口令。
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

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch {
    return { ...fallback }
  }
}

let config = readJson(CONFIG_FILE, DEFAULT_CONFIG)
let trafficState = readJson(TRAFFIC_FILE, { date: '', baseline: 0, last_seen: 0, last_seen_at: 0 })
let sessionCookie = ''
let loggedIn = false
let lastLoginAt = 0
let lastError = ''
let capacityCache = { total: 0, received: 0, sent: 0, draft: 0, sim_total: 0 }

/* ------------------------------------------------------------------ */
/* 基础工具                                                             */
/* ------------------------------------------------------------------ */

/** 固件 js/util.js 的 sha256 输出为【大写十六进制】，内层结果原样参与外层拼接。 */
export function sha256Upper(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase()
}

const num = (v, d = 0) => {
  if (v === undefined || v === null || v === '' || v === 'null' || v === 'undefined') return d
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : d
}
const str = (v) => (v === undefined || v === null ? '' : String(v))
const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = o?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return ''
}

/** 实时速率：与设备 web 首页 home.js → util.js::transUnit(x, true) 完全一致（入参 B/s）。 */
export function formatWebSpeed(bytesPerSec) {
  const v = num(bytesPerSec, 0)
  if (v <= 0) return PROTOCOL.speed.zero_text
  const bits = v * PROTOCOL.speed.bits_multiplier
  for (const u of PROTOCOL.speed.units) {
    const r = bits / u.divisor
    if (r >= PROTOCOL.speed.min_ratio) {
      return `${Math.round(r * 100) / 100}${u.unit}/s`
    }
  }
  return `${Math.round(bits * 100) / 100}b/s`
}

/** 签约速率（AMBR / QCI）：与 util.js::formatBandwidth 一致（入参 kbps）。 */
export function formatBandwidth(kbps) {
  const v = num(kbps, 0)
  if (v <= 0) return '— —'
  if (v >= 1e6) return `${String(parseFloat((v / 1e6).toFixed(2)))} Gbps`
  if (v >= 1e3) return `${String(parseFloat((v / 1e3).toFixed(2)))} Mbps`
  return `${String(parseFloat(v.toFixed(2)))} kbps`
}

export function formatBytes(bytes) {
  const b = num(bytes, 0)
  if (b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  const d = i === 0 ? 0 : (v >= 100 ? 1 : 2)
  return `${v.toFixed(d)} ${units[i]}`
}

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysToReset(resetDay) {
  const d = new Date()
  const day = Math.min(31, Math.max(1, num(resetDay, 1)))
  let target = new Date(d.getFullYear(), d.getMonth(), day)
  if (target <= new Date(d.getFullYear(), d.getMonth(), d.getDate())) {
    target = new Date(d.getFullYear(), d.getMonth() + 1, day)
  }
  return Math.max(0, Math.ceil((target - d) / 86400000))
}

/* ------------------------------------------------------------------ */
/* HTTP 层（保持 JSESSIONID 会话）                                       */
/* ------------------------------------------------------------------ */

function baseUrl() {
  return str(config.base_url).replace(/\/+$/, '') || 'http://192.168.0.1'
}

async function http(pathname, { method = 'GET', form = null, timeout = 6000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const headers = {
    Referer: `${baseUrl()}/index.html`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) F50ProMonitor/1.0'
  }
  if (sessionCookie) headers.Cookie = sessionCookie
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
  try {
    const res = await fetch(baseUrl() + pathname, {
      method,
      headers,
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: controller.signal,
      redirect: 'manual'
    })
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
    for (const c of setCookies) {
      const kv = c.split(';')[0].trim()
      if (kv.toUpperCase().startsWith('JSESSIONID=')) sessionCookie = kv
    }
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    return { status: res.status, text, json }
  } finally {
    clearTimeout(timer)
  }
}

async function cmdGet(commands, { timeout = 6000 } = {}) {
  const p = `/goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=${encodeURIComponent(commands)}`
  const r = await http(p, { timeout })
  if (r.status === 401 || /none secure connection/i.test(r.text)) {
    const e = new Error('会话未认证')
    e.unauthorized = true
    throw e
  }
  if (!r.json || typeof r.json !== 'object') throw new Error(`接口返回异常 (HTTP ${r.status})`)
  if (r.json.Error) {
    const e = new Error(`设备返回错误: ${r.json.Error}`)
    e.unauthorized = true
    throw e
  }
  return r.json
}

/* ------------------------------------------------------------------ */
/* 登录 / AD 鉴权                                                        */
/* ------------------------------------------------------------------ */

async function login(passwordOverride) {
  // 关键：密码为空时【绝不】向设备发 LOGIN 请求。
  // 否则「恢复默认」后 1 秒轮询会用空密码反复登录，消耗 psw_fail_num_str，
  // 等用户填好正确密码时设备已进入登录保护，login() 会直接「跳过登录」而连不上。
  const pwd = str(passwordOverride === undefined ? config.password : passwordOverride)
  if (!pwd) {
    const e = new Error('尚未设置 Web 登录密码，请在「设置 → 设备连接」中填写')
    e.needConfig = true   // 标记：这是本地配置缺失，不是认证失败，禁止重试
    throw e
  }
  // 登录失败会消耗设备剩余尝试次数；锁定或余数不足时直接放弃，避免把账户锁死。
  try {
    const lock = await cmdGet(PROTOCOL.commands.lock)
    const remaining = num(lock.psw_fail_num_str, 5)
    const lockSeconds = num(lock.login_lock_time, 0)
    if (lockSeconds > 0 || remaining < 3) {
      throw new Error(`设备登录保护中（剩余 ${remaining} 次 / 锁定 ${lockSeconds} 秒），已跳过登录`)
    }
  } catch (e) {
    if (e.unauthorized) throw new Error('无法读取登录保护状态，已跳过登录')
    throw e
  }

  const ld = str((await cmdGet(PROTOCOL.auth.ld_cmd)).LD)
  if (!ld) throw new Error('无法获取 LD 挑战值，请检查设备地址')
  const passwordHash = sha256Upper(sha256Upper(pwd) + ld)
  const res = await http('/goform/goform_set_cmd_process', {
    method: 'POST',
    form: { isTest: 'false', goformId: PROTOCOL.auth.login_goform_id, password: passwordHash }
  })
  const result = res.json?.result
  const ok = ['0', '4', 0, 4].includes(result)
  if (!ok) {
    loggedIn = false
    // 不要盲目重试：失败会消耗尝试次数。
    throw new Error(`登录失败 result=${result}（请核对管理密码；连续失败会锁定设备）`)
  }
  sessionCookie = sessionCookie || ''
  loggedIn = true
  lastLoginAt = Date.now()
  return true
}

async function ensureLogin(force = false) {
  if (force || !loggedIn) return login()
  // 会话约 10 分钟过期；每轮用 loginfo 确认，过期则重新登录。
  const li = await cmdGet(PROTOCOL.commands.loginfo)
  if (str(li.loginfo).toLowerCase() === 'ok') return true
  return login()
}

async function withAuth(work) {
  try {
    await ensureLogin()
    return await work()
  } catch (e) {
    // 本地配置缺失时不能重试，否则一次请求会连发两次 LOGIN。
    if (e?.needConfig) throw e
    if (e.unauthorized || /会话|认证|401/i.test(str(e.message))) {
      await login()
      return await work()
    }
    throw e
  }
}

async function getAD() {
  const ver = await cmdGet(PROTOCOL.commands.versions)
  const wa = str(pick(ver, 'wa_inner_version', 'wa_version'))
  const cr = str(ver.cr_version)
  const rd = str((await cmdGet(PROTOCOL.auth.rd_cmd)).RD)
  if (!rd) throw new Error('无法获取 RD，无法生成 AD 鉴权参数')
  return sha256Upper(sha256Upper(wa + cr) + rd)
}

async function postGoform(form) {
  return withAuth(async () => {
    const ad = await getAD()
    const res = await http('/goform/goform_set_cmd_process', {
      method: 'POST',
      form: { isTest: 'false', ...form, AD: ad },
      timeout: 8000
    })
    return res.json || {}
  })
}

/* ------------------------------------------------------------------ */
/* 状态解析                                                             */
/* ------------------------------------------------------------------ */

function deriveStatus(main, dump) {
  const C = PROTOCOL.commands
  const P = PROTOCOL.ppp_status
  const ppp = str(pick(main, 'ppp_status'))
  const connected = /connected/i.test(ppp) && !/disconnected/i.test(ppp)
  const connText = P[ppp] || (ppp ? ppp : '未知')

    // 速率：优先使用 web 管理端同源的 flux_ 字段（B/s）；仅当字段缺失才回退旧字段。
  const dlRaw = main[PROTOCOL.speed.raw_field_dl] !== undefined
    ? num(main[PROTOCOL.speed.raw_field_dl])
    : num(main[PROTOCOL.speed.fallback_dl])
  const ulRaw = main[PROTOCOL.speed.raw_field_ul] !== undefined
    ? num(main[PROTOCOL.speed.raw_field_ul])
    : num(main[PROTOCOL.speed.fallback_ul])

  const rx = num(pick(main, 'monthly_rx_bytes', 'flux_monthly_rx_bytes'))
  const tx = num(pick(main, 'monthly_tx_bytes', 'flux_monthly_tx_bytes'))
  const monthlyTotal = rx + tx
  const sessionRx = num(pick(main, 'flux_realtime_rx_bytes', 'realtime_rx_bytes'))
  const sessionTx = num(pick(main, 'flux_realtime_tx_bytes', 'realtime_tx_bytes'))
  const sessionTime = num(pick(main, 'flux_realtime_time', 'realtime_time', 'monthly_time'))

  // 当日用量：设备 B28 固件 day_* 为空，按「月初计数差值」本地跟踪。
  const today = todayStr()
  const now = Date.now()
  if (trafficState.date !== today) {
    trafficState = { date: today, baseline: monthlyTotal, last_seen: monthlyTotal, last_seen_at: now }
  } else if (!trafficState.baseline && monthlyTotal > 0) {
    trafficState.baseline = monthlyTotal
  }
  trafficState.last_seen = monthlyTotal
  trafficState.last_seen_at = now
  fs.writeFileSync(TRAFFIC_FILE, JSON.stringify(trafficState, null, 2), 'utf8')
  const dailyTotal = Math.max(0, monthlyTotal - num(trafficState.baseline))

  const quotaUnit = str(config.quota_unit || 'GB').toUpperCase()
  const unitMul = quotaUnit === 'TB' ? 1024 ** 4 : quotaUnit === 'MB' ? 1024 ** 2 : 1024 ** 3
  const quotaBytes = num(config.monthly_quota_gb) * unitMul
  const quotaUsedPct = quotaBytes > 0 ? Math.min(100, (monthlyTotal / quotaBytes) * 100) : 0
  const resetDay = config.quota_auto_reset
    ? num(pick(main, 'flux_clear_date', 'data_volume_clear_date'), num(config.quota_reset_day, 1))
    : num(config.quota_reset_day, 1)

  const netType = str(pick(main, 'network_type'))
  const nrBands = str(pick(dump, 'Nr_bands', 'nr5g_action_band'))
  const signalbar = Math.min(5, Math.max(0, num(pick(main, 'signalbar', 'network_signalbar'))))
  const rsrp = pick(dump, 'nr_rsrp', 'Z5g_rsrp', '5g_rsrp', 'lte_rsrp', 'Nr_signal_strength')
  const rsrq = pick(dump, 'nr_rsrq', 'Z5g_rsrq', '5g_rsrq', 'lte_rsrq')
  const snr = pick(dump, 'Nr_snr', 'nr_snr', 'Z5g_snr', '5g_snr', 'lte_snr')
  const pin = str(pick(main, 'sim_pin_status', 'pin_status'))
  const simStatus = /^(1|2|3)$/.test(pin) ? '需要 PIN/PUK' : (str(main.sim_slot) ? '已就绪' : '未检测到')

  return {
    online: true,
    error: null,
    ts: new Date().toLocaleString('zh-CN', { hour12: false }),

    // 硬件 / 连接状态（原版在 F50 Pro 上缺失的部分）
    ppp_status: ppp,
    connected,
    connection_text: connText,
    modem_main_state: str(pick(main, 'mc_modem_main_state', 'modem_main_state')),
    dial_mode: str(main.dial_mode),
    opms_wan_mode: str(main.opms_wan_mode),
    uptime_sec: sessionTime,
    sim_status: simStatus,
    sim_slot: str(main.sim_slot),
    sim_pin_status: pin,
    roaming: str(pick(main, 'network_simcard_roam', 'simcard_roam')),
    roam_setting_option: str(main.roam_setting_option),
    wifi_onoff_state: str(main.wifi_onoff_state),
    wifi_access_sta_num: num(main.wifi_access_sta_num),
    ssid: str(main.wifi_chip1_ssid1_ssid),
    usb_port_switch: str(main.usb_port_switch),

    // 网络 / 信号
    network_type: netType,
    network_type_text: netType === 'NR5G-SA' ? '5G SA' : (netType || '未知'),
    network_provider: str(pick(main, 'network_provider_fullname', 'network_provider')),
    plmn: str(dump.plmn),
    signalbar,
    rsrp: str(rsrp),
    rsrq: str(rsrq),
    sinr: str(snr),
    nr_signal_strength: str(dump.Nr_signal_strength),
    nr_bands: nrBands,
    nr_band_widths: str(dump.Nr_band_widths),
    nr_fcn: str(dump.Nr_fcn),
    nr_pci: str(dump.Nr_pci),
    nr_cell_id: str(dump.Nr_cell_id),
    nr_tac: str(dump.nr_tac),
    dl_ambr: str(main.dl_ambr),
    ul_ambr: str(main.ul_ambr),
    qci: str(main.qci),
    net_select: str(pick(main, 'network_net_select', 'net_select')),
    network_mode_text: (PROTOCOL.network_modes.find(m => m.value === str(pick(main, 'network_net_select', 'net_select'))) || {}).label || '自动 5G',

    // 速率（字段原始值为 B/s；显示单位与 web 首页 transUnit 一致）
    dl_bps: dlRaw,
    ul_bps: ulRaw,
    dl_text: formatWebSpeed(dlRaw),
    ul_text: formatWebSpeed(ulRaw),

    // 流量 / 套餐
    monthly_rx_bytes: rx,
    monthly_tx_bytes: tx,
    monthly_total_bytes: monthlyTotal,
    session_rx_bytes: sessionRx,
    session_tx_bytes: sessionTx,
    daily_total_bytes: dailyTotal,
    quota_bytes: quotaBytes,
    quota_used_pct: quotaUsedPct,
    quota_remaining_bytes: quotaBytes > 0 ? Math.max(0, quotaBytes - monthlyTotal) : 0,
    quota_reset_day: resetDay,
    days_to_reset: daysToReset(resetDay),
    device_limit_bytes: parseDeviceLimit(main),
    device_limit_switch: num(pick(main, 'flux_data_volume_limit_switch', 'data_volume_limit_switch')),

    // 短信
    sms_unread_num: num(pick(main, 'sms_unread_num', 'sms_dev_unread_num')),
    sms_nv_total: capacityCache.total,
    sms_nv_rev_total: capacityCache.received,

    // 硬件指标：B28 固件仅提供 cpu_temperature，其余保持 null 以便 UI 优雅显示「--」
    cpu_temperature: pick(main, 'cpu_temperature') === '' ? null : num(main.cpu_temperature),
    cpu_usage: pick(main, 'cpu_utility') === '' ? null : num(main.cpu_utility),
    mem_usage: pick(main, 'mem_utility') === '' ? null : num(main.mem_utility),
    battery_value: num(main.battery_value, -1),
    battery_charging: str(main.battery_charging),

    // 地址 / 身份（设备信息弹窗使用）
    wan_ipaddr: str(main.wan_ipaddr),
    ipv6_wan_ipaddr: str(main.ipv6_wan_ipaddr),
    lan_ipaddr: str(main.lan_ipaddr),
    mac_address: str(main.mac_address),
    iccid: str(main.iccid),
    imsi: str(main.imsi),
    imei: str(main.imei),
    sim_msisdn: str(main.sim_msisdn),
    web_version: str(main.web_version),
    wa_inner_version: str(main.wa_inner_version),
    cr_version: str(main.cr_version),
    hardware_version: str(main.hardware_version),
    model_name: str(main.model_name),
    loginfo: str(main.loginfo)
  }
}

function parseDeviceLimit(d) {
  const size = str(pick(d, 'flux_data_volume_limit_size', 'data_volume_limit_size'))
  const unit = str(pick(d, 'flux_data_volume_limit_unit', 'data_volume_limit_unit')).toLowerCase()
  if (!size || size === '0') return 0
  const n = num(size)
  if (!n) return 0
  if (unit === 'gb' || unit === '1' || unit === 'g') return n * 1024 ** 3
  if (unit === 'mb' || unit === '0' || unit === 'm') return n * 1024 ** 2
  if (unit === 'tb' || unit === '2' || unit === 't') return n * 1024 ** 4
  return n < 1000 ? n * 1024 ** 3 : n * 1024 ** 2
}

/* ------------------------------------------------------------------ */
/* 短信                                                                 */
/* ------------------------------------------------------------------ */

function parseSmsDate(raw) {
  const s = str(raw).replace(/\+.*$/, '').trim()
  if (!s) return ''
  const p = s.split(/[,;]/).map(x => x.trim())
  if (p.length < 6) return str(raw)
  const yy = Number(p[0])
  const year = yy > 70 ? 1900 + yy : 2000 + yy
  const pad = x => String(x).padStart(2, '0')
  return `${year}-${pad(p[1])}-${pad(p[2])} ${pad(p[3])}:${pad(p[4])}:${pad(p[5])}`
}

function decodeSmsContent(raw) {
  const s = str(raw)
  if (!s) return ''
  try {
    const buf = Buffer.from(s, 'base64')
    const text = buf.toString('utf8')
    // Base64 解码失败或乱码时保留原文
    if (!text || /\uFFFD/.test(text)) return s
    return text
  } catch {
    return s
  }
}

async function fetchSmsList(variant) {
  const tpl = PROTOCOL.sms.path
  const url = tpl
    .replace('{page}', variant.page)
    .replace('{size}', variant.page_size)
    .replace('{mem}', variant.mem_store)
    .replace('{tags}', variant.tags)
  const r = await http(url)
  if (!r.json || !Array.isArray(r.json.messages)) return null
  return r.json.messages
}

async function getSms() {
  return withAuth(async () => {
    let raw = await fetchSmsList(PROTOCOL.sms.primary)
    let used = 'SIM / 全部'
    if (!raw || raw.length === 0) {
      const fb = await fetchSmsList(PROTOCOL.sms.fallback)
      if (fb && fb.length) { raw = fb; used = '设备 / 全部' }
      else raw = raw || []
    }
    const messages = raw.map(m => ({
      id: str(m.id),
      number: str(m.number),
      local_number: str(m.local_number),
      content: decodeSmsContent(m.content),
      date_raw: str(m.date),
      date: parseSmsDate(m.date),
      tag: str(m.tag),
      unread: str(m.tag) === PROTOCOL.sms.tag_unread,
      store: used
    })).sort((a, b) => Number(b.id) - Number(a.id))

    let capacity = {}
    try { capacity = await cmdGet(PROTOCOL.commands.sms_capacity) } catch { /* 忽略 */ }
    capacityCache = {
      total: num(capacity.sms_nv_total),
      received: num(capacity.sms_nv_rev_total),
      sent: num(capacity.sms_nv_send_total),
      draft: num(capacity.sms_nv_draftbox_total),
      sim_total: num(capacity.sms_sim_total)
    }
    return {
      ok: true,
      messages,
      unread: messages.filter(m => m.unread).length,
      capacity: { ...capacityCache },
      source: used
    }
  })
}

/** UTF-16BE 十六进制（与 web util.js::encodeMessage / F50 Pro 固件一致）。 */
function encodeSmsBody(text, lowercase) {
  let out = ''
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0)
    if (cp > 0xFFFF) {
      // 代理对：web 端会合成完整码点（5~6 位十六进制）
      const hex = cp.toString(16).toUpperCase()
      out += lowercase ? hex.toLowerCase() : hex
    } else {
      const hex = cp.toString(16).toUpperCase().padStart(4, '0')
      out += lowercase ? hex.toLowerCase() : hex
    }
  }
  return out
}

function currentSmsTime() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  const tz = d.getTimezoneOffset() < 0 ? `+${-d.getTimezoneOffset() / 60}` : `${-d.getTimezoneOffset() / 60}`
  return `${String(d.getFullYear()).slice(2)};${p(d.getMonth() + 1)};${p(d.getDate())};${p(d.getHours())};${p(d.getMinutes())};${p(d.getSeconds())};${tz}`
}

/* ------------------------------------------------------------------ */
/* 命令分发                                                             */
/* ------------------------------------------------------------------ */

async function statusSnapshot() {
  const main = await cmdGet(PROTOCOL.commands.main)
  let dump = {}
  try { dump = await cmdGet(PROTOCOL.commands.dump) } catch (e) { lastError = `信号 dump 读取失败: ${e.message}` }
  return deriveStatus(main, dump)
}

async function getStatus() {
  try {
    const result = await withAuth(statusSnapshot)
    lastError = ''
    return result
  } catch (e) {
    return {
      online: false,
      need_config: !!e?.needConfig,
      error: e.message || String(e),
      ts: new Date().toLocaleString('zh-CN', { hour12: false })
    }
  }
}

/**
 * 保存配置 / 填写密码后【立即】重新连接：清掉旧会话 → 强制重新登录 → 取一次状态。
 * 不等 1 秒轮询，也不受前端 refreshing 锁影响。
 */
async function reconnect() {
  loggedIn = false
  sessionCookie = ''
  lastLoginAt = 0
  lastError = ''
  if (!str(config.password)) {
    return {
      online: false,
      need_config: true,
      error: '尚未设置 Web 登录密码，请在「设置 → 设备连接」中填写',
      ts: new Date().toLocaleString('zh-CN', { hour12: false })
    }
  }
  try {
    await login()            // 立即登录，成功即建立会话
    // 刚登录成功，直接取状态，不再走 ensureLogin 的 loginfo 检查，避免多余请求/二次登录。
    const result = await statusSnapshot()
    lastError = ''
    return result
  } catch (e) {
    return {
      online: false,
      need_config: !!e?.needConfig,
      error: e.message || String(e),
      ts: new Date().toLocaleString('zh-CN', { hour12: false })
    }
  }
}

async function getDeviceInfo() {
  return withAuth(async () => {
    const d = await cmdGet(PROTOCOL.commands.device)
    let dump = {}
    try { dump = await cmdGet(PROTOCOL.commands.dump) } catch { /* 忽略 */ }
    const s = await getStatus()
    let cap = {}
    try { cap = await cmdGet(PROTOCOL.commands.sms_capacity) } catch { /* 忽略 */ }
    return {
      sim_msisdn: str(pick(d, 'sim_msisdn', s.sim_msisdn)),
      iccid: str(pick(d, 'sim_iccid', 'iccid', s.iccid)),
      imsi: str(pick(d, 'sim_imsi', 'imsi', s.imsi)),
      imei: str(pick(d, 'imei', s.imei)),
      imei_0: str(d.imei_0),
      imei_1: str(d.imei_1),
      web_version: str(pick(d, 'web_version', s.web_version)),
      wa_inner_version: str(pick(d, 'wa_inner_version', s.wa_inner_version)),
      wa_version: str(d.wa_version),
      cr_version: str(pick(d, 'cr_version', s.cr_version)),
      hardware_version: str(pick(d, 'hardware_version', s.hardware_version)),
      model_name: str(pick(d, 'model_name', s.model_name)),
      market_name: str(d.market_name),
      network_provider: str(pick(d, 'network_provider_fullname', s.network_provider)),
      plmn: str(dump.plmn || `${str(d.network_rmcc)}${str(d.network_rmnc)}`),
      network_type: str(pick(d, 'network_type', s.network_type)),
      net_select: str(pick(d, 'network_net_select', 'net_select', s.net_select)),
      opms_wan_mode: str(pick(d, 'opms_wan_mode', s.opms_wan_mode)),
      ppp_status: str(pick(d, 'ppp_status', s.ppp_status)),
      ssid: str(d.wifi_chip1_ssid1_ssid),
      lan_ipaddr: str(pick(d, 'lan_ipaddr', s.lan_ipaddr)),
      wan_ipaddr: str(pick(d, 'wan_ipaddr', s.wan_ipaddr)),
      ipv6_wan_ipaddr: str(pick(d, 'ipv6_wan_ipaddr', s.ipv6_wan_ipaddr)),
      mac_address: str(pick(d, 'mac_address', s.mac_address)),
      local_domain: str(d.LocalDomain),
      station_ip_addr: str(d.station_ip_addr),
      pdp_type: str(pick(d, 'pdp_type_ui', 'apn_pdp_type')),
      cpu_temperature: str(pick(d, 'cpu_temperature', s.cpu_temperature)),
      dl_ambr: str(pick(d, 'dl_ambr', s.dl_ambr)),
      ul_ambr: str(pick(d, 'ul_ambr', s.ul_ambr)),
      nr_bands: str(dump.Nr_bands),
      nr_cell_id: str(dump.Nr_cell_id),
      nr_pci: str(dump.Nr_pci),
      nr_fcn: str(dump.Nr_fcn),
      nr_tac: str(dump.nr_tac),
      wifi_access_sta_num: num(pick(d, 'wifi_access_sta_num', s.wifi_access_sta_num)),
      sms_capacity_total: str(pick(cap, 'sms_nv_total')) || str(capacityCache.total),
      sms_capacity_used: str(pick(cap, 'sms_nv_rev_total')) || str(capacityCache.received),
      firmware_label: str(pick(d, 'web_version', 'wa_inner_version', s.web_version)) || 'F50ProV1.0.0B28',
      fetched_at: new Date().toLocaleString('zh-CN', { hour12: false })
    }
  })
}

async function diagnose() {
  const items = []
  const cases = [
    ['登录保护状态', PROTOCOL.commands.lock],
    ['版本信息(AD 依据)', PROTOCOL.commands.versions],
    ['RD 挑战值', PROTOCOL.auth.rd_cmd],
    ['主状态轮询', PROTOCOL.commands.main],
    ['NR 小区 dump', PROTOCOL.commands.dump],
    ['短信容量', PROTOCOL.commands.sms_capacity],
    ['登录状态', PROTOCOL.commands.loginfo]
  ]
  await ensureLogin().catch(() => {})
  for (const [name, q] of cases) {
    try {
      const d = await cmdGet(q)
      const keys = Object.keys(d)
      items.push({ name, ok: true, cmd: q, keys: keys.length, sample: JSON.stringify(d).slice(0, 700) })
    } catch (e) {
      items.push({ name, ok: false, cmd: q, keys: 0, sample: e.message })
    }
  }
  try {
    const sms = await fetchSmsList(PROTOCOL.sms.primary)
    items.push({ name: '短信列表(原生 80)', ok: Array.isArray(sms), cmd: PROTOCOL.sms.path, keys: sms?.length ?? 0, sample: `返回 ${sms?.length ?? 0} 条` })
  } catch (e) {
    items.push({ name: '短信列表(原生 80)', ok: false, cmd: PROTOCOL.sms.path, keys: 0, sample: e.message })
  }
  return { base_url: baseUrl(), logged_in: loggedIn, cookie: sessionCookie ? '已获取 JSESSIONID' : '无', items }
}

function saveConfig(next) {
  config = { ...config, ...next }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  loggedIn = false
  sessionCookie = ''
  return { ok: true }
}

/** 清除本机配置并恢复默认参数（默认地址 http://192.168.0.1、默认密码为空）。 */
function resetConfig() {
  config = { ...DEFAULT_CONFIG }
  trafficState = { date: '', baseline: 0, last_seen: 0, last_seen_at: 0 }
  capacityCache = { total: 0, received: 0, sent: 0, draft: 0, sim_total: 0 }
  loggedIn = false
  sessionCookie = ''
  lastLoginAt = 0
  lastError = ''
  // 用默认配置覆盖写回，确保磁盘上也彻底清掉旧密码/旧地址；流量基线文件一并删除。
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  try { fs.unlinkSync(TRAFFIC_FILE) } catch { /* 文件不存在时忽略 */ }
  return { ok: true, config: { ...config } }
}

async function sendNotification(title, body, urlOverride = '', force = false) {
  if (!force && (!config.notify_enabled || !config.notify_url)) {
    return { ok: false, skipped: true, error: '未启用通知或未配置地址' }
  }
  const url = str(urlOverride || config.notify_url)
  try {
    if (url.includes('{title}') || url.includes('{body}')) {
      const u = url.replace('{title}', encodeURIComponent(title)).replace('{body}', encodeURIComponent(body))
      const r = await fetch(u, { method: 'GET' })
      return { ok: r.ok, status: r.status }
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, source: 'F50_Pro_Monitor', at: new Date().toISOString() })
    })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export async function handle(cmd, args = {}) {
  switch (cmd) {
    case 'get_config': return { ...config, password_set: !!config.password }
    case 'save_config': return saveConfig(args.cfg || args.config || args)
    case 'reset_config': return resetConfig()
    case 'reconnect': return reconnect()
    // 浏览器预览模式没有系统托盘/任务栏句柄，图标闪烁由前端用标题 + favicon 实现，这里仅作占位。
    case 'notify_new_sms': return { ok: true, skipped: true, mode: 'browser' }
    case 'clear_new_sms_alert': return { ok: true, mode: 'browser' }
    case 'get_status': return getStatus()
    case 'get_device_info': return getDeviceInfo()
    case 'get_sms': return getSms()

    case 'send_sms': {
      const body = encodeSmsBody(str(args.content), !!config.sms_hex_lowercase)
      const r = await postGoform({
        goformId: PROTOCOL.write.send_sms.goform_id,
        notCallback: 'true',
        Number: str(args.number),
        sms_time: currentSmsTime(),
        MessageBody: body,
        ID: PROTOCOL.write.send_sms.id,
        encode_type: PROTOCOL.write.send_sms.encode_type
      })
      return { ok: str(r.result).toLowerCase() === 'success' || ['0', 0].includes(r.result), raw: r }
    }
    case 'delete_sms': {
      const ids = (args.ids || []).map(String)
      const r = await postGoform({
        goformId: PROTOCOL.write.delete_sms.goform_id,
        notCallback: 'true',
        msg_id: ids.length ? ids.join(';') + ';' : ''
      })
      return { ok: str(r.result).toLowerCase() === 'success', raw: r }
    }
    case 'mark_sms_read': {
      const ids = (args.ids || []).map(String)
      const r = await postGoform({
        goformId: PROTOCOL.write.mark_read.goform_id,
        msg_id: ids.length ? ids.join(';') + ';' : '',
        tag: PROTOCOL.write.mark_read.tag
      })
      return { ok: str(r.result).toLowerCase() === 'success' || ['0', 0].includes(r.result), raw: r }
    }
    case 'set_network_mode': {
      const mode = str(args.mode)
      if (!PROTOCOL.network_modes.some(m => m.value === mode)) throw new Error('未知网络模式')
      const r = await postGoform({
        goformId: PROTOCOL.write.network_mode.goform_id,
        BearerPreference: mode
      })
      return { ok: str(r.result).toLowerCase() === 'success' || ['0', 0].includes(r.result), raw: r }
    }
    case 'set_mobile_data': {
      const on = !!args.enabled
      const w = on ? PROTOCOL.write.mobile_data_on : PROTOCOL.write.mobile_data_off
      const r = await postGoform({ goformId: w.goform_id, notCallback: w.not_callback })
      return { ok: str(r.result).toLowerCase() === 'success' || ['0', 0].includes(r.result), raw: r }
    }

    case 'diagnose': return diagnose()
    case 'send_notification': return sendNotification(str(args.title), str(args.body), str(args.url), !!args.force)
    case 'export_file': {
      const p = str(args.path)
      if (!p) throw new Error('导出路径为空')
      // 直接交给 Node fs：原生支持中文路径与 UNC/SMB 网络磁盘路径（\\host\share\...）。
      fs.writeFileSync(p, str(args.content), 'utf8')
      return { ok: true, bytes: Buffer.byteLength(str(args.content), 'utf8') }
    }
    case 'pick_folder': return { ok: false, path: null, message: '浏览器预览模式请直接填写 UNC 路径；Tauri 原生版支持目录选择对话框' }
    case 'open_url': return { ok: false, message: '预览模式下请在浏览器打开：' + str(args.url) }
    case 'set_autostart': return { ok: false, message: '开机自启仅在 Tauri 原生版可用' }
    case 'get_autostart': return false
    case 'get_log': return { lines: [] }
    default: throw new Error(`未知命令: ${cmd}`)
  }
}
