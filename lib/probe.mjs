/**
 * dsh-cookie-guard / probe.mjs
 *
 * 只读探针：统计 DSH 桌面端 Cookies 库里 `dsh-auth-*` 条目的数量。
 *
 * 设计原则
 *  - 绝不修改原始 Cookies 文件：先复制到临时目录，只读打开副本。
 *  - 两条互补的计数路径：
 *      1) sqlite（node:sqlite，Node ≥ 22.5）—— 精确按行统计；
 *      2) 正则（字节流）—— 副本被写坏 / 版本不兼容时的兜底。
 *  - 拿不到独占锁时静默重试，失败就返回 unreachable，由调用方决定要不要告警。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const COOKIE_NAME_RE = /dsh-auth-[A-Za-z0-9_-]{6,}/g
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 400

/** 候选 Cookies 路径，按优先级排列 */
export function cookieCandidates(appData = process.env.APPDATA) {
  if (!appData) return []
  const base = join(appData, '@deepseek-ai', 'dsh-desktop')
  return [
    join(base, 'Network', 'Cookies'),
    join(base, 'Cookies'),
  ]
}

export function findCookiesFile(appData) {
  for (const p of cookieCandidates(appData)) {
    if (existsSync(p)) return p
  }
  return null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 把 Cookies 复制到临时目录（带重试），返回副本路径。
 * 原始文件在被 Electron 独占时复制会抛 EBUSY/EPERM，因此必须重试。
 */
export async function copyToTemp(src, { retries = DEFAULT_RETRIES, delayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
  const dir = join(tmpdir(), `dsh-cookie-guard-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const dst = join(dir, 'Cookies')
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      copyFileSync(src, dst)
      return { ok: true, dir, path: dst, attempts: i + 1 }
    } catch (err) {
      lastErr = err
      await sleep(delayMs)
    }
  }
  return { ok: false, dir, path: null, attempts: retries, error: lastErr }
}

/** sqlite 版本（ESM 动态导入，避免顶层 await 依赖） */
export async function countWithSqlite(dbPath) {
  let sqlite
  try {
    sqlite = await import('node:sqlite')
  } catch {
    return null
  }
  const { DatabaseSync } = sqlite
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const total = db.prepare('SELECT COUNT(*) AS c FROM cookies').get().c
    const guard = db.prepare("SELECT COUNT(*) AS c FROM cookies WHERE name LIKE 'dsh-auth-%'").get().c
    const hosts = db.prepare("SELECT host_key, COUNT(*) AS c FROM cookies WHERE name LIKE 'dsh-auth-%' GROUP BY host_key").all()
    // Chromium 的 creation_utc / expires_utc 是微秒级时间戳（约 1.3e16），
    // 超过 Number.MAX_SAFE_INTEGER，node:sqlite 直接读会抛
    // "Value is too large to be represented as a JavaScript number"，所以要 CAST 成文本。
    const oldest = db.prepare("SELECT MIN(CAST(creation_utc AS TEXT)) AS t FROM cookies WHERE name LIKE 'dsh-auth-%'").get().t
    const newest = db.prepare("SELECT MAX(CAST(creation_utc AS TEXT)) AS t FROM cookies WHERE name LIKE 'dsh-auth-%'").get().t
    const sample = db.prepare("SELECT name, host_key, CAST(expires_utc AS TEXT) AS expires_utc FROM cookies WHERE name LIKE 'dsh-auth-%' LIMIT 5").all()
    return { total, guard, hosts, oldest, newest, sample, source: 'sqlite' }
  } catch (err) {
    return { error: String(err?.message ?? err), source: 'sqlite' }
  } finally {
    try { db?.close() } catch {}
  }
}

/** 正则兜底：统计去重后的 cookie 名数量 */
export function countWithRegex(buf) {
  const text = buf.toString('latin1')
  const names = new Set()
  let m
  COOKIE_NAME_RE.lastIndex = 0
  while ((m = COOKIE_NAME_RE.exec(text)) !== null) names.add(m[0])
  return { guard: names.size, names: [...names].slice(0, 10), source: 'regex' }
}

/**
 * 主入口：返回一份体检报告。
 * @returns {Promise<{ok:boolean, path?:string, guard?:number, reason?:string, ...}>}
 */
export async function probe(opts = {}) {
  const src = opts.path ?? findCookiesFile(opts.appData)
  if (!src) return { ok: false, reason: 'cookies-not-found' }

  const copy = await copyToTemp(src, opts)
  if (!copy.ok) {
    return { ok: false, reason: 'locked', path: src, attempts: copy.attempts, error: String(copy.error?.code ?? copy.error) }
  }

  try {
    const sqlite = await countWithSqlite(copy.path)
    let report
    if (sqlite && typeof sqlite.guard === 'number') {
      report = { ok: true, path: src, guard: sqlite.guard, total: sqlite.total, hosts: sqlite.hosts, oldest: sqlite.oldest, newest: sqlite.newest, sample: sqlite.sample, source: 'sqlite' }
    } else {
      const buf = readFileSync(copy.path)
      const rx = countWithRegex(buf)
      report = { ok: true, path: src, guard: rx.guard, names: rx.names, source: 'regex', sqliteError: sqlite?.error }
    }
    report.attempts = copy.attempts
    report.ts = new Date().toISOString()
    return report
  } finally {
    try { rmSync(copy.dir, { recursive: true, force: true }) } catch {}
  }
}

/* ---------- CLI ---------- */
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const json = process.argv.includes('--json')
  const r = await probe()
  if (json) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log('=== dsh-cookie-guard probe ===')
    console.log('cookies :', r.path ?? '(未找到)')
    if (!r.ok) {
      console.log('result  : FAILED -', r.reason, r.error ?? '')
    } else {
      console.log('dsh-auth:', r.guard, `(${r.source})`)
      if (r.hosts) console.log('hosts   :', JSON.stringify(r.hosts))
      if (r.names) console.log('sample  :', r.names.slice(0, 5).join(', '))
      console.log('attempts:', r.attempts)
    }
  }
  process.exit(r.ok ? 0 : 1)
}
