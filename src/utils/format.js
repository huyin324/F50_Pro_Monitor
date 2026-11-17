/** 与 F50 Pro web 管理端 util.js 保持一致的格式化工具 */

/**
 * 实时速率：与设备 web 首页 home.js → util.js::transUnit(x, true) 一致。
 * 入参 B/s；×8 转比特，按 1024 进制取第一个 >=0.5 的单位 → b/s / Kb/s / Mb/s / Gb/s / Tb/s。
 * （注意：util.js 的 formatBandwidth(kbps) 只用于 dl_ambr / ul_ambr 等签约速率。）
 */
export function formatWebSpeed(bytesPerSec) {
  const v = Number(bytesPerSec) || 0
  if (v <= 0) return '0b/s'
  const bits = v * 8
  const units = [
    { d: 1099511627776, u: 'Tb' },
    { d: 1073741824, u: 'Gb' },
    { d: 1048576, u: 'Mb' },
    { d: 1024, u: 'Kb' },
    { d: 1, u: 'b' }
  ]
  for (const x of units) {
    const r = bits / x.d
    if (r >= 0.5) return `${Math.round(r * 100) / 100}${x.u}/s`
  }
  return `${Math.round(bits * 100) / 100}b/s`
}

/** 签约速率 AMBR：与 util.js::formatBandwidth 一致（入参 kbps） */
export function formatBandwidth(kbps) {
  const v = Number(kbps) || 0
  if (v <= 0) return '— —'
  if (v >= 1e6) return `${String(parseFloat((v / 1e6).toFixed(2)))} Gbps`
  if (v >= 1e3) return `${String(parseFloat((v / 1e3).toFixed(2)))} Mbps`
  return `${String(parseFloat(v.toFixed(2)))} kbps`
}

export function formatBytes(bytes) {
  const b = Number(bytes) || 0
  if (b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : (v >= 100 ? 1 : 2))} ${u[i]}`
}

export function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  if (d) return `${d}天 ${h}小时 ${m}分`
  if (h) return `${h}小时 ${m}分 ${ss}秒`
  return `${m}分 ${ss}秒`
}

export function signalQuality(metric, value) {
  const v = parseFloat(String(value).replace(/[^\d.\-]/g, ''))
  if (!Number.isFinite(v)) return { label: '--', color: 'muted', ratio: 0 }
  if (metric === 'rsrp') {
    if (v >= -85) return { label: '极佳', color: 'green', ratio: 1 }
    if (v >= -95) return { label: '良好', color: 'blue', ratio: 0.75 }
    if (v >= -105) return { label: '一般', color: 'orange', ratio: 0.5 }
    return { label: '较差', color: 'red', ratio: 0.25 }
  }
  if (metric === 'rsrq') {
    if (v >= -10) return { label: '极佳', color: 'green', ratio: 1 }
    if (v >= -15) return { label: '良好', color: 'blue', ratio: 0.75 }
    if (v >= -20) return { label: '一般', color: 'orange', ratio: 0.5 }
    return { label: '较差', color: 'red', ratio: 0.25 }
  }
  // SINR / SNR
  if (v >= 20) return { label: '极佳', color: 'green', ratio: 1 }
  if (v >= 13) return { label: '良好', color: 'blue', ratio: 0.75 }
  if (v >= 3) return { label: '一般', color: 'orange', ratio: 0.5 }
  return { label: '较差', color: 'red', ratio: 0.25 }
}

/** 从短信正文提取验证码（支持中文/英文常见写法） */
export function extractCode(text) {
  const s = String(text || '')
  const patterns = [
    /(?:验证码|校验码|动态码|一次性密码|OTP|code|Code)[^0-9]{0,12}([0-9]{4,8})/,
    /\b([0-9]{4,8})\b[^0-9]{0,12}(?:验证码|校验码|动态码|code)/i,
    /(?:^|\D)([0-9]{6})(?:\D|$)/
  ]
  for (const p of patterns) {
    const m = s.match(p)
    if (m) return m[1]
  }
  return ''
}

export function maskIdent(v, enabled) {
  const s = String(v || '')
  if (!enabled || s.length < 8) return s || '--'
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(0, s.length - 8))}${s.slice(-4)}`
}

/** 生成平滑折线路径（原版贝塞尔波形算法） */
export function smoothPath(history, width = 260, height = 48) {
  const pts = (history && history.length >= 2 ? history : [0, 0, 0]).map(v => Number(v) || 0)
  const max = Math.max(1000, ...pts)
  const norm = pts.map(v => Math.min(0.95, Math.max(0.06, v / max)))
  const step = width / (norm.length - 1)
  const c = norm.map((p, i) => ({ x: i * step, y: height * (1 - p) }))
  if (c.length < 2) return { stroke: '', fill: '' }
  let stroke = `M ${c[0].x.toFixed(1)} ${c[0].y.toFixed(1)}`
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = i > 0 ? c[i - 1] : c[i]
    const p1 = c[i]
    const p2 = c[i + 1]
    const p3 = i + 2 < c.length ? c[i + 2] : p2
    const cp1x = p1.x + (p2.x - p0.x) / 5.5
    const cp1y = p1.y + (p2.y - p0.y) / 5.5
    const cp2x = p2.x - (p3.x - p1.x) / 5.5
    const cp2y = p2.y - (p3.y - p1.y) / 5.5
    stroke += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  const fill = `${stroke} L ${c[c.length - 1].x.toFixed(1)} ${height} L ${c[0].x.toFixed(1)} ${height} Z`
  return { stroke, fill }
}
