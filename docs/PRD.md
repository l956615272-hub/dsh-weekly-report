# dsh-weekly-report — 产品需求文档

- 产品名：**dsh-weekly-report**（DSH 插件，Host + Client 双面）
- 项目路径：`/Users/d/Personal_Project/dsh-weekly-report`
- 版本：v0.1.0（MVP 进行中）
- 形态：按时间段挑选 DSH 会话 + 项目 git 提交，按用户自己的报告样例生成日报/周报/月报（Markdown）

---

## 1. 背景与目标

DSH 里每天产生大量会话，但"这些会话里我干了什么"没有沉淀。用户每周要写周报，只能靠回忆翻聊天记录。

本插件要解决的是：**在一个界面里按时间挑会话、按工作区挑 git 记录，交给模型按"我以前写的报告"的格式生成一份 Markdown 报告。**

### 目标

- G1 按**会话最后一次对话时间**筛选时间段内的会话，可单个/多个勾选。
- G2 查看的会话内容**只包含所选时间段内产生的对话**（同一会话内更早的对话必须排除）。
- G3 可选结合所选工作区的 **git 提交记录**（多仓库、按 git 用户名过滤）。
- G4 生成格式由**用户粘贴的历史报告样例**驱动，而不是靠自然语言描述格式。
- G5 默认产出 Markdown 文件，落到 `$DSH_HOME/dsh-weekly-report/reports/`。

### 非目标

- 不做 token 预算估算，不做上下文压缩预处理（见 §5 数据获取方式）。
- 不修改、不删除任何会话数据（严格只读会话日志）。
- 不做报告的多端同步、不做云端上传。

---

## 2. 核心决策（已确认）

| # | 决策 |
|---|---|
| D1 | 生成方式：**C 方案** —— 生成前弹出可编辑的提示词预览，确认后在新会话中发送；提示词预览里可改 |
| D2 | 报告落盘：`$DSH_HOME/dsh-weekly-report/reports/`（宿主侧写入，不受会话工作区沙箱限制） |
| D3 | 模板：**用户粘贴历史报告样例**，模型参考其结构与详略；样例可保存复用 |
| D4 | git：默认**当前分支**、可选全部分支；默认**排除 merge 提交**（UI 需有文字提示说明） |
| D5 | 会话列表按**工作区分组**、支持搜索、默认**排除 subagent 会话** |
| D6 | fork/resume 产生的**副本合并到父会话** |
| D7 | 不做 token 预估、不做预算控制 |
| D8 | 插件 UI 只做中文 |

---

## 3. 数据来源（已实测）

| 数据 | 位置/格式 | 关键字段 |
|---|---|---|
| 会话日志 | `$DSH_HOME/sessions/<编码cwd>/session-<id>/session.v*.jsonl.zstd` | 多帧 zstd 拼接；每行一个事件 `{type,seq,time,data}` |
| 会话头 | 日志第一行 | `type:"session", id, version(v0/v3/v4), createdAt, cwd, parentSession?, isSeeded?, origin?, delegationDepth, agentPreset` |
| 事件时间 | 每个事件的 `time`（epoch ms） | 唯一可靠的"最后活动时间"来源 |
| 工作区列表 | `$DSH_HOME/storages/workspace.json` | `tables.workspaces` = `{ workspaceId: { path, title, sessionIds, createdAt, updatedAt } }` |
| 事件类型 | `turn/start` `user/message` `assistant/message` `tool/call` `tool/result` `assistant/chunk` `usage` … | 回合切分依据 |

实测规模：本机 570 个会话文件，最大单文件压缩 2MB / 解压 11MB。

---

## 4. 功能需求

### P0

