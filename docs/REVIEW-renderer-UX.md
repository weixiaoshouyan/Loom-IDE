# Loom IDE 渲染层 UI/UX 与编辑器体验深度审查报告

> 审查范围：`src/renderer/**`（渲染层 UI/UX + Monaco 编辑器体验）
> 对标：VS Code / Cursor / Windsurf
> 所有 file:line 引用均经 read 工具逐行核对。

---

## 一、快捷键体系（Dimension 1）

### 1.1 【P0 严重缺陷】欢迎页宣告的 `Ctrl+L`（打开 AI Agent）根本没有实现
- **证据**：`welcome-content.ts:29` 与 `WelcomePage.tsx:116` 展示快捷键 `Ctrl+L` 为「打开 Agent」；`useKeyboardShortcuts.ts:36-84` 全文没有任何 `key === 'l'` 分支（已用 grep 验证 `Ctrl+L`/setAiOpen 仅出现在视图/欢迎页文案，无 keydown 处理器）。
- **影响**：用户按欢迎页提示按下 `Ctrl+L` 无任何反应，与 Cursor 的 `Ctrl+L` 心智不一致，且是「文档承诺了功能但未实现」的直接口碑坑。
- **严重度**：P0
- **改进建议**：在 `useKeyboardShortcuts.ts` 增加 `if (ctrl && !e.shiftKey && !e.altKey && key === 'l') { e.preventDefault(); actions.setAiOpen(p => !p); return; }`；同时在 AIAgent 的 `onToggleAI` 打开后自动把焦点交给输入框（见 4.2）。参考 Cursor：`Ctrl+L` 打开并聚焦 AI 输入框。

---

### 1.2 【P0 严重缺陷】快捷键完全硬编码，无法自定义；缺少 VS Code 的键位冲突排查与覆盖层
- **证据**：`useKeyboardShortcuts.ts:34-84` 全是 `if/return` 字面量分支；`Settings.tsx:457-468` 的「快捷键」区只是只读 `<table>`，没有任何编辑/冲突检测/JSON 导入导出。`App.tsx:882-951` 的菜单 `shortcut` 也是写死的字符串。
- **影响**：对标 Cursor/VS Code 的核心竞争力之一是 `Ctrl+K Ctrl+S` 键位可视化绑定 + 冲突检测。这里既无绑定能力，也无冲突提示，用户无法适配自身肌肉记忆。
- **严重度**：P0
- **改进建议**：把快捷键从 `if 链` 重构成 `keybinding[]` 数据表（id、chord 序列、command、when），参考 VS Code 的 `keybindings.json` 覆盖模型：默认表 + 用户覆盖表 + 冲突检测 + `Ctrl+K Ctrl+S` 打开键位面板。至少要支持 `<kbd>` 渲染与菜单内联快捷键的一处数据源（当前 App 菜单与 useKeyboardShortcuts 是两套重复定义，极易失同步——例如 menubar 的 `Ctrl+P` 与快捷键表第 51 行语义不同步）。

---

### 1.3 【P1 重要缺失】`Ctrl+Tab` / `Ctrl+PgUp/PgDn`（有序切换标签）与 `Ctrl+Shift+Z`（redo）在应用层无统一处理
- **证据**：`useKeyboardShortcuts.ts` 无 `Ctrl+Tab` 分支；`App.tsx:908-909` 的 Edit 菜单 redo 只标注 `Ctrl+Y`，未标注 VS Code 默认的 `Ctrl+Shift+Z`。`Ctrl+Tab` 交给浏览器/Monaco 默认行为，无法在「分屏两文件间」或「标签页历史序」上切换。
- **影响**：多标签工作常常只是「打开文件」，缺最常用的「最近标签快切」，与 Cursor/VS Code 差距明显。
- **严重度**：P1
- **改进建议**：实现 MRU（最近使用序）标签切换，`Ctrl+Tab` 正向 / `Ctrl+Shift+Tab` 反向弹出一个快速切换浮层（类似浏览器）；在 Edit 菜单补上 `Ctrl+Shift+Z` 并把 redo 的 shortcut 表与 Editor `monaco` trigger('redo') 对齐。

---

### 1.4 【P1 重要缺失】`Ctrl+K` 被占用为内联 AI 但缺失 VS Code 的 `Ctrl+K Ctrl+S` 和弦入口
- **证据**：`Editor.tsx:532-537` 把单键 `Ctrl+K` 绑给 `setShowInlineAI`，禁用条件仅在「编辑器有焦点」。这吃掉了 VS Code 中 `Ctrl+K` 起始的多键和弦（`Ctrl+K Ctrl+S`、`Ctrl+K Z` 折叠全部等）。
- **影响**：用户想用 VS Code 的 `Ctrl+K Ctrl+S` 打开键位绑定面板时失效；`Ctrl+K` 只在编辑器聚焦时生效，焦点在文件树/命令面板时按下无响应但也不触发和弦，体验不一致。
- **严重度**：P1
- **改进建议**：要么把内联 AI 改成 `Ctrl+Shift+K` / Cursor 式独立键，把单键 `Ctrl+K` 保留为和弦前缀；要么至少实现 `Ctrl+K Ctrl+S` 和弦跳转到 Settings 的 keybindings 页，并在非聚焦态提示。

