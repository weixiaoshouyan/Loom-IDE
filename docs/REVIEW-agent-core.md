# Loom IDE — AI Agent 核心能力深度审查报告

> 审查范围：`src/agent/**`（Agent 循环/工具/上下文/补全/审批/会话）+ 相关 renderer 组件
> 对标：Cursor / Windsurf / Claude Code / Aider / Continue
> 全部 `file:line` 证据均经 read/grep 核实；"无人调用/死代码"结论经全库 grep 证实。

---

## 维度一：Agent 循环可靠性

### 1.1【P1】工具轮超时只"弃承诺"，不杀真实进程 → 子进程悬挂/孤儿进程
`ai-engine.ts:1188-1218` 用 `TOOL_ROUND_TIMEOUT_MS = 300000` 把每个工具调用包进 `Promise.race`，超时后仅 `finish(...)` 一个"已超时废弃"的字符串（line 1200），但**底层 `executeToolCall` 仍在后台继续运行**（run_command 的 spawn、write_file 的磁盘 IO、MCP 请求不会因 Promise 废弃而中止）。若工具是 `run_command` 启动的测试/构建，5 分钟后 Agent 已带着"超时"结果继续下一轮，而那条 shell 命令仍占用 CPU/端口。
- **影响**：长任务中命令重复叠加、端口被占、磁盘被写脏，且没有 Kill 句柄。
- **建议**：仿 Cursor/Claude Code，给每个工具的执行传 `AbortSignal`；对 `run_command` 落到 `runDevelopmentCommandStreaming`（已支持 `abortSignal`，`development-command.ts:339-349`），超时/停止时 `child.kill()`；对 `write_file` 等同步 IO 至少在超时后记录并提示"改动可能已落盘"。

### 1.2【P1】并行执行破坏多轮编辑顺序
`agent-tools.ts:1661/1667` 系统提示明确告知"多个 tool_call 会并行执行"，且 `ai-engine.ts:1189` 用 `Promise.all` 并行执行**同一轮**内所有工具。OpenAI 原生工具调用中，多工具并行对独立 `write_file`（写不同文件）合理，但若模型一次发多个 `edit_file` 同一文件，就会并发读写同一文件产生竞态。
- **影响**：同一文件的多达 5 个 edit 并发 rename 临时文件，可能互相覆盖或 SKIP。
- **建议**：参照 Aider/Claude Code 的工具执行器，对**同一文件路径**去串行化（dependency 分组），或默认单并发、仅在模型显式声明 `parallel: true` 时才并行。

### 1.3【P2】对话压缩策略与 token budget 联动有缺陷
`token-budget.ts:52` `recordUsage` 在 `compressionThreshold` 触发后置 `_compressed=true`，且 `markCompressed()` 从未在 `ai-engine.ts` 中被调用（grep 证实），因此**压缩在整次运行中最多发生一次**。而 `ai-engine.ts:895-902` 的压缩触发发生在每轮 `recordUsage(0,0)`（line 890，本轮 API 用量尚未记录）判定时，靠的是**上一轮**累计值，时机滞后。
- **影响**：长对话在 80k token 预算内只压缩一次，之后全靠 `terminationThreshold=0.9` 提前终止，Agent 工作被硬切断（line 891-894 直接 `return`），没有优雅收尾。
- **建议**：压缩应对"当前完整 conversation"做估算并在每次 API 返回后评估；压缩后允许再次触发；终止前强制引导模型产出最终答案（已有 `completeAgentFinalSummary`，但当前在预算耗尽分支直接 return 没走它）。

### 1.4【P2】`chat()/chatStream` 无重试，只有 Agent 主循环有
`ai-engine.ts:1418-1473` 的 `chat()`（用于压缩摘要、`askWith` 语义、内联编辑校验上下文）用裸 `fetch`，无 429/5xx 重试，一旦网络抖动直接返回 `Error:` 字符串。对比 Agent 主循环已有 `fetchWithRetry`（line 90-124）。
- **影响**：摘要压缩、双模型对比、内联补全在瞬时网络错误下直接报错，影响体验。
- **建议**：将 `chat`/`chatStream` 统一收敛到 `fetchWithRetry` + `read-stall` 守卫（已是 `askWithStream` 的做法）。

