/**
 * useKeyboardShortcuts — global keyboard shortcut handler extracted from App.tsx.
 *
 * Registers a single `keydown` listener that handles all IDE-level shortcuts
 * (file ops, view toggles, editor actions, debugger). Editor-specific actions
 * are dispatched via CustomEvent so the Editor component can handle them.
 */
import { useEffect } from 'react';
import { t } from '@/shared/i18n';

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
}

export interface ShortcutState {
  openFilesCount: number;
  activeIdx: number;
  isDebugging: boolean;
}

export function useKeyboardShortcuts(actions: ShortcutActions, state: ShortcutState) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip during IME composition
      if (e.isComposing || (e as any).keyCode === 229) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // File operations
      if (ctrl && !e.shiftKey && !e.altKey && key === 's') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:format-and-save', { detail: { all: false } })); return; }
      if (ctrl && e.shiftKey && key === 's') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:format-and-save', { detail: { all: true } })); return; }
      if (ctrl && !e.shiftKey && key === 'n') { e.preventDefault(); actions.createUntitledFile(); return; }
      if (ctrl && !e.shiftKey && key === 'w') { e.preventDefault(); if (state.openFilesCount) actions.closeTab(state.activeIdx); return; }
      if (ctrl && !e.shiftKey && key === 'o') { e.preventDefault(); actions.openFileFromDisk(); return; }
      if (ctrl && e.shiftKey && key === 'o') { e.preventDefault(); actions.openFolder(); return; }
      // Quick Open (Ctrl+P) — always opens (never toggles) the command palette.
      if (ctrl && !e.shiftKey && key === 'p') { e.preventDefault(); actions.setCmdPalette(() => true); return; }
      if (ctrl && e.shiftKey && key === 'p') { e.preventDefault(); actions.setCmdPalette(p => !p); return; }
      if (ctrl && e.shiftKey && key === 'e') { e.preventDefault(); actions.setSidebarView('explorer'); return; }
      if (ctrl && e.shiftKey && key === 'f') { e.preventDefault(); actions.setSidebarView('search'); return; }
      if (ctrl && e.shiftKey && key === 'g') { e.preventDefault(); actions.setSidebarView('git'); return; }
      if (ctrl && e.shiftKey && key === 'x') { e.preventDefault(); actions.setSidebarView('extensions'); return; }
      if (ctrl && key === 'b') { e.preventDefault(); actions.setSidebarView(v => v ? '' : 'explorer'); return; }
      if (ctrl && key === '`') { e.preventDefault(); actions.setPanelVisible(p => !p); return; }
      if (ctrl && key === '\\') { e.preventDefault(); actions.setSplitMode(p => !p); return; }
      if (ctrl && key === ',') { e.preventDefault(); actions.setSettingsOpen(true); return; }

      // Editor actions dispatched to active editor
      if (e.altKey && key === 'z') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'editor.wordWrap', value: 'toggle' } }));
        return;
      }
      if (!ctrl && !e.altKey && key === 'f12') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'goToDefinition' } })); return; }
      if (e.altKey && key === 'f12') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'peekDefinition' } })); return; }
      if (e.shiftKey && key === 'f12') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'findReferences' } })); return; }
      if (!ctrl && !e.altKey && !e.shiftKey && key === 'f2') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'rename' } })); return; }
      if (e.shiftKey && e.altKey && key === 'f') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'format' } })); return; }
      if (ctrl && key === '/') { e.preventDefault(); window.dispatchEvent(new CustomEvent('loom:editor-action', { detail: { action: 'toggleComment' } })); return; }

      // Debugger
      if (!ctrl && !e.altKey && !e.shiftKey && key === 'f5') { e.preventDefault(); if (state.isDebugging) actions.addOutput(t('app.debugContinue')); else actions.startDebug(); return; }
      if (e.shiftKey && !ctrl && !e.altKey && key === 'f5') { e.preventDefault(); actions.stopDebug(); return; }
      if (ctrl && e.shiftKey && key === 'f5') { e.preventDefault(); actions.stopDebug(); setTimeout(() => actions.startDebug(), 100); return; }
      if (ctrl && !e.shiftKey && !e.altKey && key === 'f5') { e.preventDefault(); actions.runCurrentFile(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, state]);
}
