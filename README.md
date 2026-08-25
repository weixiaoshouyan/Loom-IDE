# Loom IDE

> 本地优先的 AI 原生开发环境 —— 让 Agent 真正帮你把活干完。

Loom IDE 是一款对标 Cursor 的开源桌面 IDE，基于 Electron + React + Monaco Editor 构建。代码、会话、历史全部留在本地；AI Agent 与编辑器深度集成，从计划、编码、审阅到验证形成完整闭环。

## ✨ 核心特性

### 🤖 AI Agent（干活，不只是聊天）
- **多 Provider**：OpenAI 兼容 API / DeepSeek / 通义千问 / 豆包 / GLM / Moonshot / 硅基流动 / 本地模型 / Orca 代理，一个面板全接入
- **Agent 模式**：文件读写、代码搜索、命令执行、Git 操作、测试运行 30+ 工具；多文件并行修改 + **逐文件 diff 审阅**（接受/拒绝/跳过）
- **计划审批**：先出计划 → 你确认 → 再动手；**删除/重命名必须人工批准**，模型无法自证放行
- **验证闭环**：改完自动跑类型检查/测试，失败继续修，通过才收工；验证进度实时可见（verify mode）
- **长时间任务不卡死**：工具执行硬超时（超时真实终止底层进程）、流式读超时、命令超时不重试、可随时停止/继续
- **断点续跑**：Agent 运行自动保存 checkpoint，随时从上次进度继续
- **行内补全**：真 debounce 的 AI 补全（带文件上下文），打字不烧额度
- **@codebase 代码检索**：Tree-sitter 多语言索引（TS/JS/Python/Go/Rust/C/Java），@ 引用文件/符号；TF-IDF + 引用图打分（本地、无 embedding 依赖）

### 🖥️ 编辑器与工作区
- Monaco 多标签、分屏、面包屑、代码大纲、本地历史时光机
- 文件树右键菜单、Git 面板（暂存/提交/推送 + **Monaco diff 视图**）、Problems 点击跳转
- 集成终端（xterm.js + node-pty，生命周期独立于面板）、全局搜索（可取消）
- 深色/浅色/跟随系统主题；中英双语界面，默认中文

### 🔒 安全设计（本地优先 ≠ 裸奔）
- 渲染进程沙箱 + CSP + 权限最小化；路径访问经 **realpath 双重校验**（封死 symlink 逃逸）
- 命令执行 allow/block 双清单：git 高危参数、PowerShell 内联代码、npx 远程安装全部拦截
- 插件跑在 **vm 沙箱**（能力门禁 require），API 密钥 safeStorage 加密存储
- 工作区内容（RAG/规则）只以 user 消息注入模型——**防提示注入**

### 🧩 生态
- VS Code 风格插件清单（commands / configuration / languages / themes / snippets）
- MCP 客户端（stdio + HTTP 端点），自动导入 `.cursor/mcp.json`
- OpenVSX / Cursor 扩展市场互通

## 🚀 快速开始

```bash
# 开发模式（Vite HMR + Electron）
npm install
npm run dev

# 质量检查（tsc 双配置 + ESLint）
npm run lint

# 单元测试（284 用例）
npm test

# 端到端测试（真实 Electron：工作流 / 打包版 / Agent 面板，10 用例）
npm run e2e

# 打包 Windows 安装包（release/）
npm run build
```

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Electron 35 · React 19 · Vite 6 · TypeScript |
| 编辑器 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| AI | OpenAI 兼容 API + MCP + Tree-sitter 索引 |
| 测试 | Vitest（284）· Playwright e2e（10）|

## 📂 目录结构

```
src/
├── main/       # Electron 主进程：IPC handlers、安全边界、插件沙箱、终端
├── agent/      # AI Agent 层：工具、执行循环、MCP、技能、代码索引
├── renderer/   # React UI：编辑器、Agent 面板、侧边栏、i18n
└── shared/     # 主/渲染共享契约与国际化资源
docs/           # 架构文档（ADR）、质量门禁基线、功能说明
tests/e2e/      # Playwright 端到端测试
```

## ✅ 质量保障

- **CI 单流水线双 job**：`quality`（lint + typecheck + 覆盖率阈值）+ `e2e-windows`（构建 + e2e）
- 覆盖率阈值按真实基线校准并持续上调；pre-commit 阻断新增 `any` 与 lint 错误
- i18n 键完整性测试保证中英语言表结构一致、无漏网硬编码键
- 安全审计日志（audit.jsonl）记录 Agent 工具调用与异常，可追溯

## 📜 License

MIT
