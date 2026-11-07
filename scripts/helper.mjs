/**
 * dsh-cookie-guard / helper.mjs
 *
 * 「清理并重启」的执行体。由面板的 POST /cookie-guard/api/clean 拉起，
 * 拉起后**面板立刻回应**（202），剩下的活由本进程在后台做完。
 *
 * 为什么必须脱离出去：DSH 一被关掉，托管面板的那个进程也跟着没了；
 * 如果清理逻辑跑在面板进程里，它会跟着一起死在中途。
 *
 * 安全铁律
 *  1. **只按 PID 杀**，永远不用 `taskkill /im DeepSeek Harness.exe` 这种按名字杀的写法
 *     （2026-10-28 我就是用按名字杀把用户桌面搞黑过一次）；
 *  2. 杀之前先把进程链查出来、写进日志，杀完逐条确认真的没了；
 *  3. 只杀「从 host 往上数、连续同名的那一串」的最顶层，不碰别的实例；
 *  4. 任何一步失败都写日志并退出，绝不盲目继续。
 *
 * 用法（一般由路由自己调，不用手敲）
 *   node scripts/helper.mjs --host <hostPid> --exe "D:\...\DeepSeek Harness.exe" --launcher "...\launcher\dsh-launch.cmd"
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')

const argv = process.argv.slice(2)
const arg = (name, dflt = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

const hostPid = Number(arg('--host', '0'))
const exe = arg('--exe', 'D:\\Deepseek\\DeepSeek Harness.exe')
const launcher = arg('--launcher', join(projectRoot, 'launcher', 'dsh-launch.cmd'))
const dryRun = argv.includes('--dry-run')
const logDir = join(projectRoot, 'logs')
const logPath = join(logDir, 'helper.log')

mkdirSync(logDir, { recursive: true })
const log = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`
  try { appendFileSync(logPath, line) } catch {}
  try { process.stdout.write(line) } catch {}
}

/** 同步睡一会儿（不 spawn 子进程，避免每次都起一个 node） */
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

log('=== helper start ===', `host=${hostPid}`, `exe=${exe}`)

if (!hostPid) {
  log('没有拿到 host PID，放弃。')
  process.exit(2)
}

/* ---------- 1. 查进程链 ---------- */
function processChain(pid) {
  const ps = `$p=${pid};$out=@();for($i=0;$i -lt 12;$i++){$x=Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue;if(-not $x){break};$out+="$($x.ProcessId)|$($x.Name)|$($x.ParentProcessId)";if($x.ParentProcessId -eq 0){break};$p=$x.ParentProcessId};$out -join ';'`
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0 || !r.stdout) {
    log('查询进程链失败:', (r.stderr || '').trim().slice(0, 200))
    return []
  }
  return r.stdout.trim().split(';').filter(Boolean).map(s => {
    const [pid, name, ppid] = s.split('|')
    return { pid: Number(pid), name, ppid: Number(ppid) }
  })
}

const chain = processChain(hostPid)
if (chain.length === 0) {
  log('进程链为空（host 可能已经退出），仍然继续清理。')
}
for (const c of chain) log(`  chain pid=${c.pid} name=${c.name} ppid=${c.ppid}`)

/* 找出这一串里最顶层的、名字连续的 DSH 进程 */
const exeName = (exe.split(/[\\/]/).pop() || '').toLowerCase()
let killPid = hostPid
let killName = 'host'
for (const c of chain) {
  if (c.name && c.name.toLowerCase() === exeName) {
    killPid = c.pid       // 越往上覆盖，最后留下最顶层
    killName = c.name
  }
}
log(`将终止 pid=${killPid} name=${killName}`)

/* ---------- 1b. 收集它的所有子孙（排除自己） ----------
 * 注意：**不能用 taskkill /T**。helper 自己就是 DSH 的子孙，
 * /T 会顺着树把 helper 也一起杀掉，清理就没人做了。
 * 所以改成：自己算出子孙 PID 清单，逐个按 PID 杀。
 */
