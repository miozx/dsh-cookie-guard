/**
 * prelaunch.mjs 的端到端测试：假 APPDATA，绝不碰线上 profile。
 *   node test/prelaunch.test.mjs
 */
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const prelaunchJs = resolve(here, '..', 'scripts', 'prelaunch.mjs')

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}  ${detail ?? ''}`) }
}

function sandbox(count) {
  const root = mkdtempSync(join(tmpdir(), 'cg-pre-'))
  const appData = join(root, 'appdata')
  const dshHome = join(root, 'home')
  const netDir = join(appData, '@deepseek-ai', 'dsh-desktop', 'Network')
  mkdirSync(netDir, { recursive: true })
  const p = join(netDir, 'Cookies')
  const db = new DatabaseSync(p)
  db.exec(`CREATE TABLE cookies (creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,
    name TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '/',
    expires_utc INTEGER NOT NULL DEFAULT 0)`)
  const ins = db.prepare('INSERT INTO cookies (creation_utc,host_key,name) VALUES (?,?,?)')
  for (let i = 0; i < count; i++) {
    ins.run(BigInt(13370000000000000 + i), '127.0.0.1', `dsh-auth-x${i}`)
  }
  db.close()
  return { root, appData, dshHome, p }
}

const run = (env, args) =>
  execFileSync(process.execPath, [prelaunchJs, ...args], {
    env: { ...process.env, APPDATA: env.appData, DSH_HOME: env.dshHome },
    encoding: 'utf8',
  })

console.log('\n[1] 3 条，低于阈值 → 不清理、退出码 0')
{
  const s = sandbox(3)
  const out = run(s, ['--threshold', '40'])
  check('提示正常，直接启动', /正常，直接启动/.test(out), out.trim())
  check('没有生成备份', !existsSync(join(s.dshHome, 'cookie-guard', 'backup')))
  rmSync(s.root, { recursive: true, force: true })
}

console.log('\n[2] 100 条，超阈值 → 自动清理到 1 条')
{
  const s = sandbox(100)
  const out = run(s, ['--threshold', '40'])
  check('检测到超标', /超标 60 条/.test(out), out.trim().split('\n').find(l => l.includes('超标')) ?? out.trim())
  const db = new DatabaseSync(s.p, { readOnly: true })
  const left = db.prepare("SELECT COUNT(*) c FROM cookies WHERE name LIKE 'dsh-auth-%'").get().c
  db.close()
  check('清理后只剩 1 条', left === 1, left)
  check('仍然不生成备份', !existsSync(join(s.dshHome, 'cookie-guard', 'backup')))
  rmSync(s.root, { recursive: true, force: true })
}

console.log('\n[3] 文件不存在 → 不崩、退出码 0')
{
  const s = sandbox(0)
  rmSync(s.p, { force: true })
  const out = run(s, ['--threshold', '40'])
  check('提示无法读取但不影响启动', /不影响启动|跳过/.test(out), out.trim())
  rmSync(s.root, { recursive: true, force: true })
}

console.log('\n[4] --dry-run → 不删任何东西')
{
  const s = sandbox(50)
  run(s, ['--threshold', '40', '--dry-run'])
  const db = new DatabaseSync(s.p, { readOnly: true })
  const left = db.prepare("SELECT COUNT(*) c FROM cookies WHERE name LIKE 'dsh-auth-%'").get().c
  db.close()
  check('50 条原样保留', left === 50, left)
  rmSync(s.root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
