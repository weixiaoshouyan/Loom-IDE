/**
 * Inline AI Edit — Cursor-style Cmd+K inline code editing
 * 支持流式生成 + diff 预览 + 逐块接受/拒绝，避免直接覆盖原代码。
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { t } from '@/shared/i18n';
import { getLoom } from '../loom-ipc';

interface Props {
  editorRef: React.MutableRefObject<any>;
  workspacePath: string;
  onClose: () => void;
}

type Mode = 'prompt' | 'streaming' | 'diff';

// ===== Line-by-line diff =====
// 简化的 LCS diff：把原始与建议按行对比，生成三种行类型：
//   - 'same'  两边都有（不变）
//   - 'del'   原始有、建议无（删除）
//   - 'add'   原始无、建议有（新增）
// 连续的 del/add 块组成一个 hunk，可独立接受。
type DiffLine = { type: 'same' | 'del' | 'add'; text: string; origIdx?: number; newIdx?: number };
type DiffHunk = { startIdx: number; endIdx: number; accepted: boolean };

function computeDiff(original: string, suggested: string): DiffLine[] {
  const a = original.split('\n');
  const b = suggested.split('\n');
  // LCS 动态规划
  const m = a.length, n = b.length;
  // 大文件保护：超过 800 行直接按全替换处理，避免 O(n*m) 卡顿
  if (m > 800 || n > 800) {
    const lines: DiffLine[] = [];
    a.forEach(t => lines.push({ type: 'del', text: t }));
    b.forEach(t => lines.push({ type: 'add', text: t }));
    return lines;
  }
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // 回溯
  const lines: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lines.unshift({ type: 'same', text: a[i - 1], origIdx: i - 1, newIdx: j - 1 });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      lines.unshift({ type: 'del', text: a[i - 1], origIdx: i - 1 });
      i--;
    } else {
      lines.unshift({ type: 'add', text: b[j - 1], newIdx: j - 1 });
      j--;
    }
  }
  while (i > 0) { lines.unshift({ type: 'del', text: a[i - 1], origIdx: i - 1 }); i--; }
  while (j > 0) { lines.unshift({ type: 'add', text: b[j - 1], newIdx: j - 1 }); j--; }
  return lines;
}

// 把 diff 行划分成 hunks：每个 hunk 是连续的「del/add/same」组合，
// 纯 same 的连续段视为分隔。每个 hunk 可独立接受。
function buildHunks(diffLines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i].type === 'same') { i++; continue; }
    // 进入变更区
    const start = i;
    while (i < diffLines.length && diffLines[i].type !== 'same') i++;
    hunks.push({ startIdx: start, endIdx: i - 1, accepted: false });
  }
  return hunks;
}

export default function InlineAIEdit({ editorRef, workspacePath, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [mode, setMode] = useState<Mode>('prompt');
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const originalCodeRef = useRef<string>('');
  const selectionRangeRef = useRef<any>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const getSelectedCode = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return '';
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      const model = editor.getModel();
      if (!model) return '';
      const position = editor.getPosition();
      if (!position) return '';
      return model.getLineContent(position.lineNumber);
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
    originalCodeRef.current = code;
    // 保存选区范围，应用编辑时复用
    const editor = editorRef.current;
    if (editor) {
      const sel = editor.getSelection();
      if (sel && !sel.isEmpty()) {
        selectionRangeRef.current = sel;
      } else {
        // 无选区时记录当前行范围
        const model = editor.getModel();
        const pos = editor.getPosition();
        if (model && pos) {
          selectionRangeRef.current = {
            startLineNumber: pos.lineNumber,
            startColumn: 1,
            endLineNumber: pos.lineNumber,
            endColumn: model.getLineMaxColumn(pos.lineNumber),
          };
        }
      }
    }

    const lang = getLanguage();
    const fullPrompt = `Edit the following ${lang} code according to this instruction: "${prompt.trim()}"

\`\`\`${lang}
${code}
\`\`\`

Return ONLY the edited code in a single code block with the language marker. Do not include any explanation.`;

    let content = '';
    const abort = getLoom()?.ai?.chatStream?.(
      [{ role: 'user', content: fullPrompt }],
      workspacePath,
      (chunk: string) => {
        content += chunk;
        setResponse(content);
      },
      () => {
        setLoading(false);
        setMode('diff');
        abortRef.current = null;
      },
      (err: any) => {
        setResponse(`Error: ${err.message}`);
        setLoading(false);
        setMode('diff');
        abortRef.current = null;
      }
    );
    abortRef.current = abort ?? null;
  }, [prompt, loading, getSelectedCode, getLanguage, workspacePath, editorRef]);

  const extractCodeFromResponse = (text: string): string => {
    const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    return text.trim();
  };

  const diffLines = useMemo<DiffLine[]>(() => {
    if (mode !== 'diff') return [];
    const original = originalCodeRef.current;
    const suggested = extractCodeFromResponse(response);
    if (!suggested) return [];
    return computeDiff(original, suggested);
  }, [mode, response]);

  const [hunks, setHunks] = useState<DiffHunk[]>([]);
  useEffect(() => {
    if (mode === 'diff') setHunks(buildHunks(diffLines));
  }, [mode, diffLines]);

  const toggleHunk = useCallback((idx: number) => {
    setHunks(prev => prev.map((h, i) => i === idx ? { ...h, accepted: !h.accepted } : h));
  }, []);

  const acceptAll = useCallback(() => {
    setHunks(prev => prev.map(h => ({ ...h, accepted: true })));
  }, []);

  const rejectAll = useCallback(() => {
    setHunks(prev => prev.map(h => ({ ...h, accepted: false })));
  }, []);

  // 根据已接受的 hunks 生成最终代码：原始代码基础上，应用所有 accepted hunk 的变更
  const buildMergedCode = useCallback((): string => {
    const original = originalCodeRef.current;
    const suggested = extractCodeFromResponse(response);
    if (!suggested) return original;
    // 简单策略：若所有 hunk 都接受 → 用 suggested；若都不接受 → 用 original；
    // 部分接受 → 按 hunk 逐段拼接。
    if (hunks.length === 0) return original;
    const allAccepted = hunks.every(h => h.accepted);
    const noneAccepted = hunks.every(h => !h.accepted);
    if (allAccepted) return suggested;
    if (noneAccepted) return original;
    // 部分接受：按 diff 行重建
    const lines: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const dl = diffLines[i];
      // 找到该行所属 hunk
      const hunkIdx = hunks.findIndex(h => i >= h.startIdx && i <= h.endIdx);
      if (hunkIdx === -1) {
        // same 行：直接保留
        lines.push(dl.text);
      } else if (hunks[hunkIdx].accepted) {
        // 接受的 hunk：保留 add 行，跳过 del 行
        if (dl.type === 'add') lines.push(dl.text);
      } else {
        // 拒绝的 hunk：保留 del 行，跳过 add 行
        if (dl.type === 'del') lines.push(dl.text);
      }
    }
    return lines.join('\n');
  }, [hunks, response, diffLines]);

  const handleApply = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const code = buildMergedCode();
    const range = selectionRangeRef.current;
    if (!range) {
      editor.executeEdits('inline-ai', [{ range: editor.getSelection() || editor.getModel()?.getFullModelRange(), text: code }]);
    } else {
      editor.executeEdits('inline-ai', [{ range, text: code }]);
    }
    onClose();
    const acceptedCount = hunks.filter(h => h.accepted).length;
    const msg = hunks.length > 0
      ? t('inlineEdit.appliedHunks', { accepted: acceptedCount, total: hunks.length })
      : t('inlineEdit.appliedFallback');
    window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: msg, type: 'success' } }));
  }, [buildMergedCode, editorRef, onClose, hunks]);

  const stopStreaming = () => {
    if (abortRef.current) { abortRef.current(); abortRef.current = null; }
    setLoading(false);
    setMode('diff');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'prompt') handleSubmit();
      else if (mode === 'diff') handleApply();
    }
    if (e.key === 'Escape') {
      if (mode === 'streaming') {
        stopStreaming();
      } else {
        onClose();
      }
    }
  };

  // Diff 统计
  const diffStats = useMemo(() => {
    let added = 0, removed = 0;
    diffLines.forEach(l => { if (l.type === 'add') added++; else if (l.type === 'del') removed++; });
    return { added, removed };
  }, [diffLines]);

  const acceptedCount = hunks.filter(h => h.accepted).length;

  return (
    <div className="inline-ai-edit-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inline-ai-edit" onClick={e => e.stopPropagation()}>
        {mode === 'prompt' && (
          <div className="inline-ai-prompt">
            <span className="inline-ai-icon">✨</span>
            <input
              ref={inputRef}
              className="inline-ai-input"
              placeholder={t('inlineEdit.placeholder')}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              aria-label={t('inlineEdit.instructionAria')}
            />
            <button className="inline-ai-submit-btn" onClick={handleSubmit} disabled={!prompt.trim() || loading}>
              Edit
            </button>
            <button className="inline-ai-close-btn" onClick={onClose} aria-label={t('inlineEdit.closeAria')}>✕</button>
          </div>
        )}

        {mode === 'streaming' && (
          <div className="inline-ai-streaming">
            <div className="inline-ai-streaming-header">
              <span className="inline-ai-icon">✨</span>
              <span>{t('inlineEdit.generating')}</span>
              <div className="inline-ai-spinner">
                <span /><span /><span />
              </div>
              <button className="inline-ai-close-btn" onClick={stopStreaming} aria-label={t('inlineEdit.stopAria')}>✕</button>
            </div>
            <div className="inline-ai-streaming-content">
              <pre><code>{response}</code></pre>
            </div>
          </div>
        )}

        {mode === 'diff' && (
          <div className="inline-ai-diff">
            <div className="inline-ai-diff-header">
              <span className="inline-ai-icon">✨</span>
              <span>{t('inlineEdit.header')}</span>
              <span className="inline-ai-diff-stats">
                <span style={{ color: 'var(--green)' }}>+{diffStats.added}</span>
                <span style={{ color: 'var(--red)' }}>−{diffStats.removed}</span>
                {hunks.length > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    · {t('inlineEdit.hunksAcceptedCount', { accepted: acceptedCount, total: hunks.length })}
                  </span>
                )}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                {hunks.length > 0 && (
                  <>
                    <button
                      className="inline-ai-diff-btn"
                      onClick={acceptAll}
                      title={t('inlineEdit.acceptAllTitle')}
                      aria-label={t('inlineEdit.acceptAllAria')}
                    >{t('inlineEdit.acceptAll')}</button>
                    <button
                      className="inline-ai-diff-btn"
                      onClick={rejectAll}
                      title={t('inlineEdit.rejectAllTitle')}
                      aria-label={t('inlineEdit.rejectAllAria')}
                    >{t('inlineEdit.rejectAll')}</button>
                  </>
                )}
                <button className="inline-ai-discard-btn" onClick={onClose}>✗ {t('inlineEdit.cancel')}</button>
                <button
                  className="inline-ai-apply-btn"
                  onClick={handleApply}
                  disabled={hunks.length > 0 && acceptedCount === 0}
                  title={t('inlineEdit.applyTitle')}
                >✓ {t('inlineEdit.apply')}</button>
              </div>
            </div>
            <div className="inline-ai-diff-content" role="region" aria-label={t('inlineEdit.diffPreviewAria')}>
              {diffLines.length === 0 ? (
                <pre><code>{response}</code></pre>
              ) : (
                (() => {
                  let hunkIdx = 0;
                  return diffLines.map((dl, i) => {
                    // 检查是否是 hunk 边界，渲染 hunk 操作栏
                    const inHunk = hunks.some(h => i >= h.startIdx && i <= h.endIdx);
                    let hunkHeader: React.ReactNode = null;
                    if (inHunk && i === hunks[hunkIdx]?.startIdx) {
                      const h = hunks[hunkIdx];
                      hunkHeader = (
                        <div className="inline-ai-hunk-bar" key={`hunk-${hunkIdx}`}>
                          <button
                            className={`inline-ai-hunk-btn ${h.accepted ? 'accepted' : ''}`}
                            onClick={() => toggleHunk(hunkIdx)}
                            aria-label={h.accepted ? t('inlineEdit.markUnaccepted') : t('inlineEdit.markAccepted')}
                          >
                            {h.accepted ? `✓ ${t('inlineEdit.hunkAccepted')}` : t('inlineEdit.markAccepted')}
                          </button>
                        </div>
                      );
                      hunkIdx++;
                    }
                    const cls = dl.type === 'add' ? 'diff-add'
                              : dl.type === 'del' ? 'diff-del'
                              : 'diff-same';
                    const prefix = dl.type === 'add' ? '+' : dl.type === 'del' ? '−' : ' ';
                    // 若所属 hunk 已接受，del 行变暗；若已拒绝，add 行变暗
                    const hunkOfLine = hunks.find(h => i >= h.startIdx && i <= h.endIdx);
                    let dimmed = false;
                    if (hunkOfLine) {
                      if (hunkOfLine.accepted && dl.type === 'del') dimmed = true;
                      if (!hunkOfLine.accepted && dl.type === 'add') dimmed = true;
                    }
                    return (
                      <React.Fragment key={`line-${i}`}>
                        {hunkHeader}
                        <div className={`diff-line ${cls} ${dimmed ? 'dimmed' : ''}`}>
                          <span className="diff-line-prefix">{prefix}</span>
                          <span className="diff-line-text">{dl.text || ' '}</span>
                        </div>
                      </React.Fragment>
                    );
                  });
                })()
              )}
            </div>
            <div className="inline-ai-diff-footer">
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {t('inlineEdit.hint')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
