/**
 * 报告文件（账本）的读写。
 *
 * 位置：<DSH_HOME>/cookie-guard/last-report.json
 * 格式：{ "last": {...}, "history": [ ...最多 40 条 ] }
 *
 * 注意：这个格式是 scripts/clean.mjs 早就在用的（它写 {last, history} 且条目里叫 kept），
 * 所以本模块**必须兼容**：读的时候两种字段名都认，写的时候统一成新字段。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const HISTORY_MAX = 40

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
export function guardDir() {
  return join(dshHome(), 'cookie-guard')
}
export function reportPath() {
  return join(guardDir(), 'last-report.json')
}

/** 本地时间字符串，给人看的那种 */
export function localTime(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 把 clean.mjs 的老条目和我们的新条目统一成一种形状 */
export function normalize(entry) {
  if (!entry || typeof entry !== 'object') return null
  const ts = entry.ts ?? entry.at ?? null
  const before = num(entry.before)
  const after = num(entry.after ?? entry.kept)
  const removed = num(entry.removed)
  return {
    ts,
    local: ts ? localTime(new Date(ts)) : (entry.atLocal ?? null),
    status: entry.status ?? 'unknown',
    before,
    after,
    removed,
    keep: num(entry.keep),
    threshold: num(entry.threshold),
    source: entry.source ?? 'clean.mjs',
    durationMs: num(entry.durationMs),
    cookiesPath: entry.cookiesPath ?? null,
  }
}

function num(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function readReport() {
  const path = reportPath()
  if (!existsSync(path)) {
    return { ok: true, empty: true, path, last: null, history: [], error: null }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const history = Array.isArray(raw.history) ? raw.history.map(normalize).filter(Boolean) : []
    const last = normalize(raw.last) ?? history[history.length - 1] ?? null
    return { ok: true, empty: false, path, last, history, error: null }
  } catch (err) {
    return { ok: false, empty: true, path, last: null, history: [], error: String(err?.message ?? err) }
  }
}

/** 追加一条记录（原子写：先写 .tmp 再 rename） */
export function appendReport(entry) {
  const dir = guardDir()
  const path = reportPath()
  const prev = readReport()
  const history = [...prev.history, normalize(entry)].filter(Boolean).slice(-HISTORY_MAX)
  const doc = { last: history[history.length - 1], history }
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(doc, null, 2))
    renameSync(tmp, path)
    return { ok: true, path, history }
  } catch (err) {
    return { ok: false, path, history, error: String(err?.message ?? err) }
  }
}

/** 给面板用的汇总 */
export function statusSnapshot() {
  const report = readReport()
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    generatedAtLocal: localTime(),
    report,
  }
}
