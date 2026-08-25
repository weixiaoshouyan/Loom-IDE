# Loom IDE — Electron 桌面安全与工程化深度审查报告

> 审查范围：`src/main/**`（主进程）、IPC 契约三份定义、构建/打包/CI/e2e 配置、docs/QUALITY-GATE.md
> 对标：VS Code / Cursor 的工程化水平
> 全部 `file:line` 证据均经 read 工具逐行核对；"死代码/未接线"类结论经全库 grep 证实。

---

## 一、按主题的详细发现

### 1. Electron 窗口安全与 preload 暴露面

**发现 1 — P1 · CSP 只在构建期由 Vite 注入，无主进程兜底 CSP**
`vite.config.ts:24-45` 通过 `transformIndexHtml` 把 CSP meta 注入 HTML；`index.ts:213` 加载渲染页面不再附加 `session.webRequest.onHeadersReceived` CSP。若构建产物 HTML 被篡改、或 static server（`index.ts:102-121`）路径解析有缺陷导致返回非本应用内容，CSP 防线随之失效。且 `CSP_DEV`（vite:18-22）`connect-src http://localhost:*` 允许任意本地端口直连。建议在主进程对所有本地页面额外设置 `webRequest` 级 CSP 头，形成纵深。

**发现 2 — P1 · window 安全基线未显式收紧**
`index.ts:181-186` 的 `webPreferences` 具备 `contextIsolation:true/nodeIntegration:false/sandbox:true`（这是好的），但**未显式设置 `webSecurity`**（依赖默认 true）且**未设置 `webviewTag:false`**。若未来启用 `<webview>` 插件面板（plugin-manager.ts:535 createWebviewPanel 支持 url/html，插件可渲染任意外部 HTML），需为 webview 单独配置 `partition`+低权限 preload+独立 CSP。当前插件面板直接渲染 html/url，是潜在注入面，建议明确禁用 webviewTag 或为 webview 建立白名单与隔离分区。

**发现 3 — P2 · `isDev` 先引用后声明**
`index.ts:204` 在 `will-navigate` 回调里引用 `isDev`，声明却在 `:210`。回调异步 defer 避免运行时报错，但属 TDZ 卫生问题，且**主进程在 loadURL 前 2 行才定义 isDev**，若重构提前触发会把生产窗口导航判定写错。建议把 `isDev` 提到 `createWindow` 顶部。

**发现 4 — P2 · `dialog-handlers.ts:75-78` 存在 E2E=1 环境变量授权后门**
`dialog:open-folder-by-path` 在 `process.env.E2E === '1'` 时**跳过用户确认对话框直接授权任意路径**（grantRoot）。虽是 e2e 自动化所必需（注释承认），但绑定环境变量使生产二进制一旦被设置该 env（或被注入）即自动授权任意目录，轻量化削弱了整条路径权限防线。建议改为仅在 dev 构建物生效（如 `!app.isPackaged`）。

### 2. IPC 契约治理

**发现 5 — P0 · IPC 契约存在三份漂移，`shared/ipc-types.ts` 与实际彻底失配**
`src/shared/ipc-types.ts:70-85` 声明的通道是 `fs:readFile`/`fs:writeFile`/`settings:get`（camelCase、按对象传参），而 `preload.ts:212/257` 实际通道是 `settings:getAll`/`fs:read-file`（kebab-case、多位置参数）；`git:status` 参数是 `{workspacePath}`，真实是 `cwd`（git-handlers.ts:39）。`ipcInvoke`（ipc-types.ts:95-102）"类型安全"是空中楼阁——调用会打空。`ipc-contract.test.ts`（ipc-contract.test.ts:66-83）只把 `preload.ts` 与 `src/main/*.ts` 的正则提取通道名做比对，**完全忽略这份独立契约**，三处永远无法自动同步。

**影响**：这正是"100+ 方法手写双份漂移"的最危险样本——有人在维护一份不再被使用的"类型安全层"，而真实契约全凭口头同步。建议删掉 `ipc-types.ts` 或让 `preload.ts` 强制以它为唯一来源（从它 derive 类型），并把 `ipc-contract.test.ts` 扩展为同时校验 `preload.ts ↔ ipc-types.ts ↔ main handlers` 三方一致性（含参数元数/通道命名约定如统一 kebab-case）。

