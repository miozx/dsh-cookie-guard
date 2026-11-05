/**
 * dsh-cookie-guard / clean.mjs
 *
 * 在 **DSH 没有运行** 的时候，清理累积的 `dsh-auth-*` cookie。
 *
 * 为什么必须"没运行"：Electron 对 `Network\Cookies` 与 `Cookies-journal`
 * 都持有独占锁（实测 EBUSY，甚至连 FileShare.ReadWrite 都拒绝），
 * 所以任何"边跑边清"的方案在这个版本上都不成立。
 *
 * 安全原则
 *  1. 先备份（整库复制到 cookie-guard/backup/），备份失败就中止；
 *  2. 只删 `host_key ∈ {127.0.0.1, localhost}` 且 `name LIKE 'dsh-auth-%'` 的行；
 *  3. 默认保留最新的 1 条（避免下次启动直接要求重新登录）；
 *  4. 删完立刻复查条数，并把报告写到 cookie-guard/last-report.json；
 *  5. 支持 --dry-run，什么都不改。
 *
 * 用法
 *   node scripts/clean.mjs                 # 按阈值自动判断
 *   node scripts/clean.mjs --dry-run       # 只看会删多少
 *   node scripts/clean.mjs --force         # 无视阈值，直接清
 *   node scripts/clean.mjs --keep=1        # 保留最新 N 条（默认 1）
 *   node scripts/clean.mjs --threshold=40  # 超过多少条才动手（默认 40）
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_DIR = join(HOME, 'cookie-guard')
const BACKUP_DIR = join(STATE_DIR, 'backup')
const REPORT = join(STATE_DIR, 'last-report.json')

const AUTH_HOSTS = "('127.0.0.1', 'localhost', '[::1]')"
const AUTH_LIKE = "'dsh-auth-%'"

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2)
const has = f => argv.includes(f)
const num = (f, d) => {
  const hit = argv.find(a => a.startsWith(f + '='))
  if (!hit) return d
  const v = Number(hit.slice(f.length + 1))
  return Number.isFinite(v) ? v : d
}
const dryRun = has('--dry-run')
const force = has('--force')
const keep = Math.max(0, num('--keep', 1))
const threshold = Math.max(1, num('--threshold', 40))
const quiet = has('--quiet')

const log = (...a) => { if (!quiet) console.log(...a) }

/* ---------------- 定位 Cookies ---------------- */
function candidates() {
  const appData = process.env.APPDATA
  if (!appData) return []
  const base = join(appData, '@deepseek-ai', 'dsh-desktop')
  return [join(base, 'Network', 'Cookies'), join(base, 'Cookies')]
}

const cookiesPath = candidates().find(p => existsSync(p))
if (!cookiesPath) {
  log('没有找到 Cookies 文件，可能 DSH 从未在此账户下启动过。')
  process.exit(0)
}

/* ---------------- 打开数据库 ---------------- */
async function openDb(p) {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(p, { readOnly: dryRun })
}

let db
try {
  db = await openDb(cookiesPath)
} catch (err) {
  const msg = String(err?.message ?? err)
  if (/locked|busy/i.test(msg)) {
    log('Cookies 正被占用 —— DSH 还在运行。请先完全退出 DSH，再运行本脚本。')
    process.exit(3)
  }
  log('打开数据库失败:', msg)
  process.exit(4)
}

const countGuard = () =>
  db.prepare(`SELECT COUNT(*) AS c FROM cookies WHERE name LIKE ${AUTH_LIKE} AND host_key IN ${AUTH_HOSTS}`).get().c
const countAll = () => db.prepare('SELECT COUNT(*) AS c FROM cookies').get().c
/** Chromium 时间戳 1.3e16 超出 JS 安全整数，必须 CAST 成文本 */
const oldestGuard = () =>
  db.prepare(`SELECT MIN(CAST(creation_utc AS TEXT)) AS t FROM cookies WHERE name LIKE ${AUTH_LIKE}`).get().t
