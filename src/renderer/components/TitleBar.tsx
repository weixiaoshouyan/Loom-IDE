import React from 'react';

interface Props {
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

export default function TitleBar({ onOpenFile, onOpenFolder }: Props) {
  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <span className="title-bar-logo">⬡</span>
        <span className="title-bar-title">织网 IDE</span>
      </div>
      <div className="title-bar-menu">
        <button className="menu-item" onClick={onOpenFile}>文件</button>
        <button className="menu-item" onClick={onOpenFolder}>打开文件夹</button>
      </div>
    </div>
  );
}
