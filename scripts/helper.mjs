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

/* ---------- 4. 清掉残留的子进程 ----------
 * 只杀 DeepSeek Harness.exe 是不够的：它拉起的 node 子进程（billion-context 代理、
 * cloudbase mcp）会活下来。实测：旧实例刚死就立刻拉起新实例，新进程 **0.04 秒就退出、exit=0**
 * —— 这是"单实例交接"行为，说明旧实例的锁还没彻底放开，残留进程会把这个窗口拉长。
 */
const killedPids = unique.map(t => t.pid)
const ps = `
$roots = @(${killedPids.join(',')})
$hit = @()
$all = Get-CimInstance Win32_Process
foreach ($k in ($all | Where-Object { $roots -contains $_.ParentProcessId })) {
  if ($k.Name -eq 'node.exe' -or $k.Name -eq 'conhost.exe') {
    try { Stop-Process -Id $k.ProcessId -Force -ErrorAction Stop; $hit += "$($k.ProcessId)($($k.Name))" } catch {}
  }
}
foreach ($o in ($all | Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -like '*node-shim*' })) {
  try { Stop-Process -Id $o.ProcessId -Force -ErrorAction Stop; $hit += "$($o.ProcessId)(orphan-node)" } catch {}
}
$hit -join ','
`
const crKill = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  encoding: 'utf8',
  windowsHide: true,
})
log('清理残留子进程:', (crKill.stdout || '').trim() || '(没有残留)')

/* ---------- 5. 重新拉起 ---------- */
const exeDir = dirname(exe)
function dshCount() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH', '/FO', 'CSV'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return ((r.stdout || '').match(/DeepSeek Harness\.exe/gi) || []).length
}

/**
 * 先等旧实例从进程表里彻底消失。
 * 上一版的教训：刚 taskkill 完，进程还在"正在结束"状态，tasklist 仍能看到它，
 * 于是 [第 1 次检查：DSH 已经在跑了，不用再拉] 直接把启动跳过了 —— 实际什么都没起来。
 */
let quiet = 0
while (dshCount() > 0 && quiet < 40) {
  sleep(500)
  quiet++
}
log(`等待旧实例退净：${(quiet * 0.5).toFixed(1)} 秒后剩 ${dshCount()} 个 DSH 进程`)

let launched = false
for (let attempt = 1; attempt <= 8 && !launched; attempt++) {
  if (attempt > 1) {
    log('等 3 秒再试（让单实例锁彻底释放）…')
    sleep(3000)
  }
  log(`第 ${attempt} 次拉起:`, exe, '(cwd=' + exeDir + ')')
  let died = null
  // 【关键】必须清掉 ELECTRON_RUN_AS_NODE：
  // 这个 helper 本身是被 DSH 用 ELECTRON_RUN_AS_NODE=1 拉起来的（拿 Electron 当 Node 用），
  // 环境变量会被子进程继承 —— 不清的话 "DeepSeek Harness.exe" 会以 Node 模式启动，
  // 没有脚本参数就直接退出（exit=0，约 40 毫秒），看起来就是"拉不起来"。
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  delete env.ELECTRON_ENABLE_LOGGING
  const child = spawn(exe, [], { cwd: exeDir, env, detached: true, stdio: 'ignore' })
  child.on('exit', code => { died = code === null ? -1 : code })
  // 注意：不能 unref() 后再等 exit —— 这里要留住事件循环才能收到 exit
  let waited = 0
  while (waited < 10000 && died === null) { sleep(500); waited += 500 }

  if (died === null) {
    launched = true
    log(`第 ${attempt} 次拉起成功：进程已存活 ${waited} 毫秒（pid=${child.pid}，tasklist 看到 ${dshCount()} 个）`)
  } else {
    log(`第 ${attempt} 次拉起失败：${waited} 毫秒内退出，exit=${died}（多半是旧实例的锁还在）`)
  }
}

if (!launched) {
  log('ERROR: 拉了 8 次都没起来 —— 请手动双击桌面「DSH（带体检启动）」或直接开 DeepSeek Harness.exe')
} else if (dshCount() === 0) {
  log('注意: spawn 报告存活，但 tasklist 里看不到它，可能是进程名不同')
}

log('=== helper done ===')
process.exit(launched ? 0 : 1)
