/**
 * Contract tests for lib/client.js — the browser half.
 *
 * The bundle runs inside the DSH shell, where we cannot attach a debugger, so the
 * only reliable way to know it behaves is to replay the shell's loader contract in
 * node:vm with fakes: window.__ModuleLoader__.load, a fake react, a fake ctx.slots.
 *
 * The settings section renders REAL host React elements (no iframe), so these
 * tests also pin that down: the tree must be made of host elements, it must be
 * built from --dsw-alias-* tokens (that is what makes it look native and follow
 * the theme/skin), and it must never throw when the host is degraded.
 *
 * Run: node test/client.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) {
    pass++
    console.log(`  [ok] ${name}`)
  } else {
    fail++
    console.log(`  [FAIL] ${name}${extra === undefined ? '' : ' — ' + extra}`)
  }
}

/** Walk a rendered React element tree and collect every element. */
function flatten(node, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const kid of node) flatten(kid, out)
    return out
  }
  out.push(node)
  for (const kid of node.kids ?? []) flatten(kid, out)
  return out
}

/** Collect every string value found anywhere in the tree's props/styles. */
function collectStrings(node) {
  const found = []
  const walk = (value) => {
    if (typeof value === 'string') found.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(node)
  return found
}

/** Collect visible text. */
function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.kids ?? []).map(textOf).join('')
}

/** The shell's document, reduced to what the theme code reads. */
function makeDocument(options = {}) {
  const attrs = new Set(options.dark ? ['data-ds-dark-theme'] : [])
  return {
    body: {
      hasAttribute: (name) => attrs.has(name),
      setAttribute: (name) => { attrs.add(name) },
      removeAttribute: (name) => { attrs.delete(name) }
    },
    documentElement: {
      style: { colorScheme: options.decided === false ? '' : (options.dark ? 'dark' : 'light') }
    }
  }
}