### 1.5【P2】plan 审批死锁风险：审批回调无外部超时
`ai-engine.ts:1109-1115` `await options.planApproval(...)` 阻塞，而 main 侧 `ai-stream-handlers.ts:239-248` 的审批 Promise 只有在 `controller.signal.abort` 才 reject。120s 的组合超时在 line 1048 **已提前 clearTimeout**（仅覆盖 HTTP 请求），故用户既未点确认也非 Ctrl+C 停止时，Agent 永久停在 `waiting_for_plan_approval`。
- **影响**：计划模式卡死（死锁风险），后台任务占用、无法轮转。
- **建议**：审批回调加独立超时（如 5–10 分钟后自动按"拒绝"处理并落 checkpoint），或将 planApproval 与该 stream 的生命周期彻底绑定。

### 1.6【P2】取消语义不一致：`stopGeneration` 后历史消息可能悬挂
`AIAgent.tsx:1042-1051` `stopGeneration()` 手动 `finishAssistantMessage` 复位 isStreaming，但依赖 `currentRequestIdRef`。若用户连发两轮，第二轮请求已在处理而用户点停止，只复位了最后一个 requestId 对应的消息。main 侧 `ai:chat-stream-abort`（ai-stream-handlers.ts:166-169）能正确中断，但 renderer 的状态与主进程的流式状态存在 1–3 条消息的竞态窗口（agent 流靠 `ai:agent-chat-end`，abort 后走 error 通道）。
- **建议**：统一用 stream 级 requestId 的 end/error 事件作为"最终状态"，渲染端不要靠 ref 手动兜底。

---

## 维度二：工具能力缺口（对标 Cursor/Claude Code）

### 2.1【P2】缺核心工具：终端交互、grep 结果精准检索、符号跳转、浏览器/截图、多任务并行
对照 `AGENT_TOOLS`（agent-tools.ts:71-427）的工具集合，缺少成熟产品标配：
- **无"打开/聚焦文件"/符号跳转工具**（`go_to_symbol`、`open_file_cursor` 类）：Agent 读完文件后无法让 IDE 定位到相关行辅助用户查阅。
- **grep 工具弱**：`search_code` 的 grep 分支（agent-tools.ts:889-988）是自实现的递归遍历，无 ripgrep/`glob` 正规引擎、无 `-C` 上下文、无二进过滤外仍逐行扫全部文件，大仓库慢（虽有 yield，line 960）。
- **无浏览器预览/截图**：虽有 `mcp-puppeteer` marketplace 条目（mcp-marketplace.ts:82-90），但未作为一等公民。
- **无并行任务工具**：`run_command` 是同步式一次一条，`background-agent` 有队列（maxConcurrent=2）但工具层无"异步提交+轮询收集"能力。
- **无"打开文件并读"的组合**。

### 2.2【P2】工具注册表不统一，与 ADR-005 愿景脱节
工具定义散落三处且口径不一致：
- `AGENT_TOOLS`（架构 schema）用于 native tool_calling（agent-tools.ts:71）；
- `getToolSystemPrompt()`（agent-tools.ts:1611-1670）用于 fallback 的 JSON `tool_call` 文本提示，两者手动各自维护（line 1619 内联 JSON）；
- 系统提示里的"Tools"描述与 `AGENT_TOOLS` 的正式 schema 双份。
没有统一的"工具注册中心/可裁剪层"（ADR-005 愿景），无法按能力开关裁剪工具集合（如后台子 agent 拒绝写工具，sub-agent.ts:141 用的是硬编码白名单 `['read_file','search_code',...]`，游离于注册表外）。
- **建议**：抽 `ToolRegistry`——单一 schema 源 + 按 role/scope（agent/sub-agent/verify）过滤的工具视图，`getToolSystemPrompt` 从注册表生成，消除双维护。

