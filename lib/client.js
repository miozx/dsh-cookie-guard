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
 * The settings section renders as REAL host React elements, not an iframe.
 * Every other DSH settings plugin does the same, and the practical difference is
 * large: inside the host document the panel inherits the shell's font stack,
 * focus rings, scrollbars and -- above all -- its `--dsw-alias-*` tokens, so it
 * tracks the active theme *and* any theme skin with no plumbing of its own. An
 * embedded document cannot do any of that: it is a rectangle with its own
 * stylesheet, own scrollbar and a tab stop at the frame boundary.
 *
 * The standalone page (/cookie-guard/) still exists for the browser and launcher
 * path; it is simply not linked from here. window.open and <a target="_blank">
 * cannot reach it: the panel is served from the shell's own port
 * (127.0.0.1:<port>), and the desktop app's webview.setWindowOpenHandler ->
 * allowedNavigation() rejects anything where isApplicationHost(url) is true --
 * same port plus 127.0.0.1/localhost, which is exactly this URL.
 *
 * English-only on purpose: the bundle is served without an explicit charset, and
 * non-ASCII comments have bitten us before.
 */
;(() => {
  const ID = 'dsh-cookie431'

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
      const hasHooks = typeof react.useState === 'function' && typeof react.useEffect === 'function'

      /** Host token with a literal fallback, used when the host has no palette. */
      const token = (name, fallback) => `var(--dsw-alias-${name}, ${fallback})`

      /**
       * Fallbacks only. The host tokens win whenever they exist (they always do
       * inside DSH), so these literals are what a browser-side preview draws.
       * Values mirror DSH's own alias tokens (see lib/panel.html for the table).
       */
      const FALLBACK = {
        dark: {
          text: '#f9fafb', muted: '#adb2b8', cardBg: '#232324',
          border: '#ffffff1f', rowBorder: '#ffffff0f', softBg: '#2c2c2e',
          accent: '#7aaaff', accentText: '#0f1115', ok: '#22c55e', warn: '#f59e0b',
          bad: '#f25a5a', chipBg: '#ffffff14', chipText: '#cfd3d6'
        },
        light: {
          text: '#0f1115', muted: '#81858c', cardBg: '#fff',
          border: '#0000001a', rowBorder: '#00000012', softBg: '#f5f6f7',
          accent: '#4176e6', accentText: '#fff', ok: '#22c55e', warn: '#f59e0b',
          bad: '#ec1313', chipBg: '#f5f6f7', chipText: '#81858c'
        }
      }

      /** Is the shell in its dark palette right now? */
      function isDark() {
        try {
          if (typeof document === 'undefined' || document.body == null) return false
          // The presenter sets html{color-scheme} together with the body
          // attribute, so a set color-scheme is authoritative; without it the
          // OS query is the best guess (same rule as dsh-better-sidebar).
          const decided = document.documentElement.style.colorScheme !== ''
          if (decided || document.body.hasAttribute('data-ds-dark-theme')) {
            return document.body.hasAttribute('data-ds-dark-theme')
          }
        } catch { /* ignore */ }
        try {
          return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
        } catch { /* ignore */ }
        return false
      }

      /**
       * Re-render on a theme flip. Observes the body attribute the presenter
       * toggles plus every other body attribute, because a theme skin switches
       * its palette by setting one of its own (data-dsh-claude-style, ...).
       */
      function subscribeTheme(callback) {
        const disposers = []
        try {
          if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.body != null) {
            const observer = new MutationObserver(() => callback())
            observer.observe(document.body, { attributes: true })
            try {
              observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
            } catch { /* ignore */ }
            disposers.push(() => observer.disconnect())
          }
        } catch { /* ignore */ }
        try {
          if (typeof matchMedia === 'function') {
            const query = matchMedia('(prefers-color-scheme: dark)')
            if (query && typeof query.addEventListener === 'function') {
              const onChange = () => callback()
              query.addEventListener('change', onChange)
              disposers.push(() => query.removeEventListener('change', onChange))
            }
          }
        } catch { /* ignore */ }
        return () => {
          for (const dispose of disposers) {
            try { dispose() } catch { /* ignore */ }
          }
        }
      }

      /** Reactive palette + scheme, so a flip re-renders in place. */
      function useTheme() {
        const read = () => {
          const dark = isDark()
          return { dark, c: FALLBACK[dark ? 'dark' : 'light'] }
        }
        if (typeof react.useSyncExternalStore === 'function') {
          // The store must return a stable reference between flips.
          let lastKey = null
          let lastValue = read()
          const snapshot = () => {
            const next = read()
            const key = next.dark ? 'dark' : 'light'
            if (key !== lastKey) {
              lastKey = key
              lastValue = next
            }
            return lastValue
          }
          return react.useSyncExternalStore(subscribeTheme, snapshot, () => read())
        }
        if (hasHooks) {
          const [, setTick] = react.useState(0)
          react.useEffect(() => subscribeTheme(() => setTick((n) => n + 1)), [])
          return read()
        }
        return read()
      }

      /** Build the inline style sheet for one palette. */
      function styles(c) {
        return {
          card: {
            border: `1px solid ${token('border-l2', c.border)}`,
            borderRadius: 14,
            padding: '20px 22px',
            background: token('bg-layer-1', c.cardBg),
            color: token('label-primary', c.text),
            maxWidth: 720,
            // No explicit font: inheriting the shell's stack is the whole point.
            fontSize: 13
          },
          head: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 },
          title: { fontSize: 15, fontWeight: 600, color: token('label-primary', c.text), lineHeight: 1.3 },
          ver: { fontSize: 11.5, color: token('label-tertiary', c.muted), lineHeight: 1.3 },
          sub: { fontSize: 12.5, color: token('label-tertiary', c.muted), lineHeight: 1.7, margin: '0 0 18px' },
          heroLabel: { fontSize: 12.5, color: token('label-tertiary', c.muted), margin: '0 0 8px' },
          heroRow: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', minHeight: 44 },
          big: { fontSize: 38, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-1px', color: token('label-primary', c.text) },
          bigDim: { fontSize: 30, fontWeight: 600, lineHeight: 1.1, color: token('label-primary', c.text) },
          arrow: { fontSize: 20, color: token('label-tertiary', c.muted), lineHeight: 1.1 },
          when: { fontSize: 12.5, color: token('label-tertiary', c.muted), margin: '10px 0 0', lineHeight: 1.7 },
          grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '18px 0 0' },
          stat: {
            border: `1px solid ${token('border-l1', c.border)}`, borderRadius: 10,
            padding: '12px 14px', background: token('bg-layer-2', c.softBg)
          },
          statKey: { fontSize: 11.5, color: token('label-tertiary', c.muted), margin: '0 0 6px' },
          statVal: { fontSize: 19, fontWeight: 650, color: token('label-primary', c.text) },
          statSuffix: { fontSize: 12, fontWeight: 400, color: token('label-tertiary', c.muted) },
          sectionTitle: { fontSize: 13, fontWeight: 600, color: token('label-secondary', c.muted), margin: '22px 0 8px' },
          table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 2 },
          th: {
            textAlign: 'start', padding: '7px 8px', borderBottom: `1px solid ${token('border-l2', c.border)}`,
            color: token('label-tertiary', c.muted), fontWeight: 500, fontSize: 11.5
          },
          td: {
            textAlign: 'start', padding: '7px 8px',
            borderBottom: `1px solid ${token('border-l1', c.rowBorder)}`, color: token('label-primary', c.text)
          },
          tdNum: { fontVariantNumeric: 'tabular-nums' },
          empty: { color: token('label-tertiary', c.muted), fontSize: 12.5, padding: '16px 0', textAlign: 'center' },
          actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 },
          btnPrimary: {
            padding: '7px 14px', border: 0, borderRadius: 8, cursor: 'pointer', fontSize: 13,
            background: token('state-business-primary', c.accent),
            color: token('label-primary-foreground', c.accentText),
            fontFamily: 'inherit'
          },
          btnGhost: {
            padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
            border: `1px solid ${token('border-l1', c.border)}`,
            background: token('bg-layer-2', c.softBg), color: token('label-primary', c.text),
            fontFamily: 'inherit'
          },
          btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
          btnHint: { fontSize: 12, color: token('label-tertiary', c.muted), lineHeight: 1.7, marginTop: 10 },
          hintBlock: { fontSize: 12, color: token('label-tertiary', c.muted), lineHeight: 1.8 },
          launcherHint: { marginTop: 8 },
          note: { fontSize: 12, marginTop: 8, lineHeight: 1.7 },
          tag: {
            fontSize: 11.5, padding: '2px 9px', borderRadius: 999, fontWeight: 600,
            whiteSpace: 'nowrap'
          },
          dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', marginInlineEnd: 6 },
          foot: { fontSize: 11.5, color: token('label-tertiary', c.muted), lineHeight: 1.8, marginTop: 16 },
          code: {
            background: token('interactive-bg-hover', c.chipBg), padding: '1px 5px',
            borderRadius: 4, fontSize: 11.5, color: token('label-secondary', c.chipText)
          },
          divider: { borderTop: `1px solid ${token('border-l1', c.rowBorder)}`, margin: '16px 0' }
        }
      }

      /**
       * Status -> wording + tone. The settings panel is the only UI that shows
       * these words now, so the table lives here; lib/panel.html keeps its own
       * copy for the standalone page (a separate document cannot import this
       * file, and the two are checked against each other in the tests).
       */
      const STATUS_TABLE = {
        cleaned: { text: '已清理', tone: 'ok' },
        skipped: { text: '未超阈值', tone: 'ok' },
        'nothing-to-do': { text: '无需清理', tone: 'ok' },
        locked: { text: '被占用已跳过', tone: 'warn' },
        error: { text: '出错', tone: 'bad' }
      }

      function describeStatus(status) {
        return STATUS_TABLE[status] || { text: status || '未知', tone: 'info' }
      }

      function statusTag(desc, S, c) {
        const tone = desc.tone || 'info'
        const fg = tone === 'ok' ? c.ok : tone === 'warn' ? c.warn : tone === 'bad' ? c.bad : c.accent
        const name = tone === 'ok' ? 'state-success' : tone === 'warn' ? 'state-warn' : tone === 'bad' ? 'state-error' : 'state-business'
        return h('span', {
          style: {
            ...S.tag,
            color: token(`${name}-primary`, fg),
            background: token(`${name}-tertiary`, c.softBg)
          }
        }, desc.text)
      }

      /** Small fetch helper against the plugin's own routes. */
      async function api(path, init) {
        const res = await fetch(path, { cache: 'no-store', ...init })
        const body = await res.json().catch(() => ({}))
        return { status: res.status, body }
      }

      const API = '/cookie-guard/api'

      function Section() {
        const { c } = useTheme()
        const S = styles(c)

        const [state, setState] = hasHooks
          ? react.useState({ loading: true, error: null, data: null })
          : [{ loading: true, error: null, data: null }, () => {}]
        const [busy, setBusy] = hasHooks ? react.useState('') : ['', () => {}]
        const [note, setNote] = hasHooks ? react.useState(null) : [null, () => {}]
        const [closing, setClosing] = hasHooks ? react.useState(false) : [false, () => {}]

        // `load` must not be rebuilt when `closing` flips (that would restart the
        // interval), so it reads the flag through a ref instead.
        const closingRef = react.useRef ? react.useRef(false) : { current: false }
        closingRef.current = closing

        const load = react.useCallback
          ? react.useCallback(async () => {
              try {
                const { status, body } = await api(`${API}/status`)
                if (status !== 200) throw new Error(`HTTP ${status}`)
                setState({ loading: false, error: null, data: body })
              } catch (err) {
                // After "clean and restart" DSH is exiting on purpose, so the
                // fetch failing is expected -- do not paint it as an error.
                if (closingRef.current) {
                  setState((prev) => (prev && prev.data ? prev : { loading: false, error: null, data: null }))
                  return
                }
                setState({ loading: false, error: String(err && err.message ? err.message : err), data: null })
              }
            }, [])
          : async () => {
              try {
                const { status, body } = await api(`${API}/status`)
                if (status !== 200) throw new Error(`HTTP ${status}`)
                setState({ loading: false, error: null, data: body })
              } catch (err) {
                if (closingRef.current) return
                setState({ loading: false, error: String(err && err.message ? err.message : err), data: null })
              }
            }

        if (react.useEffect) {
          react.useEffect(() => {
            load()
            // Only poll while the section is mounted and DSH is not shutting down.
            if (closing) return undefined
            const timer = setInterval(load, 10000)
            return () => clearInterval(timer)
          }, [load, closing])
        }

        const data = state.data
        const report = (data && data.report) || {}
        const history = Array.isArray(report.history) ? report.history : []
        const last = report.last || null
        const launcher = (data && data.launcher) || null
        const version = (data && data.version) || ''

        // The big card only trusts entries that actually counted cookies: a
        // "locked" entry has no before/after and would turn the whole block into
        // "? -> ?", which carries no information. Take the most recent numeric
        // one (history is chronological, so walk from the end).
        const hasNum = (e) => !!e && e.before !== null && e.before !== undefined
        const shown = history.slice().reverse().find(hasNum) || (hasNum(last) ? last : null)
        const skipped = last && !hasNum(last) ? last : null
        const cleaned = history.filter((e) => e && e.status === 'cleaned')
        const removedTotal = cleaned.reduce((sum, e) => sum + (Number(e.removed) || 0), 0)

        async function runClean() {
          const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(
              '现在会：\n' +
              '1. 关掉 DSH（当前这个对话窗口会跟着关闭）\n' +
              '2. 清掉多余的 dsh-auth cookie\n' +
              '3. 自动重新启动 DSH\n\n' +
              '如果这会儿正在跑任务，先等它跑完再点。继续吗？'
            )
            : true
          if (!ok) return
          setBusy('clean')
          setNote(null)
          try {
            const { status, body } = await api(`${API}/clean`, { method: 'POST' })
            if (body && body.simulated) {
              setNote({ kind: 'info', text: '预览模式：这里不会真的重启（从 DSH 里打开才有这个效果）。' })
            } else if (status === 202) {
              setClosing(true)
              setNote({ kind: 'info', text: '已发起：DSH 会在 2～3 秒内关闭，清理后自动重启。这个页面稍后会断开。' })
            } else {
              setNote({ kind: 'bad', text: '发起失败：' + ((body && (body.message || body.error)) || `HTTP ${status}`) })
            }
          } catch (err) {
            setNote({ kind: 'bad', text: '发起失败：' + (err && err.message ? err.message : err) })
          } finally {
            setBusy('')
          }
        }

        async function installLauncher() {
          setBusy('install')
          setNote(null)
          try {
            const { status, body } = await api(`${API}/install-launcher`, { method: 'POST' })
            const b = body || {}
            if (status === 200 && b.ok) {
              // The original panel listed the desktop shortcut and any notes the
              // installer reported; keep that, it is how you find the thing.
              const lines = ['已创建：' + (b.cmdPath || '')]
              if (b.lnkCreated) lines.push('桌面快捷方式：' + (b.lnkPath || ''))
              if (b.notes && b.notes.length) lines.push('· ' + b.notes.join('\n· '))
              lines.push('下次请用桌面上的「DSH（带体检启动）」启动。')
              setNote({ kind: 'ok', text: lines.join('\n'), pre: true })
            } else {
              setNote({ kind: 'bad', text: '创建失败：' + (b.error || b.message || `HTTP ${status}`) })
            }
            load()
          } catch (err) {
            setNote({ kind: 'bad', text: '创建失败：' + (err && err.message ? err.message : err) })
          } finally {
            setBusy('')
          }
        }

        /* ---- body ---- */

        const rows = []
        rows.push(
          h('div', { key: 'head', style: S.head },
            h('span', { style: S.title }, 'DSH Cookie Guard'),
            version ? h('span', { style: S.ver }, 'v' + version) : null
          )
        )
        rows.push(
          h('div', { key: 'sub', style: S.sub },
            '只看不改。所有数字都来自启动前体检写下的报告，不是估算。'
          )
        )

        if (state.loading) {
          rows.push(h('div', { key: 'loading', style: S.empty }, '正在读取状态…'))
        } else if (state.error) {
          rows.push(h('div', { key: 'err', style: { ...S.empty, color: token('state-error-primary', c.bad) } },
            '读取失败：' + state.error))
        } else {
          // hero
          rows.push(
            h('div', { key: 'hero' },
              h('div', { style: S.heroLabel }, '上一次启动时的 dsh-auth cookie 条数'),
              h('div', { style: S.heroRow },
                h('span', { style: S.big }, shown ? String(shown.before) : '—'),
                h('span', { style: S.arrow }, '→'),
                h('span', { style: S.bigDim }, shown && shown.after != null ? String(shown.after) : '—'),
                shown
                  ? statusTag(describeStatus(shown.status), S, c)
                  : (last ? statusTag(describeStatus(last.status), S, c) : null)
              )
            )
          )

          let whenText
          if (shown) {
            whenText = shown.local || shown.ts || ''
            if (shown.removed) whenText += '　删除了 ' + shown.removed + ' 条'
            if (shown.durationMs) whenText += '　耗时 ' + shown.durationMs + ' ms'
            if (skipped) {
              whenText += '　·　最近一次 ' + (skipped.local || skipped.ts || '') + ' 因 Cookies 被占用而跳过'
            }
          } else if (last) {
            whenText = (last.local || last.ts || '') + '　（这次没拿到数字，' + describeStatus(last.status).text + '）'
          } else {
            whenText = launcher && launcher.installed
              ? '还没有报告 —— 用桌面上的「DSH（带体检启动）」启动一次就会有了。'
              : '还没有报告 —— 先点下面「安装启动器」，之后用它启动 DSH 就会有了。'
          }
          rows.push(h('div', { key: 'when', style: S.when }, whenText))

          // stats
          const stats = [
            { key: '累计清理次数', value: String(cleaned.length) },
            { key: '累计删除 cookie', value: String(removedTotal) },
            {
              key: '当前阈值 / 保留',
              value: String(last && last.threshold != null ? last.threshold : '—'),
              suffix: '/ 保留 ' + (last && last.keep != null ? last.keep : 1)
            }
          ]
          rows.push(
            h('div', { key: 'grid', style: S.grid },
              stats.map((s, i) =>
                h('div', { key: i, style: S.stat },
                  h('div', { style: S.statKey }, s.key),
                  h('div', { style: S.statVal },
                    s.value,
                    s.suffix ? h('span', { style: S.statSuffix }, ' ' + s.suffix) : null))))
          )

          // history
          const recent = history.filter((e) => e && typeof e === 'object').slice(-12).reverse()
          rows.push(h('div', { key: 'histTitle', style: S.sectionTitle }, '最近记录'))
          if (recent.length === 0) {
            rows.push(h('div', { key: 'histEmpty', style: S.empty }, '还没有任何记录'))
          } else {
            const body = [h('thead', { key: 'th' }, h('tr', null,
              h('th', { style: S.th }, '时间'),
              h('th', { style: S.th }, '结果'),
              h('th', { style: S.th }, '清理前'),
              h('th', { style: S.th }, '清理后'),
              h('th', { style: S.th }, '删除')
            ))]
            body.push(h('tbody', { key: 'tb' }, recent.map((e, i) =>
              h('tr', { key: i },
                h('td', { style: S.td }, e.local || e.ts || ''),
                h('td', { style: S.td }, statusTag(describeStatus(e.status), S, c)),
                h('td', { style: { ...S.td, ...S.tdNum } }, e.before ?? '—'),
                h('td', { style: { ...S.td, ...S.tdNum } }, e.after ?? '—'),
                h('td', { style: { ...S.td, ...S.tdNum } }, e.removed ?? '—')
              )
            )))
            rows.push(h('table', { key: 'histTable', style: S.table }, body))
          }

          // actions
          rows.push(h('div', { key: 'divider', style: S.divider }))
          const cleaningBusy = busy === 'clean'
          const installBusy = busy === 'install'
          rows.push(h('div', { key: 'actions', style: S.actions },
            h('button', {
              style: { ...S.btnPrimary, ...(cleaningBusy || closing ? S.btnDisabled : {}) },
              disabled: cleaningBusy || closing,
              title: '关闭 DSH → 清理 cookie → 自动重启',
              onClick: runClean
            }, closing ? '正在重启…' : '立即清理并重启'),
            h('button', {
              style: { ...S.btnGhost, ...(cleaningBusy ? S.btnDisabled : {}) },
              disabled: cleaningBusy,
              onClick: load
            }, '刷新数据'),
            launcher && !launcher.installed
              ? h('button', {
                style: { ...S.btnGhost, ...(installBusy ? S.btnDisabled : {}) },
                disabled: installBusy,
                title: '在桌面放一个「DSH（带体检启动）」快捷方式',
                onClick: installLauncher
              }, installBusy ? '正在创建…' : '安装启动器')
              : null
          ))
          // The hint sits on its own line: sharing the flex row with the buttons
          // wrapped it awkwardly next to them.
          rows.push(h('div', { key: 'btnHint', style: S.btnHint },
            '会先把 DSH 关掉再清理（Cookies 被它独占着），然后自动拉起来。'
          ))

          // 启动器状态：没有它，报告永远是空的、平时启动也不会清理。
          const launcherHint = launcher && launcher.installed
            ? h('div', { style: S.hintBlock },
              '启动器已就位：以后用桌面上的「DSH（带体检启动）」启动，每次都会先清一次 cookie。',
              h('br', null),
              h('code', { style: S.code }, launcher.cmdPath || ''))
            : h('div', { style: S.hintBlock },
              '还没有启动器。装一个，以后双击桌面图标启动 DSH 就会自动体检（不装的话，只有点上面的按钮才会清理）。')
          rows.push(h('div', { key: 'launcherHint', style: S.launcherHint }, launcherHint))

          if (note) {
            const tone = note.kind === 'ok' ? c.ok : note.kind === 'bad' ? c.bad : c.muted
            const toneToken = note.kind === 'ok' ? 'state-success' : note.kind === 'bad' ? 'state-error' : 'label-tertiary'
            rows.push(h('div', {
              key: 'note',
              style: {
                ...S.note,
                color: token(`${toneToken}-primary`, tone),
                // Installer output is multi-line; keep the line breaks.
                whiteSpace: note.pre ? 'pre-line' : 'normal'
              }
            }, note.text))
          }

          // footer
          rows.push(h('div', { key: 'divider2', style: S.divider }))
          rows.push(h('div', { key: 'foot', style: S.foot },
            h('div', null,
              // Once the clean is under way DSH is exiting, so the dot goes grey
              // and the line says so -- polling has already stopped.
              h('span', {
                style: {
                  ...S.dot,
                  background: closing ? token('label-tertiary', c.muted) : token('state-success-primary', c.ok)
                }
              }),
              closing
                ? '已发起清理，DSH 正在退出…'
                : '数据来自本地报告文件 · 最后读取 ' + (data && data.generatedAtLocal ? data.generatedAtLocal : '—')
            ),
            h('div', null, '报告文件：', h('code', { style: S.code }, report.path || '—'))
          ))
        }

        return h('div', { style: S.card, dir: 'auto' }, rows)
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
