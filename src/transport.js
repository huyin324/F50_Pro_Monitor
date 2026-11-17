/**
 * 统一传输层：
 *  - Tauri 原生窗口：走 invoke()（Rust 后端）
 *  - 浏览器预览模式：走 /api/<cmd>（Vite 中间件 → server/api.js，Node 直连设备）
 * 两端实现同一套命令与字段，界面无需区分运行环境。
 */
let invokeFn = null

async function tauriInvoke() {
  if (invokeFn) return invokeFn
  if (!window.__TAURI_INTERNALS__) return null
  const mod = await import('@tauri-apps/api/core')
  invokeFn = mod.invoke
  return invokeFn
}

export const isTauri = () => !!window.__TAURI_INTERNALS__

export async function call(cmd, args = {}) {
  const invoke = await tauriInvoke()
  if (invoke) return invoke(cmd, args)

  const res = await fetch(`/api/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  })
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`后端返回非 JSON (HTTP ${res.status})`)
  }
  if (!res.ok || (data && data.ok === false && data.error)) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return data
}

/** 目录选择：Tauri 用原生对话框（支持 SMB/UNC 与中文路径），预览模式返回 null。 */
export async function pickFolder() {
  if (!isTauri()) {
    const r = await call('pick_folder')
    return r?.path || null
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const p = await open({ directory: true, multiple: false, title: '选择导出目录（支持 SMB 网络磁盘与中文路径）' })
  return p || null
}
