# 把项目发到 GitHub：给完全新手的一份操作手册

写这份文档的原因：这套代码是我第一次完整走完"从本地文件夹到 GitHub 仓库"的流程，
下次有新项目时，照着抄就行。

---

## 0. 先记住三条红线

1. **不要把你的 GitHub 密码给任何人，也不要给 AI。** 谁要都是错的，包括我。
2. **不要把 token 粘到聊天窗口里。** 聊天记录会被保存，token 相当于密码。
3. **仓库一旦 public，历史就收不回来了。** 别人 clone 过、fork 过、搜索引擎抓过，都不算撤回。
   发之前先用第 5 节的清单过一遍。

---

## 1. GitHub 到底是什么（一句话版）

- **git** = 装在你电脑上的"存档 + 时光机"，每个 commit 是一个存档点。
- **GitHub** = 把这份存档放到云上的网站，顺便给你一个分享链接。
- **push** = 把本地存档点上传。**pull** = 把云上的拉下来。

所以真正干活的永远是本地命令，GitHub 只是收件箱。账号密码只在**上传那一下**用到。

---

## 2. 你要准备的，其实只有两样

| 准备 | 谁来做 | 说明 |
|---|---|---|
| GitHub 账号 | 你（如果还没有，去 github.com 注册，邮箱验证即可） | 免费 |
| 一次浏览器授权 | 你，30 秒 | 让这台电脑有权往你的账号上传，见第 4 节 |

其余（建仓库、写说明、打标签、发 Release、检查有没有泄露密钥）**我都能做**，
因为这些只是本地命令 + 一次 API 调用。

---

## 3. 一次完整的"首次发布"长什么样

假设项目在 `D:\projects\my-tool`，要发成 `github.com/你的用户名/my-tool`。

```bash
cd D:\projects\my-tool

git init                      # 把文件夹变成 git 仓库（只需一次）
git add -A                    # 把当前所有文件放进"待存档"区
git commit -m "feat: 第一版"   # 存一个档

# 建远程仓库并推送（gh 已登录时，一条命令搞定）
gh repo create my-tool --public --source=. --push
```

没有 `gh` 的话，等价的手工版：

```bash
# 先在网页上点 New repository，建一个空仓库，然后：
git remote add origin https://github.com/你的名字/my-tool.git
git branch -M main
git push -u origin main
```

`git push` 第一次会弹窗让你在浏览器里登录 —— 那就是授权，输一次以后就记住了
（Windows 上是"凭据管理器"帮你存着）。

---

## 4. 授权的三种方式，选一个

| 方式 | 步骤 | 适合谁 |
|---|---|---|
| **GitHub CLI（推荐）** | 装 `gh`（`winget install --id GitHub.cli`）→ 运行 `gh auth login` → 选 GitHub.com → HTTPS → 用浏览器登录 → 输入网页上那串 8 位码 | 想以后一条命令建仓库、发 Release 的人 |
| **GitHub Desktop** | 装官方客户端 → 登录 → 把本地文件夹拖进去 | 完全不想碰命令行的人 |
| **Personal Access Token** | 网页 Settings → Developer settings → Tokens 生成 → 推送时当密码用 | 不推荐新手：容易泄露、容易忘记权限 |

**共同点：三者都不需要把密码告诉别人。** 你只是在浏览器里点"授权"。

---

## 5. 发布前的检查清单（照顺序过一遍）

- [ ] `git status` 干净：没有忘了提交的文件
- [ ] **没有密钥**：搜一遍 `sk-`、`ghp_`、`password`、`eyJ`（JWT 的开头）
- [ ] **没有本地垃圾**：`node_modules/`、`*.log`、`*.db`、截图原图、`.env` 都在 `.gitignore` 里
- [ ] **没有个人信息**：真实姓名、手机号、内网地址、别人的聊天记录截图
- [ ] `README.md` 第一段能让人 10 秒看懂"这是解决什么问题的"
- [ ] `LICENSE` 有（不给许可证，别人法律上不能用）
- [ ] 跑一次测试，确认 clone 下来能跑
- [ ] 确认 public 还是 private —— 想清楚再点

---

