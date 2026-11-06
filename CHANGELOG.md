# 更新日志 / Changelog

本文件用于生成 GitHub Release 说明：打 tag 时 `publish.yml` 取 `## <version>` 到下一个 `## ` 之间的内容作为该版本的发布说明。
This file feeds the GitHub Release notes: on a tag push, `publish.yml` uses everything between `## <version>` and the next `## ` heading.

## 0.1.8

### 中文

**新增功能**
- 会话列表改为显示侧边栏里的**会话标题**（读 `session_projcache` 的 `record.rows.title`）。以前只按裸 uuid 找缓存文件，而缓存里大量文件带 `session-` 前缀，导致标题读不到、列表退化成首条消息的前 60 字。修复后 24 个会话里 23 个能显示真标题，只有空会话仍回退到首条消息摘要。
- 新增「包含归档会话（默认排除）」开关。归档会话本来不在周报候选里，现在默认仍然隐藏，需要时勾上就会出现，并把 `--archived` 一起带进证据采集命令，避免选了归档会话却在采集时全部消失。

**修复**
- 窗口内没有任何对话内容的会话不再出现在列表里。`session/end-seed` 是在会话关闭时才打的时间戳，它会把「最后活动时间」推进窗口，于是两类空壳混进来了：只打开、一句话没说就关掉的空白会话（连标题都没有，列表里只剩裸会话 ID），以及对话其实早已结束、只有收尾事件落在窗口里的会话（永远显示「窗口内 0 条用户消息」）。现在只有窗口内真有用户消息、助手回复或工具调用的会话才会列出。
- `collect.mjs sessions` 的说明行现在会写明归档会话是包含还是排除。

**完整更新日志**：https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.7...v0.1.8

### English

**Added**
- The session list now shows the **sidebar session title** (read from `session_projcache`'s `record.rows.title`). It used to look only for the bare-uuid cache file, but many cache files carry a `session-` prefix, so titles were missed and the list fell back to the first 60 characters of the first message. 23 of 24 real sessions now show their real title; only empty sessions still fall back to the message summary.
- New `包含归档会话（默认排除）` (include archived sessions) switch. Archived sessions stay hidden by default; turning it on lists them and passes `--archived` to the evidence collector, so a session picked from the archive bucket no longer disappears during collection.

**Fixed**
- Sessions with no conversation inside the window no longer show up in the list. `session/end-seed` is stamped when a session closes, so it pushes the recorded last activity into the window — which pulled in two kinds of shells: a session opened and abandoned without a word (no title either, so the row showed nothing but a raw session id) and a session whose conversation had long ended, with only the closing event inside the window (permanently "0 messages in window"). A session is now listed only when the window really contains a user message, an assistant reply, or a tool call.
- `collect.mjs sessions` now states whether archived sessions were included or excluded in its summary line.

**Full changelog**: https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.7...v0.1.8

## 0.1.7

### 中文

**新增功能**
- 会话列表按工作区折叠：点工作区标题即可收起或展开，折叠后标题上仍显示「已选 3/18」。
- 每个工作区的会话列表独立滚动（最高 264px），一个工作区里会话很多也不会把后面的表单推到屏幕外。
- 新增「折叠全部 / 展开全部」两个快捷按钮。

**修复**
- 0.1.6 打了 tag 却没能发到 npm：工作流里发布步骤的条件 `if: !inputs.dry_run` 在 tag 触发时读到的是字符串 `"false"`，导致该步骤被跳过。0.1.7 改为在 shell 里判断 `DRY_RUN`，并把 0.1.6 的界面改动一并带上。
- GitHub Release 说明改为从本文件的对应版本段落自动生成（中英双语），发布时会重建同名 Release。

**完整更新日志**：https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.6...v0.1.7

### English

**Added**
- Collapsible workspace groups in the session list: click a workspace header to fold or unfold it; the folded header still shows the selected count (`3/18`).
- Each workspace scrolls on its own (max 264px), so a workspace with many sessions no longer pushes the rest of the form off screen.
- New `折叠全部` / `展开全部` (collapse all / expand all) shortcuts.

**Fixed**
- 0.1.6 was tagged but never reached npm: the publish step's `if: !inputs.dry_run` read the string `"false"` on a tag push and skipped itself. 0.1.7 moves the check into the shell (`DRY_RUN`) and ships the 0.1.6 UI work along with it.
- GitHub Release notes are now generated from the matching section of this file (Chinese + English), and the existing release for the tag is recreated on every publish.

**Full changelog**: https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.6...v0.1.7

## 0.1.6

### 中文

**新增功能**
- 会话列表按工作区折叠：点工作区标题即可收起或展开，折叠后标题上仍显示「已选 3/18」。
- 每个工作区的会话列表独立滚动（最高 264px），一个工作区里会话很多也不会把后面的表单推到屏幕外。
- 新增「折叠全部 / 展开全部」两个快捷按钮。

**完整更新日志**：https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.5...v0.1.6

### English

**Added**
- Collapsible workspace groups in the session list: click a workspace header to fold or unfold it; the folded header still shows the selected count (`3/18`).
- Each workspace scrolls on its own (max 264px), so a workspace with many sessions no longer pushes the rest of the form off screen.
- New `折叠全部` / `展开全部` (collapse all / expand all) shortcuts.

**Full changelog**: https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.5...v0.1.6

## 0.1.5

### 中文

**修复**
- README 的安装说明不再写死作者本机路径，改为先 `git clone` 再填写克隆后的目录。
- 测试里的时间窗口断言不再依赖运行机器的时区，UTC 的 CI runner 上也能通过。

**完整更新日志**：https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.4...v0.1.5

### English

**Fixed**
- The install section no longer hard-codes the author's local path; clone the repo and point DSH at that folder instead.
- Time-window assertions in the test suite no longer depend on the machine timezone, so they also pass on the UTC CI runner.

**Full changelog**: https://github.com/l956615272-hub/dsh-weekly-report/compare/v0.1.4...v0.1.5

## 0.1.4

### 中文

首个发布版本：按会话最后活动时间筛选并只取时间窗内的回合、多仓库 git 采集、样例驱动的报告生成、报告与样例库。

**完整更新日志**：https://github.com/l956615272-hub/dsh-weekly-report/commits/v0.1.4

### English

First public release: sessions picked by last activity with turns sliced to the window, multi-repository git collection, sample-driven report writing, and a local report/sample library.

**Full changelog**: https://github.com/l956615272-hub/dsh-weekly-report/commits/v0.1.4
