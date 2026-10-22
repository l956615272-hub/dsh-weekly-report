# dsh-weekly-report

按时间段挑选 DSH 会话 + 项目 git 提交，参考**你自己以前写的报告**，生成日报 / 周报 / 月报（Markdown）。

## 特性

- 按**会话最后一次对话时间**筛选（不是创建时间），并且只使用所选时间段内产生的对话
- 按工作区分组、搜索、默认排除 subagent 会话、fork/resume 副本自动合并
- 可选结合 git 记录：单工作区内多仓库自动发现、按 git 用户名（姓名或邮箱）过滤、当前分支/全部分支、默认排除 merge
- 报告格式由你粘贴的历史报告样例驱动，样例可保存复用
- 生成前可预览并直接修改提示词，确认后新建会话自动发送并跳转
- 默认产出 Markdown，落到 `$DSH_HOME/dsh-weekly-report/reports/`

## 安装

### 从 npm（推荐）

在 DSH Desktop 侧边栏的「插件」页里，把包名填进安装框：

```
dsh-weekly-report
```

### 从本地路径（开发用）

同一个页面选择「安装本地路径」，填：

```
/Users/d/Personal_Project/dsh-weekly-report
```

安装后 **重启 DSH Desktop**（宿主代码需要重启；只有客户端改动时刷新页面即可）。之后在「设置 → 周报生成」里使用。

## 使用流程

1. 选报告类型（日报/周报/月报）和时间范围（今天 / 近 7 天 / 本周 / 上周 / 本月 / 上月 / 自定义）
2. 勾选要纳入的会话（按工作区分组，可搜索、可全选）
3. 需要时勾选「结合 git 记录」，选工作区、仓库、填 git 用户名
4. 粘贴一份以前的报告作为格式样例（可保存为常用样例）
5. 点「生成提示词预览」→ 可直接改提示词 → 选报告生成会话落地的工作区 → 「新建会话并发送」（由插件宿主创建会话并发送提示词；**成功后自动关闭设置面板**，直接落到新会话；新会话也会自动出现在侧边栏）
6. 新会话会跑证据命令、读证据、写报告，并通过 `save-report.mjs` 存进报告库；面板底部可以看到已保存的报告

## 命令行工具（也可以手动跑）

```sh
# 会话证据（只读，只取时间窗内的回合）
node scripts/collect.mjs sessions --from 2026-10-08T00:00:00+08:00 --to 2026-10-16T00:00:00+08:00 \
  --ids session-a,session-b --out .dsh-weekly-report/sessions.md

# git 证据（多仓库、按作者、默认排除 merge）
node scripts/collect.mjs git --workspace /path/to/workspace --from 2026-10-08 --to 2026-10-16 \
  --author "你的名字" --author "you@example.com" --out .dsh-weekly-report/git.md

# 把报告存进报告库（需要 DSH 正在运行）
node scripts/save-report.mjs --name 2026-W41.md --file report.md --url http://127.0.0.1:19387
```

## 开发

```sh
node --test test/*.test.mjs
```

详细设计、已确认的决策和数据来源见 [docs/PRD.md](docs/PRD.md)。
