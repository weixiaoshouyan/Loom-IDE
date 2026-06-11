/**
 * Inline AI Edit — Cursor-style Cmd+K inline code editing
 * Opens a floating input bar to ask AI to edit selected code or generate new code inline
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  editorRef: React.MutableRefObject<any>; // Monaco editor ref
  workspacePath: string;
  onClose: () => void;
}

export default function InlineAIEdit({ editorRef, workspacePath, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [mode, setMode] = useState<'prompt' | 'streaming' | 'result'>('prompt');
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const getSelectedCode = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return '';
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      // Get current line if nothing selected
      const model = editor.getModel();
      if (!model) return '';
      const position = editor.getPosition();
      if (!position) return '';
      const lineContent = model.getLineContent(position.lineNumber);
      return lineContent;
    }
    return editor.getModel()?.getValueInRange(selection) || '';
  }, [editorRef]);

  const getLanguage = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return 'plaintext';
    const model = editor.getModel();
    if (!model) return 'plaintext';
    return model.getLanguageId();
  }, [editorRef]);

  const handleSubmit = useCallback(() => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setMode('streaming');
    setResponse('');

    const code = getSelectedCode();
    const lang = getLanguage();
    
    const fullPrompt = `Edit the following ${lang} code according to this instruction: "${prompt.trim()}"

\`\`\`${lang}
${code}
\`\`\`

Return ONLY the edited code in a code block with the language marker. Do not include any explanation unless I ask for it.`;

    let content = '';
    const abort = (window as any).loom.ai.chatStream(
      [{ role: 'user', content: fullPrompt }],
      workspacePath,
      (chunk: string) => {
        content += chunk;
        setResponse(content);
      },
      () => {
        setLoading(false);
        setMode('result');
        abortRef.current = null;
      },
      (err: any) => {
        setResponse(`Error: ${err.message}`);
        setLoading(false);
        setMode('result');
        abortRef.current = null;
      }
    );
    abortRef.current = abort;
  }, [prompt, loading, getSelectedCode, getLanguage, workspacePath]);

  const extractCodeFromResponse = (text: string): string => {
    // Extract code from markdown code blocks
    const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    // If no code block, return the raw text
    return text.trim();
  };

  const handleApply = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const code = extractCodeFromResponse(response);
    if (!code) return;

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      // Replace current line
      const model = editor.getModel();
      if (!model) return;
      const position = editor.getPosition();
      if (!position) return;
      const lineCount = model.getLineCount();
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: model.getLineMaxColumn(position.lineNumber),
      };
      editor.executeEdits('inline-ai', [{ range, text: code }]);
    } else {
      editor.executeEdits('inline-ai', [{ range: selection, text: code }]);
    }
    onClose();
    window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: 'Inline edit applied ✓', type: 'success' } }));
  }, [response, editorRef, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'prompt') handleSubmit();
      else if (mode === 'result') handleApply();
    }
    if (e.key === 'Escape') {
      if (mode === 'streaming') {
        abortRef.current?.();
        abortRef.current = null;
        setLoading(false);
        setMode('result');
      } else {
        onClose();
      }
    }
  };

  return (
    <div className="inline-ai-edit-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inline-ai-edit">
        {/* Prompt mode */}
        {mode === 'prompt' && (
          <div className="inline-ai-prompt">
            <span className="inline-ai-icon">✨</span>
            <input
              ref={inputRef}
              className="inline-ai-input"
              placeholder="Describe the change you want to make... (e.g., 'add error handling', 'convert to async/await')"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button className="inline-ai-submit-btn" onClick={handleSubmit} disabled={!prompt.trim() || loading}>
              Edit
            </button>
            <button className="inline-ai-close-btn" onClick={onClose}>✕</button>
          </div>
        )}

        {/* Streaming mode */}
        {mode === 'streaming' && (
          <div className="inline-ai-streaming">
            <div className="inline-ai-streaming-header">
              <span className="inline-ai-icon">✨</span>
              <span>AI is generating code...</span>
              <div className="inline-ai-spinner">
                <span /><span /><span />
              </div>
              <button className="inline-ai-close-btn" onClick={() => { abortRef.current?.(); setMode('result'); }}>✕</button>
            </div>
            <div className="inline-ai-streaming-content">
              <pre><code>{response}</code></pre>
            </div>
          </div>
        )}

        {/* Result mode */}
        {mode === 'result' && (
          <div className="inline-ai-result">
            <div className="inline-ai-result-header">
              <span className="inline-ai-icon">✨</span>
              <span>AI suggestion</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
                (Enter to apply, Esc to discard)
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="inline-ai-apply-btn" onClick={handleApply}>✓ Apply</button>
                <button className="inline-ai-discard-btn" onClick={onClose}>✗ Discard</button>
              </div>
            </div>
            <div className="inline-ai-result-content">
              <pre><code>{extractCodeFromResponse(response)}</code></pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
