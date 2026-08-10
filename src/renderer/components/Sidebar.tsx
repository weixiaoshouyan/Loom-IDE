import React from 'react';
import SidebarExplorerView from './SidebarExplorerView';
import SidebarSearchView from './SidebarSearchView';
import SidebarGitView from './SidebarGitView';
import SidebarExtensionsView from './SidebarExtensionsView';
import { OutlineView } from './FileTree';
import Notepads from './Notepads';

interface Props {
  view: string;
  workspacePath: string;
  onOpenFile: (path: string, content: string) => void;
  onOpenFolder: () => void;
  onCloseFolder: () => void;
  selectedFile: string;
  sidebarWidth: number;
  gitStatusMap?: Record<string, string>;
  locale?: 'zh-CN' | 'en-US';
}

// ====== Main Sidebar ======
function Sidebar({ view, workspacePath, onOpenFile, onOpenFolder, onCloseFolder, selectedFile, sidebarWidth, gitStatusMap, locale = 'zh-CN' }: Props) {
  if (!view) return null;
  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      {view === 'explorer' && <SidebarExplorerView workspacePath={workspacePath} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} onCloseFolder={onCloseFolder} selectedFile={selectedFile} gitStatusMap={gitStatusMap} locale={locale} />}
      {view === 'search' && <SidebarSearchView workspacePath={workspacePath} onOpenFile={onOpenFile} locale={locale} />}
      {view === 'git' && <SidebarGitView workspacePath={workspacePath} onOpenFile={onOpenFile} locale={locale} />}
      {view === 'extensions' && <SidebarExtensionsView locale={locale} workspacePath={workspacePath} onOpenFile={onOpenFile} />}
      {view === 'outline' && (
        <>
          <div className="sidebar-header"><span>{locale === 'zh-CN' ? '代码大纲' : 'OUTLINE'}</span></div>
          <div className="sidebar-content">
            <OutlineView filePath={selectedFile} onOpenFile={onOpenFile} locale={locale} />
          </div>
        </>
      )}
      {view === 'notepads' && (
        <Notepads workspacePath={workspacePath} locale={locale} />
      )}
    </div>
  );
}

export default React.memo(Sidebar);
