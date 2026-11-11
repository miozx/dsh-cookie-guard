// spawn-dsh.mjs — start DSH detached from the console that launched us.
//
// Why this exists: `start "" exe` from a .cmd gives DSH the launcher console.
// Closing that window sends CTRL_CLOSE to every process attached to it, so DSH
// dies with the window. The panel's "clean and restart" button never had this
// problem because helper.mjs spawns with { detached: true, stdio: 'ignore' }.
// Same trick here, so the launcher window can be closed (or simply finishes)
// without taking DSH down with it.
//
// Usage: node spawn-dsh.mjs --exe "<path to DSH.exe>" [--wait 2500] [--dry-run]
// Exit codes: 0 started (or already-running handoff), 2 bad args, 3 exe missing,
//             1 process died within the wait window with a non-zero code.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

const argv = process.argv.slice(2)

function opt(name, fallback) {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return fallback
}

const exe = opt('exe', '')
const waitMs = Number(opt('wait', '2500'))
const dryRun = argv.includes('--dry-run')

if (!exe) {
  console.error('spawn-dsh: --exe is required')
  process.exit(2)
}
if (!existsSync(exe)) {
  console.error('spawn-dsh: exe not found: ' + exe)
  process.exit(3)
}

// A launcher started by DSH inherits ELECTRON_RUN_AS_NODE=1; the exe would then
// run as Node with no script and exit in ~40ms. Strip the Electron switches.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE
delete env.ELECTRON_ENABLE_LOGGING

const cwd = dirname(exe)

if (dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, exe, cwd, waitMs }))
  process.exit(0)
}

const child = spawn(exe, [], { cwd, detached: true, stdio: 'ignore', env })
let exit = null
child.on('exit', (code, signal) => { exit = { code, signal } })
child.on('error', (err) => { exit = { error: String(err && err.message || err) } })
child.unref()

const startedAt = Date.now()

setTimeout(() => {
  const waitedMs = Date.now() - startedAt
  // Exited with 0 right away = the single-instance lock handed off to a running
  // copy, which is the normal outcome when DSH is already open.
  const ok = exit === null || (exit.code === 0 && !exit.error)
  console.log(JSON.stringify({ ok, pid: child.pid, exit, waitedMs }))
  process.exit(ok ? 0 : 1)
}, waitMs)
