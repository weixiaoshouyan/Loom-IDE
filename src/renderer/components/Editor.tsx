import React, { useRef, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import type { OpenFile } from '../App';

interface Props {
  file: OpenFile | null;
}

export default function Editor({ file }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    editorRef.current = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: 'vs-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      tabSize: 2,
      wordWrap: 'on',
    });
    return () => { editorRef.current?.dispose(); };
  }, []);

  useEffect(() => {
    if (!editorRef.current || !file) return;
    const model = monaco.editor.createModel(file.content, file.language);
    editorRef.current.setModel(model);
  }, [file]);

  if (!file) {
    return (
      <div className="editor-empty">
        <div className="editor-welcome">
          <h1>⬡ 织网 IDE</h1>
          <p>代码如丝，编织成网</p>
          <div className="welcome-actions">
            <p>Ctrl+O 打开文件 · Ctrl+K 打开文件夹</p>
          </div>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="editor-container" />;
}
