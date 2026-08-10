import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

/**
 * Modal diff view (Monaco diff editor). Shows original (HEAD/index) vs working
 * content of one file. Used by the Git panel; the editor is created on mount
 * and disposed on unmount so no model/listener leaks survive.
 */
export default function DiffViewModal({
  fileName,
  original,
  modified,
  language,
  onClose,
}: {
  fileName: string;
  original: string;
  modified: string;
  language?: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark';
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      theme,
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 12,
    });
    editorRef.current = editor;
    const originalModel = monaco.editor.createModel(original, language || 'plaintext');
    const modifiedModel = monaco.editor.createModel(modified, language || 'plaintext');
    editor.setModel({ original: originalModel, modified: modifiedModel });
    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once semantics
  }, []);

  // Esc closes the modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="diff-modal-overlay" onClick={onClose} role="presentation">
      <div className="diff-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Diff: ${fileName}`}>
        <div className="diff-modal-header">
          <span className="diff-modal-title" title={fileName}>{fileName}</span>
          <button type="button" className="diff-modal-close" onClick={onClose} aria-label="Close diff">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="diff-modal-body">
          <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  );
}