function descendants(rootPid) {
  const ps = `$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name;$kids=@{};foreach($p in $all){if(-not $kids.ContainsKey([int]$p.ParentProcessId)){$kids[[int]$p.ParentProcessId]=@()};$kids[[int]$p.ParentProcessId]+=$p};$out=@();$q=New-Object System.Collections.Queue;$q.Enqueue(${rootPid});while($q.Count -gt 0){$cur=$q.Dequeue();if($kids.ContainsKey([int]$cur)){foreach($k in $kids[[int]$cur]){$out+="$($k.ProcessId)|$($k.Name)";$q.Enqueue([int]$k.ProcessId)}}};$out -join ';'`
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0 || !r.stdout) return []
  return r.stdout.trim().split(';').filter(Boolean).map(s => {
    const [pid, name] = s.split('|')
    return { pid: Number(pid), name }
  })
}

const self = process.pid
const childList = descendants(killPid)
/* 只杀 DSH 本体的进程（同一个 exe）。
 * 它们的子进程里混着输入法、我自己的终端等等，没必要牵连 ——
 * 而且解锁 Cookies 只需要那个 Electron 浏览器进程退出。 */
const sameExe = p => (p.name || '').toLowerCase() === exeName || p.pid === killPid
const skipped = childList.filter(p => !sameExe(p))
const targets = [{ pid: killPid, name: killName }, ...childList]
  .filter(p => p.pid && p.pid !== self && sameExe(p))
const seen = new Set()
const unique = targets.filter(p => (seen.has(p.pid) ? false : (seen.add(p.pid), true)))
log(`需要终止 ${unique.length} 个 DSH 进程（已排除 helper 自己 pid=${self}，另跳过 ${skipped.length} 个非 DSH 子进程）：`)
for (const t of unique) log(`  kill pid=${t.pid} name=${t.name}`)
if (skipped.length) log('  跳过: ' + skipped.map(p => `${p.pid}(${p.name})`).join(', '))

if (dryRun) {
  log('--dry-run：只打印计划，不杀进程、不清理、不重启。')
  log('=== helper done (dry-run) ===')
  process.exit(0)
}

/* ---------- 2. 逐个按 PID 终止 ---------- */
function alive(pid) {
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return /^"/.test((r.stdout || '').trim())
}

for (const t of targets) {
  if (!alive(t.pid)) { log(`  pid=${t.pid} 已经不在，跳过`); continue }
  const k = spawnSync('taskkill', ['/PID', String(t.pid), '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  log(`  taskkill pid=${t.pid} exit=${k.status} ${(k.stdout || '').trim().replace(/\s+/g, ' ').slice(0, 120)}`)
}

const deadline = Date.now() + 30_000
let gone = false
while (Date.now() < deadline) {
  if (!alive(killPid)) { gone = true; break }
  sleep(300)
}
log('确认主进程已经退出:', gone)
if (!gone) {
  log('等了 30 秒还没退，放弃本次清理，避免和锁抢文件。')
  process.exit(3)
}

/* 给 Electron 一点时间把句柄都放掉 */
sleep(1200)

/* ---------- 3. 清理 ---------- */
const cleanJs = join(projectRoot, 'scripts', 'clean.mjs')
const cr = spawnSync(process.execPath, [cleanJs, '--force', '--keep', '1'], {
  encoding: 'utf8',
  windowsHide: true,
})
log('clean 退出码:', cr.status)
for (const line of `${cr.stdout || ''}${cr.stderr || ''}`.split(/\r?\n/)) {
  if (line.trim()) log('  clean|', line.trim())
}

/* ---------- 4. 重新拉起（走启动器，日志统一进 launcher.log） ---------- */
const startTarget = existsSync(launcher) ? launcher : exe
log('重新启动:', startTarget)
const s = spawn('cmd', ['/c', 'start', '', startTarget], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
})
s.unref()

log('=== helper done ===')
process.exit(0)
