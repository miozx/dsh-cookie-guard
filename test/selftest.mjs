/**
 * 自测：验证 probe 的两条计数路径，不需要碰被锁定的真实 Cookies。
 *   1) sqlite 路径 —— 造一个结构相同的假库
 *   2) 正则路径 —— 用回收站里的真实 Cookies-journal 副本
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { countWithRegex, countWithSqlite } from '../lib/probe.mjs'

const tmp = join(process.env.TEMP ?? '.', 'cookie-guard-selftest')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}  ${detail ?? ''}`) }
}

/* ---------- 1) sqlite ---------- */
const dbPath = join(tmp, 'Cookies')
const db = new DatabaseSync(dbPath)
db.exec(`
  CREATE TABLE cookies (
    creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL DEFAULT X'',
    path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL DEFAULT 0,
    is_httponly INTEGER NOT NULL DEFAULT 0, last_access_utc INTEGER NOT NULL DEFAULT 0,
    has_expires INTEGER NOT NULL DEFAULT 1, is_persistent INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 1, samesite INTEGER NOT NULL DEFAULT 0,
    source_scheme INTEGER NOT NULL DEFAULT 0, source_port INTEGER NOT NULL DEFAULT -1,
    last_update_utc INTEGER NOT NULL DEFAULT 0, source_type INTEGER NOT NULL DEFAULT 0,
    has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0
  )`)
const ins = db.prepare('INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc) VALUES (?,?,?,?,?,?)')
ins.run(13370000000000000, '127.0.0.1', 'dsh-auth-aaa111', 'x', '/', 13390000000000000)
ins.run(13370000000000001, '127.0.0.1', 'dsh-auth-bbb222', 'x', '/', 13390000000000000)
ins.run(13370000000000002, '127.0.0.1', 'dsh-auth-ccc333', 'x', '/', 13390000000000000)
ins.run(13370000000000003, '.bing.com', '_EDGE_SID', 'x', '/', 13390000000000000)
ins.run(13370000000000004, '127.0.0.1', 'other', 'x', '/', 13390000000000000)
db.close()

const s = await countWithSqlite(dbPath)
if (s.error) console.log('sqlite error:', s.error)
console.log('sqlite 结果:', JSON.stringify({ total: s.total, guard: s.guard, hosts: s.hosts }))
check('sqlite 总行数 = 5', s.total === 5, s.total)
check('sqlite dsh-auth 条数 = 3', s.guard === 3, s.guard)
check('sqlite host 归组正确（只有 127.0.0.1 有 dsh-auth 行）', Array.isArray(s.hosts) && s.hosts.length === 1 && s.hosts[0].c === 3, JSON.stringify(s.hosts))

/* ---------- 2) 正则 ---------- */
const journal = process.argv[2]
if (journal) {
  const buf = readFileSync(journal)
  const r = countWithRegex(buf)
  console.log('regex 结果 :', JSON.stringify({ guard: r.guard, sample: r.names.slice(0, 3) }))
  check('regex 能从真实 journal 里数出名字', r.guard > 0, r.guard)
  check('regex 数出的名字都以 dsh-auth- 开头', r.names.every(n => n.startsWith('dsh-auth-')), JSON.stringify(r.names.slice(0, 3)))
} else {
  // 合成的 journal 片段：格式与真实 Cookies-journal 里的明文一致
  // （host_key + 随机 cookie 名），但**不含任何真实 JWT**。
  const fake = Buffer.from(
    '127.0.0.1\tdsh-auth-AAAA1111bbbb2222\0' +
    '127.0.0.1\tdsh-auth-CCCC3333dddd4444\0' +
    '127.0.0.1\tdsh-auth-AAAA1111bbbb2222\0' +
    '.bing.com\t_EDGE_SID\0',
    'latin1'
  )
  const r = countWithRegex(fake)
  check('regex 去重后 = 2', r.guard === 2, r.guard)
  check('regex 不把无关 cookie 算进来', r.names.every(n => n.startsWith('dsh-auth-')), JSON.stringify(r.names))
}

rmSync(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