**发现 6 — P2 · 通道命名规范混用**
`preload.ts:367` 用 `debug:runtime:get`（冒号 + kebab），而同域的 `debug:start/stop/stdout` 用 `.`（`:331-345`）；`version:run-command-stream` 与 `verification:run-event` 也是跨段分离。通道缺少单一前缀体系，增加记忆与跨域检索成本。建议统一为 `<domain>:<verb>` 全 kebab。

**发现 7 — P2 · 流式通道无发送端身份绑定**
所有 AI 流式通道（ai-stream-handlers.ts:144-268）用 `send`（fire-and-forget）推送到 `mainWindow.webContents`，`preload.ts:29-53` 依赖 renderer 手动注册/移除监听器。若 renderer 崩溃或组件卸载前未调返回的 cleanup，`ipcRenderer.on` 监听器与 `activeStreams` 条目会残留（虽有 end 兜底清理，但网络流被 abort 且 renderer 先行崩溃时 `ai:chat-stream-abort` 不会到达，主进程侧 `activeStreams` 靠 generator 抛错清理）。建议为主进程 stream 增加 TTL/超时逃生阀，并让 renderer 用专有请求对象替代裸监听器。

### 3. 进程模型与阻塞风险

**发现 8 — P1 · `spawnSync` 同步阻塞主进程**
`shell-handlers.ts:55-84` 的 `verification:run-command` 调 `runDevelopmentCommand`，其内部 `development-command.ts:223` 用 **`spawnSync`** 同步等待子进程结束（默认最长 120s）。在 IPC handler 事件循环里，一次慢命令会完全冻结整个 UI/所有窗口。虽然 `runStream` 已提供 `spawn` 异步替代（:317），但非流式路径仍存在且暴露。建议删掉非流式 handler 或改为异步等待同一共享状态。

**发现 9 — P1 · 大量同步文件 I/O 在主进程 IPC**
`file-handlers.ts:20-22(readFileSync)/:41-46(fsync+renameSync)/:60-92` 全部同步；`file-index-handlers.ts:26-27` 递归 `readdirSync`；`conversations-handlers.ts:65-94(list 的 statSync+readFileSync)/:110-162(search 同步遍历全部会话文件并全文 toLowerCase)`。大目录/多会话下主进程显著卡顿。建议文件读改 `fs/promises`，index/search 移入 worker（见 11）。

**发现 10 — P1 · telemetry 同步写盘且 audit.jsonl 无限增长**
`telemetry.ts:111` 每次 `audit/captureException/captureMessage` 都执行 **`fs.appendFileSync` 同步写盘**，落在 agent 每个工具调用链上（agent-tools.ts:589-594 → agent-callbacks.ts:140）；磁盘只写不轮转/不压缩，`getAuditLog` 内存上限 2000 条但文件无限增长。建议异步批量 flush + 按大小/日期轮转 + 定期归档。

**发现 11 — P1 · 代码索引/搜索在主进程无 worker 隔离**
`code-index.ts:120-143` 用 tree-sitter 批量解析（虽有 batch+yield 让出，但仍是主线程 CPU-bound）；`searchCodeIndex:175-183` 对全量 symbol 线性算分+全排序。`file-index-handlers.ts:41-56` 的 Quick Open 全量扫描也在主进程。插件隔离路线（plugin-host.ts:1-8）只停留在注释声明。建议将 build/search 移入 `utilityProcess` 或 `worker_threads`，主进程仅做 IPC 转发。

### 4. 插件沙箱

**发现 12 — P1 · 插件激活无超时，可卡死主进程**
`plugin-manager.ts:465` 加载后 `activate(api)`（:469）是**同步调用且无 timeout**。恶意/失控插件 `while(true)` 立即冻结整个应用（`plugin-host.ts:25` 虽有 30s timeout，但 `activateInHost` 从未被调用——形成与 manager 双套激活实现漂移）。建议统一走 `activateInHost`，并把激活放到 `worker`/`utilityProcess`。sandbox 本身（plugin-sandbox.ts:163-236）的 capability-gated require 与原型代理设计是良好的纵深，值得肯定。

