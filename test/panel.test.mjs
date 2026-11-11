/**
 * 面板接口的端到端测试。
 *
 * 全程只用临时目录（DSH_HOME 指向 tmp），**绝不触碰真实的 ~/.dsh**。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const tmp = mkdtempSync(join(tmpdir(), 'cg-panel-'))
process.env.DSH_HOME = tmp
// 启动器相关路径也指向临时目录：测试绝不能碰真实桌面
process.env.CG_LAUNCHER_DIR = join(tmp, 'launcher')
process.env.CG_DESKTOP_DIR = join(tmp, 'desktop')

const { createRoutes, makeHandler, BASE_PATH } = await import('../lib/routes.mjs')
const { appendReport, reportPath } = await import('../lib/report.mjs')

let pass = 0
let fail = 0
const hits = []

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  [ok]   ' + name) }
  else { fail += 1; console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')) }
}

const cleanCalls = []
const installCalls = []
const routes = createRoutes({
  base: BASE_PATH,
  clean: () => { cleanCalls.push(Date.now()); return { started: true, helperPid: 4242, simulated: false } },
  install: (o) => {
    installCalls.push(o)
    return { ok: true, cmdPath: join(tmp, 'launcher', 'start-dsh.cmd'), lnkCreated: true, lnkPath: join(tmp, 'desktop', 'x.lnk') }
  },
})
const handler = makeHandler(routes)
const server = createServer((req, res) => handler(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

const get = (p, init) => fetch(base + p, { cache: 'no-store', ...init })

console.log('panel.test · 临时目录 = ' + tmp)

try {
  /* 1. 页面能打开 */
  {
    const r = await get(BASE_PATH + '/')
    const body = await r.text()
    ok('GET 面板 → 200', r.status === 200, 'status=' + r.status)
    ok('Content-Type 是 html', /text\/html/.test(r.headers.get('content-type') || ''))
    ok('页面里有标题', body.includes('DSH Cookie Guard'))
    ok('页面里有按钮文案', body.includes('立即清理并重启'))
    hits.push('page')
  }

  /* 2. 没有报告时是空状态 */
  {
    const r = await get(BASE_PATH + '/api/status')
    const j = await r.json()
    ok('空状态 → 200', r.status === 200)
    ok('ok = true', j.ok === true)
    ok('report.empty = true', j.report && j.report.empty === true)
    ok('report.last = null', j.report.last === null)
    ok('history 为空数组', Array.isArray(j.report.history) && j.report.history.length === 0)
    ok('不再暴露 backups 字段', j.backups === undefined, JSON.stringify(j.backups))
    ok('报告路径用的是临时目录', String(j.report.path).startsWith(tmp), j.report.path)
    hits.push('empty')
  }

  /* 3. 写入一条"已清理"记录后能读出来 */
  {
    appendReport({
      ts: new Date('2026-11-06T14:00:00Z').toISOString(),
      status: 'cleaned', source: 'test',
      before: 8, after: 1, removed: 7, keep: 1, threshold: 1,
      durationMs: 240,
    })
    const j = await (await get(BASE_PATH + '/api/status')).json()
    ok('last.before = 8', j.report.last.before === 8, JSON.stringify(j.report.last && j.report.last.before))
    ok('last.after = 1', j.report.last.after === 1)
    ok('last.removed = 7', j.report.last.removed === 7)
    ok('last.status = cleaned', j.report.last.status === 'cleaned')
    ok('history 有 1 条', j.report.history.length === 1)
    ok('local 时间被格式化', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(j.report.last.local || ''), j.report.last.local)
    hits.push('one')
  }

  /* 4. 兼容 clean.mjs 老格式（kept 而不是 after） */
  {
    appendReport({
      ts: new Date('2026-11-06T15:00:00Z').toISOString(),
      status: 'cleaned', before: 3, total: 40, kept: 1, removed: 2, afterBytes: 20480,
    })
    const j = await (await get(BASE_PATH + '/api/status')).json()
    ok('老格式 kept 被映射成 after', j.report.last.after === 1, String(j.report.last.after))
    ok('老字段 backupBytes 已被丢弃', j.report.last.backupBytes === undefined || j.report.last.backupBytes === null, String(j.report.last.backupBytes))
    ok('history 累计 2 条', j.report.history.length === 2)
    ok('history 顺序是时间正序', j.report.history[0].removed === 7 && j.report.history[1].removed === 2)
    hits.push('compat')
  }

  /* 5. 清理接口：POST → 202 并真的调用了 clean（测试里是桩），GET → 405 */
  {
    const rGet = await get(BASE_PATH + '/api/clean')
    ok('GET /api/clean → 405', rGet.status === 405, 'status=' + rGet.status)
    const rPost = await get(BASE_PATH + '/api/clean', { method: 'POST' })
    const body = await rPost.json()
    ok('POST /api/clean → 202', rPost.status === 202, 'status=' + rPost.status)
    ok('返回 started = true', body.started === true, JSON.stringify(body))
    ok('返回 helperPid', body.helperPid === 4242, String(body.helperPid))
    ok('clean() 被调用了一次', cleanCalls.length === 1, 'calls=' + cleanCalls.length)
    const again = await get(BASE_PATH + '/api/clean', { method: 'POST' })
    ok('两秒内连点 → 429', again.status === 429, 'status=' + again.status)
    ok('连点没有再触发 clean()', cleanCalls.length === 1, 'calls=' + cleanCalls.length)
    hits.push('clean202')
  }

  /* 6. 越界路径不能被误认 */
  {
    const a = await get('/nope')
    ok('未知路径 → 404', a.status === 404, 'status=' + a.status)
    const b = await get(BASE_PATH + '-evil')
    ok('前缀相近的路径 → 404', b.status === 404, 'status=' + b.status)
    const c = await get(BASE_PATH)
    ok('/cookie-guard 不带斜杠也能开', c.status === 200, 'status=' + c.status)
    hits.push('routing')
  }

  /* 7. 报告文件真的写到了临时目录 */
  {
    const p = reportPath()
    ok('报告路径在临时目录内', p.startsWith(tmp), p)
  }

  /* 8. 启动器：状态里有 launcher、页面有安装按钮、接口能装 */
  {
    const j = await (await get(BASE_PATH + '/api/status')).json()
    ok('status 带 launcher 段', !!j.launcher, JSON.stringify(j.launcher))
    ok('launcher.installed = false（还没装）', j.launcher.installed === false)
    ok('launcher 路径在临时目录内', String(j.launcher.cmdPath).startsWith(tmp), j.launcher.cmdPath)

    const html = await (await get(BASE_PATH + '/')).text()
    ok('页面有「安装启动器」按钮', html.includes('安装启动器'))
    ok('页面会读 launcher 状态', html.includes('api/install-launcher'))
    ok('空状态文案不再硬编码桌面路径', html.includes('先点下面「安装启动器」') || html.includes('launcherReady'))

    const bad = await get(BASE_PATH + '/api/install-launcher')
    ok('GET /api/install-launcher → 405', bad.status === 405, 'status=' + bad.status)

    const r = await get(BASE_PATH + '/api/install-launcher', { method: 'POST' })
    const b = await r.json()
    ok('POST → 200', r.status === 200, 'status=' + r.status)
    ok('返回 ok + cmdPath', b.ok === true && !!b.cmdPath, JSON.stringify(b))
    ok('install() 被调用', installCalls.length === 1, 'calls=' + installCalls.length)
    hits.push('launcher')
  }
} finally {
  await new Promise(r => server.close(r))
  rmSync(tmp, { recursive: true, force: true })
}

console.log('')
if (fail === 0) {
  console.log(`ALL PASS (${pass}/${pass})`)
  process.exit(0)
} else {
  console.log(`FAILED: ${fail} 项未通过，${pass} 项通过`)
  process.exit(1)
}
