/**
 * 快捷键表（keybindings）—— 单一事实源。
 *
 * 此前快捷键散落在 useKeyboardShortcuts 的 if/return 链与 Settings 只读表格，
 * 两处失同步是常态。本模块定义：
 *   - 默认键位表（与历史行为完全一致）；
 *   - 用户覆盖合并（settings.keybindings 保存 `{ id: 'chord' | null }`）；
 *   - 冲突检测（同一 chord 被多个命令占用时报告）。
 *
 * chord 记法：`Ctrl+Shift+P`、`Ctrl+\`、`F5`、`Alt+F12` 等（修饰键 + 主键）。
 */
export type KeybindingId =
  | 'file.new' | 'file.open' | 'file.openFolder' | 'file.save' | 'file.saveAll'
  | 'file.closeTab' | 'file.revert'
  | 'view.commandPalette' | 'view.quickOpen' | 'view.explorer' | 'view.search'
  | 'view.git' | 'view.extensions' | 'view.outline' | 'view.terminal'
  | 'view.toggleSidebar' | 'view.splitEditor' | 'view.toggleTheme' | 'view.toggleWordWrap'
  | 'ai.toggle'
  | 'editor.find' | 'editor.replace' | 'editor.goToDefinition' | 'editor.peekDefinition'
  | 'editor.findReferences' | 'editor.rename' | 'editor.format' | 'editor.toggleComment'
  | 'editor.redo' | 'editor.undo' | 'debug.run' | 'debug.start' | 'debug.stop'
  | 'problems.next' | 'problems.prev'
  | 'settings.open' | 'tab.next' | 'tab.prev';

export interface KeybindingDef {
  id: KeybindingId;
  command: string;
  /** 默认键位（chord 记法）；null = 默认未绑定 */
  default: string | null;
  /** 菜单/面板展示用的命令名 */
  label: string;
}

export const DEFAULT_KEYBINDINGS: KeybindingDef[] = [
  { id: 'file.new', command: 'file.new', default: 'Ctrl+N', label: '新建文件' },
  { id: 'file.open', command: 'file.open', default: 'Ctrl+O', label: '打开文件' },
  { id: 'file.openFolder', command: 'folder.open', default: 'Ctrl+Shift+O', label: '打开文件夹' },
  { id: 'file.save', command: 'file.save', default: 'Ctrl+S', label: '保存' },
  { id: 'file.saveAll', command: 'file.saveAll', default: 'Ctrl+Shift+S', label: '全部保存' },
  { id: 'file.closeTab', command: 'file.closeTab', default: 'Ctrl+W', label: '关闭标签' },
  { id: 'file.revert', command: 'file.revert', default: null, label: '从磁盘重新载入' },
  { id: 'view.commandPalette', command: 'view.commandPalette', default: 'Ctrl+Shift+P', label: '命令面板' },
  { id: 'view.quickOpen', command: 'view.quickOpen', default: 'Ctrl+P', label: '快速打开' },
  { id: 'view.explorer', command: 'view.explorer', default: 'Ctrl+Shift+E', label: '资源管理器' },
  { id: 'view.search', command: 'view.search', default: 'Ctrl+Shift+F', label: '搜索' },
  { id: 'view.git', command: 'view.git', default: 'Ctrl+Shift+G', label: '源代码管理' },
  { id: 'view.extensions', command: 'view.extensions', default: 'Ctrl+Shift+X', label: '扩展' },
  { id: 'view.outline', command: 'view.outline', default: null, label: '代码大纲' },
  { id: 'view.terminal', command: 'view.terminal', default: 'Ctrl+`', label: '终端' },
  { id: 'view.toggleSidebar', command: 'view.toggleSidebar', default: 'Ctrl+B', label: '切换侧边栏' },
  { id: 'view.splitEditor', command: 'view.splitEditor', default: 'Ctrl+\\', label: '拆分编辑器' },
  { id: 'view.toggleTheme', command: 'view.toggleTheme', default: null, label: '切换主题' },
  { id: 'view.toggleWordWrap', command: 'view.toggleWordWrap', default: 'Alt+Z', label: '切换自动换行' },
  { id: 'ai.toggle', command: 'ai.toggle', default: 'Ctrl+L', label: 'AI 面板' },
  { id: 'editor.find', command: 'editor.find', default: 'Ctrl+F', label: '查找' },
  { id: 'editor.replace', command: 'editor.replace', default: 'Ctrl+H', label: '替换' },
  { id: 'editor.goToDefinition', command: 'editor.goToDefinition', default: 'F12', label: '转到定义' },
  { id: 'editor.peekDefinition', command: 'editor.peekDefinition', default: 'Alt+F12', label: '预览定义' },
  { id: 'editor.findReferences', command: 'editor.findReferences', default: 'Shift+F12', label: '查找引用' },
  { id: 'editor.rename', command: 'editor.rename', default: 'F2', label: '重命名符号' },
  { id: 'editor.format', command: 'editor.format', default: 'Shift+Alt+F', label: '格式化文档' },
  { id: 'editor.toggleComment', command: 'editor.toggleComment', default: 'Ctrl+/', label: '切换注释' },
  { id: 'editor.undo', command: 'editor.undo', default: 'Ctrl+Z', label: '撤销' },
  { id: 'editor.redo', command: 'editor.redo', default: 'Ctrl+Y', label: '重做' },
  { id: 'debug.run', command: 'debug.run', default: 'Ctrl+F5', label: '运行（不调试）' },
  { id: 'debug.start', command: 'debug.start', default: 'F5', label: '开始调试' },
  { id: 'debug.stop', command: 'debug.stop', default: 'Shift+F5', label: '停止调试' },
  { id: 'problems.next', command: 'problems.next', default: 'F8', label: '下一个问题' },
  { id: 'problems.prev', command: 'problems.prev', default: 'Shift+F8', label: '上一个问题' },
  { id: 'settings.open', command: 'settings.open', default: 'Ctrl+,', label: '设置' },
  { id: 'tab.next', command: 'tab.next', default: 'Ctrl+Tab', label: '下一个标签' },
  { id: 'tab.prev', command: 'tab.prev', default: 'Ctrl+Shift+Tab', label: '上一个标签' },
];

