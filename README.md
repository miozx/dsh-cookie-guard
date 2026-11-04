# dsh-cookie-guard

DSH Desktop（DeepSeek Harness）启动失败的常见元凶之一：**`dsh-auth-*` cookie 无限堆积，把 `Cookie` 请求头撑爆，宿主返回 HTTP 431，桌面端报 `desktop welcome: Web authentication failed`，表现就是白屏 / 打不开。**

本项目只做三件事，并且都可审计、可回滚：

1. **体检**（任意时刻，只读）：数一数 `Cookies` 库里有多少条 `dsh-auth-*`；
2. **清理**（只在 DSH 关着的时候）：删掉多余的，**只保留最新 1 条**，清理前**自动备份**整个 `Cookies`；
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

- 清理前备份到 `$DSH_HOME/cookie-guard/backup/cookies-<时间戳>.db`（默认 `DSH_HOME` = `C:\Users\<你>\.dsh`）；
- 只删 `host_key ∈ {127.0.0.1, localhost, [::1]}` 且 `name LIKE 'dsh-auth-%'` 的行，**别的站点 cookie 一条不动**；
- 每次结果写入 `cookie-guard/last-report.json`（保留最近 50 条）。

### 3. 用启动器（推荐，一劳永逸）

`launcher/dsh-launch.cmd`：体检 → 超标自动清 → 启动 DSH。第一次用请确认里面的 `DSH_EXE` 路径对，然后在桌面建个快捷方式，以后就双击它。

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

退出码：`0` 正常 / `3` 文件被占用 / `4` 备份失败（已中止，未删除任何东西）。

## 测试

```bash
npm test        # 三套：自检、clean 端到端、prelaunch 端到端
```

测试全部在临时目录里跑（`APPDATA` / `DSH_HOME` 指向 tmp），**绝不碰线上 profile**。

## 安全边界

- 只读打开时不带 `readOnly` 会加锁 → 代码里一律用 `{ readOnly: true }`；
- 备份失败 → 直接中止，不删；
- 不联网、不写注册表、不改 DSH 文件、不留后台进程；
- `test/journal-sample.bin`（含真实 JWT 的样本）已从仓库移除，别把会话日志提交上来。

## 回滚

删掉本目录即可。如果用了启动器快捷方式，改用原来的 `DeepSeek Harness.exe`。

## 路线图

- [x] 只读探针 + 清理 + 备份 + 启动器
- [ ] DSH 插件形态（`cordis.patch.yml` + `lib/index.js`），在 Web UI 里显示当前 cookie 数与阈值
- [ ] 从 `Cookies-journal` 恢复统计（不依赖 DSH 关闭）
- [ ] macOS / Linux 路径适配

## 许可

MIT