**发现 13 — P2 · 插件 webview 面板可加载任意 html/url**
`plugin-manager.ts:535-552` `createWebviewPanel` 接受插件传入的 `html`/`url` 并回传 renderer 渲染；`postMessageToWebview`/`onWebviewEvent` 由插件驱动。若渲染 webview 时未隔离，等于插件获得了近似 renderer 的能力面。建议对 webview 施加独立 CSP、禁 nodeIntegration/contextIsolation 之外的暴露、并在 manifest 白名单允许的 URL 协议。

### 5. 安全纵深

**发现 14 — P0 · 命令策略可被渲染进程越权改写（绕过硬边界）**
`command-policy-handlers.ts:24-44` 让渲染进程直接 `command-policy:setAllowed`（替换整个 allow-list）与 `setExtraBlocked`；`settings-handlers.ts:32-54` 的 `settings:set` 支持任意 key（含 `agent.commandPolicy.allowInlineInterpreterCode`）且**无身份/权限校验**。这意味着 agent 侧所有精心设计的 deny-list（command-policy.ts:23-63）、PowerShell alias 拦截（:98-103）、interpreter inline-code 拦截（:110-126）都能被一段拿到 `window.loom` 的脚本一键关闭并把 `rm/del` 加回 allowed。命令策略本应是主进程的授权边界，却被设计成用户可随意改——安全严重性取决于"谁能调用 loom"（插件 webview/被攻破页面）。建议将策略写入口的授权判断下沉到主进程（仅允许本机受信任调用），`command-policy-handlers` 移到 `KNOWN_UNEXPOSED_HANDLE`（现已被标注但仍在 ipc-contract.test.ts:26-32 说明由 settings 面管理，等于公开了后门）。

**发现 15 — P1 · agent 侧 git 调用无参数级策略**
`agent-callbacks.ts:133-135` `onGitCommand` 直接把 agent 传入的 `[command, ...args]` 交给 `runGit`，未做 allow-list / `--` 分隔 / hooks 路径校验；`git-handlers.ts:12-25` 的 runGit 仅 spawn `git`。`git -c core.hooksPath=...`、环境注入的 hook 执行、以及 `--work-tree` 逃逸在工作区内是真实攻击面（区别于 ui 侧 git-handlers.ts:74 已加 `--`）。建议把 git 工具调用复用 ui 侧同款校验。

**发现 16 — P2 · API key 由 safeStorage 加密存储的设计正确，但同步密文残留路径需复核**
`config.ts:145-184` 加密写 + `tmp+rename` 原子写 + `decryptApiKeys:192-210` 的"解密失败则清空防双加密"，设计优秀。但加密 key 存放于明文 `config.json`（仅 base64 ciphertext），且 `safeStorage.isEncryptionAvailable()===false` 时（config.ts:161-166）**既不持久化也不提示用户 key 已丢失**（仅 console.warn）。建议 false 时在 UI 显式提示。

**发现 17 — P2 · 崩溃处理强制 exit(1) 且无崩溃恢复**
`crash-handler.ts:27-33` uncaughtException 后 200ms 强杀进程；`index.ts:469-474` 的 telemetry 捕获是弥补，但无主进程崩溃时的 **Windows watchdog/重启**、无醒目错误对话框。渲染进程崩溃未监听 `webContents 'render-process-gone'` 做回收重建。建议引入 electron 的 `render-process-gone`/`unresponsive` 恢复 + 崩溃后询问重启。

### 6. 打包与分发

**发现 18 — P1 · 自动更新不可用（占位 URL），且降级体验缺失**
`package.json:64-69` publish.url 是 `https://updates.loom-ide.example/`；`index.ts:424-429` 检测到占位 URL 直接跳过 `checkForUpdates`，因此 **自动更新功能实际从未启用过**。影响：安全与功能补丁无法自动分发，用户永远停留在 0.2.1。降级层面：没有"手动检查更新/下载安装包"入口，`--publish=always`（package.json:21）会直接失败，CI 也未做发布。建议：接真实 generic/github provider，或在不可用前于 UI 提供版本检查提示与手动下载引导，并补 notarization 讨论。

**发现 19 — P1 · 未启用 asar 且无代码签名**
`package.json:60-115` 的 build 配置无 `asar` 字段（默认 `asar:false`），源码直接铺在 `resources/app`，便于篡改/逆向；windows build 无 `signAndEditExecutable`/证书配置。建议开启 `asar:true` + Windows 代码签名（或至少 `asar` + 教育/自签证书），并加 `electronSign` 配置。

