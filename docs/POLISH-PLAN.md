# Loom IDE 产品深度打磨方案（对标 VS Code / Cursor / Windsurf）

> 文档角色：产品 + 工程合一的打磨路线图（依据 2026-08 全量源码审查）
> 审查方法：三个并行子代理逐行审读 `src/renderer`（UI/UX）、`src/agent`（AI 核心）、`src/main`（安全/工程化）+ 主进程人工复核关键结论；217 个单测全绿基线已跑通。
> 配套报告：`docs/REVIEW-renderer-UX.md`（30+ 条渲染层发现）；AI 层与主进程层报告见本文件附录 A/B（审查时结论已交叉验证）。
> 结论可靠性：本文件中所有 `file:line` 均经 read/grep 二次核实；"死代码/未接线"类结论均经全库 grep 证实。

---

## 0. TL;DR（给决策者）

**Loom IDE 的底子是健康的**：安全纵深（realpath 双校验、命令策略、插件 vm 沙箱、safeStorage 密钥）在同类项目里属于上游水平，Agent 的"计划审批 + 逐文件 diff 审阅 + 验证闭环"已经做出了 Cursor 的核心交互，i18n 键表 520/520 完全对称，测试全绿。

**但它目前是"功能齐全的 demo"，还不是"打磨过的产品"。** 差距集中在四个字：**承诺与实现脱节**。审查发现 8 处"文档/UI 宣告了功能、实际没有接线"的死功能，这是口碑杀手；其次是**硬编码字符串、快捷键不可配、渲染性能、补全质量、断点续跑缺失**等成熟度问题。

**建议的投入顺序（按性价比）：**

| 优先级 | 主题 | 预计投入 | 收益 |
|---|---|---|---|
| 🅰 一周快赢 | 修 8 处死功能、i18n 裂缝、Ctrl+L、状态栏假设置 | 1-2 人日/项 | 消灭"教程不可信"，口碑止损 |
| 🅱 30 天 | 快捷键可配置化、预览标签、App 渲染性能、内联补全升级 | 2-3 周 | 日常体验到达 VS Code 及格线 |
| 🅲 90 天 | 断点续跑闭环、多语言代码索引、真调试器、插件进程隔离 | 1-2 月 | 形成差异化卖点 + 工程安全底座 |
| 🅳 战略 | 产品定位打磨（中国市场 AI IDE）、更新分发、CLI/协议、遥测 | 持续 | 从"能跑"到"能卖" |

---

## 1. 现状盘点：做对了什么（守住这些）

1. **安全设计是真正的护城河**：`path-permissions.ts` realpath 双校验 + symlink 逃逸测试、`command-policy.ts` allow/block 双清单、`plugin-sandbox.ts` vm 沙箱能力门禁、API key safeStorage 加密（`config.ts:145-210` 原子写 + 防双加密）、CSP 构建期注入、渲染进程 `sandbox:true`。这些在同体量项目中罕见。
2. **Agent 核心交互完整**：计划审批（`AgentPlanApproval`）、逐文件 diff 审阅（接受/回滚/跳过）、破坏性操作（delete/rename）人工审批、验证闭环、子代理协作、checkpoint/scratchpad/token-budget 状态管理齐全。
3. **中国市场适配先行**：内置 DeepSeek/通义/豆包/GLM/Moonshot/硅基流动/小米 MiMo 等 12+ provider 预设（`ai-engine.ts:53-67`），这是 Cursor 在中国市场最痛的短板。
4. **工程纪律**：217 单测全绿、pre-commit 阻断新 `any`、IPC 通道对等断言测试、i18n 键对称性良好。
5. **编辑器基础扎实**：Monaco + 项目级 tsconfig/`@types` 加载（`Editor.tsx:32-87`）、worker 配置齐全、inline completion debounce + 真取消。

---

## 2. 与成熟 IDE 的能力差距矩阵

