/**
 * App 级菜单与命令面板定义（从 App.tsx 拆出的模块）。
 *
 * 纯数据模块：所有副作用都以依赖注入的方式传入（actions/state setters），
 * 便于单独审查、测试与复用。App.tsx 只需一行调用即可获得完整菜单/命令。
 */
import type { OpenFile } from './App';
import { t } from '@/shared/i18n';
import { emitLoomEvent } from './loom-events';

export interface MenuItemDef {
  label?: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  action?: () => void;
}

export interface MenuGroupDef {
  label: string;
  items: MenuItemDef[];
}

export interface CommandDef {
  id: string;
  label: string;
  shortcut?: string;
  description?: string;
  action: () => void;
}

/** 构建菜单所需的外部依赖（App 注入） */
export interface AppMenuDeps {
  workspace: string;
  openFiles: OpenFile[];
  activeIdx: number;
  theme: 'dark' | 'light' | 'system';
  createUntitledFile: () => void;
  openFileFromDisk: () => void;
  openFolder: () => void;
  closeWorkspace: () => void;
  saveFile: () => void;
  saveAllFiles: () => void;
  closeTab: (idx: number) => void;
  closeOtherTabs: (idx: number) => void;
  closeAllTabs: () => void;
  startDebug: () => void;
  stopDebug: () => void;
  runCurrentFile: () => void;
  applyTheme: (t: 'dark' | 'light' | 'system') => void;
  addNotification: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void;
  setHistoryTarget: (path: string) => void;
  setSettingsOpen: (v: boolean) => void;
  setCmdPalette: (v: boolean) => void;
  setSidebarView: (v: string | ((prev: string) => string)) => void;
  setPanelVisible: (fn: (p: boolean) => boolean) => void;
  setSplitMode: (fn: (p: boolean) => boolean) => void;
}