### 2.3【P2】`get_diagnostics`/`read_lints` 实现有误导隐患
`agent-tools.ts:1282-1331`：`get_diagnostics` 直接 `runTscCheck`，且 `executGetLints` 只支持 TS/`tsc`，非 TS 工程返回 `'No linter configuration found or no issues detected'`（line 1323-1325），可能让模型误以为"代码没问题"。上下文里 `context.diagnostics` 恒为空数组（ai-stream-handlers.ts:195 `diagnostics: []`），引擎从未把真实 IDE diagnostics 喂给 Agent。
- **影响**：Agent 的自我验证信号失真，可能跳过真正的问题。
- **建议**：把 IDE 实时 diagnostics 真正接入 `ToolExecutionContext.diagnostics`，并给 `get_diagnostics` 用 LSP/tsc 的真实错误/警告级别，非 TS 时明确"无法静态检查"。

### 2.4【P2】`plan_edits` 的"原子"名不副实，失败无回滚
`agent-tools.ts:2099-2163`：Phase2 逐文件 write+rename，若中途失败，注释自认"请手动回滚"（line 2158-2159），已应用的 edits 不会还原。所谓"原子"只是"验证阶段全通过才 apply"，apply 本身不原子。
- **影响**：跨文件批量编辑半途失败会留下部分改动。
- **建议**：apply 前保存每文件备份（内存或 `.loom`），失败时回滚已写文件。

---

## 维度三：上下文注入质量

### 3.1【P0】`RulesEngine`（分层规则引擎）是死代码，`.loomrules` 只被 renderer 裸读一次
- `rules-engine.ts:33-173` 提供 `.loomrules` + `.loom/rules/*.md` 分层 + glob + priority，但 grep 显示**仅测试 `agent-features.test.ts:19` import 它**，主进程/renderer 从未实例化。
- 实际 `.loomrules` 由 `App.tsx:345` renderer 侧 `fs.readFile(rulesPath)` 一次性读取到 `workspaceRules`，且**只在 workspace 变化时读一次（line 341-355）**，用户编辑 `.loomrules` 后不刷新。
- 更关键的脱离：`AIAgent.tsx:898` 里 `workspaceRules` 只在 **chat 模式**的 `compactContext` 加入 `finalPrompt`（line 901 `\n\nContext:...`），但**Agent 模式发送的 `history` 也复用了 finalPrompt**（line 925），所以 Agent 模式其实也带入了 — 但这是"裸读的 .loomrules"，`.loom/rules/*.md` 分层规则完全不会生效。
- **影响**：文档宣称"受 Cursor .cursorrules / Claude Code CLAUDE.md 启发"的分层规则能力实际未接线；仅顶层 `.loomrules` 生效且存在陈旧缓存。
- **建议**：在主进程以 workspace 打开事件接线 `RulesEngine`，把解析结果作为 `teamRules`（trusted 边界）注入 untrustedContext（与 ai-engine.ts:837 一致），并监听文件变更热重载。

### 3.2【P2】@codebase 检索通道分叉：IPC 用 keyword，Agent 用 TF-IDF，web 路径无 rerank
- renderer `@codebase` popover 走 `settings-handlers.ts:88` `searchCodeIndex`（纯 keyword 打分，`code-index.ts:161-183`）；
- Agent 运行时 `agent-callbacks.ts:92` 用 `semanticSearch`（TF-IDF + 引用图，`semantic-search.ts`），两处结果**口径不一致**。
- 无真 embedding/rerank；`ragContext` 注入硬编码 top-8（ai-engine.ts:779），且引用格式是 `• kind name (file:line)\n text前4行`（line 782），无文件完整路径之外的去重与分级。
- **建议**：统一走 `semanticSearch`；agent 上下文注入加最小命中阈值 + 按分数排序 + （可选）embedding rerank；@codebase 与 agent 查同一索引缓存。

### 3.3【P2】Agent 改完文件后看不到自己 diff 的自纠错闭环
Agent 写完文件后只能靠重新 `read_file` 或人力 review；没有"上一轮改动 diff"自动反馈。编辑上下文只有 `git_diff` 工具（agent-tools.ts:240-249，需显式调用）。对比 Cursor 会在工具结果里自动附上本轮文件 diff。
- **建议**：每次 `write_file/edit_file/apply_pending_edits` 后，工具结果附带该文件的 `git diff`（或内存 diff），让模型下一轮直接看到改动。