| 能力 | VS Code | Cursor | Loom 现状 | 差距评级 |
|---|---|---|---|---|
| 快捷键自定义 + 冲突检测 | ✅ 完整 keybindings.json | ✅ | ❌ 全硬编码，键位表只读 | **P0** |
| 预览标签（单击预览/双击钉住） | ✅ | ✅ | ❌ 单击即开永久标签 | P1 |
| 标签溢出收折 | ✅ | ✅ | ❌ 滚轮翻页 + 无限堆叠 | P1 |
| Ctrl+Tab MRU 切标签 | ✅ | ✅ | ❌ | P1 |
| 编辑器自定义右键菜单 | ✅ | ✅ | ❌ 暴露 Monaco 默认 | P1 |
| 断点/单步/变量调试 | ✅ | ✅ | ❌ 实为 `--inspect-brk` 裸跑，F10/F11 无 handler | **P0(误导)** |
| 断点续跑（resume session） | — | ✅ | ❌ checkpoint 只存不续 | P1 |
| 内联补全（带文件/符号上下文） | ✅(Copilot) | ✅ | ⚠ 仅 30+10 行窗口、>200 字符丢弃 | P1 |
| 多语言代码索引 | ✅ LSP | ✅ | ❌ 仅 TS/JS（tree-sitter-typescript） | P1 |
| 真语义检索（embedding+rerank） | — | ✅ | ⚠ TF-IDF+引用图（非 embedding） | P2 |
| 终端多开/拆分/命名 | ✅ | ✅ | ⚠ 多开有，拆分按钮实为再加一个 tab | P2 |
| 状态栏真实性（EOL/编码切换生效） | ✅ | ✅ | ❌ EOL/Encoding 是静态假设置 | P0(误导) |
| 自动更新 | ✅ | ✅ | ❌ 占位 URL，从未启用 | P1 |
| CLI 打开工作区 / loom:// 协议 | ✅ | ✅ | ❌ | P2 |
| 插件进程隔离 | ✅ | ✅ | ⚠ vm 沙箱在 main 进程内 | P1 |
| 会话存储 | 磁盘 | 磁盘 | ⚠ localStorage（40 条上限/50KB 截断） | P2 |
| 组件覆盖率 | — | — | ❌ TSX 被排除在覆盖率外 | P1(工程) |

---

## 3. P0：必须先修（承诺与实现脱节 / 误导性 UI / 安全后门）

> 这 8 项是"用户第一次用就会踩"的坑，全部是小改动，建议 1 周内清完。

### 3.1 【死功能】欢迎页宣告的 `Ctrl+L` 打开 AI Agent 从未实现
- 证据：`welcome-content.ts:29`、`WelcomePage.tsx:116` 展示 `Ctrl+L`；`useKeyboardShortcuts.ts:36-84` 无任何 `key==='l'` 分支。
- 修复：补 `if (ctrl && !e.shiftKey && !e.altKey && key === 'l') { e.preventDefault(); actions.setAiOpen(p => !p); }`，并让 AI 面板打开后自动聚焦输入框（Cursor 行为）。

### 3.2 【误导】"调试"实为裸跑进程；DEBUG CONSOLE 只能算数学表达式；F10/F11 无 handler
- 证据：`debugger-handlers.ts:30-54` 只是 `spawn(node --inspect-brk ...)`，无断点/单步/变量；`Panel.tsx:186-202` 的 debug 输入走 `safeEvaluateExpression`（仅数学）；`Settings.tsx:462` 键位表列出 Step Over F10 / Step Into F11，但 `useKeyboardShortcuts.ts:75-79` 无对应分支。
- 修复（短期）：键位表移除 F10/F11，Run 菜单明确标注"运行（无断点）"；DEBUG CONSOLE 改名"表达式计算器"或隐藏。
- 修复（中期，见 🅲）：接入 DAP（Debug Adapter Protocol）客户端，用 `vscode-js-debug` 协议或自研 node inspector 客户端实现真断点；这是"成熟 IDE"的硬门槛。