**发现 20 — P2 · 图标与 NSIS 配置零散**
`package.json:99` win.icon 指向 `resources/icon.png`，而 `index.ts:171/444` 用 `resources/icon.ico`——两种格式并存，打包图标质量与 NSIS 安装器图标依赖 .png 有损。NSIS 配置（:109-114）是面向单用户的 oneClick:false + allowToChangeInstallationDirectory，未处理 perMachine、卸载清理（快速打开/最近文档）与安装后启动。建议统一 .ico 且补 NSIS 卸载行为与 `estimateSize`。

### 7. 工程质量与测试

**发现 21 — P1 · CI"双绿"与覆盖率阈值严重失真**
QUALITY-GATE.md:22-24 明确承认此前阈值 40/30/40/40 从不满足，被**校准到 22/18/22/24**并**排除全部 `*.tsx` 与 `*.html`**（vite.config.ts:90-102），即**渲染层组件零覆盖率**。quality-gate.yml 与 ci.yml 都只跑 `tsc+eslint+vitest`（不跑 coverage，quality-gate.yml:37 虽跑 coverage 但阈值极低），e2e 是单独 workflow 未并入 quality-gate。所谓"双绿"对真实缺陷几乎无拦截力。建议：换 istanbul provider 纳入 TSX、每里程碑 +10pp ratchet（文档已有此意图但未执行）。

**发现 22 — P2 · e2e 覆盖盲区大且依赖特权后门**
5 个 spec（smoke 仅欢迎页元素可见性/窗口 resize；workflow 依赖 `E2E=1` 绕过授权，见 dialog-handlers.ts:75）。未覆盖：多窗口、IPC 错误路径、权限拒绝、审计日志落地、崩溃恢复、streaming abort、插件沙箱逃逸。建议补 IPC 契约负面测试（非法输入注入到每个 handler）与 e2e 数据通路断言，并移除对 `E2E=1` 的依赖（改用 `webContents` 注入的自动化专用 IPC token）。

**发现 23 — P2 · 全局错误上报默认关闭、Sentry 依赖缺失**
`telemetry.ts:33` 默认 `enabled:false`，`initSentry`（:63-78）动态 require `@sentry/electron/main`，但 **package.json 未声明该依赖**——即使开启也必然走 catch 打印 warn，Sentry 永远不会真正生效。`process.on('uncaughtException')` 只用 console，无统一日志系统（startup-trace 是写 tmp 的裸 append）。建议要么真正集成 Sentry，要么自建结构化日志（日志级别/轮转/脱敏）。

### 8. 缺失的基础设施

**发现 24 — P2 · 无统一日志系统、性能监控、用户反馈通道**
全部对 `console.warn/error` + 散落文件 append，无聚合/级别/上下文。无性能指标埋点（首帧耗时、IPC 延迟、内存泄漏监测，虽有 runtime-state.ts 手写 snapshot 但仅 Debug 面板用）。无"崩溃后提交反馈/上传日志"能力，无更新/升级提示页，无正式"关于/许可证"窗口（license 在 package.json:6 为 MIT，但无 UI）。

**发现 25 — P2 · 有 IPC 调试面板但无 CLI（loom 命令）**
`runtime-state.ts` 提供诊断快照，但缺失成熟 IDE 标配的 **命令行入口**（`loom open <path>`、`loom . ` 从终端打开工作区）、文件关联 `loom://` 协议。index.ts:490-492 仅 `activate` 单窗口。建议注册 `app.setAsDefaultProtocolClient('loom')` 与单实例锁（现无限多开，会争用 staticServerPort，index.ts:122-132 虽自动换端口但多实例状态各自为政）。

---

## 二、按严重度排序的汇总表

