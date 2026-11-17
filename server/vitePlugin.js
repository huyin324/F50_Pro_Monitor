/**
 * Vite 开发/预览中间件：把 /api/<命令> 映射到 server/api.js。
 * 浏览器预览模式由此获得与 Tauri 原生版完全相同的能力（Node 侧直连设备，无 CORS 限制）。
 */
import { handle } from './api.js'

function middleware() {
  return (req, res, next) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/api/')) return next()
    const cmd = url.pathname.slice(5)
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', async () => {
      let args = {}
      try { args = raw ? JSON.parse(raw) : {} } catch { args = {} }
      let status = 200
      let payload
      try {
        payload = await handle(cmd, args)
      } catch (e) {
        status = 200 // 前端统一从 body 判断，避免浏览器把错误吞掉
        payload = { ok: false, error: e?.message || String(e) }
      }
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(payload))
    })
  }
}

export function devApiPlugin() {
  return {
    name: 'f50-pro-dev-api',
    configureServer(server) {
      server.middlewares.use(middleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware())
    }
  }
}