| 编号 | 需求 | 说明 |
|---|---|---|
| F1 | 会话清单 | 扫描所有 DSH home，列出会话：工作区、标题、cwd、最后活动时间、窗口内消息数 |
| F2 | 时间窗筛选 | 预设（今天/近 7 天/本周/上周/本月/上月）+ 自定义；口径 = **最后活动时间落在区间内** |
| F3 | 分组、搜索、排除 subagent | 按工作区分组；按标题/cwd 搜索；`origin === "subagent"` 默认排除 |
| F4 | fork/resume 合并 | `parentSession` 且 `delegationDepth === 0` 的副本归并到父会话显示 |
| F5 | 窗口内内容提取 | 只取 `time ∈ [from,to]` 的回合；回合边界 = `turn/start`，归属 = 该回合的用户消息时间 |
| F6 | git 采集 | 工作区内递归发现多个仓库；`--since/--until`（带时区 ISO）、`--author`（姓名或邮箱）、当前分支/全部分支、默认 `--no-merges` |
| F7 | 提示词预览与生成 | 可编辑预览 → 新建会话（选定工作区）→ 自动发送 → 跳转到该会话 |
| F8 | 报告落盘 | 报告写入 `reports/`，文件名按区间生成，冲突自动加序号 |

### P1

- 样例库：保存/命名/选择历史报告样例。
- git 按子目录过滤（monorepo 场景，只统计某个包/目录下的提交）。
- 报告库列表：在插件面板里浏览历史报告。
- 分支说明文字、作者从仓库历史下拉选择。

---

## 5. 数据获取方式（关键设计）

**结论：插件不把会话正文塞进提示词，模型自己去读；但不让模型现编解析命令。**

理由（实测）：

1. 单会话解压后可达 11MB，直接读必然爆上下文；
2. DSH 没有面向模型的会话读取工具（20 个 `dsh-tool-*` 中无 session 相关），模型只能自己拼 `bash + zstd + jq`，容易写错且耗 token；
3. 会话格式存在 v0/v3/v4 三个版本，解析逻辑必须集中维护，不能每次让模型即兴发挥。

因此：

- 插件随包分发只读脚本 `scripts/collect.mjs`：
  - `sessions --ids <id...> --from <ISO> --to <ISO> --out <file>`：只输出窗口内回合的瘦身文本（用户消息全文 + 助手结论 + 工具调用名与关键参数），写入证据文件；
  - `git --repo <path...> --from <ISO> --to <ISO> --author <name|email> [--all-branches] --out <file>`：输出提交清单 Markdown。
- 提示词里只给：报告要求 + 用户粘贴的样例 + **会话 ID 清单 + 时间窗 + 上面这两条现成命令**。
- 证据文件写在会话自己的工作区内（沙箱允许），模型用 `read` 分页读取，可控且省 token。

报告落盘单独解决：`reports/` 在会话工作区之外，会话沙箱写不进去；由**插件宿主注册 `POST /dsh-weekly-report/reports`**，提示词里给模型一条 `curl` 命令提交最终 Markdown，宿主写入并回传路径。

---

## 6. 交互流程

1. 侧边栏/设置 → 「周报生成」面板。
2. 选时间范围（预设或自定义）→ 面板列出按工作区分组、已过滤 subagent、已合并 fork 的会话；勾选会话；用搜索框快速定位。
   - 每个工作区可折叠（点标题），折叠后仍显示「已选 n/m」；组内列表独立滚动（最高 264px），会话多也不会把表单推出屏幕；另有「折叠全部 / 展开全部」。
3. 勾选「结合 git 记录」→ 多选 git 来源工作区 → 勾选仓库 → 填 git 用户名（可多值）→ 选当前分支/全部分支。
4. 粘贴一份或多份历史报告样例（可选保存为常用样例）。
5. 点「生成预告」→ 弹出**可编辑的提示词预览**（含会话 ID 清单、时间窗、现成命令、样例）。
6. 确认 → 选报告落地的工作区（默认 = git 来源工作区）→ 浏览器调插件自己的 `POST /dsh-weekly-report/dispatch`，**由宿主**用 `ctx.sessionController.create` + `.prompt` 创建会话并发送 → 客户端再尽力 `uiWorkspace.openSession` 跳转，成功后调用设置壳传给 section 的 `close` prop 关闭设置面板（失败则不关闭，把原因留在面板上）。

