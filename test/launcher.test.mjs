/**
 * 启动器安装器的测试。
 *
 * 全部写入临时目录（CG_LAUNCHER_DIR / CG_DESKTOP_DIR），**不碰真实桌面、不建真的 .lnk**。
 * 唯一例外是 buildCmd 的纯字符串检查。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'cg-launcher-'))
process.env.CG_LAUNCHER_DIR = join(tmp, 'launcher')
process.env.CG_DESKTOP_DIR = join(tmp, 'desktop')

const { buildCmd, installLauncher, launcherStatus, cmdPath, lnkPath, SHORTCUT_NAME } =
  await import('../lib/launcher.mjs')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  [ok]   ' + name) }
  else { fail += 1; console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')) }
}

console.log('launcher.test · 临时目录 = ' + tmp)

const pkg = 'C:\\Users\\x\\.dsh\\profiles\\desktop\\node_modules\\dsh-cookie431'
const exe = 'C:\\Program Files\\DSH\\DeepSeek Harness.exe'

try {
  /* 1. 生成的 cmd 内容 */
  {
    const c = buildCmd({ pkgRoot: pkg, dshExe: exe })
    ok('以 @echo off 开头', c.startsWith('@echo off'))
    ok('引用了包里的 dsh-launch.cmd', c.includes('%PKG%\\launcher\\dsh-launch.cmd'))
    ok('写入了包路径', c.includes(pkg))
    ok('写入了 DSH 路径', c.includes('set "CG_DSH_EXE=' + exe + '"'))
    ok('找不到包时有提示', c.includes(':missing') && c.includes('pause'))
    ok('结束时返回退出码', c.includes('exit /b %ERRORLEVEL%'))
    ok('只有 CRLF，没有裸 LF', c.split('\r\n').length > 5 && !/[^\r]\n/.test(c))
    ok('纯 ASCII', [...c].every((ch) => ch.charCodeAt(0) < 128))
  }

  /* 2. dry-run 不落盘 */
  {
    const r = installLauncher({ dryRun: true, pkgRoot: pkg, dshExe: exe })
    ok('dry-run ok = true', r.ok === true)
    ok('dry-run 带回内容', typeof r.content === 'string' && r.content.length > 100)
    ok('dry-run 没有写文件', !existsSync(r.cmdPath))
  }

  /* 3. 真正写入（不建快捷方式） */
  {
    const r = installLauncher({ noShortcut: true, pkgRoot: pkg, dshExe: exe })
    ok('ok = true', r.ok === true, r.error)
    ok('cmd 已存在', existsSync(r.cmdPath))
    ok('lnkSkipped = no-shortcut', r.lnkSkipped === 'no-shortcut')
    const text = readFileSync(r.cmdPath, 'ascii')
    ok('磁盘上的内容与生成的一致', text === buildCmd({ pkgRoot: pkg, dshExe: exe }))
    ok('cmdPath 落在 CG_LAUNCHER_DIR 下', r.cmdPath === cmdPath())
    ok('lnkPath 落在 CG_DESKTOP_DIR 下', r.lnkPath === lnkPath() && r.lnkPath.endsWith(SHORTCUT_NAME))
    ok('没有建出 .lnk', !existsSync(r.lnkPath))
  }

  /* 4. 状态查询 */
  {
    const s = launcherStatus()
    ok('installed = true', s.installed === true)
    ok('cmdExists = true', s.cmdExists === true)
    ok('lnkExists = false', s.lnkExists === false)
    ok('路径可回显', s.cmdPath.endsWith('start-dsh.cmd'))
  }

  /* 5. 重复安装是幂等的 */
  {
    const r1 = installLauncher({ noShortcut: true, pkgRoot: pkg })
    const r2 = installLauncher({ noShortcut: true, pkgRoot: pkg })
    ok('两次都能成功', r1.ok && r2.ok)
    ok('第二次不再写 DSH 路径时也能覆盖', readFileSync(cmdPath(), 'ascii').includes('set "PKG=' + pkg + '"'))
  }

  /* 6. 参数缺失也不炸 */
  {
    const r = installLauncher({ dryRun: true })
    ok('不带参数也能给出内容', r.ok === true && r.content.includes('dsh-launch.cmd'))
  }
  /* 7. 启动方式必须脱离控制台（否则关窗口会连 DSH 一起杀掉） */
  {
    const spawnSrc = readFileSync(new URL('../scripts/spawn-dsh.mjs', import.meta.url), 'utf8')
    ok('spawn-dsh 用 detached: true', spawnSrc.includes('detached: true'))
    ok('spawn-dsh 忽略 stdio', spawnSrc.includes("stdio: 'ignore'"))
    ok('spawn-dsh 清掉 ELECTRON_RUN_AS_NODE', spawnSrc.includes('delete env.ELECTRON_RUN_AS_NODE'))
    ok('spawn-dsh 先检查 exe 存在', spawnSrc.includes('existsSync(exe)'))

    const cmdSrc = readFileSync(new URL('../launcher/dsh-launch.cmd', import.meta.url), 'utf8')
    ok('启动器优先走 spawn-dsh', cmdSrc.includes('scripts\\spawn-dsh.mjs'))
    ok('启动器保留退路 start "" /D', cmdSrc.includes('start "" /D "%DSH_DIR%"'))
    ok('启动器不再用 tasklist 死等 12 秒', !cmdSrc.includes('GEQ 12'))
    ok('启动器纯 ASCII', [...cmdSrc].every((ch) => ch.charCodeAt(0) < 128))
    ok('启动器只有 CRLF', !/[^\r]\n/.test(cmdSrc))
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log('')
console.log(fail === 0 ? `ALL PASS (${pass}/${pass})` : `${fail} FAILED, ${pass} passed`)
process.exit(fail === 0 ? 0 : 1)