### 3.4【P2】常用文件/相似文件自动携带（VS Code context 策略）缺失
Chat 模式 `compactContext`（AIAgent.tsx:209-218）把 open files `.slice(0,6)` 各头部 12000 字符塞进 context，无"最近编辑文件优先 / 与问题相似度排序"，会塞入无关大文件、挤占预算。
- **建议**：按最近激活时间 + open-file 与 query 的相似度排序，超预算时降级携带。

---

## 维度四：内联补全质量

### 4.1【P2】补全仅 700ms debounce、无系统提示、无 open 文件上下文、>200 字符丢弃
`Editor.tsx:98-202` `registerAICompletionProvider`：
- 700ms 空闲 debounce（line 104-107）——参数可接受，但**单飞**（`aiCompletionInFlight` line 103）导致打字快时频繁跳过、体验不稳定。
- 用 `chatStream`（`window.loom.ai.chatStream`, line 161）发起，而 `chatStream` 只拼默认"You are a helpful assistant"系统提示（ai-engine.ts:1505-1508），**未注入当前文件/打开文件/API 语义**。
- 上下文仅 `前30行后10行`（line 122-138），无多文件。
- line 181 `completion.length > 200` 直接丢弃 → 多行函数内联补全几乎不可能。
- 无补全缓存（同类前缀重复请求），无续接/多行感知。
- **建议**：参照 Copilot/Cursor：可缓存签名与命中；prompt 注入文件头 + 相关符号；放宽多行上限并做括号平衡/缩进规整；加 semicolon/brace-aware 的接受截断。

### 4.2【P3】内联编辑（Cmd+K）用 chatStream，无工具能力、无历史上下文
`InlineAIEdit.tsx:156-174` 复用 `ai.chatStream` 发单条 user 消息，仅含选中代码与指令，无历史、无工作区/规则。接受/拒绝走 hunk 粒度（line 197-239），体验尚可，但大文件 LCS `computeDiff` O(n*m) 只在 >800 行降级为全替换（line 33），800×800 动态规划仍可能卡顿。
- **建议**：内联编辑接 Agent 浅循环（可多轮修错误）；对 diff 用 Myers 算法或增量和。

---

## 维度五：计划/审批/审阅流

### 5.1【P2】双套验证系统发散、`AgentVerificationPanel` 死代码
引擎内 `runVerification`（ai-engine.ts:618-668）在 agent 主循环内跑 tsc/npm test；renderer 又有独立的 `agent-task-state.ts` verification 状态机 + `AgentVerificationPanel.tsx`，但 grep 证实 **AgentVerificationPanel 从未被任何组件 import/挂载**，`agentTask.verification` 也从未被 `startVerification` 设置（仅测试用）。两条验证路径互不知晓。
- **影响**：Agent 引擎验证结果未同步到 UI 面板（用户看不到"正在验证/失败"），UI 侧验证面板是纯冗余。
- **建议**：删除 renderer 侧死面板，把引擎验证进度通过 `task_event`/`state` 事件推到现有 `AgentRunStatus`（已有 `verifying` 文案，AIAgent.tsx:118）。

### 5.2【P3】逐文件 diff 审阅的接受/拒绝与主进程 editGate 双向不同步的边界
`AIAgent.tsx:677-704` accept 通过 `onApplyEdit` 写盘 + `acceptReviewItem`；reject 调用 `ai.rejectAgentEdit` 更新主进程 editGate（ai-stream-handlers.ts:300-311）。但 accept 路径**未通知主进程 editGate 置为 applied**，若后续 `apply_pending_edits` 再写可能重复（虽然 engine 内同一 filePath 的 pendingEdits 会被清空，但 UI 与主进程状态仍可能不同步）。
- **影响**：审阅期间，若构建/verify 使用到 pending 内容，或用户接受后又让 Agent 继续改同一文件，可能导致"应用/跳过"错乱。
- **建议**：accept 也回调主进程 editGate 状态，形成唯一事实源。

