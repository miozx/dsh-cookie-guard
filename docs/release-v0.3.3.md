# v0.3.3 — 改名上 npm，一行装

在 GitHub 上创建 Release 时：

- **Tag**：选 `v0.3.3`（已经推上去了）
- **Title**：`v0.3.3 — 改名上 npm，一行装`
- **正文**：复制下面「正文开始 / 正文结束」之间的全部内容

---

--- 正文开始 ---

这次没有新功能，只做了一件拖了很久的事：**发到 npm**，让别人不用再改 json 也能装。

## 为什么改名

npm 上 `dsh-cookie-guard` 这个名字已经被人占了（另一个作者，跟这个项目无关）。所以发布名改成了 **`dsh-cookie431`** —— `431` 就是浏览器/服务器在「请求头太大」时返回的状态码，也就是本项目要解决的那个症状。

GitHub 仓库名保持不变，npm 包名和仓库名不一致是完全合法的，只是容易混淆，README 里已经写清楚。

## 怎么装（npm 路线）

```bash
cd %USERPROFILE%\.dsh\profiles\desktop
pnpm add dsh-cookie431
```

然后在同一个文件的 `dsh.profile.bundles` 数组里加上 `"dsh-cookie431"`，**完全退出** DSH 再启动。

装好后：**设置 → Cookie Guard** 里就有面板；`http://127.0.0.1:<端口>/cookie-guard/` 也能直接打开。

## 从 0.3.2 升级的人注意

包名变了，所以手动挂载的依赖键也要跟着变：

```diff
- "dsh-cookie-guard": "link:D:\\tools\\dsh-cookie-guard"
+ "dsh-cookie431": "link:D:\\tools\\dsh-cookie-guard"
```

`dsh.profile.bundles` 里那一项同理。改完 `pnpm install` 并重启。

## 其它改动

- 去掉 `package.json` 里无效的 `bin` 字段（目标脚本没有 shebang，npm 发布时会拒绝它）
- README 新增「别人怎么拿到它」（ZIP / Release / clone）和「装进自己的 DSH（四步）」
- 新增《如何发布到-GitHub.md》：从 `git init` 到 tag 的完整流程，含「push 超时」排查一节

## 安装包内容

- 发布文件：**14 个**，解包 **28.8 kB**
- `shasum`：`05e8bb9086b106ca048460cdf732899d4d8f32da`
- 五个测试套件：`selftest` / `clean` / `prelaunch` / `panel`（32 项）/ `client`（16 项）全部通过

## 它解决的是什么

DSH Desktop 每次启动都会生成一个新的 `dsh-auth-*` cookie（随机名、30 天有效期），而 Chromium 按 host 存 cookie、**忽略端口**，于是这些 cookie 越积越多 —— 攒到 `Cookie` 请求头超限，宿主返回 **HTTP 431**，桌面端报 `desktop welcome: Web authentication failed`，表现就是白屏打不开。

实测中过一次：**136 条** `dsh-auth-*`，按每条约 200 字节算，请求头约 27 KB。

本项目做三件事：启动前体检 → 超阈值清理（只留最新 1 条）→ 一个只读面板让你看得见。清理实测 **0.2 秒**，「清理并重启」全程 **3.8 秒**。

--- 正文结束 ---