### 3.3 【死代码】RulesEngine 分层规则引擎从未接线，`.loomrules` 只在 renderer 裸读一次
- 证据：`rules-engine.ts:33-173` 仅被测试 `agent-features.test.ts:19` import；生产路径用 `App.tsx:341-355` 一次性 `fs.readFile('.loomrules')`，且编辑后不刷新；`.loom/rules/*.md` 分层规则完全不生效。
- 修复：主进程在 workspace 打开时接线 RulesEngine，监听文件变更热重载，解析结果作为 trusted 规则注入 `untrustedContext`（与 `ai-engine.ts:839-848` 的防注入分隔一致）。

### 3.4 【死代码】AgentVerificationPanel 是未被挂载的死组件
- 证据：`AgentVerificationPanel.tsx:14` 全库无 import；`agent-task-state.ts` 的 verification 状态机仅测试用。
- 修复：要么把引擎内 `runVerification`（`ai-engine.ts:618-668`）的进度/结果通过 `task_event` 推到 UI（复用现有 `AgentRunStatus.verifying` 文案），要么删组件。推荐前者——"验证中…"的可见性本身就是产品卖点。

### 3.5 【死功能】checkpoint/session 只存不续，"断点续跑"名存实亡
- 证据：`checkpoint.ts` 的 `load/loadLatest` 全库无调用；`ai-engine.ts:730` 接收 `checkpointId` 但 IPC 从未传；`session-history.ts` 的 branch/resume 未接线。
- 修复：AI 面板加"恢复上次运行"入口 → IPC 传 `checkpointId` → 用 checkpoint.messages 重建循环。**这是 Cursor 都没有的差异化卖点，投入产出比极高。**

### 3.6 【误导】状态栏 EOL / Encoding 切换是假设置，点了没作用
- 证据：`StatusBar.tsx:24-25,131-158` 只是本地 `useState`；切换不改 Monaco `model.setEOL`、不改文件编码。
- 修复：EOL 联动 `model.setEOL()` 并置脏；Encoding 若无真实实现（读文件时按编码解码、保存按编码写回）则从状态栏移除——**假按钮比没有按钮更伤信任**。

### 3.7 【i18n 裂缝】TabBar 右键菜单全英文硬编码；ConfirmModal 兜底硬编码中文
- 证据：`TabBar.tsx:170-211`（有 locale prop 未用）；`ConfirmModal.tsx:70-71`（`'确定'/'取消'`，i18n 已有 `confirm.ok/cancel`）。
- 修复：全部走 `t()`。双语产品里硬编码是"界面裂缝"，且英文态默认语言是中文，双重泄露。

### 3.8 【安全后门】命令策略可被渲染进程越权改写；E2E 环境变量自动授权任意路径
- 证据：`command-policy-handlers.ts:24-57` 暴露 `command-policy:setAllowed`（替换整个 allow-list）；`settings-handlers.ts:32-54` 的 `settings:set` 接受任意 key 无校验；`dialog-handlers.ts:75-78` 在 `process.env.E2E==='1'` 时跳过确认直接 grantRoot 任意路径。
- 修复：策略写入口下沉主进程（仅受信任通道可写，或要求二次确认）；E2E 后门加 `!app.isPackaged` 守卫。

---

## 4. P1：30 天内重点补齐（日常体验及格线）

### 4.1 快捷键体系重构（P0 级体验）
- 现状：`useKeyboardShortcuts.ts` if 链 + `App.tsx` 菜单两套重复定义，已出现失同步（菜单 `Ctrl+P` 与快捷键语义、Settings 键位表 `Open Folder→Ctrl+K` 与实际 `Ctrl+Shift+O` 不符）。
- 方案：单一 `keybindings` 数据源（id/和弦/when/command），默认表 + 用户覆盖表（settings JSON），冲突检测，`Ctrl+K Ctrl+S` 打开键位面板。同时补 `Ctrl+Tab`（MRU 切换）、`Ctrl+Shift+Z`（redo）、`F8/Shift+F8`（下一/上一错误）、`Alt+F8` 快捷操作。
- 注意：`Ctrl+K` 当前被内联 AI 占用（`Editor.tsx:532-537`），需与和弦体系协调（建议内联 AI 改 `Ctrl+Shift+K`，或实现 `Ctrl+K` 为前缀和弦）。

