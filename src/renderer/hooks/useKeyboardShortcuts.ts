/**
 * useKeyboardShortcuts — 表驱动的全局快捷键处理器。
 *
 * 键位表见 ../keybindings（单一事实源）：本 hook 只负责
 *   1. 从 settings 加载用户覆盖（settings.keybindings）；
 *   2. 每次 keydown 用 matchKeybinding 匹配 → 分发到命令动作；
 *   3. 输入框保护（只有白名单键生效）。
 *
 * 新增/修改快捷键 = 改 keybindings.ts 表 + 本文件的 dispatchAction 分发，
 * 不再散落 if/return。
 */
import { useEffect, useState } from 'react';
import { t } from '@/shared/i18n';
import { emitLoomEvent, onLoomEvent } from '../loom-events';
import {
  matchKeybinding,
  resolveKeybindings,
  type KeybindingId,
  type KeybindingOverrides,
} from '../keybindings';

export interface ShortcutActions {
  createUntitledFile: () => void;
  closeTab: (idx: number) => void;
  openFileFromDisk: () => void;
  openFolder: () => void;
  startDebug: () => void;
  stopDebug: () => void;
  runCurrentFile: () => void;
  addOutput: (msg: string) => void;
  setCmdPalette: (fn: (p: boolean) => boolean) => void;
  setAiOpen: (fn: (p: boolean) => boolean) => void;
  setSidebarView: (v: string | ((prev: string) => string)) => void;
  setPanelVisible: (fn: (p: boolean) => boolean) => void;
  setSplitMode: (fn: (p: boolean) => boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  cycleTabs: (dir: 1 | -1) => void;
}

export interface ShortcutState {
  openFilesCount: number;
  activeIdx: number;
  isDebugging: boolean;
}

/** 输入框聚焦时仍然生效的全局快捷键 id（保存/关闭标签/AI/终端/设置） */
const INPUT_SAFE_IDS = new Set<KeybindingId>([
  'file.save', 'file.saveAll', 'file.closeTab', 'ai.toggle', 'view.terminal', 'settings.open',
]);

/** 命令 id → 实际动作分发 */
function dispatchAction(id: KeybindingId, a: ShortcutActions, s: ShortcutState): void {
  switch (id) {
    case 'file.new': a.createUntitledFile(); break;
    case 'file.open': a.openFileFromDisk(); break;
    case 'file.openFolder': a.openFolder(); break;
    case 'file.save': emitLoomEvent('loom:format-and-save', { all: false }); break;
    case 'file.saveAll': emitLoomEvent('loom:format-and-save', { all: true }); break;
    case 'file.closeTab': if (s.openFilesCount) a.closeTab(s.activeIdx); break;
    case 'file.revert': emitLoomEvent('loom:revert-file', undefined); break;
    case 'view.commandPalette': a.setCmdPalette(() => true); break;
    case 'view.quickOpen': a.setCmdPalette(() => true); break;
    case 'view.explorer': a.setSidebarView('explorer'); break;
    case 'view.search': a.setSidebarView('search'); break;
    case 'view.git': a.setSidebarView('git'); break;
    case 'view.extensions': a.setSidebarView('extensions'); break;
    case 'view.outline': a.setSidebarView('outline'); break;
    case 'view.terminal': a.setPanelVisible(p => !p); break;
    case 'view.toggleSidebar': a.setSidebarView(v => v ? '' : 'explorer'); break;
    case 'view.splitEditor': a.setSplitMode(p => !p); break;
    case 'view.toggleWordWrap': emitLoomEvent('loom:setting-change', { key: 'editor.wordWrap', value: 'toggle' }); break;
    case 'ai.toggle': a.setAiOpen(p => !p); break;
    case 'editor.undo': emitLoomEvent('loom:editor-action', { action: 'undo' }); break;
    case 'editor.redo': emitLoomEvent('loom:editor-action', { action: 'redo' }); break;
    case 'editor.find': emitLoomEvent('loom:editor-action', { action: 'find' }); break;
    case 'editor.replace': emitLoomEvent('loom:editor-action', { action: 'replace' }); break;
    case 'editor.goToDefinition': emitLoomEvent('loom:editor-action', { action: 'goToDefinition' }); break;
    case 'editor.peekDefinition': emitLoomEvent('loom:editor-action', { action: 'peekDefinition' }); break;
    case 'editor.findReferences': emitLoomEvent('loom:editor-action', { action: 'findReferences' }); break;
    case 'editor.rename': emitLoomEvent('loom:editor-action', { action: 'rename' }); break;
    case 'editor.format': emitLoomEvent('loom:editor-action', { action: 'format' }); break;
    case 'editor.toggleComment': emitLoomEvent('loom:editor-action', { action: 'toggleComment' }); break;
    case 'debug.start': if (s.isDebugging) a.addOutput(t('app.debugContinue')); else a.startDebug(); break;
    case 'debug.stop': a.stopDebug(); break;
    case 'debug.run': a.runCurrentFile(); break;
    case 'problems.next': emitLoomEvent('loom:problems-next', { dir: 1 }); break;
    case 'problems.prev': emitLoomEvent('loom:problems-next', { dir: -1 }); break;
    case 'settings.open': a.setSettingsOpen(true); break;
    case 'tab.next': a.cycleTabs(1); break;
    case 'tab.prev': a.cycleTabs(-1); break;
    default: break;
  }
}

export function useKeyboardShortcuts(actions: ShortcutActions, state: ShortcutState) {
  // 用户键位覆盖（settings.keybindings）
  const [overrides, setOverrides] = useState<KeybindingOverrides>({});

  useEffect(() => {
    window.loom?.settings?.getAll?.().then((s: any) => {
      if (s?.keybindings && typeof s.keybindings === 'object') {
        setOverrides(s.keybindings as KeybindingOverrides);
      }
    }).catch(() => {});
    return onLoomEvent('loom:setting-change', ({ key, value }) => {
      if (key === 'keybindings' && value && typeof value === 'object') {
        setOverrides(value as KeybindingOverrides);
      }
    });
  }, []);

  useEffect(() => {
    const resolved = resolveKeybindings(overrides);

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || (e as any).keyCode === 229) return;

      const target = e.target as HTMLElement | null;
      const inInput = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true
      );

      const id = matchKeybinding(e, resolved);
      if (!id) return;
      if (inInput && !INPUT_SAFE_IDS.has(id)) return;

      e.preventDefault();
      dispatchAction(id, actions, state);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, state, overrides]);
}

export { resolveKeybindings };
export type { KeybindingId, KeybindingOverrides };
