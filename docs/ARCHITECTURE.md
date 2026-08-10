# Loom IDE 系统架构设计与长期发展规划

> 文档角色：架构决策基线（ADR 集合 + 演进路线图）
> 适用范围：Loom IDE 客户端（Electron + React 19 + Vite + TypeScript + 自研 Agent 层）
> 配套：QUALITY-GATE.md（质量门禁已落地，视为 Phase 0）
> 视角：软件架构师 —— 先领域后技术、命名权衡、可逆优先

---

## 0. 一句话结论（给决策者的 TL;DR）

**Loom IDE 现在就是一个结构相当健康的"模块化单体（modular monolith）"。它的可扩展性问题，不是"要不要拆微服务"——那是架构空想（architecture astronautics）。真正的杠杆有四个：**

1. **扩展隔离模型**：插件现在跑在 main 进程里，没有隔离。这是当前最大的安全与稳定性债。
2. **IPC 契约治理**：100+ 个 IPC 方法靠手写双份维护、全是 `any`，必然漂移。
3. **AI/Agent 作为一等公民的有界上下文**：provider / tool / planner 抽象要固化，能力要可裁剪、可审计。
4. **本地优先（local-first）何时走向云化**：团队/同步能力现在很薄，是明确的"未来阶段"决策点。

> **明确拒绝的提案**：把 Loom IDE 拆成微服务。理由见 ADR-001。
> **本设计的假设**：聚焦 Loom IDE 客户端架构；云后端（如 Orca Universal Proxy）作为未来 Phase 的可插拔适配层，不在本期设计其自身拓扑。若你指的是另一套独立大型系统，请纠正我，我重画。

---

## 1. 当前架构（C4：Context + Container）

### 1.1 Context（系统上下文）

```
┌────────────┐
│  开发者用户 │  在本地机器上编写/调试代码，使用 AI Agent 辅助
└─────┬──────┘
      │ 使用
      ▼
┌─────────────────────────────────────────────────────────┐
│                  Loom IDE（桌面应用）                      │
│   本地优先：代码/会话/历史 全部存于用户机器                  │
└─────────────────────────────────────────────────────────┘
      │ 对接（均为可选/外部）
      ├─▶ LLM Providers（OpenAI / Anthropic / 本地模型 / Orca 路由）
      ├─▶ MCP Servers（外部工具/知识源）
      ├─▶ Git CLI / 本地文件系统
      ├─▶ OpenVSX / Extension Marketplace
      └─▶ Cloud Backend（可选，当前仅 settings 同步雏形，经 cloud-sync 适配层）
```

### 1.2 Container（容器级，基于真实代码）

```
┌─────────────────────────────  Electron Renderer (React) ─────────────────────────────┐
│  UI 组件(Editor/Terminal/Debug/Sidebar/CommandPalette/ExtensionMarketplace...)        │
│  services/plugin-bridge.ts  ·  loom-ipc.ts（手写客户端契约，~300 行 any）              │
└──────────────────────────────────┬───────────────────────────────────────────────────┘
                                    │ contextBridge（只读、显式暴露）
                                    ▼
┌─────────────────────────────  Preload（契约边界，当前手写） ─────────────────────────┐
│  exposeInMainWorld('loom', { ai, plugins, fs, git, terminal, team, mcp, ... })         │
│  ⚠ 与 renderer/loom-ipc.ts 双份维护，无 schema 校验，无版本号                          │
└──────────────────────────────────┬───────────────────────────────────────────────────┘
                                    │ IPC (invoke / send / on)
                                    ▼
┌─────────────────────────────  Electron Main (Node.js) ──────────────────────────────┐
│  按有界上下文切分的 handler 模块（每个文件一组 ipcMain.handle）：                       │
│   • AI/Agent:  ai-config / ai-stream / cli-agents / agent-tasks / skills-mcp           │
│   • 编辑核心:  file / file-watcher / history / git / debugger / debug-runtime /        │
│                dialog / window / terminal / shell / verification / code-index          │
│   • 扩展:      plugin-manager / plugin-host / plugin-handlers / extension-marketplace   │
│   • 协作/账户: team-handlers / cloud-sync / telemetry                                   │
│   • 平台:      settings / config / runtime-state / crash-handler / startup-trace       │
│                                                                                       │
│  安全边界（已整改中）: path-permissions · command-policy · safeStorage                  │
│  ✅ 插件已接入 vm 沙箱（plugin-sandbox.ts：能力门禁 + 原型污染防护，A2 已落地）           │
└──────┬───────────────────────────────────────────────────────────────────────────────┘
       │ 调用外部
       ├─▶ LLM / Orca Proxy      ├─▶ MCP Servers        ├─▶ Git / FS
       ├─▶ Marketplace (OpenVSX)  └─▶ Cloud Adapter（可选，当前仅 settings 同步）
```