| # | 严重度 | 维度 | 关键位置 | 一句话结论 |
|---|-------|------|---------|-----------|
| 1 | **P0** | IPC 契约 | `ipc-types.ts:70-85` vs `preload.ts:23/212` | 三份"类型安全"契约通道名/签名彻底失配，仅文本比对无法同步 |
| 2 | **P0** | 命令策略 | `command-policy-handlers.ts:24-57` + `settings-handlers.ts:32-54` | 渲染进程可越权改写 allow/block 与 inline-code 策略，绕过整个命令防线 |
| 3 | P1 | 进程模型 | `development-command.ts:223` (spawnSync) | 一次慢命令冻结整个 UI |
| 4 | P1 | 进程模型 | `file-handlers/ conversations / telemetry.ts:111` | IPC 链路大量同步 fs I/O，主进程卡顿 |
| 5 | P1 | 性能 | `code-index.ts / file-index-handlers.ts` | 索引+搜索在主进程，无 worker 隔离 |
| 6 | P1 | 插件 | `plugin-manager.ts:469` | 插件同步 activate 无超时，可卡死主进程；activateInHost 空转 |
| 7 | P1 | 分发 | `package.json:67` + `index.ts:424-429` | 自动更新实际从未启用，无法分发安全补丁 |
| 8 | P1 | 分发 | `package.json:60-115` | 未启用 asar、无签名 |
| 9 | P1 | 安全 | `dialog-handlers.ts:75-78` | E2E=1 环境变量任意路径自动授权后门 |
| 10 | P1 | 安全 | `agent-callbacks.ts:133-135` | agent 侧 git 无参数/hooks 校验 |
| 11 | P1 | 工程质量 | `vite.config.ts:90-102` + QUALITY-GATE | 覆盖率阈值被降到 22/18/22/24 且排除全部 TSX，"双绿"无拦截力 |
| 12 | P2 | 窗口 | `index.ts:181-186`, `vite.config.ts:24-45` | CSP 仅构建期注入、webviewTag 未禁、无主进程兜底 |
| 13 | P2 | 崩溃 | `crash-handler.ts:27-33`, `index.ts` | 强杀无恢复、无 render-process-gone 重建 |
| 14 | P2 | 错误上报 | `telemetry.ts:63-78` + package.json | Sentry 依赖缺失，上报永远不会生效 |
| 15 | P2 | 基础 | `cloud-sync.ts` | 云同步为 skeleton，signIn 恒失败但 UI 暴露 |
| 16 | P2 | 基础设施 | `index.ts:477-488` | 无 loom:// 协议、单实例锁、CLI 打开工作区 |
| 17 | P2 | 命名 | `preload.ts:367` | 通道命名冒号/kebab 混用 |
| 18 | P2 | 代码卫生 | `index.ts:204/210` | isDev 先引用后声明 |
| 19 | P2 | 终端 | `terminal-mgmt.ts:44-47` | 未授权 cwd 静默回退 USERPROFILE 而非拒绝 |
| 20 | P2 | 对话 | `conversations-handlers.ts:42` | 仅 slice(-500)，无总量上限 |
| 21 | P2 | 打包 | `package.json:99,171` + NSIS | 图标 .png/.ico 不一致，NSIS 无 per-machine/清理 |
| 22 | P2 | e2e | 5 个 spec + dialog-handlers E2E 后门 | 覆盖浅、依赖特权 env、无数据通路/权限拒绝断言 |

---

## 三、落地优先级建议

**立即（P0）**
1. **统一 IPC 契约**：删除或废弃 `src/shared/ipc-types.ts` 的失真层，令 `preload.ts` 从唯一类型源 derive，并把 `ipc-contract.test.ts` 扩为三方一致性（preload↔ipc-types↔main）校验 + 参数元数比对。
2. **命令策略写入口下沉**：`command-policy:setAllowed` 等 handler 移出可被任意页面触达的范围，`settings:set` 对 `agent.*` 键增加主进程授权校验（或改为仅受信任通道）。

**随后（P1）**
3. 删除 `spawnSync` 路径；文件/telemetry/index 改异步与 worker；统一 `activateInHost` 并入 worker。
4. 补 asar+签名；接真实 update provider 或加手动更新/离线降级 UI；删 `E2E=1` 后门。
5. 提升覆盖率到真实可用（istanbul 纳入 TSX + 逐步 ratchet），e2e 补数据通路与权限拒绝断言。

**跟进（P2）**：统一通道命名、加 loom:// 与单实例、崩溃恢复、日志/性能监控基础设施、图标/NSIS/许可相关修订。

> 注：本报告对应 docs/POLISH-PLAN.md 第 3.8 / 4.7 / 4.8 / 5 章的内容展开；实施顺序以 POLISH-PLAN.md 的 Phase A-D 为准。
