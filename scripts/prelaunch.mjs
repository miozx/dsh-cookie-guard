/**
 * 启动前体检：在 DSH 还没起来（Cookies 没被锁）的时候先看一眼。
 *
 * 设计原则：**永不阻塞启动**。任何异常都只打印警告，退出码一律 0。
 *
 *   node scripts/prelaunch.mjs [--threshold 40] [--keep 1] [--dry-run]
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { probe } from '../lib/probe.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cleanJs = join(here, 'clean.mjs')

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return dflt
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const threshold = Number(arg('threshold', 40))
const keep = Number(arg('keep', 1))
const dryRun = arg('dry-run', false) === true

const line = '─'.repeat(56)
console.log(line)
console.log('DSH Cookie Guard · 启动前体检')
console.log(line)

let result
try {
  result = await probe()
} catch (err) {
  console.log('  体检失败（不影响启动）:', err.message)
  process.exit(0)
}

if (!result.ok) {
  const lockNote = result.reason === 'locked'
    ? 'Cookies 正被占用（可能 DSH 还在后台跑）→ 跳过，不影响启动'
    : `无法读取：${result.reason ?? result.error ?? 'unknown'}（不影响启动）`
  console.log('  ' + lockNote)
  console.log(line)
  process.exit(0)
}

console.log(`  Cookies 文件 : ${result.path ?? '(未知)'}`)
console.log(`  dsh-auth 条数: ${result.guard}  (总 cookie ${result.total})`)
if (result.newest) console.log(`  最新一条     : ${result.newest}`)
console.log(`  阈值         : ${threshold}`)

if (result.guard <= threshold) {
  console.log('  结论         : 正常，直接启动')
  console.log(line)
  process.exit(0)
}

console.log(`  结论         : 超标 ${result.guard - threshold} 条 → 先清理再启动`)
console.log(line)

const args = [cleanJs, '--force', '--threshold', String(threshold), '--keep', String(keep)]
if (dryRun) args.push('--dry-run')

const r = spawnSync(process.execPath, args, { stdio: 'inherit' })
if (r.error) console.log('  清理器启动失败（不影响启动）:', r.error.message)
else if (r.status !== 0) console.log(`  清理器退出码 ${r.status}（不影响启动）`)

console.log(line)
process.exit(0)
