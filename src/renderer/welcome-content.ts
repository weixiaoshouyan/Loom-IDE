import { t } from '@/shared/i18n';

export interface WelcomeAction {
  id: 'newFile' | 'openFile' | 'openFolder' | 'settings';
  label: string;
  detail: string;
  shortcut: string[];
}

export interface WelcomeShortcut {
  key: string;
  label: string;
}

export function getWelcomeActions(): WelcomeAction[] {
  return [
    { id: 'newFile', label: t('welcome.newFile'), detail: t('welcome.newFileDetail'), shortcut: ['Ctrl', 'N'] },
    { id: 'openFile', label: t('welcome.openFile'), detail: t('welcome.openFileDetail'), shortcut: ['Ctrl', 'O'] },
    { id: 'openFolder', label: t('welcome.openFolder'), detail: t('welcome.openFolderDetail'), shortcut: ['Ctrl', 'Shift', 'O'] },
    { id: 'settings', label: t('welcome.openSettings'), detail: t('welcome.openSettingsDetail'), shortcut: ['Ctrl', ','] },
  ];
}

export function getWelcomeShortcuts(): WelcomeShortcut[] {
  return [
    { key: 'Ctrl+Shift+P', label: t('welcome.commandPalette') },
    { key: 'Ctrl+P', label: t('welcome.quickOpen') },
    { key: 'Ctrl+K', label: t('welcome.inlineEdit') },
    { key: 'Ctrl+L', label: t('welcome.agentMode') },
    { key: 'Ctrl+Shift+F', label: t('welcome.globalSearch') },
    { key: 'Ctrl+`', label: t('welcome.toggleTerminal') },
  ];
}