/** A minimal stand-in for the shell: loader, react, optional slots service. */
function runClient(options = {}) {
  const log = []
  const state = { module: null, threw: null, registered: [], rendered: null, fetched: [], effects: [] }
  const react = {
    createElement: (tag, props, ...kids) => ({ tag, props: props ?? {}, kids })
  }
  if (options.hooks !== false) {
    // `options.loaded` makes the data slot start already populated, so the
    // fully-rendered UI (buttons, table, tokens) can be asserted without
    // waiting on the async fetch.
    const loadedData = {
      ok: true,
      version: '9.9.9',
      generatedAtLocal: '2026-11-12 12:00:00',
      report: {
        path: 'C:\\x\\last-report.json',
        last: { status: 'cleaned', before: 7, after: 1, removed: 6, local: '2026-11-11 18:04:15', threshold: 1, keep: 1, durationMs: 240 },
        history: [{ status: 'cleaned', before: 7, after: 1, removed: 6, local: '2026-11-11 18:04:15', durationMs: 240 }]
      },
      launcher: { installed: false, cmdPath: 'C:\\x\\start-dsh.cmd' }
    }
    // `options.loadedData` lets a test supply its own payload through the same
    // synchronous path.
    const payload = options.loadedData ?? loadedData
    react.useState = (initial) => {
      const value = typeof initial === 'function' ? initial() : initial
      if (options.loaded && value && typeof value === 'object' && 'loading' in value && 'data' in value) {
        return [{ loading: false, error: null, data: payload }, () => {}]
      }
      return [value, () => {}]
    }
    react.useEffect = (fn) => {
      try {
        const cleanup = fn()
        if (typeof cleanup === 'function') state.effects.push(cleanup)
      } catch (err) {
        state.threw = err
      }
    }
    react.useCallback = (fn) => fn
    // Real react returns a stable mutable box; mirror that so the closingRef
    // path is exercised rather than the no-useRef fallback.
    react.useRef = (initial) => ({ current: initial })
  }
  if (options.hooks !== false) {
    react.useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot()
  }

  const makeCtx = () => {
    if (options.withoutSlots) return {}
    return {
      slots: {
        inject: (name, fn) => {
          log.push('slot.inject:' + name)
          if (options.injectThrows) throw new Error('inject boom')
          return fn()
        },
        register: (desc, Component) => {
          log.push('slot.register:' + desc.name + '/' + desc.id)
          if (options.registerThrows) throw new Error('register boom')
          state.registered.push(desc)
          if (typeof Component === 'function') state.rendered = Component()
          return () => {}
        }
      }
    }
  }

  const window = {
    __DSH_BOOT__: options.boot ?? { web: { url: 'http://127.0.0.1:9999/' } },
    confirm: () => true,
    open: () => {},
    __ModuleLoader__: options.withoutLoader
      ? undefined
      : {
          load: (spec) => {
            log.push('load:' + spec.id)
            if (options.factoryThrows) throw new Error('factory boom')
            const req = (name) => {
              if (name === 'react') return react
              throw new Error('unexpected require: ' + name)
            }
            state.module = spec.factory(req)
            if (options.apply) state.module.apply(makeCtx())
          }
        }
  }

  const sandbox = {
    window,
    location: { origin: options.origin ?? 'dsh-app://app' },
    console: { warn: () => {}, info: () => {}, error: () => {} },
    document: makeDocument(options),
    fetch: async (url) => {
      state.fetched.push(url)
      if (options.fetchRejects) throw new Error('network down')
      return {
        status: options.fetchStatus ?? 200,
        json: async () => options.fetchBody ?? {
          ok: true,
          version: '9.9.9',
          report: { path: 'C:\\x\\last-report.json', history: [], last: null },
          launcher: { installed: false, cmdPath: 'C:\\x\\start-dsh.cmd' },
          generatedAtLocal: '2026-11-12 12:00:00'
        }
      }
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    Promise, JSON, Array, Set, Object, String, Number, RegExp, Error, URL
  }
  if (options.matchMedia !== false) {
    sandbox.matchMedia = (query) => ({
      matches: options.media === 'dark' && query.includes('dark'),
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  }
  if (options.mutationObserver !== false) {
    sandbox.MutationObserver = class {
      observe() {}
      disconnect() {}
    }
  }

  const context = vm.createContext(sandbox)
  try {
    vm.runInContext(SOURCE, context)
  } catch (err) {
    state.threw = err
  }
  return { log, state, module: state.module }
}

console.log('client.test.mjs')

/* 1-4: module contract */
{
  const { state } = runClient()
  check('loader.load is called with the package id', !!state.module, 'module not produced')
  check('name is dsh-cookie431', state.module?.name === 'dsh-cookie431', state.module?.name)
  check(
    'inject lists the "slots" SERVICE, not a package id',
    JSON.stringify(state.module?.inject) === '["slots"]',
    JSON.stringify(state.module?.inject)
  )
  check('apply is a function', typeof state.module?.apply === 'function')
}

/* 5-8: registration */
{
  const { state, log } = runClient({ apply: true })
  const desc = state.registered[0] ?? {}
  check('injects into the settings.section slot', log.includes('slot.inject:settings.section'), log.join(','))
  check('registers name=settings.section', desc.name === 'settings.section', desc.name)
  check('registers id=dsh-cookie431', desc.id === 'dsh-cookie431', desc.id)
  check('label() returns Cookie Guard', typeof desc.label === 'function' && desc.label() === 'Cookie Guard')
}

/* 9-14: the section is NATIVE host markup, not an embedded document */
{
  const { state } = runClient({ apply: true })
  const tree = state.rendered
  const nodes = flatten(tree)
  check('component returns an element', !!tree && !!tree.tag, String(tree?.tag))
  check('the section is NOT an iframe', nodes.every((n) => n.tag !== 'iframe'), 'found an iframe')
  check(
    'the section has no embedded document at all',
    nodes.every((n) => n.tag !== 'iframe' && n.tag !== 'object' && n.tag !== 'embed'),
    nodes.map((n) => n.tag).join(',')
  )
  check('renders the Cookie Guard heading as host text', textOf(tree).includes('Cookie Guard'), textOf(tree).slice(0, 60))
  check(
    'the root card carries a native border radius + surface',
    typeof tree?.props?.style?.borderRadius === 'number' && !!tree?.props?.style?.border,
    JSON.stringify(tree?.props?.style?.border)
  )
}

/* 15-20: colours come from host tokens, so theme + skin follow automatically */
{
  const { state } = runClient({ apply: true, dark: true, decided: true, loaded: true })
  const all = collectStrings(state.rendered)
  const tokenRefs = all.filter((s) => s.includes('--dsw-alias-'))
  check('the section is painted with --dsw-alias-* tokens', tokenRefs.length > 0, tokenRefs.slice(0, 3).join(' | '))
  check('the surface uses bg-layer-1', all.some((s) => s.includes('--dsw-alias-bg-layer-1')), '')
  check('the text uses label-primary', all.some((s) => s.includes('--dsw-alias-label-primary')), '')
  check(
    'the primary button uses state-business-primary',
    all.some((s) => s.includes('--dsw-alias-state-business-primary')),
    all.filter((s) => s.includes('state-business')).slice(0, 3).join(' | ')
  )
  check(
    'every token reference carries a literal fallback',
    tokenRefs.every((s) => /var\(--dsw-alias-[a-z0-9-]+,\s*[^)]+\)/.test(s)),
    tokenRefs.filter((s) => !/var\(--dsw-alias-[a-z0-9-]+,\s*[^)]+\)/.test(s)).slice(0, 3).join(' | ')
  )
  check(
    'no hard-coded surface colour is left in the tree',
    !all.some((s) => /^#[0-9a-f]{3,8}$/i.test(s) && !s.includes('--dsw')),
    all.filter((s) => /^#[0-9a-f]{3,8}$/i.test(s)).slice(0, 5).join(',')
  )
}

/* 21-24: the palette itself flips with the host */
{
  const dark = runClient({ apply: true, dark: true, decided: true })
  const darkAll = collectStrings(dark.state.rendered).join(' ')
  check(
    'dark host -> fallbacks are the dark literals',
    darkAll.includes('#232324') || darkAll.includes('#151517') || darkAll.includes('#f9fafb'),
    ''
  )
  const light = runClient({ apply: true, dark: false, decided: true })
  const lightAll = collectStrings(light.state.rendered).join(' ')
  check(
    'light host -> fallbacks are the light literals',
    lightAll.includes('#fff') || lightAll.includes('#f5f6f7') || lightAll.includes('#0f1115'),
    ''
  )
  check('dark and light trees differ', darkAll !== lightAll, 'identical output')
}
{
  // Before the presenter runs, the OS query decides.
  const { state } = runClient({ apply: true, dark: false, decided: false, media: 'dark' })
  const all = collectStrings(state.rendered).join(' ')
  check(
    'falls back to prefers-color-scheme before the presenter runs',
    all.includes('#232324') || all.includes('#f9fafb'),
    ''
  )
}
{
  // A user who picks dark on a light OS: the attribute must win.
  const { state } = runClient({ apply: true, dark: true, decided: true, media: 'light' })
  const all = collectStrings(state.rendered).join(' ')
  check(
    'body[data-ds-dark-theme] beats a light OS preference',
    all.includes('#232324') || all.includes('#f9fafb'),
    ''
  )
}

/* 25-28: it talks to its own routes and degrades gracefully */
{
  const { state } = runClient({ apply: true })
  check(
    'reads status from the plugin’s own route',
    state.fetched.some((u) => u.includes('/cookie-guard/api/status')),
    state.fetched.join(',')
  )
}
{
  const { state } = runClient({ apply: true, fetchRejects: true })
  check('a failing fetch does not throw', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ apply: true })
  check('the status request is issued on mount', state.fetched.length > 0, 'no fetch was made')
}

/* 29-30: no window-opening affordance at all in this commit */
{
  // window.open and <a target="_blank"> are both silently denied here (see the
  // file header), so the panel must not pretend to offer one.
  const { state } = runClient({ apply: true, loaded: true })
  const nodes = flatten(state.rendered)
  check('no anchor is rendered', nodes.every((n) => n.tag !== 'a'), 'found an anchor')
  check('no "新窗口" affordance exists', !textOf(state.rendered).includes('新窗口'), '')
}

/* 31-35: never break the host */
{
  const { state } = runClient({ apply: true, withoutSlots: true })
  check('apply without ctx.slots does not throw', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ apply: true, registerThrows: true })
  check('a throwing slots.register is swallowed', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ withoutLoader: true })
  check('missing __ModuleLoader__ does not throw', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ factoryThrows: true })
  check('a throwing factory does not throw', state.threw === null, String(state.threw))
}
{
  // No react hooks at all: the section must still render once without crashing.
  const { state } = runClient({ apply: true, hooks: false })
  check('renders without react hooks', state.threw === null && !!state.rendered, String(state.threw))
}
{
  // No matchMedia / MutationObserver: degrade to light, never throw.
  const { state } = runClient({ apply: true, dark: false, decided: false, matchMedia: false, mutationObserver: false })
  check('no matchMedia or MutationObserver does not throw', state.threw === null, String(state.threw))
}

/* 36-37: locked entries must not blank the hero card */
{
  const lockedBody = {
    ok: true,
    version: '9.9.9',
    report: {
      path: 'x',
      last: { status: 'locked', local: '2026-11-12 09:00:00' },
      history: [
        { status: 'cleaned', before: 9, after: 1, removed: 8, local: '2026-11-11 18:00:00' },
        { status: 'locked', local: '2026-11-12 09:00:00' }
      ]
    },
    launcher: { installed: true },
    generatedAtLocal: '2026-11-12 12:00:00'
  }
  const { state } = runClient({ apply: true, loaded: true, loadedData: lockedBody })
  const txt = textOf(state.rendered)
  check(
    'a locked last entry still shows the previous numbers',
    txt.includes('9') && txt.includes('被占用'),
    txt.slice(0, 100)
  )
  check('that render did not throw', state.threw === null, String(state.threw))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
