# 织网 IDE (Loom)

国产 AI 原生开发环境，内嵌 Orca 智能体。

## 架构

```
loom/
├── src/
│   ├── main/          # Electron 主进程
│   │   ├── index.ts   # 窗口管理 + IPC
│   │   └── preload.ts # 安全桥接
│   ├── renderer/      # 前端界面 (React + Monaco Editor)
│   │   ├── App.tsx    # 主布局
│   │   ├── components/
│   │   │   ├── TitleBar.tsx    # 自定义标题栏
│   │   │   ├── Sidebar.tsx     # 文件资源管理器
│   │   │   ├── Editor.tsx      # Monaco 代码编辑器
│   │   │   ├── AIAgent.tsx     # Orca 智能体面板
│   │   │   └── StatusBar.tsx   # 状态栏
│   │   └── styles/globals.css  # Catppuccin 暗色主题
│   └── agent/         # Orca 智能体连接器
│       └── connector.ts        # 连接 Orca Proxy API
├── public/
├── resources/
└── package.json
```

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 与 Orca 的关系

织网 IDE 通过 IPC 连接本地运行的 Orca Universal Proxy (默认 `http://127.0.0.1:18080`)，
复用 Orca 的全部 AI 能力：多模型切换、智能体工具调用、本地技能库、MCP 服务等。
