# dsh-cookie-guard

DSH Desktop（DeepSeek Harness）启动失败的常见元凶之一：**`dsh-auth-*` cookie 无限堆积，把 `Cookie` 请求头撑爆，宿主返回 HTTP 431，桌面端报 `desktop welcome: Web authentication failed`，表现就是白屏 / 打不开。**

本项目只做三件事，并且都可审计、可回滚：

1. **体检**（任意时刻，只读）：数一数 `Cookies` 库里有多少条 `dsh-auth-*`；
2. **清理**（只在 DSH 关着的时候）：删掉多余的，**只保留最新 1 条**；
3. **启动器**（可选）：双击先体检 → 超标就先清 → 再拉起 DSH，让"清理"永远发生在文件没被锁的时候。

> 为什么不能"边跑边清"：`Network\Cookies` 被 Electron 独占（实测 `Copy-Item` 与只读打开都会 `EBUSY`）。任何声称能在运行中清理的实现都值得怀疑。

## 现象与原理

| 现象 | 日志/证据 |
|---|---|
| 白屏、`DeepSeek Harness is unavailable` | 崩溃报告 `phase: startup`，`desktop welcome: Web authentication failed` |
| 每次启动新增 1 条 cookie | `127.0.0.1  dsh-auth-<随机>`，值里是 JWT：`{"version":1,"authority":"127.0.0.1:<端口>","issuedAt":…,"expiresAt":…}` |
| 为什么清不掉 | Chromium cookie 按 **host** 存储、**忽略端口**，而 DSH 每次启动换端口、换随机名字 → 无上限累积 |
| 什么时候崩 | `Cookie` 请求头超过服务器上限 → HTTP 431 → 握手校验失败 |

实测：一台用了约 2 个月的机器上累计 **136 条** `dsh-auth-*`，按每条约 200 B 估算，请求头约 27 KB。

## 用法

需要 Node ≥ 22.5（`node:sqlite`）。**不会**修改 DSH 任何文件，也不改系统 PATH。

### 1. 看看现在有多少条（只读，随时可跑）

```bash
node lib/probe.mjs            # 人类可读
node lib/probe.mjs --json     # 机器可读
```

DSH 正在运行时它会如实告诉你 `locked`（而不是瞎猜一个数字）。

### 2. 清理（请先退出 DSH）

```bash
node scripts/clean.mjs --dry-run    # 先看会删什么，不动文件
node scripts/clean.mjs              # 低于阈值(40)会跳过；超了才动手
node scripts/clean.mjs --force      # 无视阈值，强制清理
```

- **不做备份**：这些 cookie 是每次启动现签的本地握手票（只含端口 + 签发时间 + 签名，30 天过期），旧票对应的是已经消失的端口，还原备份挽回不了任何东西；删掉的条数照样记进报告，够追溯了；
- 只删 `host_key ∈ {127.0.0.1, localhost, [::1]}` 且 `name LIKE 'dsh-auth-%'` 的行，**别的站点 cookie 一条不动**；
- 每次结果写入 `cookie-guard/last-report.json`（保留最近 50 条）。

### 3. 用启动器（推荐，一劳永逸）

`launcher/dsh-launch.cmd`：体检 → 超标自动清 → 启动 DSH。第一次用请确认里面的 `DSH_EXE` 路径对，然后在桌面建个快捷方式，以后就双击它。

### 4. 看面板（只读）

```bash
node scripts/panel-serve.mjs        # → http://127.0.0.1:47823/cookie-guard/
```

一个本地网页：上次启动前后的 cookie 条数、累计清理次数、保留策略、最近记录。

它读的是 `cookie-guard/last-report.json`（启动前体检写的），所以**不需要 DSH 关着**也能看，
而且数字来源可追溯——`launcher.log` 里能看到同一批数字。

### 5. 面板上的「立即清理并重启」（第 3 步）

点一下会发生什么：