## 6. 一个像样的仓库该有的 7 个文件

| 文件 | 作用 | 本项目的例子 |
|---|---|---|
| `README.md` | 门面：解决什么问题、怎么装、怎么用 | 顶部有截图和徽章 |
| `LICENSE` | 授权条款 | MIT |
| `.gitignore` | 哪些文件永不入库 | 忽略 `node_modules/`、`*.log` |
| `.gitattributes` | 换行符规则（见第 7 节） | `.cmd` 用 CRLF，`.mjs` 用 LF |
| `CHANGELOG.md` | 每个版本改了什么 | v0.1.0 → v0.3.2 |
| `test/` | 能一键跑的测试 | 5 套，全绿 |
| `docs/` | 截图、长文档 | 本文件 |

---

## 7. 新手最容易踩的 6 个坑

1. **换行符（CRLF vs LF）**。Windows 上写 `.cmd`/`.ps1` 如果是纯 LF，双击会报
   "不是内部或外部命令"。用 `.gitattributes` 固定规则：
   ```
   *.cmd text eol=crlf
   *.mjs text eol=lf
   ```
2. **中文文件名**。git 会把它显示成 `"\346\211\223..."`，这是正常的转义，文件没坏。
   但为了跨平台省事，脚本类文件建议用英文名。
3. **把 `node_modules` 传上去**。几万个文件、几百 MB，而且会被 GitHub 提示。
   `.gitignore` 第一行就写它。
4. **大文件**。GitHub 单文件上限 100 MB，仓库建议 < 1 GB。视频、安装包不要进仓库，
   发 Release 时作为附件上传。
5. **提交了密钥**。删掉文件再 commit **没用**，历史里还在。要么轮换（作废）那个密钥，
   要么用 `git filter-repo` 重写历史（高级操作，新手别自己上）。
6. **以为删了文件夹就没了**。`.git` 目录就是全部历史，删了它等于把时光机砸了。

---

## 8. 日常改动的循环（记住这四行就够）

```bash
git status                 # 现在有什么改动？
git add -A                 # 全部加入待存档
git commit -m "fix: 说明"   # 存档，写清改了什么
git push                   # 上传
```

写 commit message 的小规矩：`feat:`（新功能）/ `fix:`（修 bug）/ `docs:`（文档）/
`refactor:`（重构）/ `test:`（测试）/ `chore:`（杂活）。一句话说清"为什么"，不用写"怎么做"。

---

## 9. 版本号与 Release

- **tag** 是给某个存档点起个名字：`git tag v0.3.2 && git push --tags`
- **Release** 是 GitHub 上的一次"发版"，可以挂附件、写更新说明：
  `gh release create v0.3.2 --notes-file CHANGELOG.md`
- 版本号约定（语义化版本）：`主.次.修` —— 修 bug 加最后一位，加功能加中间，改接口加第一位。

---

## 10. 出事了怎么办

| 情况 | 处理 |
|---|---|
| 提交信息写错了 | `git commit --amend -m "新说明"`（还没 push 时） |
| 多提交了不该提交的文件 | `git rm --cached 文件名` 再 commit（文件留在本地） |
| 想撤销最后一次 commit（保留改动） | `git reset --soft HEAD^` |
| 密钥进了仓库 | 立刻去对应网站**作废**它，然后才谈清理历史 |
| 想删掉整个仓库 | GitHub 网页 → Settings → 最下面 Delete this repository |

---

## 11. 这个项目里，我实际做了什么（可照抄的模板）

1. 写 `.gitignore` / `.gitattributes`（换行符、忽略构建产物）
2. 写 `LICENSE`（MIT）、`CHANGELOG.md`
3. 把 README 改成"10 秒看懂"的结构：一句话问题 → 三件事 → 截图 → 快速开始
4. 跑 5 套测试确认全绿，才提交
5. 分多次提交，每次一件事（`feat:` / `fix:` / `refactor:` / `docs:`），历史可读
6. 发布前一节一节地过第 5 节的清单（尤其是搜密钥）
7. 建仓库 → 推送 → 打 tag → 发 Release

下次你自己发新项目，就按第 5、6、11 节的清单做，命令行部分照着第 3 节抄。