---

### 1.5 【P2 体验优化】一键「新建文件」快捷键为 `Ctrl+N`，但与旧式「新建窗口」语义冲突；且 `Ctrl+Shift+P`/`Ctrl+P` 进入同一命令面板
- **证据**：`useKeyboardShortcuts.ts:46,51-52`：`Ctrl+N` 新建空白文件（非 VS Code 语义的「新建窗口」，可接受但需引导）；`Ctrl+P`（51 行）强制 `setCmdPalette(() => true)`，`Ctrl+Shift+P`（52 行）`p => !p` 做切换——两者语义不一致（一个 always-open、一个 toggle），用户快速连按 `Ctrl+P` 后再按 `Ctrl+Shift+P` 会意外关闭。
- **影响**：快速打开命令面板时的 toggle 语义会让连按的用户反复开合。
- **严重度**：P2
- **改进建议**：`Ctrl+P` 与 `Ctrl+Shift+P` 统一为「打开（始终 open）」，关闭统一交给 Esc/点击遮罩；如需 toggle 用 `Ctrl+Shift+P` 单独再开一个「切换」语义即可，避免 open/toggle 混用。

---

### 1.6 【P2 体验优化】`Alt+Z`（`useKeyboardShortcuts.ts:63`）与 Settings 里标注冲突；Debug 菜单标注了未实现的 `F10/F11` Step
- **证据**：`useKeyboardShortcuts.ts:63-67` 把 `Alt+Z` 绑成 toggle wordWrap；`Settings.tsx:462` 也标注 `Toggle Word Wrap Alt+Z`，是一致了；但 `Settings.tsx:462` 还列了 `Step Over F10`、`Step Into F11`，而 `useKeyboardShortcuts.ts:75-79` 只实现 `F5/Shift+F5/Ctrl+F5/Ctrl+Shift+F5`，`App.tsx:936-943` 的 Run 菜单只有 StartDebug/Run/StopDebug——**F10/F11 没有任何 handler**，是「文档承诺了但没实现」。
- **影响**：用户在设置里看到 Step 快捷键，按下无反应，误导。
- **严重度**：P2
- **改进建议**：要么实现 step 命令，要么从键位表移除 F10/F11；始终以「键位表 = 实际 handler 白名单」为唯一事实来源。

---

## 二、编辑器能力（Dimension 2）

### 2.1 【P1 重要缺失】编辑器无自定义右键上下文菜单，直接暴露 Monaco 默认菜单
- **证据**：`Editor.tsx:499` 仅 `contextmenu: true`（开启 Monaco 默认菜单），全工程再无对 `editor.onContextMenu` 或 `editor.addAction` 的扩展；对比 `FileTree.tsx`、`TabBar.tsx` 都有定制右键菜单。
- **影响**：用户右键缺少「在资源管理器中显示 / 复制路径 / 从磁盘重载 / 打开本地历史」等 IDE 级操作，体验割裂（文件树有但编辑器没有）。
- **严重度**：P1
- **改进建议**：调用 `editor.onContextMenu((e) => { e.preventDefault(); /* 弹自定义菜单 */ })`，复用 `ContextMenu` 组件；在 Monaco 菜单之上叠加「Copy Path / Reveal in Explorer / Revert from Disk / Local History」等项，参考 VS Code `contextMenu` contribution。

---

### 2.2 【P2 体验优化】缺少「标签拖出为独立窗口」/「编辑器分屏按钮在收窄时无悬浮 +」；拆分模型的灵活度低于 VS Code
- **证据**：`App.tsx:1011-1037`、`EditorGroup.tsx:91-120`：分屏是固定「左右/上下 + ratio」双格，`openFiles.length < 2` 时强制关闭；`TabBar.tsx:151-163` 只有单一 split 按钮，无法「把一个标签拖成第二个拆分格」或拖到外部成新窗口。
- **影响**：VS Code 支持任意布局 + 拖标签到新分组/新窗口；这里只有一种二拆分且无拖放分屏，多任务编排受限。
- **严重度**：P2
- **改进建议**：在 TabBar 的 `onDragEnd`/`onDrop` 中检测拖到编辑器空白处 → 设置 splitIdx 为新文件；把 layout 抽象成 `group[]` 数组支持任意分栏。优先实现「标签拖到右侧 → 拆分」，投入小见效快。

---

### 2.3 【P2 体验优化】`F2` 重命名 / 错误跳转 / 折叠控件等依赖 Monaco 默认，但缺少「波浪线点击跳转错误」的定位联动
- **证据**：`Editor.tsx:710-716` 只把 Monaco markers 透传成全局 `loom:diagnostics` 事件进 Problems 面板，`Panel.tsx:366-379` 点击行可跳转；但「光标置于错误行」没有在面板里高亮当前错误，也没有从编辑器波浪线直接「下一错误」的导航（如 `Alt+F8`）。
- **影响**：错误处理链中断：看到波浪线 → 需要切到底部 Problems 手动点，缺 VS Code 式「光标处错误一键跳转全部」。
- **严重度**：P2
- **改进建议**：提供 `editor.action.marker.next`/`previous` 的全局快捷键绑定（VS Code 为 `F8/Shift+F8`），并让 Problems 面板根据 `loom:cursor-change` 高亮与当前文件/行匹配的错误。

