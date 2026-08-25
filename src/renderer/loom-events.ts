/**
 * Loom 渲染层类型化事件总线
 *
 * 背景：此前组件间通信全部通过裸 `window.dispatchEvent(new CustomEvent('loom:xxx', ...))`
 * 散弹式进行（约 20 个事件名、100+ 处调用、15 个文件），事件名拼错只在运行时静默失败，
 * 出问题难以定位。
 *
 * 本模块是**唯一的事件名/载荷类型事实源**：
 *   - `emitLoomEvent('loom:notify', { message, type })` —— 事件名与载荷都有编译期类型检查；
 *   - `onLoomEvent('loom:notify', handler)` —— 返回取消订阅函数，杜绝手工 removeEventListener。
 *
 * 底层仍走 window CustomEvent（与主进程/旧代码兼容），但类型由 LoomEventMap 统一约束。
 * 新代码一律走本总线；迁移完成后禁止再手写 `dispatchEvent(new CustomEvent('loom:...'))`。
 */
import type { NotificationType } from './components/Notification';

/** 编辑器动作（Editor.tsx 通过 loom:editor-action 消费） */
export interface LoomEditorAction {
  action:
    | 'undo' | 'redo' | 'format'
    | 'goToDefinition' | 'findReferences' | 'rename' | 'peekDefinition'
    | 'toggleComment' | 'toggleBlockComment' | 'inlineAI'
    | 'find' | 'replace' | 'toggleEOL';
}

export interface LoomDiagnostic {
  severity: string;
  message: string;
  file?: string;
  line?: number;
}

/**
 * 事件名 → 载荷 的契约表。新增事件必须先在这里登记类型；
 * 载荷为 undefined 表示"无载荷"事件（如 loom:refresh-tree）。
 */
export interface LoomEventMap {
  // ---- 通知 ----
  'loom:notify': { message: string; type?: NotificationType; duration?: number };
  // ---- 全局命令（欢迎页/状态栏 → App）----
  'loom:cmd': string;
  'loom:open-folder-path': string;
  'loom:save-file': { all?: boolean };
  'loom:format-and-save': { all?: boolean };
  // ---- 编辑器 ----
  'loom:editor-action': LoomEditorAction;
  'loom:editor-state': { path: string; eol: 'LF' | 'CRLF' };
  'loom:editor-set-content': { path: string; content: string };
  'loom:cursor-change': { line: number; column: number };
  'loom:go-to-line': { line?: number };
  'loom:diagnostics': LoomDiagnostic[];
  // ---- 文件树 / 标签 ----
  'loom:pin-file': string;
  'loom:refresh-tree': undefined;
  'loom:file-tree-refresh': undefined;
  'loom:create-in-directory': { directory: string; kind: 'file' | 'folder' };
  // ---- 历史 / 撤销 ----
  'loom:open-history': undefined;
  'loom:revert-file': undefined;
  // ---- 问题导航 ----
  'loom:problems-next': { dir?: number };
  // ---- 设置（渲染层内部同步）----
  'loom:setting-change': { key: string; value: unknown };
  // ---- 底部面板 ----
  'loom:open-panel-tab': string;
  'loom:clear-output': undefined;
}

/** 发送事件。事件名与载荷均受 LoomEventMap 类型约束。 */
export function emitLoomEvent<K extends keyof LoomEventMap>(name: K, payload: LoomEventMap[K]): void {
  window.dispatchEvent(new CustomEvent(name, { detail: payload }));
}

/** 订阅事件。返回取消订阅函数（组件卸载时调用，杜绝监听器泄漏）。 */
export function onLoomEvent<K extends keyof LoomEventMap>(
  name: K,
  handler: (payload: LoomEventMap[K]) => void,
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(name, listener as EventListener);
  return () => window.removeEventListener(name, listener as EventListener);
}