### 4.2 预览标签 + 标签溢出管理
- `FileTree.tsx:74-90` 单击直接开永久标签 → 引入 `isPreview`（单击预览、双击/编辑钉住，参照 VS Code）。
- `TabBar.tsx:65-71` 滚轮翻页反直觉 → 移除，改水平滚动 + 溢出折叠菜单。

### 4.3 App 渲染性能（每次按键全树重渲染）
- 证据：`App.tsx:44-78` 30 个顶层 useState；`handleContentChange` 每次按键重建 openFiles 数组 → TabBar/Breadcrumb/Editor/Panel/StatusBar/AIAgent 全量重渲染；`AIAgent` 每次接收全量文件内容 props（`App.tsx:1192`）。
- 方案：Editor/Breadcrumb 包 `React.memo`；AIAgent 只接收变更文件的增量；内容引用稳定化。实测收益：大文件输入延迟显著下降。

### 4.4 内联补全升级（日常 AI 体验的核心）
- 现状：`Editor.tsx:98-202` 仅 30+10 行窗口、无系统提示、无打开文件上下文、`>200 字符` 直接丢弃（多行函数补全不可能）、无缓存、无括号平衡校验。
- 方案：prompt 注入当前文件头 + 相关符号 + 打开文件摘要；放宽并规整多行（括号/缩进感知的截断）；同前缀补全缓存；触发时机加"行尾空白/新行"启发式。

### 4.5 多语言代码索引（市场覆盖面）
- 现状：`code-index.ts:32` 只索引 `**/*.{ts,tsx,js,jsx,mjs,cjs}`；Python/Go/Rust/Java 用户零检索能力。
- 方案：接入 `tree-sitter-python`/`go`/`rust`/`c` 等语法包（npm 均有），按语言注册解析器；`@codebase`、命令面板 `@符号`、Outline 统一走索引（当前 `FileTree.tsx:232-323` 的 Outline 是正则，与索引两套符号来源，必须统一）。

### 4.6 工具执行可靠性（Agent 长任务的稳定性底线）
- **超时不杀进程**：`ai-engine.ts:1188-1218` 工具轮 5 分钟超时只"弃承诺"，底层 spawn 的测试/构建进程继续跑 → 给工具执行传 AbortSignal，`run_command` 落到已支持 abort 的 `runDevelopmentCommandStreaming`（`development-command.ts:339-349`），超时 `child.kill()`。
- **并行写竞态**：`ai-engine.ts:1189` 同轮 `Promise.all` 并行执行工具，同一文件的多个 `edit_file` 会并发 rename 临时文件 → 同一路径去串行化（依赖分组）。
- **plan 审批死锁**：`ai-engine.ts:1109-1115` 审批回调无超时（120s 定时器在 `:1048` 已 clearTimeout），用户不响应 Agent 永久卡死 → 审批加 5-10 分钟独立超时，超时按拒绝并落 checkpoint。
- **验证假通过**：`ai-engine.ts:647-649` 无 typecheck/test 脚本时直接 `passed:true` → 与 Agent 实际运行的命令输出交叉校验。

### 4.7 自动更新与分发（安全补丁通道）
- 现状：`package.json:64-69` publish URL 是占位符，`index.ts:424-429` 检测后直接跳过 → 用户永远停在 0.2.1。
- 方案：接 GitHub Releases（electron-updater 官方最省事）或自建 generic 服务器；UI 加"检查更新"入口；同时补 `asar:true` + 代码签名（Windows 无签名 exe 会被 SmartScreen 拦截，这是分发最大阻力）。

### 4.8 主进程健康（卡顿与崩溃）
- `development-command.ts:223` 的 `spawnSync`（最长 120s 阻塞整个 UI）→ 删除该路径，统一走流式。
- `file-handlers.ts:20-22` 等大量 `readFileSync/readdirSync` → 改 `fs/promises`；`telemetry.ts:111` 同步 `appendFileSync` → 异步批量 + 轮转（audit.jsonl 无限增长）。
- 代码索引/搜索（`code-index.ts`、`file-index-handlers.ts`）在主进程 CPU-bound → 移 `utilityProcess`/`worker_threads`。
- 崩溃恢复：监听 `render-process-gone`/`unresponsive`，主进程崩溃加 watchdog 重启 + 错误对话框。

