# v0.3.2 — 面板进了设置页

> 这份文件不是给程序读的，是给「发 Release 时复制粘贴」用的：
> 打开 https://github.com/woshixiaoshuai2333/dsh-cookie-guard/releases/new?tag=v0.3.2
> 把标题填成上面那行，把下面「正文开始」到「正文结束」之间的内容整段复制进正文框。
>
> 注意：标题那行（`# v0.3.2 — 面板进了设置页`）是 Markdown 标题语法，
> 填进 GitHub 的 Title 输入框时**去掉 `# `**，只要文字。

--- 正文开始 ---

## 这版做了什么

- **设置 → Cookie Guard**：面板现在直接挂在 DSH 内部（`settings.section` 槽位），不用再开浏览器
- 修正两个容易搞错的字段：`package.json` 的 `dsh.client.inject` 填**客户端包 id**，
  `module.exports.inject` 填 **Cordis 服务名**（`slots`）—— 错一个就静默失败
- 面板按钮清理时补传 `--threshold 1`，报告里的数字不再骗人
- 启动器与清理助手的三处修复：`%ERRORLEVEL%` 重定向坑、`start` 缺少工作目录、
  `ELECTRON_RUN_AS_NODE` 被继承导致"点重启后拉不起来"

## 怎么用

```bash
node lib/probe.mjs        # 只读体检：现在有几条 dsh-auth
node scripts/clean.mjs    # 清理（需先退出 DSH）
```

挂进 DSH 桌面见 README 的「挂进 DSH」一节。完整记录见 CHANGELOG.md。

## 数字

- 触发这个问题的那台机器：累计 **136 条** `dsh-auth-*`，`Cookie` 头约 27 KB → HTTP 431
- 清理一次的耗时：约 **0.2 秒**（8 条 → 1 条）
- 「清理并重启」从点按钮到窗口出现：**3.8 秒**

--- 正文结束 ---
