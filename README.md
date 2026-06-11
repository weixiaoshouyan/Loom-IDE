# 织网 IDE (Loom)

国产 AI 原生开发环境，对标 Cursor，内嵌 Orca 智能体。

## 核心功能

- **多 LLM 提供商**：OpenAI、DeepSeek、Anthropic Claude、通义千问、智谱 GLM、月之暗面、SiliconFlow、豆包、零一万物、自定义
- **Agent 模式**：AI 自主读写编辑文件、执行命令、搜索代码（Cursor 同款工具调用）
- **内联 AI 编辑**：Ctrl+K 快速 AI 编辑选中代码
- **MCP 协议**：支持 Model Context Protocol 外部工具扩展
- **集成终端**：xterm.js + node-pty 全功能终端
- **Git 集成**：状态、暂存、提交、推送、拉取、分支切换
- **多语言调试器**：JS/TS/Python/Go/Rust/Java/C#/Ruby
- **插件系统**：VSCode 兼容扩展格式，9 个内置插件
- **技能系统**：16 个内置 Prompt 模板，支持自定义

## 架构

```
loom/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 窗口管理 + IPC + 静态服务器 + 系统托盘
│   │   ├── preload.ts           # 安全桥接 (contextBridge)
│   │   └── plugin-manager.ts    # 插件管理器
│   ├── renderer/                # 前端界面 (React 19 + Monaco Editor)
│   │   ├── App.tsx              # 主布局
│   │   ├── components/
│   │   │   ├── AIAgent.tsx      # AI 聊天/Agent 面板
│   │   │   ├── Editor.tsx       # Monaco 代码编辑器
│   │   │   ├── Sidebar.tsx      # 文件树/搜索/Git/扩展
│   │   │   ├── Panel.tsx        # 底部面板(终端/输出/调试)
│   │   │   ├── TabBar.tsx       # 标签页管理
│   │   │   ├── InlineAIEdit.tsx # Ctrl+K 内联 AI 编辑
│   │   │   └── Settings.tsx     # 设置界面
│   │   └── styles/globals.css   # 完整主题系统(暗色+亮色)
│   └── agent/                   # AI 引擎
│       ├── ai-engine.ts         # 多提供商 AI 引擎
│       ├── agent-tools.ts       # 8 个 Agent 工具
│       ├── skills.ts            # 技能/Prompt 模板
│       └── mcp-client.ts        # MCP 协议客户端
├── resources/
│   ├── icon.ico                 # 应用图标
│   └── icon.svg                 # 矢量图标源
└── package.json
```

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
# 编译主进程
node _compile-fix.js

# 构建渲染进程
node build-renderer.js

# 启动
npx electron .
```

## 启动方式

| 方式 | 命令 |
|------|------|
| 开发模式 | `npm run dev` |
| 直接启动 | `npx electron .` |
| 无窗口启动 | `wscript launch-hidden.vbs` |
| 桌面快捷方式 | 双击 "Loom IDE" 快捷方式 |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S | 保存 |
| Ctrl+Shift+S | 全部保存 |
| Ctrl+O | 打开文件 |
| Ctrl+N | 新建文件 |
| Ctrl+B | 切换侧栏 |
| Ctrl+` | 切换终端 |
| Ctrl+K | 内联 AI 编辑 |
| Ctrl+Shift+P | 命令面板 |
| Ctrl+\ | 分屏编辑 |
| F5 | 启动调试 |

## 与 Orca 的关系

织网 IDE 通过 IPC 连接本地运行的 Orca Universal Proxy (默认 `http://127.0.0.1:18080`)，
复用 Orca 的全部 AI 能力：多模型切换、智能体工具调用、本地技能库、MCP 服务等。

也支持直连模式（Builtin），直接调用各 LLM 提供商 API。