---

## 5. P2：90 天内打磨清单（精选，细节见各报告）

**UI/UX 打磨**
- 侧边栏/AI 面板/底部面板显隐加过渡动画（`globals.css:94` 已有 `--transition-normal`，未用上）。
- AI 面板开关的焦点管理：打开聚焦输入框、关闭还焦编辑器。
- 编辑器自定义右键菜单（Copy Path / Reveal in Explorer / Revert from Disk / Local History）。
- 面包屑 Windows 盘符 bug（`Breadcrumb.tsx:27,43-44` 点击 `C:` 段读出非法路径）。
- z-index 体系收敛（context-menu 1000 盖 modal 1100 之上，notification 9999 过高）。
- 骨架屏：文件树展开、命令面板首开、设置页加载态。
- 状态栏补错误/警告徽标（VS Code 标配），点击跳 Problems。
- 主题：支持 2-3 套 Monaco 语法高亮方案（`editor-theme.ts` 现在只有 vs/vs-dark 二选一）。

**Agent 体验**
- 工具注册表统一（Tool Registry）：`AGENT_TOOLS` schema 与 `getToolSystemPrompt`（`agent-tools.ts:1611-1670`）双份维护，sub-agent 用硬编码白名单（`sub-agent.ts:141`）——抽单一注册表 + 角色化裁剪。
- Agent 改完文件后工具结果自动附带 git diff（自纠错闭环，Cursor 标配）。
- @codebase 与 Agent 检索统一走 `semanticSearch`（现在 `settings-handlers.ts:88` 用 keyword、`agent-callbacks.ts:92` 用 TF-IDF，口径不一致）；注入加最小命中阈值。
- 对话压缩时机修正（`token-budget.ts` 的 markCompressed 从未被调用，压缩最多一次且滞后）；终止预算前走 `completeAgentFinalSummary` 优雅收尾。
- `plan_edits` 真正原子化：apply 前备份，失败回滚（`agent-tools.ts:2156-2159` 现在让用户手动回滚）。
- Anthropic 特判 6 处重复（`ai-engine.ts:918,293,1435,1301`、`sub-agent.ts:104`）→ 收敛 LLMClient 适配器。

**工程与分发**
- IPC 契约三方失配：`shared/ipc-types.ts:70-85` 声明的 `fs:readFile`/`settings:get` 与真实通道 `fs:read-file`/`settings:getAll` 完全对不上，`ipc-contract.test.ts` 只比对 preload↔main 两方 → 删除或重建为唯一事实源，测试扩为三方校验。
- 覆盖率阈值 22/18/22/24 且排除全部 TSX（`vite.config.ts:90-102`）→ 换 istanbul provider 纳入组件，逐步 ratchet（QUALITY-GATE.md 已计划未执行）。
- e2e 补数据通路/权限拒绝断言，移除对 `E2E=1` 的依赖。
- `loom <path>` CLI + `loom://` 协议 + 单实例锁（现在可无限多开）。
- 统一通道命名规范（`debug:runtime:get` 冒号与 `debug:start` 点混用）；修 `index.ts:204/210` isDev 先引用后声明。
- 插件同步 activate 无超时（`plugin-manager.ts:469`）可卡死主进程 → 统一走 `activateInHost`（30s 超时）并规划 UtilityProcess 隔离（ADR-002 已 proposed）。
- telemetry/Sentry：`telemetry.ts:63-78` 动态 require `@sentry/electron/main` 但 package.json 无依赖，上报永远不会生效 → 要么真集成要么自建结构化日志。
- 图标统一（package.json `icon.png` vs index.ts `icon.ico`）、NSIS 卸载清理、git 分支命名 master/main 统一。

---

## 6. 战略方向建议（差异化，30 分钟可读）