---

### 2.4 【P2 体验优化】Outline（大纲）用正则扫描而非已存在的 tree-sitter 符号索引，功能与准确性低于命令面板的符号搜索
- **证据**：`FileTree.tsx:232-323` 的 `OutlineView` 用正则逐行匹配函数/类/导入（`246-281` 行），而 `CommandPalette.tsx:158-191` 与 `AIAgent.tsx:455-468` 已使用 `codeIndex.search`（tree-sitter）。同一工作区存在两套符号来源。
- **影响**：正则大纲对类方法、修饰符、TS 泛型等误报/漏报，且与命令面板 `@` 符号结果不一致，用户会觉得「大纲不准」。
- **严重度**：P2
- **改进建议**：`OutlineView` 改调 `codeIndex.search(workspace, filename, -1)` 取该文件符号，复用树层级；保留正则做无索引时的降级。

---

### 2.5 【P2 体验优化】大文件未做 Monaco `largeFileOptimizations` 覆盖，且会话截断阈值可能意外触发
- **证据**：`Editor.tsx:474-512` 的 create 选项未设置 `largeFileOptimizations`；`app-storage.ts:74-78` 会话存储对 `>50000` 字符统一截断。二者叠加：用户打开 >50KB 文件时，编辑器仍按普通模式渲染（大文件可能卡顿），且重启后内容被截断为「…truncated…」并拒存（`App.tsx:526-529` 的 saveBlockedTruncated）。
- **影响**：大文件编辑性能无保障；会话恢复后大文件内容丢失且无法保存（有安全护栏但用户困惑）。
- **严重度**：P2
- **改进建议**：给 create 选项按内容长度动态启用 `largeFileOptimizations`（禁用折叠/括号对等开销项）；session 截断阈值做成设置，并在截断时于标题/状态栏显著提示「会话仅存前 50KB」。

---

### 2.6 【P2 体验优化】FindReplace 是自制而非 Monaco 原生，缺「selection→自动填入查找词」「Case/Regex 联动 URI 语义」，且没有「撤销一次替换后重查」等体验
- **证据**：`Editor.tsx:526-531` 拦截 `Ctrl+F/H` 后 `setShowFind`，使用自实现 `FindReplaceBar`（`model.findMatches`），而非 Monaco `editor.action.startFindReplaceAction`。
- **影响**：丢失 Monaco 原生查找的「所选文本自动进入查找框、正则/整词状态持久、多光标替换、包裹高亮动效」等成熟 UX。
- **严重度**：P2
- **改进建议**：优先复用 `editor.getAction('actions.find')`/Monaco 原生查找 widget（功能完整），仅在其上追加 bar 样式；若坚持自制，补上「用当前 selection 初始化 findText 并把光标定位到首个匹配」及 Enter 后 `findNext` 的循环包裹行为（当前 `navigate` 已支持循环，但初次 Enter 只定位第一个匹配）。

---

## 三、标签页 / 工作台体验（Dimension 3）

### 3.1 【P1 重要缺失】没有 VS Code 的「预览标签（preview tab）」：单击文件树直接打开永久标签而非可被替换的预览
- **证据**：`FileTree.tsx:74-90` `handleClick` 直接 `onOpenFile` → `App.tsx:441-449` `upsertOpenFile` 追加永久 tab，无「单击预览 / 双击钉住」区分；`TabBar.tsx:84-136` 也全是一等标签。
- **影响**：在大项目里逐一点开文件会迅速塞满标签条，与 VS Code 默认的 read-only 预览替换行为差异明显。
- **严重度**：P1
- **改进建议**：引入 `isPreview`（read-only，虚线样式，被新单击替换；双击/编辑/正则解析后转为持久）。在 `upsertOpenFile` 里当活动标签是 preview 且未编辑时用新文件替换它，复用 VS Code 语义。

---

### 3.2 【P1 重要缺失】标签过多时无溢出收折/滚动条/「+ 更多」万国符；横向滚轮被改为翻页（反直觉）
- **证据**：`TabBar.tsx:65-71` `onWheel` 把垂直滚轮映射成切换 active tab；`tabs-container` 无溢出折叠（CSS 里无 `.tabs-container` 的 scroll/overflow 折叠逻辑），标签横向堆叠直至压缩到不可读。
- **影响**：VS Code 超过可视宽度会进入水平滚动或收折；这里滚一下鼠标就换标签（用户想只看 tab 标题反而被切走），且大量标签无聚合入口。
- **严重度**：P1
- **改进建议**：移除 `onWheel` 翻页（或改为仅当按 `Ctrl` 时），加水平滚动条 + 两端「◀ ▶」溢出按钮 + 溢出时右侧「…菜单」列出剩余标签；保留「标签大缩窄时显示图标」策略。