1. 页面先确认（会告诉你"当前对话窗口会跟着关闭"）；
2. `POST /cookie-guard/api/clean` 立刻回 **202**，同时拉一个**脱离进程** `scripts/helper.mjs`；
3. helper 查出 DSH 的进程链，**只按 PID** 逐个终止（绝不用 `taskkill /im` 按名字杀）；
4. 等 `Cookies` 的锁真正放掉，再跑 `clean.mjs --force --keep 1`；
5. 最后用启动器把 DSH 拉起来。

安全细节：

- helper **不能用 `taskkill /T`** —— 它自己是 DSH 的子孙，`/T` 会把它一起杀掉。所以它自己算子孙清单、逐个 `/PID` 杀；
- 只杀同名 exe（`DeepSeek Harness.exe`）的进程，输入法、终端这些子进程一律跳过；
- 30 秒还没退干净就**放弃清理**（exit 3），不硬抢锁；两秒内连点返回 **429**；
- 预览模式（`node scripts/panel-serve.mjs`，不在 DSH 里）点按钮只会得到 `simulated: true`，不会真重启。

动手前想先看看它打算杀谁：

```bash
node scripts/helper.mjs --host <DSH 进程PID> --dry-run
```

它会把"进程链 / 要杀的 PID / 跳过的进程"全打出来，然后直接退出，什么都不干。

接口一览（挂进 DSH 后路径不变）：


| 接口 | 方法 | 说明 |
|---|---|---|
| `/cookie-guard/` | GET | 面板页面 |
| `/cookie-guard/api/status` | GET | 只读状态 JSON |
| `/cookie-guard/api/clean` | POST | **尚未实现**，现在固定返回 `501 not-implemented` |

> 「清理并重启」是第 3 步，明确不做假成功：没实现就返回 501，页面上的按钮也是灰的。

## 挂进 DSH（可选）

插件形态下 `/cookie-guard/` 由 DSH 自己托管，地址是 `http://127.0.0.1:<DSH端口>/cookie-guard/`。

挂载方式（以 `link:` 本地链接为例，改 `C:\Users\<你>\.dsh\profiles\desktop\package.json`）：

```jsonc
"dependencies": { "dsh-cookie-guard": "link:D:\\path\\to\\dsh-cookie-guard" },
"dsh": { "profile": { "bundles": [ ..., "dsh-cookie-guard" ] } }
```

然后在该目录执行 `pnpm install`（lockfile 过期时加 `--no-frozen-lockfile`），重启 DSH。

**卸载**：把上面两处删掉，再 `pnpm install`，重启。装不上/起不来时，崩溃对话框里的
「Disable third-party plugins」按钮也能兜底。

## 全部参数

```
clean.mjs
  --threshold=N   低于 N 条则跳过（默认 40）
  --keep=N        保留最新 N 条（默认 1）
  --force         无视阈值
  --dry-run       只报告不修改
  --vacuum        清理后 VACUUM 压缩数据库
  --quiet         少说话

prelaunch.mjs     --threshold --keep --dry-run
probe.mjs         --json
```

退出码：`0` 正常 / `3` 文件被占用 / `4` 打开或读取失败。

## 测试

```bash
npm test        # 三套：自检、clean 端到端、prelaunch 端到端
```

测试全部在临时目录里跑（`APPDATA` / `DSH_HOME` 指向 tmp），**绝不碰线上 profile**。

## 安全边界

- 只读打开时不带 `readOnly` 会加锁 → 代码里一律用 `{ readOnly: true }`；
- 不备份、不联网、不写注册表 —— 删掉的条数与耗时都记进 `last-report.json`；
- 不联网、不写注册表、不改 DSH 文件、不留后台进程；
- `test/journal-sample.bin`（含真实 JWT 的样本）已从仓库移除，别把会话日志提交上来。

## 回滚

删掉本目录即可。如果用了启动器快捷方式，改用原来的 `DeepSeek Harness.exe`。

## 路线图

- [x] 只读探针 + 清理 + 启动器
- [ ] DSH 插件形态（`cordis.patch.yml` + `lib/index.js`），在 Web UI 里显示当前 cookie 数与阈值
- [ ] 从 `Cookies-journal` 恢复统计（不依赖 DSH 关闭）
- [ ] macOS / Linux 路径适配

## 许可

MIT
