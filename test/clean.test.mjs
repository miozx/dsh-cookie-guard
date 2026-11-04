/**
 * clean.mjs 的端到端测试：用一个假的 APPDATA 目录跑真实流程，
 * 绝不碰线上 profile。
 *
 *   node test/clean.test.mjs
 */
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const cleanJs = resolve(here, '..', 'scripts', 'clean.mjs')

const root = join(tmpdir(), 'cg-clean-test-' + process.pid)
const appData = join(root, 'appdata')
const dshHome = join(root, 'dsh-home')
const netDir = join(appData, '@deepseek-ai', 'dsh-desktop', 'Network')
const cookiesPath = join(netDir, 'Cookies')

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}  ${detail ?? ''}`) }
}

function buildDb(rows) {
  rmSync(cookiesPath, { force: true })
  const db = new DatabaseSync(cookiesPath)
  db.exec(`CREATE TABLE cookies (
    creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, name TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '/',
    expires_utc INTEGER NOT NULL DEFAULT 0)`)
  // 注意：creation_utc 在真库里是 1.3e16，超过 2^53。
  // 用 SQL 字面量或 JS number 都会失真（SQLite 会把它当 REAL，尾数被抹平），
  // 必须用 BigInt 绑定，才能得到和 Chromium 写入时一致的 int64。
  const ins = db.prepare('INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc) VALUES (?,?,?,?,?,?)')
  for (const r of rows) ins.run(BigInt(r.c), r.h, r.n, 'v', '/', 0)
  db.close()
}

const count = (where = '1=1') => {
  const db = new DatabaseSync(cookiesPath, { readOnly: true })
  const c = db.prepare(`SELECT COUNT(*) AS c FROM cookies WHERE ${where}`).get().c
  db.close()
  return c
}

const runClean = args =>
  execFileSync(process.execPath, [cleanJs, ...args], {
    env: { ...process.env, APPDATA: appData, DSH_HOME: dshHome },
    encoding: 'utf8',
  })

mkdirSync(netDir, { recursive: true })

/* ---------- 场景 1：超过阈值，默认保留最新 1 条 ---------- */
console.log('\n[1] 5 条 dsh-auth + 2 条无关 cookie，--force')
buildDb([
  { c: 13370000000000001n, h: '127.0.0.1', n: 'dsh-auth-old1' },
  { c: 13370000000000002n, h: '127.0.0.1', n: 'dsh-auth-old2' },
  { c: 13370000000000003n, h: '127.0.0.1', n: 'dsh-auth-old3' },
  { c: 13370000000000004n, h: '127.0.0.1', n: 'dsh-auth-old4' },
  { c: 13370000000000005n, h: '127.0.0.1', n: 'dsh-auth-newest' },
  { c: 13370000000000006n, h: '.bing.com', n: 'SRCHD' },
  { c: 13370000000000007n, h: '127.0.0.1', n: 'unrelated' },
])
const out1 = runClean(['--force'])
check('删除了 4 条', /已删除: 4 条/.test(out1), out1.trim().split('\n').pop())
check('dsh-auth 只剩 1 条', count("name LIKE 'dsh-auth-%'") === 1, count("name LIKE 'dsh-auth-%'"))
const names = () => {
  const db = new DatabaseSync(cookiesPath, { readOnly: true })
  const r = db.prepare('SELECT name FROM cookies ORDER BY name').all().map(x => x.name)
  db.close()
  return r
}
check('保留的是最新那条', count("name = 'dsh-auth-newest'") === 1, 'survivors=' + JSON.stringify(names()))
check('无关 cookie 未受影响（2 条）', count("name NOT LIKE 'dsh-auth-%'") === 2, count("name NOT LIKE 'dsh-auth-%'"))
const backups = readdirSync(join(dshHome, 'cookie-guard', 'backup'))
check('生成了 1 份备份', backups.length === 1, JSON.stringify(backups))
const report = JSON.parse(readFileSync(join(dshHome, 'cookie-guard', 'last-report.json'), 'utf8'))
check('报告 status = cleaned', report.last.status === 'cleaned', report.last.status)
check('报告记录了 removed = 4', report.last.removed === 4, report.last.removed)

/* ---------- 场景 2：低于阈值 → 跳过 ---------- */
console.log('\n[2] 3 条 dsh-auth，默认阈值 40 → 应跳过')
buildDb([
  { c: 13370000000000011, h: '127.0.0.1', n: 'dsh-auth-a' },
  { c: 13370000000000012, h: '127.0.0.1', n: 'dsh-auth-b' },
  { c: 13370000000000013, h: '127.0.0.1', n: 'dsh-auth-c' },
])
const out2 = runClean([])
check('提示低于阈值', /低于阈值/.test(out2), out2.trim())
check('一条都没删', count("name LIKE 'dsh-auth-%'") === 3, count("name LIKE 'dsh-auth-%'"))

/* ---------- 场景 3：--dry-run 不修改 ---------- */
console.log('\n[3] --dry-run --force（10 条）应不修改文件')
buildDb(Array.from({ length: 10 }, (_, i) => ({ c: 13370000000000100 + i, h: '127.0.0.1', n: `dsh-auth-x${i}` })))
const out3 = runClean(['--force', '--dry-run'])
check('提示 dry-run', /\[dry-run\]/.test(out3), out3.trim().split('\n').pop())
check('仍是 10 条', count("name LIKE 'dsh-auth-%'") === 10, count("name LIKE 'dsh-auth-%'"))
check('dry-run 不产生备份', readdirSync(join(dshHome, 'cookie-guard', 'backup')).length === 1, 'backup grew')

/* ---------- 场景 4：--keep=2 ---------- */
console.log('\n[4] --keep=2')
buildDb(Array.from({ length: 5 }, (_, i) => ({ c: 13370000000000200 + i, h: '127.0.0.1', n: `dsh-auth-k${i}` })))
runClean(['--force', '--keep=2'])
check('剩 2 条', count("name LIKE 'dsh-auth-%'") === 2, count("name LIKE 'dsh-auth-%'"))

/* ---------- 场景 5：localhost / [::1] 也要清 ---------- */
console.log('\n[5] localhost 与 [::1] 也纳入清理范围')
buildDb([
  { c: 13370000000000301, h: 'localhost', n: 'dsh-auth-l1' },
  { c: 13370000000000302, h: '[::1]', n: 'dsh-auth-l2' },
  { c: 13370000000000303, h: 'example.com', n: 'dsh-auth-notours' },
])
runClean(['--force', '--keep=0'])
check('本机两种 host 被清空', count("host_key IN ('localhost','[::1]')") === 0, count("host_key IN ('localhost','[::1]')"))
check('外部站点的同名 cookie 不动', count("host_key = 'example.com'") === 1, 'external row removed')

rmSync(root, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