**关键事实（来自源码核实）：**
- `src/main` 43 个文件，按 `*-handlers.ts` 模式切分了**约 20 个有界上下文、100+ IPC 方法**——划分意识很好。
- 插件系统已起步：`plugin-manager` / `plugin-host` / `extension-marketplace` + 渲染端 `plugin-bridge` / `ExtensionMarketplace.tsx`。
- 云化已留口子：`cloud-sync.ts` 有 `CloudAdapter` 接口（`syncSettings`），`team-handlers` 复用 `_cloudSync.getUser()`；但团队能力目前仅是"workspace 级规则文件"，并非真正的协同。

---

## 2. 有界上下文划分（领域建模）

| 上下文 | IPC 命名空间 | 职责 | 成熟度 | 风险 |
|---|---|---|---|---|
| 编辑核心 | `fs` `watcher` `history` `file` | 文件读写/监听/时光机 | 高 | 路径穿越已加固 |
| 版本控制 | `git` | 状态/提交/推送 | 中 | — |
| 运行/调试 | `terminal` `debug` `debugRuntime` `verification` | 终端/调试器/校验命令 | 中 | 命令注入已加固 |
| AI 对话 | `ai` | 聊天/流式/多 provider/规划审批 | 高（最复杂） | 流式靠手写 listener，易泄漏 |
| Agent 执行 | `cliAgents` `agentTasks` `skills` `mcp` `codeIndex` | CLI Agent/任务/技能/MCP/索引 | 中 | 能力爆炸、无统一工具注册表 |
| 扩展生态 | `plugins` `marketplace` | 插件生命周期/市场 | 中（**无隔离**） | **进程内 require，RCE 面** |
| 协作/账户 | `team` `cloud-sync` `telemetry` | 团队规则/登录/审计 | 低（雏形） | 无真实协同 |
| 平台 | `settings` `recent` `window` `shell` `dialog` | 配置/窗口/系统交互 | 高 | — |

---

## 3. 可扩展性评估：四根杠杆与取舍

### 杠杆 A — 扩展隔离模型（最高优先级）
- **现状**：插件加载已接入 `plugin-sandbox.ts` 的 **vm 沙箱**（A2 止血已落地）：能力门禁 `require`（fs/network/child_process 按声明能力解锁）、原型链污染防护（constructor/proto 屏蔽）、5s 执行超时。仍与主进程同进程——**A1（UtilityProcess 隔离）仍是 Phase 2 目标**。
- **取舍**：
  - 方案 A1（推荐）：插件跑在 **Electron UtilityProcess / 独立渲染进程**，仅通过**能力 API（Capability API）** 与主进程通信，能力按需声明（类 VSCode proposed API 门禁）。
    - 得：真正隔离、崩溃可控、安全边界不再被绕过。
    - 失：复杂度上升、需设计进程间消息协议、首版要重写插件加载器。
  - 方案 A2：用 `node:vm` 沙箱在 main 进程内隔离。
    - 得：改动小、无跨进程。
    - 失：vm 沙箱对原生模块/原型污染防护有限，**隔离不彻底**，不满足安全基线。

### 杠杆 B — IPC 契约治理
- **现状**：`preload.ts` 与 `renderer/loom-ipc.ts` 手写双份、无版本、无运行时校验；`ipc-contract.test.ts` 已做通道名自动对等断言（`codeindex:prebuild` 错位已修复）。`any` 存量约 650 处（pre-commit 已阻断新增）。
- **取舍**：
  - 方案 B1（推荐）：**单一事实源**——用一份 TS 接口 + `zod`/`runtypes` schema 描述契约；`preload` 与客户端由 schema **代码生成/校验**；契约加 `major.minor` 版本号，破坏式变更升 major。
    - 得：消除漂移、类型安全、可演进、可在边界做安全校验。
    - 失：引入代码生成步骤、需一次性把 100+ 方法补类型。
  - 方案 B2：保持手写，仅补测试和 `any` 治理。
    - 得：改动最小。
    - 失：漂移风险长期存在，规模越大越痛。