export type KeybindingOverrides = Partial<Record<KeybindingId, string | null>>;

export interface ResolvedKeybinding extends KeybindingDef {
  chord: string | null;
  /** 该键位是否被用户显式覆盖 */
  isOverride: boolean;
}

/** 合并用户覆盖，返回最终键位表。 */
export function resolveKeybindings(overrides: KeybindingOverrides = {}): ResolvedKeybinding[] {
  return DEFAULT_KEYBINDINGS.map(def => {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, def.id);
    const value = hasOverride ? overrides[def.id] : def.default;
    return { ...def, chord: value ?? null, isOverride: hasOverride };
  });
}

/**
 * 冲突检测：同一 chord 被多个命令占用时返回冲突列表
 * （chord 为 null 或未绑定的命令不参与）。
 */
export function findKeybindingConflicts(
  resolved: ResolvedKeybinding[],
): { chord: string; commands: string[] }[] {
  const byChord = new Map<string, string[]>();
  for (const kb of resolved) {
    if (!kb.chord) continue;
    const list = byChord.get(kb.chord) || [];
    list.push(kb.id);
    byChord.set(kb.chord, list);
  }
  return [...byChord.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([chord, ids]) => ({ chord, commands: ids }));
}

/** 解析 chord 记法 → { ctrl, shift, alt, meta, key }（供事件匹配）。 */
export interface ParsedChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

export function parseChord(chord: string): ParsedChord | null {
  const parts = chord.split('+').map(s => s.trim());
  let ctrl = false, shift = false, alt = false, meta = false;
  const keyParts: string[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') ctrl = true;
    else if (lower === 'shift') shift = true;
    else if (lower === 'alt' || lower === 'option') alt = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'win') meta = true;
    else keyParts.push(p);
  }
  if (keyParts.length !== 1) return null;
  return { ctrl, shift, alt, meta, key: keyParts[0].toLowerCase() };
}

/** 把 KeyboardEvent 归一化为可比较的 chord 字符串。 */
export function eventToChord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key === ' ' ? 'Space' : e.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

/** 键位匹配器：把事件映射到命中的 keybinding id（按表顺序，首个命中返回）。 */
export function matchKeybinding(
  e: KeyboardEvent,
  resolved: ResolvedKeybinding[],
): KeybindingId | null {
  const chord = eventToChord(e);
  for (const kb of resolved) {
    if (kb.chord && normalizeChord(kb.chord) === chord) return kb.id;
  }
  return null;
}

/** 归一化 chord（Ctrl 大小写、分隔符），保证覆盖值与表内值可比。 */
export function normalizeChord(chord: string): string {
  return chord
    .split('+')
    .map(p => {
      const t = p.trim();
      const lower = t.toLowerCase();
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
      if (lower === 'alt' || lower === 'option') return 'Alt';
      if (lower === 'shift') return 'Shift';
      if (lower === 'meta' || lower === 'cmd' || lower === 'win') return 'Ctrl';
      return t.length === 1 ? t.toUpperCase() : t;
    })
    .join('+');
}