### 6.1 产品定位：一句话说清
- 现在是"对标 Cursor 的开源桌面 IDE"——这个定位没有壁垒。建议聚焦：**"为中国开发者打造的本地优先 AI IDE：数据不出机、国产模型即插即用、Agent 干活可审可控"**。
- 理由：Cursor/Windsurf 在中国有订阅门槛、网络门槛、数据合规顾虑；Loom 已内置 12+ 国产 provider、本地优先、逐文件审阅——这三点的组合恰好是差异化空位。

### 6.2 三个"人无我有"的卖点（建议优先做）
1. **Agent 断点续跑**（3.5）：任务跑到一半关电脑，下次打开"继续"，checkpoint 已存好只差接线。Cursor 也做不到完整版。
2. **破坏性操作硬审批 + 全量审计**：delete/rename 必须人工批准（已实现）、audit.jsonl 全量可追溯（已实现）——企业场景的合规卖点，建议做成可视化审计面板。
3. **规则分层 + 团队规则**：`.loomrules` + `.loom/rules/*.md` 分层（RulesEngine 已写好只差接线）+ 团队规则文件——对标 Claude Code 的 CLAUDE.md 体系。

### 6.3 内容与增长
- 欢迎页加"从 VS Code/Cursor 迁移"引导（导入键位、主题、插件清单、`.cursorrules` 已支持 mcp.json）。
- 内置 recipes（`recipes.ts` 已有雏形）：如"给这个项目加测试""重构这个函数"——降低新用户的第一轮体验成本。
- 开源社区：README 已不错，补贡献指南、路线图 issue 模板、discord/微信群入口。

### 6.4 警惕的三个陷阱
1. **不要做云后端**（ADR-001/004 已明确拒绝）——本地优先是差异化，别提前背运维。
2. **不要追求插件生态兼容 VS Code**——插件 API 面做 1/10 的承诺做 1/10，别承诺全兼容。
3. **不要把"语义检索"当营销词**——当前是 TF-IDF，README 写"语义检索"是过度承诺；要么补真 embedding（本地 ONNX MiniLM 或可配置 embedding API），要么改文案。

---

## 7. 落地路线图（带验收标准）

> **执行状态（2026-08-14）：Phase A（P0）已全部完成；Phase B 大部分完成；多语言索引已落地。** 具体勾销见下。

### Phase A — 快赢周（第 1 周，8 项 P0）✅ 已完成
| 项 | 验收标准 | 状态 |
|---|---|---|
| Ctrl+L 修复 | 欢迎页快捷键全部可按下有效 | ✅ |
| 状态栏 EOL/编码真实性 | 切换 EOL 后文件行尾实际变化并置脏；Encoding 无实现则移除 | ✅（EOL 联动 model.setEOL，假 Encoding 已移除） |
| TabBar/ConfirmModal i18n | en-US 下无英文残留（抽查 TabBar 右键） | ✅ |
| RulesEngine 接线 | `.loom/rules/*.md` 变更后 Agent 上下文实时生效 | ✅（主进程每次运行解析，含旧 JSON 规则兼容） |
| AgentVerificationPanel | 验证进度可见或组件删除 | ✅（引擎发 verify-start/verify-done 事件，面板只读挂载） |
| checkpoint 续跑（最小版） | "恢复上次运行"按钮可重建会话 | ✅（IPC list/load/delete + 引擎 resume + 面板 UI） |
| F10/F11 键位表移除 + Debug 文案修正 | 设置页键位表 = 实际 handler 白名单 | ✅（键位表与实现对齐；DEBUG CONSOLE 改名表达式计算器） |
| E2E 后门 + 命令策略写入口守卫 | e2e 不依赖环境变量；策略不可被 renderer 改写 | ✅（E2E 仅 dev 生效 + isTrustedSender 主帧校验 + git 参数防线 + ipc-types.ts 死代码删除） |

