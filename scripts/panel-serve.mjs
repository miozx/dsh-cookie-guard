/**
 * 独立开发服务器 —— 不装插件也能看面板效果。
 *
 *   node scripts/panel-serve.mjs            # 默认 http://127.0.0.1:47823/cookie-guard/
 *   node scripts/panel-serve.mjs 47900      # 换端口
 *
 * 它和 DSH 插件用的是**同一份** lib/routes.mjs，所以你现在看到的页面，
 * 就是以后挂进 DSH 之后的样子（只是域名不同）。
 */
import { createServer } from 'node:http'
import { createRoutes, makeHandler, BASE_PATH } from '../lib/routes.mjs'

const port = Number(process.argv[2] || process.env.COOKIE_GUARD_PORT || 47823)
const routes = createRoutes({ base: BASE_PATH })
const handler = makeHandler(routes)

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    try {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'internal', message: String(err?.message ?? err) }))
    } catch { /* 连接可能已断 */ }
  })
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用，换一个：node scripts/panel-serve.mjs ${port + 1}`)
  } else {
    console.error('启动失败:', err?.message ?? err)
  }
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}${BASE_PATH}/`
  console.log('')
  console.log('  DSH Cookie Guard · 面板已启动')
  console.log('  ' + url)
  console.log('')
  console.log('  数据来源: <DSH_HOME>/cookie-guard/last-report.json')
  console.log('  按 Ctrl+C 停止')
  console.log('')
})