### 杠杆 C — AI/Agent 作为一等公民有界上下文
- **现状**：`ai` 上下文最复杂，provider 经 `engine()` 抽象，工具在 `agent-tools.ts`，planner 经 `ai:agent-plan-approve/reject` 人工审批。
- **取舍**：固化 **Provider 抽象 + Tool Registry + Planner/Human-in-the-loop** 三层；工具注册需声明"是否触文件系统/是否执行命令"，由安全策略统一裁决（复用 `path-permissions`/`command-policy`）。得：能力可裁剪、可审计、可远程化；失：抽象成本。

### 杠杆 D — 本地优先 → 云化时机
- **现状**：`cloud-sync` 仅有 settings 同步适配器雏形；`team` 仅是规则文件。
- **取舍**：见下方 ADR-004 与取舍矩阵。**本期不建云后端**，但把"同步/账户/协同"全部收敛到 `CloudAdapter` 接口之后，未来换实现零成本。

---

## 4. 架构决策记录（ADR）

### ADR-001：保持模块化单体，拒绝微服务拆分
- **状态**：Accepted
- **上下文**：Loom IDE 是单机桌面应用，团队规模有限，部署单元=一个 Electron 包。微服务带来的网络边界、分布式事务、运维成本在这里没有任何收益，反而摧毁桌面端的离线优先与低延迟优势。
- **决策**：维持 main/renderer 模块化单体；通过"handler 按有界上下文切分 + 明确的模块依赖方向"保持内聚；跨进程只在**必要的隔离边界**（插件）出现。
- **后果**：易维护、可离线、团队能扛。代价：单体内部需靠纪律（lint/契约）防止耦合腐化——这正是 QUALITY-GATE 与 ADR-003 的价值。

### ADR-002：插件进程隔离 + 能力 API
- **状态**：Proposed（Phase 2 落地）
- **上下文**：插件当前 `require()` 进 main 进程，与安全边界同进程，是 RCE/稳定性雷。
- **决策**：Phase 2 将插件迁入 **UtilityProcess / 独立渲染进程**，仅暴露窄能力 API；能力声明式门禁；plugin-host 负责生命周期与超时。Phase 1 先冻结"新插件必须声明 capabilities"的契约。
- **后果**：真正隔离、崩溃可控。代价：需重写加载器、设计跨进程协议。可逆性高（先 A2-vm 兜底，再升 A1）。

### ADR-003：IPC 契约单一事实源 + 版本化 + 边界校验
- **状态**：Proposed（Phase 1 落地）
- **决策**：抽取一份 `ipc-contract.ts`（TS 类型 + zod schema），`preload` 与 `loom-ipc` 由之生成/校验；契约带版本号；在 bridge 处对所有入参做 schema 校验（兼作安全输入校验）。
- **后果**：消除双份漂移、类型安全、可演进、免费获得输入校验。代价：一次性补全 100+ 方法类型、加构建步骤。

### ADR-004：本地优先，云作为可插拔适配层（本期不建后端）
- **状态**：Proposed
- **决策**：所有云能力经 `CloudAdapter` 接口；本期仅 settings/extensions 同步；团队协同（presence/光标）留待 Phase 3 决策。Orca Universal Proxy 可作为后端候选实现之一。
- **后果**：不绑定具体云厂商、不提前承担后端运维。代价：协同类需求需延后。

### ADR-005：AI/Agent 固化为可裁剪、可审计的有界上下文
- **状态**：Proposed（Phase 1–2）
- **决策**：Provider 抽象 + Tool Registry（工具声明能力标签）+ Planner 人工审批；所有"触文件/执行命令"的工具调用统一经 `path-permissions`/`command-policy` 裁决。
- **后果**：能力可插拔、可审计、可远程化（Phase 4）。代价：抽象与治理成本。

