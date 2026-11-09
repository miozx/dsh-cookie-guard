/**
 * Contract tests for lib/client.js — the browser half.
 *
 * The bundle runs inside the DSH shell, where we cannot attach a debugger, so the
 * only reliable way to know it behaves is to replay the shell's loader contract in
 * node:vm with fakes: window.__ModuleLoader__.load, a fake react, a fake ctx.slots.
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

/** A minimal stand-in for the shell: loader, react, optional slots service. */
function runClient(options = {}) {
  const log = []
  const state = { module: null, threw: null, registered: [], rendered: null }
  const react = {
    createElement: (tag, props, ...kids) => ({ tag, props: props ?? {}, kids })
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
            if (options.apply) {
              state.module.apply(makeCtx())
            }
          }
        }
  }
  const sandbox = {
    window,
    location: { origin: options.origin ?? 'dsh-app://app' },
    console: { warn: () => {}, info: () => {}, error: () => {} },
    document: { title: '' },
    Set,
    Object,
    String,
    RegExp,
    Error
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

/* 5-7: registration */
{
  const { state, log } = runClient({ apply: true })
  const desc = state.registered[0] ?? {}
  check('injects into the settings.section slot', log.includes('slot.inject:settings.section'), log.join(','))
  check('registers name=settings.section', desc.name === 'settings.section', desc.name)
  check('registers id=dsh-cookie431', desc.id === 'dsh-cookie431', desc.id)
  check('label() returns Cookie Guard', typeof desc.label === 'function' && desc.label() === 'Cookie Guard')
}

/* 8-10: the rendered section */
{
  const { state } = runClient({ apply: true })
  const tree = state.rendered
  check('component returns an element', !!tree && !!tree.tag, String(tree?.tag))
  const iframe = (tree?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check('section contains an iframe', !!iframe)
  check('iframe points at /cookie-guard/', String(iframe?.props?.src).includes('/cookie-guard/'), iframe?.props?.src)
}

/* 11: boot-URL fallback when the shell origin is not http(s) */
{
  const { state } = runClient({ apply: true, origin: 'dsh-app://app' })
  const tree = state.rendered
  const iframe = (tree?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check(
    'falls back to the __DSH_BOOT__ http origin when origin is dsh-app://',
    iframe?.props?.src === 'http://127.0.0.1:9999/cookie-guard/',
    iframe?.props?.src
  )
}

/* 12-14: never break the host */
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

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
