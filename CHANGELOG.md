# 更新日志 / Changelog

本文件用于生成 GitHub Release 说明：打 tag 时 `publish.yml` 取 `## <version>` 到下一个 `## ` 之间的内容作为该版本的发布说明。
This file feeds the GitHub Release notes: on a tag push, `publish.yml` uses everything between `## <version>` and the next `## ` heading.

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