---

## 5. 长期演进路线图（分阶段，可逆优先）

| 阶段 | 目标 | 关键动作 | 退出标准 |
|---|---|---|---|
| **Phase 0**（已交付） | 质量基线 | QUALITY-GATE：tsc 双绿、ESLint 覆盖 renderer、覆盖率阈值（2026-08-10 校准为真实基线 22/18/22/24）、CI/pre-commit | lint+test 在 CI 强制绿 |
| **Phase 1**（进行中） | 契约与能力固化 | ADR-003 契约代码生成+校验；ADR-005 Tool Registry + 能力标签；插件声明式 capabilities 契约（vm 沙箱 A2 已落地，见杠杆 A）；`codeindex` 错位等契约 bug 已修 | 100+ IPC 全类型化、边界校验上线 |
| **Phase 2** | 隔离与安全加固 | ADR-002 插件迁 UtilityProcess（A1）；市场信任/审核；AI planner GA；渲染层组件覆盖率（istanbul provider） | 插件崩溃不影响主进程；安全边界不被绕过 |
| **Phase 3** | 协同与同步 | ADR-004 落地 settings/extensions/会话 云同步；团队规则→真实协同（决策点） | 多设备一致；可选团队 presence |
| **Phase 4** | 远程化（按需） | Agent 重负载迁后端/Orca；多租户（仅当产品确需） | 重 Agent 任务不阻塞本地 |

> 每一步都**尽量可逆**：插件隔离先 vm 兜底再升进程；云化先适配器再实现；绝不一次"大重写"。

---

## 6. 取舍矩阵：本地优先平台 vs 云混合平台

| 维度 | 本地优先（本期推荐） | 云混合（Phase 3+） |
|---|---|---|
| 离线可用 | ✅ 完全 | ⚠ 需冲突解决 |
| 延迟 | ✅ 本地毫秒级 | ⚠ 受网络影响 |
| 隐私/安全 | ✅ 代码不出机 | ⚠ 需加密/合规 |
| 协同能力 | ❌ 无 | ✅ 多设备/多人 |
| 运维成本 | ✅ 几乎为零 | ⚠ 后端+SLA |
| 变现/账号体系 | ❌ 弱 | ✅ 强 |

**判断**：当前产品阶段，本地优先是正确默认；云化按 Phase 3 决策点再开，绝不提前。

---

## 7. 立即可落地的"快赢"（Quick Wins，无需等路线图）

> 状态更新（2026-08-10）：第 1-5 项已全部完成——
> 1. `codeindex:prebuild` 通道错位已修复（`ipc-contract.test.ts` 自动对等断言上线，防再漂移）。
> 2. 插件 capabilities 契约已冻结：`PluginManifest.capabilities` 强校验 + vm 沙箱能力门禁（`plugin-sandbox.ts`）。
> 3. bridge 入参校验部分落地：流式通道全部带 rid 过滤 + 大小上限；zod 全量校验留待 ADR-003。
> 4. 契约单测已覆盖：preload 暴露方法名 ↔ main handler 名的自动对等断言（`ipc-contract.test.ts`）。
> 5. 插件加载器 A2（vm 沙箱）已作为止血上线；A1（UtilityProcess）为 Phase 2 目标。

**下一批快赢候选**：
- 渲染层组件覆盖率：换 `@vitest/coverage-istanbul` 或补 jsdom 组件测试，把 TSX 纳入覆盖率。
- `Ctrl+P` 快速打开已恢复（打开即文件搜索模式）；文件树右键菜单、Problems/Git 点击跳转、diff 视图已上线（2026-08-10）。

---

## 8. 需要你拍板的两个岔路口

- **岔路 1（扩展隔离策略）**：Phase 2 直接上 UtilityProcess 隔离（A1），还是先用 vm 沙箱止血（A2）再升？我的建议：**A2 先行止血（本季度），A1 作为 Phase 2 目标**。
- **岔路 2（云化时机）**：是否同意"本期不建云后端、仅留适配层，Phase 3 再决策协同"？我的建议：**同意**，避免提前承担后端运维。

你回一句"继续"或指定上面任一项，我直接落地对应 Phase 的**第一步具体改动**（含代码），不空转。