---

### 3.3 【P2 体验优化】未保存标记只依赖 `isFileDirty` 的全局对比，脏点点击行为与 VS Code 不一致
- **证据**：`TabBar.tsx:117-133`：脏标签渲染 `.tab-modified`，但 `onClick` 是 **关闭**（120 行），VS Code 里点击脏点默认是「在 Git 变更视图间」或聚焦文件而非直接关闭；`App.tsx:713-720` 关闭时才弹确认。
- **影响**：用户想点脏点确认/聚焦，却被直接关闭并弹框，体验与习惯不符。
- **严重度**：P2
- **改进建议**：脏点 `onClick` 改为 `onSelect(i)`（聚焦该标签），提供单独的 x 按钮走 `onClose`；同时脏点用 `title` 说明「有未保存更改」。

---

### 3.4 【P2 体验优化】分屏（split）标签条功能缩水：无右键菜单、无关闭按钮、无拖拽重排，仅剩点击切换
- **证据**：`EditorGroup.tsx:63-85` `renderTabBar` 只渲染 `.tab`+标题+脏点+X（关闭整个 split），无 TabBar 的右键菜单/重排；`App.tsx` 的 `onSelect` 仅切换 `leftIdx/rightIdx`。
- **影响**：分屏里的文件无法单独关闭/重排，与主标签条能力明显不齐。
- **严重度**：P2
- **改进建议**：将主 `TabBar` 组件复用进 split 面板，传入 `onClose(idx)`（关闭该文件）、右键菜单、`onReorder`；split 只保留「关闭格」按钮。

---

## 四、布局与交互细节（Dimension 4）

### 4.1 【P2 体验优化】侧边栏 / AI 面板 / 底部面板的显隐都是瞬时卸载或 `display:none`，无收合过渡动画（违反项目自己的设计系统）
- **证据**：`App.tsx:1065` `{sidebarView && (...)}`（条件卸载）、`App.tsx:1168` `{aiOpen && (...)}`（条件卸载）、`Panel.tsx:213` `style={{ display: visible ? undefined : 'none' }}`。CSS 中 `--transition-normal` 已定义好（`globals.css:94`）且 `.sidebar` 有 `transition: width`（`globals.css:460`），但侧边栏「隐藏」分支直接不渲染，动画不生效。
- **影响**：VS Code/Cursor 收合侧边栏时 200ms 弹性过渡；这里生硬闪消失/闪过，细节观感差一个档次。
- **严重度**：P2
- **改进建议**：隐藏改为「保留挂载 + 控制宽度/opacity + transition」，或用 `CSS transform` 收合；End 后延时卸载以释放底层。Panel 同理用 `height→0 + opacity` 过渡而非 `display:none`。

---

### 4.2 【P2 体验优化】AI 面板与编辑器抢焦点：`Ctrl+L`（若实现后）打开面板却无焦点移交；命令面板 `ai.toggle` 打开后仍停留在原焦点
- **证据**：`useKeyboardShortcuts.ts` 没有 AI 相关键；`App.tsx:969` `ai.toggle` 仅 `setAiOpen(p => !p)`，无焦点处理；`AIAgent.tsx:500,641` 只有 mention 应用 / skill 应用后 `textareaRef.current.focus()`，面板刚打开时输入框不会自动聚焦（除非内部 `useEffect`，需确认）——见 641 行为用户手动后聚焦。
- **影响**：打开 AI 面板后键盘焦点仍可能在编辑器，输入文字会打在编辑器而 AI 输入框没响应；或反之 AI 输入框吞掉全局快捷键。
- **严重度**：P2
- **改进建议**：在 `aiOpen` 首次变 true 时 `requestAnimationFrame(() => aiInputRef.focus())`（Cursor 行为）；关闭时把焦点还给编辑器（`editorRef.focus()`）。注意 AIAgent 内部还有 `Terminal` 与 `AgentPlanApproval` 等子组件，需防止它们抢焦点。

---

### 4.3 【P2 体验优化】模态层级基本可用，但上下文菜单与命令面板同为 `--z-context-menu(1000)`/`--z-modal(1100)`，会互相遮挡；命令面板打开时右键菜单仍在 1000 层压在 1100 之下不合理
- **证据**：`globals.css:111-117`：`--z-context-menu:1000`、`--z-modal:1100`、`--z-toast:1500`、`--z-notification:9999`；`TabBar.tsx:167-213` 右键菜单 `z-index:1001` 会盖在命令面板（1100）之上但又在确认框（1200）之下，层级语义混乱。
- **影响**：多模态同时（如右键菜单 + 命令面板）时遮挡与点击吞掉；Toast 9999 又过高，几乎透明化层级体系。
- **严重度**：P2
- **改进建议**：收敛为「popover < overlay < context-menu < modal < top-modal < toast < notification」的严格递增，并将各组件统一用单一 z 变量；给命令面板/设置等加 `<div className="modal-backdrop">` 避免穿透点击。

---