export function buildMenuItems(d: AppMenuDeps): MenuGroupDef[] {
  return [
    {
      label: t('menu.file'),
      items: [
        { label: t('menu.fileNewFile'), shortcut: 'Ctrl+N', action: d.createUntitledFile },
        { label: t('menu.fileOpenFile'), shortcut: 'Ctrl+O', action: d.openFileFromDisk },
        { label: t('menu.fileOpenFolder'), shortcut: 'Ctrl+Shift+O', action: d.openFolder },
        { label: t('menu.fileCloseFolder'), action: d.closeWorkspace, disabled: !d.workspace },
        { separator: true, label: '' },
        { label: t('menu.fileSave'), shortcut: 'Ctrl+S', action: d.saveFile },
        { label: t('menu.fileSaveAll'), shortcut: 'Ctrl+Shift+S', action: d.saveAllFiles },
        { label: t('menu.fileReloadFile'), action: () => emitLoomEvent('loom:revert-file', undefined) },
        { label: t('menu.fileLocalHistory'), action: () => { const f = d.openFiles[d.activeIdx]; if (f?.path) d.setHistoryTarget(f.path); } },
        { separator: true, label: '' },
        { label: t('menu.fileCloseTab'), shortcut: 'Ctrl+W', action: () => { if (d.openFiles.length) d.closeTab(d.activeIdx); } },
        { label: t('menu.fileCloseOthers'), action: () => d.closeOtherTabs(d.activeIdx) },
        { label: t('menu.fileCloseAll'), action: d.closeAllTabs },
        { separator: true, label: '' },
        { label: t('menu.filePreferences'), shortcut: 'Ctrl+,', action: () => d.setSettingsOpen(true) },
        { separator: true, label: '' },
        { label: t('menu.fileExit'), action: () => window.loom?.window?.close?.() },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        { label: t('menu.editUndo'), shortcut: 'Ctrl+Z', action: () => { emitLoomEvent('loom:editor-action', { action: 'undo' }); } },
        { label: t('menu.editRedo'), shortcut: 'Ctrl+Y', action: () => { emitLoomEvent('loom:editor-action', { action: 'redo' }); } },
        { separator: true, label: '' },
        { label: t('menu.editFind'), shortcut: 'Ctrl+F', action: () => { emitLoomEvent('loom:editor-action', { action: 'find' }); } },
        { label: t('menu.editReplace'), shortcut: 'Ctrl+H', action: () => { emitLoomEvent('loom:editor-action', { action: 'replace' }); } },
        { separator: true, label: '' },
        { label: t('menu.editFindInFiles'), shortcut: 'Ctrl+Shift+F', action: () => d.setSidebarView('search') },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { label: t('menu.viewCommandPalette'), shortcut: 'Ctrl+Shift+P', action: () => d.setCmdPalette(true) },
        { label: t('menu.viewQuickOpen'), shortcut: 'Ctrl+P', action: () => d.setCmdPalette(true) },
        { separator: true, label: '' },
        { label: t('menu.viewExplorer'), shortcut: 'Ctrl+Shift+E', action: () => d.setSidebarView('explorer') },
        { label: t('menu.viewSearch'), shortcut: 'Ctrl+Shift+F', action: () => d.setSidebarView('search') },
        { label: t('menu.viewSourceControl'), shortcut: 'Ctrl+Shift+G', action: () => d.setSidebarView('git') },
        { label: t('menu.viewExtensions'), shortcut: 'Ctrl+Shift+X', action: () => d.setSidebarView('extensions') },
        { label: t('menu.viewOutline'), action: () => d.setSidebarView('outline') },
        { separator: true, label: '' },
        { label: t('menu.viewTerminal'), shortcut: 'Ctrl+`', action: () => d.setPanelVisible(p => !p) },
        { label: t('menu.viewToggleSidebar'), shortcut: 'Ctrl+B', action: () => d.setSidebarView(v => v ? '' : 'explorer') },
        { label: t('menu.viewSplitEditor'), shortcut: 'Ctrl+\\', action: () => d.setSplitMode(p => !p) },
        { separator: true, label: '' },
        { label: t('menu.viewToggleTheme'), action: () => { const next = d.theme === 'dark' ? 'light' : 'dark'; d.applyTheme(next); window.loom?.settings?.set?.('theme', next); } },
      ],
    },
    {
      label: t('menu.run'),
      items: [
        { label: t('menu.runStartDebug'), shortcut: 'F5', action: d.startDebug },
        { label: t('menu.runRunNoDebug'), shortcut: 'Ctrl+F5', action: d.runCurrentFile },
        { label: t('menu.runStopDebug'), shortcut: 'Shift+F5', action: d.stopDebug },
      ],
    },
    {
      label: t('menu.help'),
      items: [
        { label: t('menu.helpAbout'), action: () => d.addNotification(t('app.aboutMessage'), 'info', 6000) },
        { label: t('menu.helpKeymap'), action: () => d.setSettingsOpen(true) },
        {
          label: t('menu.helpCheckUpdates'),
          action: async () => {
            try {
              const res = await window.loom?.update?.check?.();
              if (!res?.ok) {
                if (res?.reason === 'not-configured') {
                  d.addNotification(t('app.updateNotConfigured'), 'info', 5000);
                } else {
                  d.addNotification(t('app.updateCheckFailed', { msg: res?.message || 'unknown' }), 'error', 5000);
                }
              } else if (res.hasUpdate) {
                d.addNotification(t('app.updateAvailable'), 'success', 8000);
              } else {
                d.addNotification(t('app.updateUpToDate', { version: res.current || '' }), 'info', 4000);
              }
            } catch {
              d.addNotification(t('app.updateCheckFailed', { msg: 'IPC failed' }), 'error', 5000);
            }
          },
        },
      ],
    },
  ];
}

