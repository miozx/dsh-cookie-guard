/**
 * HTTP 接口表 —— 三个"服务窗口"：
 *
 *   GET  /cookie-guard/                面板页面（HTML）
 *   GET  /cookie-guard/api/status      只读状态（JSON）
 *   POST /cookie-guard/api/clean       清理 + 重启（第 3 步）
 *
 * 设计要点：
 *  - 这里不 import 任何 DSH 的内部模块，只依赖 node:http 的 req/res 形状，
 *    所以同一份代码既能挂进 DSH（ctx.webServer.register），也能用
 *    scripts/panel-serve.mjs 单独起一个服务器给你看效果。
 *  - 只注册**一个** prefix 路由，内部再分派，减少注册面积。
 *  - 「清理并重启」先回 202，再让**独立进程**（scripts/helper.mjs）去干活：
 *    因为 DSH 一关，托管这个路由的进程也一起没了。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statusSnapshot } from './report.mjs'
import { installLauncher, launcherStatus } from './launcher.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')
export const PANEL_HTML_PATH = join(here, 'panel.html')
export const HELPER_PATH = join(projectRoot, 'scripts', 'helper.mjs')
export const LAUNCHER_PATH = join(projectRoot, 'launcher', 'dsh-launch.cmd')
export const CLIENT_LOG_PATH = join(projectRoot, 'logs', 'client.log')

export const BASE_PATH = '/cookie-guard'

/** 是否真的跑在 DSH（Electron 宿主）里 —— 独立预览服务器里没有 electron */
export function insideDsh() {
  return Boolean(process.versions && process.versions.electron)
}

/** 默认的清理实现：拉一个脱离进程，然后立刻返回 */
export function spawnHelper({ exe = process.execPath, launcher = LAUNCHER_PATH } = {}) {
  const child = spawn(
    process.execPath,
    [HELPER_PATH, '--host', String(process.pid), '--exe', exe, '--launcher', launcher],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // 在 DSH 里 process.execPath 是 DeepSeek Harness.exe，
      // 必须让 Electron 以 Node 模式跑，否则会再开一个应用窗口。
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  )
  child.unref()
  return { ok: true, started: true, helperPid: child.pid ?? null, simulated: false }
}

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
 * @param {Function} [opts.clean]    执行「清理并重启」（测试注入桩，默认拉 helper）
 */
export function createRoutes(opts = {}) {
  const base = (opts.base ?? BASE_PATH).replace(/\/+$/, '')
  // 状态里带上"启动器装没装"：面板要靠它决定显示「去安装」还是「用桌面快捷方式启动」
  const status = opts.status ?? (() => ({ ...statusSnapshot(), launcher: launcherStatus() }))
  const html = opts.html ?? readPanelHtml
  const install = opts.install ?? ((o = {}) => installLauncher({
    ...o,
    // 在 DSH 里 process.execPath 就是 DSH 自己，把它写进启动器，省得猜安装位置
    dshExe: o.dshExe ?? (insideDsh() ? process.execPath : ''),
  }))
  const clean = opts.clean ?? (() => (insideDsh() ? spawnHelper() : {
    ok: true, started: false, simulated: true,
    message: '预览模式（不是从 DSH 里打开的）：不会真的重启，只演示按钮流程。',
  }))

  /** 防连点：两秒内只允许一次 */
  let lastCleanAt = 0

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
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'method-not-allowed', allow: 'POST' })
      }
      if (Date.now() - lastCleanAt < 2000) {
        return sendJson(res, 429, { ok: false, error: 'too-soon', message: '刚刚已经发起过了，别再连点。' })
      }
      lastCleanAt = Date.now()
      try {
        const result = clean()
        return sendJson(res, 202, { ok: true, ...result })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'clean-failed', message: String(err?.message ?? err) })
      }
    }

    if (sub === '/api/install-launcher') {
      // npm / 插件市场装进来的人没有桌面启动器 —— 这里给他一键补上。
      // 只写两个东西：%LOCALAPPDATA%\dsh-cookie431\start-dsh.cmd 和一个桌面快捷方式，
      // 都是可逆的（删掉即可），不碰注册表、不碰系统目录。
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'method-not-allowed', allow: 'POST' })
      }
      let body = ''
      req.on('data', (chunk) => { if (body.length < 1024) body += chunk })
      req.on('end', () => {
        let want = {}
        try { want = body ? JSON.parse(body) : {} } catch { want = {} }
        try {
          const result = install({ force: Boolean(want.force) })
          return sendJson(res, result.ok ? 200 : 500, result)
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: 'install-failed', message: String(err?.message ?? err) })
        }
      })
      return
    }

    if (sub === '/api/client-log') {
      // 浏览器半侧的自检上报：它到底有没有被加载、注册有没有成功。
      // 客户端跑在别人的页面里，出问题我看不到控制台，所以让它往这里扔一行。
      const method = (req.method ?? 'GET').toUpperCase()
      if (method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'method-not-allowed', allow: 'POST' })
      }
      let body = ''
      req.on('data', (chunk) => {
        if (body.length < 8192) body += chunk
      })
      req.on('end', () => {
        try {
          mkdirSync(join(projectRoot, 'logs'), { recursive: true })
          appendFileSync(CLIENT_LOG_PATH, `${new Date().toISOString()} ${body.slice(0, 8000)}\n`)
        } catch { /* 记日志失败不该影响浏览器 */ }
        sendJson(res, 204, { ok: true })
      })
      return
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