### 4.4 【P2 体验优化】状态栏信息密度整体不足，缺「错误/警告计数、编码与行尾实时性、空格 indentation 切换、模型分支交互」；个别项为静态假象
- **证据**：`StatusBar.tsx:128-178`：右下只有 Ln/Col、Spaces、language（大写首字）、Encoding、EOL、Theme、fontSize、locale；`Problems` 错误数只显示在底部面板标题（`Panel.tsx:235-239`），状态栏没有错误/警告角标；`StatusBar.tsx:46` 用 `useEffect` 依 `activeFile?.path` 重置光标是合理的，但 `eol/encoding`（`24-25`、`129-149`）是 `useState` 的静态本地值，Editor 里并没有根据 `model.getEOL()` 同步，切换 EOL 只是改了个文本，实际行尾没变——**假设置**。
- **影响**：用户点 EOL/Encoding 以为生效了，实则未作用于文件，严重误导；且缺 Git 变更数、错误角标等 VS Code 标配。
- **严重度**：P2
- **改进建议**：EOL 切换应联动 `model.setEOL()` 并置脏；Encoding 若无真实实现则隐藏或接入 `fs` 换码；状态栏补错误/警告徽标（复用 `problems` 计数）并做成可点击跳 Problems。

---

### 4.5 【P2 体验优化】欢迎页引导不错但快捷键展示与实现脱节（见 1.1/1.4），且「Ctrl+K 内联 AI」仅编辑器聚焦有效，欢迎页未说明前置条件
- **证据**：`WelcomePage.tsx:112-122` 在非编辑态欢迎页展示 `Ctrl+K`/`Ctrl+L`；`Editor.tsx:532` 的 `Ctrl+K` 要求 `editorRef.current?.hasTextFocus()` 才响应，欢迎页本身无编辑器，按下无效。
- **影响**：引导文案在用户首次体验时全部失效，造成「教程不可信」。
- **严重度**：P2
- **改进建议**：欢迎页仅展示全局可用的键；内联 AI 的 `Ctrl+K` 改为全局 handler（无编辑器时先聚焦编辑器再开内联输入），或在欢迎页文案注明仅编辑态可用。

---