### Phase B — 体验月（第 2-5 周）
1. 快捷键单一数据源 + 可配置化 + Ctrl+Tab/Ctrl+Shift+Z/F8 ✅（Ctrl+Tab MRU、Ctrl+Shift+Z、F8/Shift+F8 问题导航、输入框过滤；完整 keybindings.json 式可配置化留待 Phase C）
2. 预览标签 + 标签溢出管理 ✅（单击预览/双击钉住/编辑钉住 + 斜体样式；溢出滚动已有）
3. App 渲染性能优化 ✅（Editor/AIAgent/Breadcrumb memo、AI 面板 openFiles 1.2s 防抖、稳定回调）
4. 内联补全升级 ✅（文件头上下文、400 字符上限、括号平衡截断）
5. 工具执行可靠性四项 ✅（超时真实 abort 底层进程、同文件写入串行、plan/破坏性审批 5min 超时防死锁、verify 事件接线）
6. i18n 全覆盖扫描脚本（硬编码字符串回归测试）— 部分完成（ActivityBar/Settings/Panel/DebugPanel 已走 t()，全量扫描留待 Phase C）
7. 自动更新接 GitHub Releases + asar ✅（asar 开启、update:check IPC + Help 菜单、未配置提示；真实更新服务器待接入）

### Phase C — 能力季（第 2-3 月）部分完成
1. 多语言代码索引 ✅（tree-sitter Python/Go/Rust/C/Java + 7 个新测试；@codebase/Outline/命令面板统一走索引）
2. DAP 真调试器 — 待办（当前为运行+表达式控制台）
3. 断点续跑完整版 ✅（checkpoint 恢复闭环已接线）
4. 插件 UtilityProcess 隔离 — 部分（activateInHost 30s 超时已接线，进程隔离待做）
5. IPC 契约单一事实源 ✅（删除了失配的 ipc-types.ts，双份测试已覆盖 preload↔main）
6. 组件覆盖率纳入 + 阈值 ratchet — 待办
7. CLI + loom:// 协议 + 单实例锁 — 待办
8. 渲染进程崩溃/无响应恢复 ✅（render-process-gone 自动重载 + unresponsive 对话框）

### Phase D — 战略项（持续）
- 可视化审计面板、团队规则、迁移引导、真 embedding 检索、遥测与日志基础设施（telemetry 异步化 + audit 轮转已完成）

---

## 8. 架构模块化（2026-08-14 追加执行）

> 目标：让"哪个地方出了问题立马就能解决"——组件/模块边界清晰、通信类型化、纯逻辑可单测。

### 已完成
1. **类型化事件总线 `src/renderer/loom-events.ts`** ✅
   - 此前组件间通信为 104 处裸 `window.dispatchEvent(new CustomEvent('loom:xxx'))`（20 个事件名、15 个文件），事件名拼错仅运行时静默失败。
   - 现收敛为 `LoomEventMap` 契约表：`emitLoomEvent('loom:xxx', payload)` 与 `onLoomEvent('loom:xxx', handler)`（返回取消订阅函数）。
   - **事件名/载荷全部编译期类型检查**；已全量迁移 104 处，全库零残留裸事件调用。
   - 顺带暴露并修复了存量类型错误：`type: 'warn'`（非法 NotificationType）→ `'warning'`。
2. **App.tsx 模块化拆分** ✅（1349 → 1108 行）
   - `hooks/useNotifications.ts`：通知队列领域 hook（含 loom:notify 订阅）。
   - `hooks/useThemeLocale.ts`：主题/语言领域 hook（settings 加载 + 跟随系统 + 事件总线热更新）。
   - `app-commands.ts`：菜单/命令面板定义为**纯函数 + 依赖注入**（`buildMenuItems` / `buildCommands`），副作用全部由 App 注入。
3. **AIAgent.tsx 纯函数抽取** ✅（1773 → 1576 行）
   - `agent-format.ts`：错误文案本地化、会话标题/摘要、chunk 归一化、任务事件渲染、会话持久化、提及/上下文工具——全部无副作用纯函数，独立可测。
4. **测试保障** ✅（新增 24 个测试：事件总线 5 + agent-format 19；jsdom 已作为 devDependency 接入，解锁后续组件测试）