/** 构建命令面板所需的外部依赖（App 注入） */
export interface AppCommandDeps {
  workspace: string;
  openFiles: OpenFile[];
  activeIdx: number;
  openFileFromDisk: () => void;
  openFolder: () => void;
  closeWorkspace: () => void;
  createUntitledFile: () => void;
  saveFile: () => void;
  saveAllFiles: () => void;
  runCurrentFile: () => void;
  addOrFocusFile: (path: string, content: string) => void;
  applyTheme: (t: 'dark' | 'light' | 'system') => void;
  addNotification: (msg: string, type?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void;
  setHistoryTarget: (path: string) => void;
  setSettingsOpen: (v: boolean) => void;
  setCmdPalette: (v: boolean) => void;
  setAiOpen: (fn: (p: boolean) => boolean) => void;
  setSidebarView: (v: string | ((prev: string) => string)) => void;
  setPanelVisible: (fn: (p: boolean) => boolean) => void;
  setSplitMode: (fn: (p: boolean) => boolean) => void;
}

export function buildCommands(d: AppCommandDeps): CommandDef[] {
  return [
    { id: 'file.open', label: t('command.fileOpen'), shortcut: 'Ctrl+O', action: d.openFileFromDisk },
    { id: 'folder.open', label: t('command.folderOpen'), shortcut: 'Ctrl+Shift+O', action: d.openFolder },
    { id: 'folder.close', label: t('command.folderClose'), action: d.closeWorkspace },
    { id: 'file.new', label: t('command.fileNew'), shortcut: 'Ctrl+N', action: d.createUntitledFile },
    { id: 'file.save', label: t('command.fileSave'), shortcut: 'Ctrl+S', action: d.saveFile },
    { id: 'file.saveAll', label: t('command.fileSaveAll'), shortcut: 'Ctrl+Shift+S', action: d.saveAllFiles },
    { id: 'view.explorer', label: t('command.viewExplorer'), shortcut: 'Ctrl+Shift+E', action: () => d.setSidebarView('explorer') },
    { id: 'view.search', label: t('command.viewSearch'), shortcut: 'Ctrl+Shift+F', action: () => d.setSidebarView('search') },
    { id: 'view.git', label: t('command.viewGit'), shortcut: 'Ctrl+Shift+G', action: () => d.setSidebarView('git') },
    { id: 'view.extensions', label: t('command.viewExtensions'), action: () => d.setSidebarView('extensions') },
    { id: 'view.outline', label: t('command.viewOutline'), action: () => d.setSidebarView('outline') },
    { id: 'view.terminal', label: t('command.viewTerminal'), shortcut: 'Ctrl+`', action: () => d.setPanelVisible(p => !p) },
    { id: 'view.sidebar', label: t('command.viewSidebar'), shortcut: 'Ctrl+B', action: () => d.setSidebarView(v => v ? '' : 'explorer') },
    { id: 'view.commandPalette', label: t('command.viewCommandPalette'), shortcut: 'Ctrl+Shift+P', action: () => d.setCmdPalette(true) },
    { id: 'view.splitEditor', label: t('command.viewSplitEditor'), shortcut: 'Ctrl+\\', action: () => d.setSplitMode(p => !p) },
    { id: 'ai.toggle', label: t('command.aiToggle'), action: () => d.setAiOpen(p => !p) },
    { id: 'settings.open', label: t('command.settingsOpen'), shortcut: 'Ctrl+,', action: () => d.setSettingsOpen(true) },
    { id: 'theme.dark', label: t('command.themeDark'), action: () => { d.applyTheme('dark'); window.loom?.settings?.set?.('theme', 'dark'); } },
    { id: 'theme.light', label: t('command.themeLight'), action: () => { d.applyTheme('light'); window.loom?.settings?.set?.('theme', 'light'); } },
    { id: 'theme.system', label: t('command.themeSystem'), action: () => { d.applyTheme('system'); window.loom?.settings?.set?.('theme', 'system'); } },
    { id: 'file.revert', label: t('command.fileRevert'), action: () => emitLoomEvent('loom:revert-file', undefined) },
    { id: 'file.history', label: t('command.fileHistory'), action: () => { const f = d.openFiles[d.activeIdx]; if (f?.path) d.setHistoryTarget(f.path); } },
    { id: 'editor.format', label: t('command.editorFormat'), shortcut: 'Shift+Alt+F', action: () => emitLoomEvent('loom:editor-action', { action: 'format' }) },
    { id: 'editor.comment', label: t('command.editorComment'), shortcut: 'Ctrl+/', action: () => emitLoomEvent('loom:editor-action', { action: 'toggleComment' }) },
    { id: 'debug.run', label: t('command.debugRun'), shortcut: 'Ctrl+F5', action: d.runCurrentFile },
    { id: 'workspace.rules', label: t('command.workspaceRules'), action: () => {
      if (!d.workspace) { d.addNotification(t('app.editRulesOpenWorkspaceFirst'), 'warning'); return; }
      const rulesPath = d.workspace.replace(/[\\/]/g, '/').replace(/\/$/, '') + '/.loomrules';
      window.loom.fs.exists(rulesPath).then(async (exists: boolean) => {
        if (!exists) {
          const defaultRules = `# Loom IDE Rules
# Add your project-specific instructions for AI here.
# These rules are included in every AI chat message.
`;
          await window.loom.fs.writeFile(rulesPath, defaultRules);
        }
        const content = await window.loom.fs.readFile(rulesPath);
        d.addOrFocusFile(rulesPath, content);
      }).catch(() => d.addNotification(t('app.editRulesCreateFailed'), 'error'));
    }},
  ];
}