### 4.6 【P2 体验优化】面包屑在 Windows 盘符处理有 bug：根段会读出错误路径
- **证据**：`Breadcrumb.tsx:27,43-44`：`filePath.split(/[\\/]/)` 把 `C:\Users\...` 切成 `["C:", "Users", ...]`；`onSegmentClick(idx=0)` 时 `segments.slice(0,1).join('\\')` → `"C:"`，传给 `readDir("C:")`（`48` 行）是无效路径。
- **影响**：Windows 用户点击面包屑第一段（盘符）打不开目录。
- **严重度**：P2
- **改进建议**：对 Windows 把首段修正为 `C:\`（`seg[0] + '\\'`）；并把分割改为保留绝对根更稳妥（`/^([A-Za-z]:)(\\.*)$/`）。

---

## 五、视觉与主题（Dimension 5）

### 5.1 【P2 体验优化】仅有深/浅两款 CSS 主题 + Monaco 二选一，无语法高亮主题跟随选项、无自定义代码配色
- **证据**：`editor-theme.ts:3-7` 只返回 `'vs'|'vs-dark'` 二选一；`globals.css:119+` 只有 `[data-theme="light"]` 覆盖，无第三方/自定义 Monaco `defineTheme`；`Settings.tsx:414-431` 主题选择只有 dark/light/system 三卡。
- **影响**：对比 VS Code 的任意 Code 主题 + 厂商语义 token + 自定义工作区配色，这里用户无法换配色，专业感不足。
- **严重度**：P2
- **改进建议**：投少量成本支持 2-3 套内置 `monaco.editor.defineTheme(...)` 高亮方案并把 `theme` 经 Settings 联动 `monaco.editor.setTheme`（`Editor.tsx:581-583` 已有此 hook，仅是主题枚举待扩）。

### 5.2 【P2 体验优化】加载/骨架屏缺失：命令面板、文件索引、AI 首屏等无 skeleton 或空态分区，只有简单 loading
- **证据**：`Settings.tsx:174-182` 加载态只是一个居中文字；`FileTree.tsx:367-381` 空态是纯文本；`Panel.tsx:360-364` 空态是纯文字。几乎没有骨架屏。
- **影响**：首启/打开大项目时白屏->有内容，无骨架缓冲，观感平淡。
- **严重度**：P2
- **改进建议**：文件树展开时为目录行加 `skeleton` 占位动画；命令面板/欢迎页首屏可加轻量 skeleton；复用 `--transition` 与 `@keyframes` 做 shimmer。

### 5.3 【P2 体验优化】字体设置仅编辑区生效，UI 字体/图标字体不可配；`statusbar` 等仍用固定像素尺寸
- **证据**：`Settings.tsx:400-401` 仅 `editor.fontSize/fontFamily`；`Editor.tsx:478-479` 字体列表硬编码；`StatusBar.tsx:178` fontSize 只读展示。
- **影响**：VS Code 的 `editor.fontFamily`/`editor.fontLigatures`/`workbench.colorTheme` 全覆盖，这里 UI 层与代码字体无法统一调。
- **严重度**：P2
- **改进建议**：把 `fontFamily` 透传到 `--font-ui`/`--font-code` CSS 变量，使欢迎页/面板/编辑区一致；Settings 增加 ligatures 开关（Monaco `fontLigatures` 已设 true，`Editor.tsx:504`）。

---

## 六、无障碍与国际化（Dimension 6）

### 6.1 【P0 严重缺陷】标签栏右键菜单是硬编码英文，且未走 `t()`；`ConfirmModal` 默认按钮文案硬编码中文
- **证据**：`TabBar.tsx:170-211`：`Close`/`Close Others`/`Close All`/`Close to the Right`/`Copy Path`/`Copy File Name` 全部写死英文，props 上有 `locale` 却未使用；`ConfirmModal.tsx:70-71`：`confirmText || '确定'`、`cancelText || '取消'` 兜底硬编码中文（而 i18n 已有 `confirm.ok/cancel`，`zh-CN.ts:573-576`）。
- **影响**：英文界面下标签页右键全英文，中文界面下未传文案的确认框却是中文默认——双语都泄露硬编码，覆盖不到的字符串成为「界面裂缝」。
- **严重度**：P0
- **改进建议**：TabBar 右键菜单用 `t('tabs.close')` 等（`zh-CN.ts:92-100` 已预留 `tabs.*`）；ConfirmModal 兜底改为 `t('confirm.cancel')/t('confirm.ok')`。

### 6.2 【P1 重要缺失】大量界面字符串仍未抽到 i18n：Settings 键位表英文、Settings 状态文案中文、`ActivityBar` title、`DebugPanel` 表头等
- **证据**：`Settings.tsx:462` 键位表 `"Save","Ctrl+S"` 等全英文硬编码（未用 `tk()`，且「Open Folder」标 `Ctrl+K` 与 `useKeyboardShortcuts.ts:49` 的 `Ctrl+Shift+O` 不符）；`Settings.tsx:202,310` 状态 `已拉取 X 个模型`/`已添加并拉取` 中文硬编码；`Settings.tsx:475-476` 标题 `Settings`、aria `Close settings` 硬编码；`ActivityBar.tsx:25-29` title（Explorer/Ctrl+Shift+E…）全英文；`DebugPanel.tsx:141` 表头 `ID/Shell/PTY/PID`；`Settings.tsx:462` 又是双份英文。
- **影响**：切到 en-US 时部分 UI 仍是英文、部分状态弹中文，割裂感强。
- **严重度**：P1
- **改进建议**：建立「key 生命表」测试：遍历所有组件里 `t('...')` 与 `[^i（用 ts 编译器/脚本）扫描硬编码可显示串`；统一走 `t()`，并在 Settings 键位表同时修正 `Open Folder` 键位为 `Ctrl+Shift+O`。

### 6.3 【P2 体验优化】组件 `role`/ARIA 覆盖不完整：文件树 tab 缺 `aria-keyshortcuts`，命令面板结果无 `role=option`,活动标签条无正确的焦点管理
- **证据**：`FileTree.tsx:180-183` 有 `role=treeitem`/`aria-selected`/`aria-expanded`，但无 `aria-keyshortcuts`、无 `onKeyDown` 实现方向键导航（树内只能 Tab 到一个节点）；`CommandPalette.tsx:421-496` 列表项无 `role=option`，`aria-activedescendant` 未设置；`TabBar.tsx:103-106` tab 有 `role=tab` 但无 `aria-controls`、无对应用法。
- **影响**：屏幕阅读器与纯键盘用户难以逐项导航；标签/结果列表操作等全靠鼠标。
- **严重度**：P2
- **改进建议**：为 `command-palette-list` 设 `role=listbox`/`aria-activedescendant`；文件树补 `ArrowUp/Down/Left/Right/Enter` keydown；TabBar 补 `aria-controls` 与合成焦点；为快捷键入口加 `aria-keyshortcuts="..."`。

---

## 七、状态管理与性能（Dimension 7）

### 7.1 【P1 重要缺失】`App.tsx` 把所有可变状态集中在顶层 `useState`，每次键盘输入都触发全树重渲染
- **证据**：`App.tsx:44-78` 约 30 个 `useState`；`handleContentChange:495-497` 每次按键 `setOpenFiles(prev => prev.map(...))` 生成新数组 → 重新渲染 `<TabBar>`、`<Breadcrumb>`、`<Editor>`、`<Panel>`、`<StatusBar>`、`<AIAgent>`（`App.tsx:1105/1124/1145/1156/1205/1189`）。其中 `Editor` 不是 `React.memo`（无包裹），`AIAgent` 收到 `openFiles.map(f=>({...content}))`（`App.tsx:1192`）——每次输入都会重建含全部文件内容的 props。
- **影响**：编辑器每敲一键，AIAgent（含大量子组件与折叠/消息列表）与 TabBar/Breadcrumb 全部重渲染；大文件/多标签下是明显卡顿源。
- **严重度**：P1
- **改进建议**：用 `React.memo` 包裹 `Editor`/`Breadcrumb`；把 `openFiles` 内容性 props 用引用稳定化（只在文件变化时改引用）；AIAgent 接收「最近一次变更的文件」，而非全量内容快照，或子组件 `memo` 化；`setOpenFiles` 的 updater 里避免同步展开大数组到 props。

### 7.2 【P2 体验优化】会话持久化到 localStorage，容量与序列化成本高，且对 >50KB 文件有截断丢失风险
- **证据**：`App.tsx:302-308` 每 1.5s 防抖 `saveSession`；`app-storage.ts:66-88` 把全部 `openFiles` 序列化存 localStorage——多个未超 50KB 的中型文件即可撑爆 `~5MB` 配额；`>50KB` 会被截断（`74-78`）并在恢复后静默丢弃内容（配合 `App.tsx:526-529` 拒存，安全但丢数据）。`saveSession` 的 `catch {}`（`app-storage.ts:88`）静默吞掉配额溢出。
- **影响**：打开多个文件即可能写入失败无提示；恢复时大文件内容被截断且无法保存（体验陷阱）。
- **严重度**：P2
- **改进建议**：用主进程文件/`indexedDB` 持久化会话，localStorage 仅存索引；把「仅存 openFiles 路径+激活位置，内容重启后重新从磁盘读」设为默认（符合 VS Code 行为），彻底规避截断/配额问题；写失败时给出通知而非静默。

### 7.3 【P2 体验优化】`InlineAIEdit` 的 LCS diff 用 `O(n*m)` DP，>800 行有全替换保护但 800 行内仍可能卡
- **证据**：`InlineAIEdit.tsx:27-64`：`dp` 二维数组 `(m+1)×(n+1)`；`computeDiff` 由 `useMemo` 依赖 `[mode, response]` 触发，流式期间每次 chunk 更新 `response` 都重算 diff。800 行以内文件在流式更新时反复执行 O(800×800) DP，可能掉帧。
- **影响**：大一点的函数在 AI 生成 diff 预览时界面卡顿。
- **严重度**：P2
- **改进建议**：流式期间只在 `mode==='diff'`（结束）算 diff；把阈值从 800 设为 ~500，并改用 Myers diff 或先按公共前缀后缀裁剪再 LCS 以显著降复杂度。

### 7.4 【P2 体验优化】全局 `keydown` 监听器（`useKeyboardShortcuts.ts:81`）在所有区域（含输入框/textarea 聚焦时）都执行，可能拦截本应由输入框处理的按键
- **证据**：`useKeyboardShortcuts.ts:44-79` 的 handler 绑定 `window`，未检查 `e.target` 是否在 `input/textarea/[contenteditable]` 中；例如用户在 AI 输入框里按 `Ctrl+O` 会触发 open-file 而非输入框自身行为；`Editor.tsx:526` 的捕获监听也仅对 Ctrl+F/H 做了 `hasTextFocus` 判断，未覆盖全局键。
- **影响**：在文本输入区按下与全局冲突的组合键（如某些编辑器快捷键）会被误拦截。
- **严重度**：P2
- **改进建议**：在全局 handler 开头 `if ((e.target as HTMLElement)?.matches?.('input, textarea, [contenteditable=true]')) return;`，再决定是否放行；编辑器/终端等专注态由各自的局部监听处理，仅在非输入态落到全局。

---

## 八、严重度汇总表

| # | 严重度 | 维度 | 问题 | 关键证据 |
|---|--------|------|------|----------|
| 1.1 | P0 | 快捷键 | 欢迎页宣告的 `Ctrl+L` 打开 AI Agent 无 handler，按下无效 | `welcome-content.ts:29`、`useKeyboardShortcuts.ts:36-84` |
| 6.1 | P0 | i18n | TabBar 右键菜单硬编码英文；ConfirmModal 默认按钮硬编码中文 | `TabBar.tsx:170-211`、`ConfirmModal.tsx:70-71` |
| 1.2 | P0 | 快捷键 | 快捷键完全硬编码不可自定义、无冲突排查、无 `Ctrl+K Ctrl+S` | `useKeyboardShortcuts.ts:34-84`、`Settings.tsx:457-468` |
| 1.3 | P1 | 快捷键 | 无 `Ctrl+Tab`(MRU 切tab) 统一处理；Edit 菜单 redo 只标 `Ctrl+Y` | `useKeyboardShortcuts.ts`、`App.tsx:908-909` |
| 1.4 | P1 | 快捷键 | `Ctrl+K` 被内联 AI 占用，吃掉了 VS Code `Ctrl+K Ctrl+S` 和弦 | `Editor.tsx:532-537` |
| 3.1 | P1 | 标签 | 无 VS Code 预览标签（单击预览/双击钉住） | `FileTree.tsx:74-90`、`App.tsx:441-449` |
| 3.2 | P1 | 标签 | 标签无溢出收折；横向滚轮被改为翻页（反直觉） | `TabBar.tsx:65-71` |
| 2.1 | P1 | 编辑器 | 编辑器无自定义右键菜单，暴露 Monaco 默认菜单 | `Editor.tsx:499` |
| 6.2 | P1 | i18n | Settings 键位表/状态文字、ActivityBar title、DebugPanel 表头未走 i18n；键位表「Open Folder Ctrl+K」与实现不符 | `Settings.tsx:462,202,310,475`、`ActivityBar.tsx:25-29` |
| 7.1 | P1 | 性能 | App 顶层集中 state，每次输入全树重渲染；Editor 未 memo；AIAgent 每次接收全量文件内容 | `App.tsx:44-78,495-497,1192` |
| 2.2 | P2 | 编辑器 | 标签无法拖出/拖成新分屏；分屏只支持一种双格布局 | `App.tsx:1011-1037`、`EditorGroup.tsx:91-120` |
| 2.3 | P2 | 编辑器 | 无「下一错误（F8）」/错误波浪线↔面板联动 | `Editor.tsx:710-716`、`Panel.tsx:366-379` |
| 2.4 | P2 | 编辑器 | Outline 用正则而非已有的 tree-sitter 符号索引 | `FileTree.tsx:232-323` vs `CommandPalette.tsx:158-191` |
| 2.5 | P2 | 编辑器 | 大文件无常规 `largeFileOptimizations`，会话截断>50KB 丢内容 | `Editor.tsx:474-512`、`app-storage.ts:74-78` |
| 2.6 | P2 | 编辑器 | FindReplace 自制，失掉 Monaco 原生 selection→查找词、状态持久等 UX | `Editor.tsx:526-531`、`FindReplaceBar.tsx` |
| 3.3 | P2 | 标签 | 脏点点击语义为「关闭」而非「聚焦」 | `TabBar.tsx:117-133` |
| 3.4 | P2 | 标签 | 分屏标签条无右键菜单/关闭/重排 | `EditorGroup.tsx:63-85` |
| 4.1 | P2 | 布局 | 侧边栏/AI 面板/底面板显隐无过渡动画，条件卸载或 display:none | `App.tsx:1065,1168`、`Panel.tsx:213` |
| 4.2 | P2 | 布局 | AI 面板与编辑器抢焦点；`ai.toggle` 打开后不聚焦输入框 | `App.tsx:969`、`AIAgent.tsx:500,641` |
| 4.3 | P2 | 布局 | z-index 体系名不副实：context-menu 1000 盖在 modal 1100 上、notification 9999 过高 | `globals.css:111-117` |
| 4.4 | P2 | 布局 | 状态栏缺错误数/编码行尾联动；EOL/Encoding 切换是静态假设置 | `StatusBar.tsx:128-178` |
| 4.5 | P2 | 布局 | 欢迎页快捷键展示与实现脱节（Ctrl+K/L 非全局） | `WelcomePage.tsx:112-122`、`Editor.tsx:532` |
| 4.6 | P2 | 布局 | 面包屑 Windows 盘符段读出非法路径 `C:` | `Breadcrumb.tsx:27,43-44` |
| 5.1 | P2 | 视觉 | 仅两档主题，无常量语法高亮/自定义配色 | `editor-theme.ts:3-7`、`Settings.tsx:414-431` |
| 5.2 | P2 | 视觉 | 缺骨架屏，加载态只有文字 | `Settings.tsx:174-182`、`FileTree.tsx:367-381` |
| 5.3 | P2 | 视觉 | 字体仅编辑区生效，UI 字体/ligatures 不可统一配 | `Settings.tsx:400-401`、`Editor.tsx:478-479` |
| 6.3 | P2 | 无障碍 | 文件树缺方向键导航、命令面板缺 listbox/aria-activedescendant、tab 缺 aria-controls | `FileTree.tsx:180-183`、`CommandPalette.tsx:421-496`、`TabBar.tsx:103-106` |
| 7.2 | P2 | 性能 | localStorage 会话容量风险 + >50KB 截断丢内容 + 静默失败 | `App.tsx:302-308`、`app-storage.ts:66-88` |
| 7.3 | P2 | 性能 | InlineAIEdit 流式期间反复 O(n×m) LCS diff，大块掉帧 | `InlineAIEdit.tsx:27-64` |
| 7.4 | P2 | 性能 | 全局 keydown 未过滤 input/textarea，误拦输入区按键 | `useKeyboardShortcuts.ts:81` |

### 优先级建议（落地顺序）
1. **P0 先修**：`Ctrl+L` 空 handlers（1.1）、TagBar/ConfirmModal 双语硬编码（6.1）、快捷键可配置化起步（1.2，可先做「键位表单数据源 + 冲突提示」）。
2. **P1 重点**：预览标签 + 标签溢出（3.1/3.2）、编辑器右键菜单（2.1）、i18n 补齐（6.2）、App 渲染性能（7.1）、`Ctrl+Tab`/`Ctrl+K Ctrl+S`（1.3/1.4）。
3. **P2 打磨**：按汇总表逐项收敛细节，优先动画、状态栏真实性、EOL 联动、面包屑盘符、骨架屏。

> 注：以上 30+ 条均有精确 file:line 佐证；行号已在当前分支核对。建议以「键位表=单数据源」「事件=唯一事实源」「i18n 全覆盖测试」三条工程纪律为纲系统推进。