### 5.3【P2】验证闭环存在"假通过"
`runVerification`（ai-engine.ts:647-649）在"找不到 typecheck/test/lint 脚本"时直接 `passed:true` 放行；而 verify 判定只在模型**不再发工具调用**那一轮触发（ai-engine.ts:1136）。若模型先跑了 `run_command npm test` 且该命令本身未通过，模型仍可能（误）判定完成而不再发工具，verifyMode 的"先 typecheck/test 再真完成"约束并未严格强制（verify 是独立于命令历史的旁路）。
- **建议**：verify 结果应与 Agent 实际运行的 test 命令输出交叉校验，避免"模型说了算"失真。

---

## 维度六：模型与成本

### 6.1【P2】Provider 抽象无标准层，Anthropic 特判散落各处
Anthropic 消息格式特判出现在 `agentChatStream`（ai-engine.ts:918-951）、`askWithStream`（line 293-302）、`chat`（1435-1443）、`completeAgentFinalSummary`（1301-1331）、`subAgent`（sub-agent.ts:104-110）、`AGENT_TOOLS_OPENAI`（158），共 6 处重复实现。模型路由硬编码 `AIConfig.mode`（line 49）。
- **建议**：抽象 `LLMClient`（chat/stream/tools/usage），实现 OpenAI/Anthropic 适配器，消除特判。

### 6.2【P3】token 用量展示覆盖式+LRU 可能丢失历史
`ai-engine.ts:176-222` tokenUsage 按 streamId 累计，但 `chatStream`/`askWithStream` 里 `recordTokenUsage(streamId, input, output)` 是**每次累加**（line 379/1604），而 main handler 结束读 `getTokenUsage(id)`（ai-stream-handlers.ts:155/257）只读最后一个 id；跨会话历史汇总会被 30min TTL/200 条 LRU 清掉。UI 侧 `formatUsage` 只是当前会话。

### 6.3【P3】限流处理只在 Agent 主循环，`askWith`/内联补全路径不重试
见 1.4。

---

## 维度七：会话与历史/断点续跑

### 7.1【P2】checkpoint 与 session 只是"序列化"，无真正 resume 闭环
`checkpoint.ts` 能存/列/load（ai-engine.ts:858-873 已接线 save），但 main/renderer **没有任何恢复入口**：`ai:agent-chat-stream` 不接收 `checkpointId` 来重建 conversation（ai-engine.ts:730 options.checkpointId 传入但 IPC 从未传），`CheckpointManager.load/loadLatest` 无人调用（grep 仅 checkpoint.ts 内部）。SessionManager 同理，`session-history.ts` 的 branch/resume 全无接线。
- **建议**：Agent 面板加"恢复上次运行"按钮 → IPC 传 `checkpointId` → 用 checkpoint.messages 重建循环，并把 scratchpad/state 恢复。

### 7.2【P3】renderer 用 localStorage 存会话，40 条上限，无跨机同步
`AIAgent.tsx:245-256` 按 `[0,40]` 截断存 localStorage；主进程另有 `conversations-handlers.ts` 磁盘会话，两边不互通。会话体验停留"聊天历史"而非"可回放的 Agent 会话"。

### 7.3【P3】`background-agent` 取消只是置标志，不中止底层流
`background-agent.ts:90-95` cancel 置 `task.status='cancelled'`，`runTask` 在 next chunk 时 break（line 158-159），但 `agentChatStream` 用的是同一 abortSignal——若已处于长工具/verify 阶段，取消要等该步结束才生效。

---

## 维度八：安全边界

