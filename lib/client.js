/**
 * dsh-cookie-guard — browser half.
 *
 * Loaded by the DSH shell (dsh-app://) as the package's "./client" export.
 * No bundler: the module contract is small enough to hand-write.
 *
 * Contract (verified against dsh-better-sidebar@0.30.1 and dsh-context@0.78.2):
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory(require) -> { name, inject, apply }
 *
 * IMPORTANT: `inject` here is a list of Cordis *service names* in the client app
 * ("slots", "locale", "sessions", ...), NOT package ids. Declaring a package id
 * makes web boot hang with `pending (waiting for service: <id>)`.
 *
 * English-only on purpose: the bundle is served without an explicit charset, and
 * non-ASCII comments have bitten us before.
 */
;(() => {
  const ID = 'dsh-cookie-guard'

  function makeFactory() {
    return (require) => {
      const module = { exports: {} }

      let react = null
      try {
        react = require('react')
      } catch (err) {
        console.error('[cookie-guard] cannot require react; client UI skipped', err)
        module.exports = { name: ID, inject: [], apply: () => {} }
        return module.exports
      }
      const h = react.createElement

      /** Panel lives on the same origin as the shell; fall back to the boot URL. */
      function panelUrl() {
        try {
          const fromLocation = `${location.origin}/cookie-guard/`
          if (String(location.origin).indexOf('http') === 0) return fromLocation
        } catch { /* ignore */ }
        return findHttpUrl() ? `${findHttpUrl()}/cookie-guard/` : '/cookie-guard/'
      }

      /** Depth-first scan of window.__DSH_BOOT__ for an http origin. */
      function findHttpUrl() {
        const seen = new Set()
        const walk = (value, depth) => {
          if (depth > 6 || value === null || typeof value !== 'object') {
            if (typeof value === 'string' && /^https?:\/\/127\.0\.0\.1:\d+/.test(value)) return value
            return null
          }
          if (seen.has(value)) return null
          seen.add(value)
          for (const key of Object.keys(value)) {
            const hit = walk(value[key], depth + 1)
            if (hit) return hit
          }
          return null
        }
        try {
          const hit = walk(window.__DSH_BOOT__, 0)
          if (!hit) return null
          return hit.replace(/\/+$/, '')
        } catch { /* ignore */ }
        return null
      }

      function Section() {
        const url = panelUrl()
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 12 } },
            h('div', { style: { fontSize: 15, fontWeight: 600 } }, 'Cookie Guard'),
            h(
              'div',
              { style: { fontSize: 12, opacity: 0.6, flex: 1 } },
              'dsh-auth cookie growth guard — read-only view of the launch-time check'
            ),
            h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { fontSize: 12 } }, 'Open ↗')
          ),
          h('iframe', {
            src: url,
            title: 'Cookie Guard',
            style: { flex: 1, minHeight: 480, width: '100%', border: '1px solid rgba(127,127,127,.25)', borderRadius: 8, background: '#fff' }
          })
        )
      }

      function apply(ctx) {
        try {
          if (!ctx || !ctx.slots) {
            console.warn('[cookie-guard] ctx.slots unavailable; client UI skipped')
            return
          }
          const dispose = ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: ID, order: 150, label: () => 'Cookie Guard' },
              Section
            )
          )
          console.info('[cookie-guard] settings section registered', typeof dispose)
        } catch (err) {
          console.error('[cookie-guard] failed to register settings section', err)
        }
      }

      module.exports = { name: ID, inject: ['slots'], apply }
      return module.exports
    }
  }

  try {
    if (window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
      window.__ModuleLoader__.load({ id: ID, factory: makeFactory() })
    } else {
      console.warn('[cookie-guard] __ModuleLoader__ missing; client half cannot load')
    }
  } catch (err) {
    console.error('[cookie-guard] client bundle failed', err)
  }
})()
