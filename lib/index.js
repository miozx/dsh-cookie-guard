/**
 * DSH 插件入口（Cordis 形态）。
 *
 * 这一层**只做一件事**：把 lib/routes.mjs 里的接口挂到 DSH 的 webServer 上。
 * 任何异常都不向外抛 —— 插件装坏了顶多是"面板打不开"，绝不能让 DSH 起不来。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { guardDir } from './report.mjs'
import { createRoutes, BASE_PATH } from './routes.mjs'

export const name = 'dsh-cookie-guard'
export const inject = ['webServer']

function note(msg) {
  try {
    const dir = join(guardDir(), 'state')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'mount.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* 日志写不了就算了 */ }
}

export function apply(ctx, config = {}) {
  const base = config.basePath ?? BASE_PATH
  note(`apply() called, base=${base}`)

  const register = (route) => {
    if (!ctx?.webServer?.register) {
      note('ctx.webServer.register 不存在，跳过挂载')
      return
    }
    try {
      const dispose = ctx.webServer.register(route)
      note(`registered ${route.kind} ${route.path}`)
      return dispose
    } catch (err) {
      note(`register failed: ${err?.message ?? err}`)
    }
  }

  try {
    const routes = createRoutes({ base })
    for (const route of routes) {
      // 用 ctx.effect 让 DSH 卸载插件时自动回收
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => register(route))
      } else {
        register(route)
      }
    }
    note('mounted ok')
  } catch (err) {
    note(`apply failed: ${err?.message ?? err}`)
  }
}
