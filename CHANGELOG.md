# 更新记录

## v0.3.2 — 2026-11-08

**新增：设置里有了入口，不用再开浏览器。**

- 客户端半侧（`lib/client.js`）注册到 DSH 的 `settings.section` 槽位，设置里多了「Cookie Guard」一页，
  里面直接嵌 `/cookie-guard/` 页面 —— 面板逻辑仍然只有一份。
- 修正两个字段的语义：`package.json` 的 `dsh.client.inject` 填**客户端包 id**，
  `module.exports.inject` 填 **Cordis 服务名**（`slots`）。填错会静默失败。
- 面板按钮调 `clean.mjs` 时补上 `--threshold 1`，报告里记的阈值不再是不存在的 40。

## v0.3.1 — 2026-11-08

- 撤回上一版加进去的客户端半侧（当时的实现拿不到 `ctx.slots`，界面永远不出现）。

## v0.3.0 — 2026-11-07

- 首次尝试把面板塞进 DSH 界面（`settings.section`），启动时因 `dsh.client.inject`
  填了不存在的包而崩溃，已回退。

## v0.2.0 — 2026-11-06

- **去掉清理前的 cookie 备份**。`dsh-auth-*` 是每次启动新签发的本地握手票（30 天、绑定当时的端口），
  备份既不能恢复任何东西，也不提供诊断信息（该信息已经在报告里）。少一个分支、少一个失败点。

## v0.1.0 — 2026-11-05

- 第一版：`probe.mjs`（只读计数）、`clean.mjs`（清到只剩最新 N 条）、`prelaunch.mjs`（启动前体检）、
  `lib/panel.html` + `lib/routes.mjs`（只读面板）、`scripts/helper.mjs`（清理并重启）。

## 0.3.3 — 2026-11-09

- 发布到 npm，包名 **dsh-cookie431**（原名 `dsh-cookie-guard` 已被他人占用，仓库名保持 `dsh-cookie-guard` 不变）
- `package.json` 的 `name`、`cordis.patch.yml` 的 `id`/`name`、profile 依赖键同步改名，避免 patch 名与安装目录不一致导致插件静默不加载
- 补 `repository` / `homepage` / `bugs` / `publishConfig` 字段，`bin` 命令改为 `dsh-cookie431`