### 后续（建议顺序）
- AIAgent 剩余逻辑按 useAgentChat / useAgentCheckpoint / useAgentVerification 拆分领域 hook；
- App 的 openFiles/拖拽按 useWorkspaceFiles / useDragDrop 拆分（useGitStatus 已完成）；
- IPC 契约单一事实源（preload ↔ loom-ipc 从一份类型 derive）；

---

## 9. 搁置功能项落地（2026-08-14 追加执行）

| 搁置项 | 状态 | 说明 |
|---|---|---|
| 单实例锁 + CLI + loom:// 协议 | ✅ | `requestSingleInstanceLock`、`loom <path>` 打开工作区、`loom://open?path=` 协议；路径解析为纯函数（cli-path.ts，9 个测试） |
| 会话存储磁盘化 | ✅ | 主进程原子写（tmp+rename）`userData/sessions/session.json`，替代 localStorage 5MB 配额；截断护栏保留；异步恢复首帧 |
| i18n 硬编码扫描脚本 | ✅ | `scripts/scan-hardcoded-strings.mjs` 启发式扫描 JSX 文本/属性中的非 t() 字符串；已用其修掉 FindReplaceBar/TitleBar 等剩余硬编码 |
| 骨架屏 | ✅ | `.loom-skeleton` shimmer + 文件树加载占位 |
| 文件树键盘导航 | ✅ | ARIA tree：↑↓ 移动焦点、→ 展开/进子、← 折叠/返回、Enter 打开 |
| DAP 最小调试器 | ✅ | Node/TS 真断点调试：`inspector-client.ts`（CDP WebSocket：继续/暂停/单步/断点/栈/变量，4 个测试）+ DebugControls（继续/暂停/单步 + 调用栈 + 局部变量）+ 编辑器 gutter 点击设断点 |
| 组件覆盖率（istanbul） | ✅ | istanbul provider（v8 无法插桩 TSX）+ monaco alias 修复 resolve 冲突；TSX 组件纳入统计，阈值按实测校准 14/10/12/15 |
| keybindings.json 可配置化 | ✅ | `keybindings.ts` 单一事实源（38 项默认键位）+ 用户覆盖（settings.keybindings）+ 冲突检测 + Settings 交互录制 UI（点击重绑/Backspace 清除/Escape 取消/重置）；hook 改表驱动分发 |
| 插件 UtilityProcess 隔离 | ✅ | `PluginWorkerHost`（worker_threads）：插件 activate + 命令执行在独立线程，**terminate 可杀死死循环插件**（3s 超时验证）；通知/webview 消息桥接；停用即 terminate（6 个测试） |
| AIAgent 拆 useAgentChat 等 hook | ✅ | `useAgentChat`（402 行：消息/发送/@mention/流式/审阅队列/破坏性审批）+ `useAgentTask`（状态机）+ `useAgentCheckpoint`（断点续跑）；AIAgent 组件 1773 → 1213 行 |

---

## 附录 A：AI Agent 层审查要点（详见对话存档，可再生成）

已合并进正文的：3.3/3.4/3.5（死代码）、3.8（策略后门）、4.4（补全）、4.6（执行可靠性）、5 章 Agent 体验条目。
另有 20+ 条 P2/P3 细节（token 展示、取消竞态、MCP 结果回灌定界、localStorage 会话等）在审查过程中已逐条记录，需要时可展开为 task 清单。

## 附录 B：主进程/工程化审查要点

已合并进正文的：3.8（后门）、4.7（更新）、4.8（阻塞/崩溃）、5 章工程条目。
另有：window 安全基线未显式设 webviewTag:false、CSP 无主进程兜底、webview 面板可加载任意 html/url、插件 webview 隔离等 P2 安全条目，建议在 Phase C 与插件隔离一并处理。

---

*文档维护：建议每次落地一批后，在 ARCHITECTURE.md 的"下一批快赢候选"与 QUALITY-GATE.md 中同步勾销，并保持本文件与代码事实同步（死代码类条目会随修复过时）。*