const newestGuard = () =>
  db.prepare(`SELECT MAX(CAST(creation_utc AS TEXT)) AS t FROM cookies WHERE name LIKE ${AUTH_LIKE}`).get().t

let before, total
try {
  before = countGuard()
  total = countAll()
} catch (err) {
  log('读取失败:', String(err?.message ?? err))
  process.exit(4)
}

log('=== dsh-cookie-guard clean ===')
log('cookies :', cookiesPath)
log('总 cookie:', total, ' 其中 dsh-auth:', before)
if (before > 0) log('最早/最新 :', oldestGuard(), '/', newestGuard())

if (!force && before < threshold) {
  log(`低于阈值 ${threshold}，不处理。`)
  finish({ status: 'skipped', before, total, kept: before, removed: 0 })
}

const toDelete = Math.max(0, before - keep)
if (toDelete === 0) {
  log('没有需要删除的条目。')
  finish({ status: 'nothing-to-do', before, total, kept: before, removed: 0 })
}

/* ---------------- 备份 ---------------- */
let backupPath = null
if (!dryRun) {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  backupPath = join(BACKUP_DIR, `cookies-${stamp}.db`)
  try {
    copyFileSync(cookiesPath, backupPath)
    log('备份完成:', backupPath, `(${statSync(backupPath).size} B)`)
    pruneBackups()
  } catch (err) {
    log('备份失败，终止（不冒险）:', String(err?.message ?? err))
    process.exit(5)
  }
}

/* ---------------- 删除 ---------------- */
if (dryRun) {
  log(`[dry-run] 将删除 ${toDelete} 条，保留最新 ${keep} 条。未做任何修改。`)
  finish({ status: 'dry-run', before, total, kept: keep, removed: toDelete, backup: null })
}

/* 保留最新 keep 条：按 creation_utc 倒序，跳过前 keep 条。
   注意用裸列排序而不是 CAST —— 列是 INTEGER 亲和，直接比较是精确的 64 位整数比较。 */
const sql = `
  DELETE FROM cookies
   WHERE name LIKE ${AUTH_LIKE}
     AND host_key IN ${AUTH_HOSTS}
     AND name NOT IN (
       SELECT name FROM cookies
        WHERE name LIKE ${AUTH_LIKE} AND host_key IN ${AUTH_HOSTS}
        ORDER BY creation_utc DESC
        LIMIT ${keep}
     )`
let removed = 0
try {
  const r = db.prepare(sql).run()
  removed = Number(r.changes ?? 0)
  log('已删除:', removed, '条')
  if (has('--vacuum')) {
    db.exec('VACUUM')
    log('VACUUM 完成，文件已收缩到', statSync(cookiesPath).size, 'B')
  }
} catch (err) {
  log('删除失败:', String(err?.message ?? err))
  log('备份仍在:', backupPath)
  process.exit(6)
}

/* ---------------- 复查 ---------------- */
const after = countGuard()
log('清理后 dsh-auth:', after, '（原 ', before, '）')

finish({ status: 'cleaned', before, total, kept: after, removed, backup: backupPath, afterBytes: statSync(cookiesPath).size })

/* ---------------- 收尾 ---------------- */
function finish(rec) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const history = existsSync(REPORT) ? safeRead(REPORT) : []
    const entry = { ts: new Date().toISOString(), ...rec }
    const list = Array.isArray(history) ? history.slice(-49) : []
    list.push(entry)
    writeFileSync(REPORT, JSON.stringify({ last: entry, history: list }, null, 2))
  } catch { /* 报告写不了不影响清理结果 */ }
  try { db?.close() } catch {}
  process.exit(0)
}

function safeRead(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')).history ?? [] } catch { return [] }
}

/** 备份只保留最近 N 份（默认 20），避免每次启动都清时把磁盘堆满 */
function pruneBackups(keepFiles = Number(process.env.PURRGE_GUARD_BACKUPS || 20)) {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('cookies-') && f.endsWith('.db'))
      .map(f => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(keepFiles)) {
      try { unlinkSync(join(BACKUP_DIR, f)) } catch {}
    }
  } catch { /* 清理备份失败不影响主流程 */ }
}