> 为什么由宿主创建：浏览器半侧拿客户端服务必须走 `ctx.inject`，取不到时是静默失败；宿主路由把同样的操作变成一次普通 HTTP 调用，失败会以错误码返回、在面板上可见。宿主 `create` 会广播 `api-session/added`，新会话自动出现在侧边栏。
7. 模型跑命令、读证据、写报告、`curl` 提交 → 宿主写入 `reports/` → 面板「报告库」里可以看到。

---

## 7. 架构

```
dsh-weekly-report/
  package.json          # main + ./client + dsh.bundle.patch + dsh.client
  cordis.patch.yml      # - insert: [{ id, name }]
  lib/index.js          # 宿主：HTTP 路由 /dsh-weekly-report/{health,sessions,workspaces,reports}
  lib/client.js         # 浏览器：__ModuleLoader__ + React，注册 settings.section
  lib/core/dsh-home.js  # DSH home 发现、数据目录
  lib/core/zstd.js      # 多帧 zstd 解码 + 首/尾帧快速读取
  lib/core/sessions.js  # 会话清单、分类、最后活动时间、窗口统计
  lib/core/workspaces.js# workspace.json 读取与 cwd → 工作区映射
  scripts/collect.mjs   # 给模型用的只读提取脚本
  test/core.test.mjs
```

技术约定：宿主半侧是普通 Cordis 插件（`inject: ['webServer']`），客户端半侧手写浏览器 bundle（只需 `require('react')`，无需构建链）。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 会话日志格式随 DSH 升级变化（v0/v3/v4 并存） | 解析集中在 `lib/core/sessions.js`；格式不对时降级为"仅按最后活动时间列出"，不阻断 |
| 570+ 会话全量扫描慢 | 只读首帧（头）+ 尾帧（最后活动时间），通过筛选的会话才做全量解压；结果带 TTL 缓存 |
| 模型不照命令执行、自己乱翻 | 提示词明确写死命令；证据文件里带时间窗说明；报告里要求标注数据来源 |
| 会话含密钥/客户信息 | 只读、不外传；面板标注"内容将发送给当前模型"；预留脱敏开关（P1） |
| 报告写入被沙箱拦 | 由宿主路由写入，不走会话沙箱 |

---

## 9. 里程碑

- **M0** 脚手架 + 安装到 desktop profile，面板可渲染。✅
- **M1** 会话扫描 + 时间窗筛选 + 分工作区列表（只读）。✅
- **M2** 窗口内回合提取 + 提示词预览 + 新建会话发送 + 跳转。✅
- **M3** git 仓库发现与提交采集 + 合入提示词。✅
- **M4** 样例库 + 报告落盘路由 + 报告库浏览。✅
- **M5（P1）** 脱敏开关、git 子目录过滤、作者下拉、报告导出。

## 10. 实现现状

| 位置 | 内容 |
|---|---|
| `lib/core/zstd.js` | 多帧 zstd 解码；只读首帧（会话头）与尾帧（最后活动时间）的快速路径 |
| `lib/core/sessions.js` | 会话清单、`origin:"subagent"` 排除、`parentSession` fork 合并、窗口内回合提取 |
| `lib/core/workspaces.js` | `workspace.json` → cwd 映射 |
| `lib/core/git.js` | 仓库发现、提交采集、`--since-as-filter` 修复、作者/分支/merge 过滤 |
| `lib/core/prompt.js` | 提示词与证据命令构建（时间边界精确到毫秒，带本地时区偏移） |
| `lib/core/reports.js` | 报告与样例库的落盘、命名（`2026-W41.md`）、防覆盖、防目录穿越 |
| `lib/index.js` | 宿主路由：`/health` `/workspaces` `/repos` `/sessions` `/prompt` `/reports` `/samples` `/dispatch` |
| `lib/client.js` | 设置页「周报生成」面板：会话选择、git 选项、样例、提示词预览、发送跳转、报告库 |
| `scripts/collect.mjs` | 给模型的只读证据采集脚本（sessions / git） |
| `scripts/save-report.mjs` | 把报告 POST 给插件（宿主写入，不受会话沙箱限制） |

测试：`node --test test/*.test.mjs`（18 个用例，覆盖解码、筛选、合并、git 过滤、路由、提示词、落盘、面板渲染）。
