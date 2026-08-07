# Loom IDE

Loom IDE 是一款对标 Cursor 的本地 AI 原生开发环境。基于 Electron + React + Vite + Monaco Editor + xterm.js + TypeScript Agent 层构建。

## 核心能力

### AI 功能
- 多 Provider 配置，兼容 OpenAI / OpenAI-Compatible API，支持内置预设与自定义 Provider
- Orca 代理模式：本地 agent 路由 `http://127.0.0.1:18080`
- Agent 模式：文件读写/搜索/列表/命令执行工具 + 可审查 diff 预览，sub-agent 协作，planner 审批
- **@-mention 文件引用**：输入 `@` 触发文件搜索，支持 `@relativePath` 插入文件上下文
- **@codebase 语义检索**：基于 Tree-sitter 代码索引的符号搜索
- **InlineAIEdit 逐块 diff**：LCS 动态规划 diff，支持 hunk 级别接受/拒绝
- **CommandPalette fuzzy 匹配 + MRU**：subsequence 模糊匹配，最近使用优先
- **流式输出打字光标**：AI 回复末尾闪烁光标动画

### 编辑器 & 工作区
- Monaco 编辑器、多标签页、分屏编辑（状态持久化）
- 文件树、全局搜索（可取消 + 进度显示 + 协程让步）、Git 面板、终端、本地历史、笔记、代码片段
- 主题切换（深色/浅色/跟随系统）
- 统一确认 Modal 替代原生 `window.confirm`（支持 Esc 取消/Enter 确认/点击遮罩取消）

### 安全 & 性能
- Symlink 逃逸防护：`fs.realpathSync` 二次校验
- IPC 路径权限校验：`canAccess` + realpath 双重校验
- 对话框二次确认：高危操作（删除/卸载/替换）原生 dialog 确认
- Git/CodeIndex handler 权限校验
- Plan 审批 abort signal：关窗自动 reject
- 事件循环阻塞防护：搜索协程让步（每 20 文件/50ms 释放）
- Disposable 清理：Editor model 监听器统一释放

### 便捷性
- Settings 受控输入乐观更新（防 IPC 延迟丢字）
- 分屏状态持久化（splitMode/splitRatio/splitIdx）
- z-index 6 级变量化层级（修复 Modal 遮挡 bug）
- A11y：FileTree/TabBar/TitleBar ARIA 角色补全

### 插件 & MCP
- VS Code 风格插件清单子集：commands、configuration、languages、themes、snippets
- MCP 客户端：stdio servers + HTTP 工具端点（含自定义 headers）
- Cursor 互操作：打开工作区时自动导入 `.cursor/mcp.json`

## 开发

```bash
npm install      # 安装依赖
npm run dev      # 启动 Vite (5174) + Electron 开发模式
npm run lint     # tsc 类型检查（双工程）
npm run test:run # vitest 单元测试
npm run build    # tsc + vite build + electron-builder 打包
npm start        # 运行打包产物
```

打包产物输出到 `release/`，包含 NSIS 安装包和免安装版。

## AI Provider 模式

- **Orca 模式**：请求转发到本地 Orca Universal Proxy
- **Built-in 模式**：直接调用配置的 Provider API，需提供 OpenAI 兼容的 `/chat/completions` 端点

## 项目目录结构

```
loom/
├── src/                        # 源码
│   ├── main/                   # Electron 主进程
│   │   ├── index.ts            # 入口：窗口管理、IPC handlers、生命周期
│   │   ├── path-permissions.ts # 路径权限校验（realpath + canAccess）
│   │   ├── cli-agents.ts       # CLI agent 管理
│   │   └── development-command.ts # 开发命令执行（PowerShell 黑名单）
│   ├── renderer/               # React 渲染进程
│   │   ├── App.tsx             # 应用根组件：布局、标签页、分屏、快捷键
│   │   ├── app-storage.ts      # 布局/会话持久化（SavedLayout）
│   │   ├── components/         # UI 组件
│   │   │   ├── AIAgent.tsx          # AI 对话面板（@-mention + 流式）
│   │   │   ├── InlineAIEdit.tsx     # 行内 AI 编辑（LCS diff + hunk 操作）
│   │   │   ├── CommandPalette.tsx   # 命令面板（fuzzy + MRU + 符号搜索）
│   │   │   ├── Editor.tsx           # Monaco 编辑器封装
│   │   │   ├── FileTree.tsx         # 文件树（ARIA tree）
│   │   │   ├── TabBar.tsx           # 标签栏（ARIA tablist）
│   │   │   ├── TitleBar.tsx         # 标题栏菜单（ARIA menubar）
│   │   │   ├── ConfirmModal.tsx     # 统一确认 Modal（事件驱动队列）
│   │   │   ├── Settings.tsx         # 设置面板（乐观更新）
│   │   │   ├── SidebarSearchView.tsx # 全局搜索（可取消 + 进度）
│   │   │   ├── SidebarExtensionsView.tsx # 扩展管理
│   │   │   ├── Terminal.tsx         # xterm.js 终端
│   │   │   ├── LocalHistory.tsx    # 本地历史快照
│   │   │   ├── Notepads.tsx         # 工作区笔记
│   │   │   └── SnippetManager.tsx   # 代码片段管理
│   │   └── styles/
│   │       └── globals.css      # 全局样式（深色/浅色主题 + z-index 变量）
│   ├── agent/                  # AI Agent 层
│   │   ├── ai-engine.ts        # AI 引擎（流式 + 工具调用循环）
│   │   ├── agent-tools.ts      # Agent 工具（read/write/search + 安全校验）
│   │   ├── sub-agent.ts        # 子 agent 协作
│   │   ├── planner.ts          # 计划审批
│   │   ├── code-index.ts       # Tree-sitter 代码索引
│   │   ├── mcp-client.ts       # MCP 客户端
│   │   └── development-command.ts # 开发命令执行
│   └── shared/                 # 主进程/渲染进程共享类型
├── public/                     # 静态资源
│   └── index.html              # Vite 入口 HTML
├── resources/                  # 应用资源
│   ├── icon.ico                # Windows 图标
│   ├── icon.png                # PNG 图标
│   └── icon.svg                # SVG 图标
├── dist/                       # Vite 构建输出（tsc + vite build）
├── release/                    # electron-builder 打包产物
│   ├── Loom IDE Setup 0.2.1.exe # NSIS 安装包
│   └── win-unpacked/           # 免安装版
├── package.json                # 项目配置 + scripts
├── package-lock.json           # 依赖锁定
├── tsconfig.json               # 渲染进程 TS 配置
├── tsconfig.main.json          # 主进程 TS 配置
├── vite.config.ts              # Vite 构建配置
└── node_modules/               # 依赖（不提交）
```

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 35 + React 19 + Vite 6 |
| 语言 | TypeScript |
| 编辑器 | Monaco Editor |
| 终端 | xterm.js + node-pty |
| AI | OpenAI-Compatible API + MCP |
| 代码索引 | Tree-sitter |
| 测试 | Vitest |
| 打包 | electron-builder |
