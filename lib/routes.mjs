/**
 * HTTP 接口表 —— 三个"服务窗口"：
 *
 *   GET  /cookie-guard/                面板页面（HTML）
 *   GET  /cookie-guard/api/status      只读状态（JSON）
 *   POST /cookie-guard/api/clean       清理 + 重启（第 3 步开发中，现在返回 501）
 *
 * 设计要点：
 *  - 这里不 import 任何 DSH 的内部模块，只依赖 node:http 的 req/res 形状，
 *    所以同一份代码既能挂进 DSH（ctx.webServer.register），也能用
 *    scripts/panel-serve.mjs 单独起一个服务器给你看效果。
 *  - 只注册**一个** prefix 路由，内部再分派，减少注册面积。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statusSnapshot } from './report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const PANEL_HTML_PATH = join(here, 'panel.html')

export const BASE_PATH = '/cookie-guard'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function sendJson(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function sendHtml(res, code, html) {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(html)
}

/** 读取面板 HTML（每次读，方便改完刷新就能看到） */
export function readPanelHtml() {
  try {
    return readFileSync(PANEL_HTML_PATH, 'utf8')
  } catch (err) {
    return `<!doctype html><meta charset="utf-8"><title>DSH Cookie Guard</title>` +
      `<h1>面板文件读取失败</h1><pre>${String(err?.message ?? err)}</pre>`
  }
}

/**
 * 创建路由表。
 * @param {object} [opts]
 * @param {string} [opts.base]       挂载前缀，默认 /cookie-guard
 * @param {Function} [opts.status]   取状态数据的函数（测试可注入假数据）
 * @param {Function} [opts.html]     取页面 HTML 的函数
 */
export function createRoutes(opts = {}) {
  const base = (opts.base ?? BASE_PATH).replace(/\/+$/, '')
  const status = opts.status ?? statusSnapshot
  const html = opts.html ?? readPanelHtml

  const handler = async (req, res) => {
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad-request' })
    }

    // 只认 /cookie-guard 与 /cookie-guard/... ，避免和 /cookie-guard-evil 混淆
    if (pathname !== base && !pathname.startsWith(base + '/')) {
      return sendJson(res, 404, { ok: false, error: 'not-found', path: pathname })
    }

    const sub = pathname.slice(base.length).replace(/\/+$/, '') || '/'

    if (sub === '/' || sub === '/index.html') {
      return sendHtml(res, 200, html())
    }

    if (sub === '/api/status') {
      try {
        return sendJson(res, 200, status())
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'status-failed', message: String(err?.message ?? err) })
      }
    }

    if (sub === '/api/clean') {
      // 第 3 步才实现；现在明确告诉调用方"还没做"，绝不假装成功
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'method-not-allowed', allow: 'POST' })
      }
      return sendJson(res, 501, {
        ok: false,
        error: 'not-implemented',
        message: '「清理并重启」是第 3 步，目前还没接上。现在请用启动器（桌面快捷方式）来清理。',
      })
    }

    return sendJson(res, 404, { ok: false, error: 'not-found', path: pathname })
  }

  return [{ kind: 'prefix', path: base, handler }]
}

/** 把请求交给路由表（单前缀，取第一条即可） */
export function makeHandler(routes = createRoutes()) {
  const route = routes[0]
  return (req, res) => route.handler(req, res)
}