### 8.1【P1】内联补全路径无 prompt-injection 与隐私防护，且模型输出直接渲染
- 内联补全（Editor.tsx:143-149）把 `textBeforeCursor.trimEnd()█textAfterCursor` **原样塞进 prompt**（含任意 #!/注释里的"忽略先前指令"字样）交给 chatStream，chatStream 没有 `untrustedContext` 分隔标记。
- `AgentMessageItem.tsx:32-35` 与 `ast-panel` 用 `dangerouslySetInnerHTML={{__html: formatMarkdown(content)}}`。`markdown-renderer.ts:41-53` 虽转义了 `&<>` 并在 code 块内再做转义（line 9-11），但 `formatMarkdown` 的 URL 正则（line 49）处理的是已转义的字符串 `&amp;`，而跳过 `isSafeHref` 检查的 URL 会原样保留 `javascript:`——**不过 line 53 又有兜底 `(href|src)=...javascript:...` 替换**，因此 `javascript:`/`data:` 基本被拦。剩下的敞口是 `rel="noopener"` 已加（line 51）但 `dangerouslySetInnerHTML` 本身是 XSS 面，任何漏转义路径（尤其 code 块 `data-code` 属性、`<details>` 注入）都需严格审计。
- **建议**：给内联补全的 prompt 加 `<untrusted_workspace_content>` 分隔与"仅供参考非指令"标签（同 ai-engine.ts:839-848）；尽量用 `dangerouslySetInnerHTML` 之外的纯 render 方案，或对 markdown-renderer 做属性到白名单的彻底收敛。

### 8.2【P2】工具权限校验：写入分支对 `..`/绝对路径的落在 isSafePath 上游基本健全，但 `run_command` 的二次校验缺失
`agent-tools.ts` 各写入工具都先 `isSafePath`（line 669/734/780/…）再操作，且优先走主进程 `PathPermissionStore`（line 503-554，含 symlink 逃逸防护），这是亮点。但 `executeRunCommand`（line 1059-1106）校验 `cwd`（line 1062）后，真正执行依赖 `command-policy.ts` 的 allow-list（development-command.ts 已委托，line 70-72/183），**命令参数的拒绝清单基于字符串黑名单**（`POWERSHELL_BLOCKED_PATTERNS` line 54-68，`GIT_DANGEROUS_PATTERNS` line 82-90），对 `arg0` 之外带空格的封装命令/N 传递仍有绕过空间（虽然不是 shell:false 下的注入，但 `python -c "..."` 可整段任意代码）。

### 8.3【P3】`.loomrules`（未信任）以"原生规则"语义注入 Chat 模式的 context
`AIAgent.tsx:898-901` 把 workspaceRules 直接拼进最终 user prompt 的 `Context:`，无定界"仅供参考"标记（Agent 模式因走 `teamRules`+untrustedContext 的好习惯反而更安全）。文件里的"忽略以上指令"在纯 Chat 模式会以用户指令口吻出现（尽管是 user 消息，比 system 信任度低，但仍建议统一走定界引用）。

### 8.4【P3】MCP marketplace 的 `mcp-filesystem` 默认允许"写工作区外"
`mcp-marketplace.ts:40-47` filesystem server installArgs 含 `/path/to/allow` 占位，`mcp-client.ts:57-64` 的 `ALLOWED_MCP_COMMANDS` 含 `node`/`python`，且 MCP 工具的 `call_mcp_tool`（agent-tools.ts:1593-1606）对 MCP 返回内容**不过滤**直接回灌 conversation，MCP server 结果可能包含注入内容（虽有 untrustedContext 但 MCP 工具结果走的是 tool 消息，不经过该分隔）。

---

## 按严重度汇总表

| 严重度 | 编号 | 发现 | 关键证据 |
|---|---|---|---|
| **P0** | 3.1 | RulesEngine 分层规则是死代码，仅裸读 `.loomrules` 且缓存陈旧 | rules-engine.ts 仅测试 import；App.tsx:345-355 |
| **P0** | 8.1 | 内联补全路径无注入防护；模型输出经 dangerouslySetInnerHTML 渲染（含 XSS 面） | Editor.tsx:143-149；AgentMessageItem.tsx:32-35 |
| **P1** | 1.1 | 工具轮超时不杀底层进程，命令/写文件悬挂 | ai-engine.ts:1203-1208 |
| **P1** | 1.2 | 工具全并行执行破坏多文件/同文件编辑顺序 | ai-engine.ts:1189；agent-tools.ts:1661,1667 |
| **P1** | 1.5 | plan 审批回调无超时，120s 定时器已清，用户不响应即死锁 | ai-engine.ts:1048,1109-1115；ai-stream-handlers.ts:239-248 |
| **P1** | 7.1 | checkpoint/session 只存不续，无恢复入口 | ai-engine.ts:730；checkpoint.ts load 无人调用 |
| **P1** | 5.3 | verify 闭环存在"假通过"（无脚本即 passed） | ai-engine.ts:647-649,1136 |
| **P1** | 8.2 | run_command 参数级安全依赖黑名单，python -c 等可绕过 | development-command.ts:54-90 |
| **P1/P2** | 2.3 | get_diagnostics 非 TS 工程误导为"无问题" | agent-tools.ts:1318-1325 |
| **P2** | 1.3 | 对话压缩单次触发+时机滞后 | token-budget.ts:52；ai-engine.ts:890-902 |
| **P2** | 1.4 | chat/chatStream 无重试 | ai-engine.ts:1418-1473 |
| **P2** | 2.1 | 缺符号跳转/ripgrep/浏览器/并行任务等核心工具 | agent-tools.ts:71-427 |
| **P2** | 2.2 | 工具注册表不统一，sub-agent 用硬编码白名单 | agent-tools.ts:1611-1670；sub-agent.ts:141 |
| **P2** | 2.4 | plan_edits 非真正原子，失败不回滚 | agent-tools.ts:2156-2159 |
| **P2** | 3.2 | @codebase 与 Agent 检索口径不一致，无 rerank | settings-handlers.ts:88 vs agent-callbacks.ts:92 |
| **P2** | 3.3 | Agent 改完看不到自己 diff，无自纠错闭环 | agent-tools.ts:240-249 |
| **P2** | 3.4 | open 文件全塞 12000 字符无相似度排序 | AIAgent.tsx:209-218 |
| **P2** | 4.1 | 内联补全 >200 字符丢弃、无 open 文件上下文、无缓存 | Editor.tsx:181,161,143-149 |
| **P2** | 5.1 | 双套验证系统，AgentVerificationPanel 死组件 | AgentVerificationPanel 无人 import；agent-task-state 仅测试用 |
| **P2** | 5.2 | 审阅 accept 未同步主进程 editGate | AIAgent.tsx:677-685；ai-stream-handlers.ts:300-311 |
| **P2** | 6.1 | Anthropic 特判 6 处重复 | ai-engine.ts:918,293,1435,1301；sub-agent.ts:104 |
| **P3** | 1.6/7.3 | 取消语义竞态、background-agent 取消延迟生效 | AIAgent.tsx:1042-1051；background-agent.ts:90-95 |
| **P3** | 6.2/6.3 | token 汇总 TTL/LRU 丢历史；askWith 不限流重试 | ai-engine.ts:176-222 |
| **P3** | 4.2 | InlineAIEdit diff O(n*m) 大文件卡顿 | InlineAIEdit.tsx:33,39-44 |
| **P3** | 7.2 | localStorage 会话 40 条，与主进程会话不互通 | AIAgent.tsx:245-256 |
| **P3** | 8.3/8.4 | Chat 模式 rules 无定界标记；MCP 结果直接回灌 | AIAgent.tsx:898-901；agent-tools.ts:1593-1606 |

---

## 改进路线（按投入/收益排序）
1. **接好 checkpoint↔Agent 恢复闭环**（P0/P1）：这是"断点续跑"产品承诺的根因缺失。
2. **工具执行器加真实 AbortSignal 链**（P1）：超时 kill 进程，消除悬挂/孤儿节点。
3. **统一 Tool Registry + 单一 schema + 角色化裁剪**（P2）。
4. **接线 RulesEngine**，替代 renderer 裸读，缓存失效刷新 + 注入 untrustedContext。
5. **Agent 编辑结果回喂 diff**、verify 结果与真实命令输出交叉校验。
6. **内联补全收敛到注入工作区上下文的专用 client**，丢弃 >200 上限。
7. **收敛 Anthropic 到 LLMClient 适配器**。
8. **安全加固**：内联补全 prompt 加 untrusted 分隔、MCP 结果回灌走定界、markdown-renderer 属性白名单化。

> 注：本报告对应 docs/POLISH-PLAN.md 第 3.3-3.5 / 4.4 / 4.6 / 5 章的内容展开；实施顺序以 POLISH-PLAN.md 的 Phase A-D 为准。
