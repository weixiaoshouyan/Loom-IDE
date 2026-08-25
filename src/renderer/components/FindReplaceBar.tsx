import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import { t } from '@/shared/i18n';

const WORD_SEP = '~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?\n\t';

export default function FindReplaceBar({ editor, locale }: { editor: monaco.editor.IStandaloneCodeEditor | null; locale?: 'zh-CN' | 'en-US' }) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    // VS Code 语义：打开查找时用当前选区初始化查找词
    const selection = editor?.getSelection();
    const selectedText = selection && !selection.isEmpty()
      ? editor!.getModel()?.getValueInRange(selection) ?? ''
      : '';
    if (selectedText && selectedText.trim() && selectedText.length <= 200) {
      setFindText(selectedText);
    }
    setTimeout(() => findInputRef.current?.focus(), 30);
  }, [editor]);

  useEffect(() => {
    if (!editor || !findText) {
      decorationsRef.current = editor?.deltaDecorations(decorationsRef.current, []) || [];
      setMatchCount(0); setCurrentMatch(0); return;
    }
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord ? WORD_SEP : null, false);
    setMatchCount(matches.length);
    setCurrentMatch(matches.length > 0 ? 1 : 0);
    const newDecorations = matches.map((m: any) => ({
      range: m.range,
      options: { inlineClassName: 'search-highlight-match', stickiness: 1 },
    }));
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    if (matches.length > 0) editor.revealRangeInCenter(matches[0]!.range);
  }, [findText, matchCase, wholeWord, useRegex, editor]);

  // 重新计算匹配并根据当前光标/选区同步高亮与 “当前/总数” 计数
  const refreshMatches = useCallback(() => {
    if (!editor || !findText) { setMatchCount(0); setCurrentMatch(0); return; }
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord ? WORD_SEP : null, false);
    setMatchCount(matches.length);
    const newDecorations = matches.map((m) => ({
      range: m.range,
      options: { inlineClassName: 'search-highlight-match', stickiness: 1 },
    }));
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    if (matches.length === 0) { setCurrentMatch(0); return; }
    const sel = editor.getSelection();
    const pos = sel ? sel.getStartPosition() : null;
    let idx = pos ? matches.findIndex(m => m.range.getStartPosition().equals(pos)) : -1;
    if (idx < 0 && pos) idx = matches.findIndex(m => pos.isBeforeOrEqual(m.range.getStartPosition()));
    if (idx < 0) idx = 0;
    setCurrentMatch(idx + 1);
  }, [editor, findText, useRegex, matchCase, wholeWord]);

  // 自行计算上/下一个匹配，保证选区跳转与计数联动
  const navigate = useCallback((dir: 1 | -1) => {
    if (!editor || !findText) return;
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord ? WORD_SEP : null, false);
    setMatchCount(matches.length);
    if (matches.length === 0) { setCurrentMatch(0); return; }
    const sel = editor.getSelection();
    const pos = sel ? sel.getStartPosition() : (editor.getPosition() || matches[0]!.range.getStartPosition());
    const curIdx = matches.findIndex(m => m.range.getStartPosition().equals(pos));
    let nextIdx: number;
    if (dir === 1) {
      if (curIdx >= 0) nextIdx = (curIdx + 1) % matches.length;
      else { const f = matches.findIndex(m => pos.isBefore(m.range.getStartPosition())); nextIdx = f >= 0 ? f : 0; }
    } else {
      if (curIdx >= 0) nextIdx = (curIdx - 1 + matches.length) % matches.length;
      else {
        let f = -1;
        for (let k = matches.length - 1; k >= 0; k--) { if (matches[k]!.range.getStartPosition().isBefore(pos)) { f = k; break; } }
        nextIdx = f >= 0 ? f : matches.length - 1;
      }
    }
    const target = matches[nextIdx]!;
    editor.setSelection(target.range);
    editor.revealRangeInCenter(target.range);
    setCurrentMatch(nextIdx + 1);
  }, [editor, findText, useRegex, matchCase, wholeWord]);

  const findNext = useCallback(() => navigate(1), [navigate]);
  const findPrev = useCallback(() => navigate(-1), [navigate]);

  const replaceOne = useCallback(() => {
    if (!editor || !findText) return;
    const model = editor.getModel();
    if (!model) return;
    const selection = editor.getSelection();
    if (!selection) return;
    const pos = selection.getStartPosition();
    const text = model.getValueInRange(selection);
    if (text.length === 0) {
      const fromPos = pos;
      const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord ? WORD_SEP : null, false);
      const nextMatch = matches.find(m => fromPos.isBeforeOrEqual(m.range.getStartPosition()));
      if (nextMatch) {
        model.pushEditOperations([], [{ range: nextMatch.range, text: replaceText }], () => null);
        editor.setSelection(nextMatch.range.collapseToStart());
      }
    } else {
      model.pushEditOperations([], [{ range: selection, text: replaceText }], () => null);
      editor.setSelection(selection.collapseToStart());
    }
    refreshMatches();
  }, [editor, findText, replaceText, matchCase, wholeWord, useRegex, refreshMatches]);

  const replaceAll = useCallback(() => {
    if (!editor || !findText) return;
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord ? WORD_SEP : null, false);
    if (matches.length === 0) return;
    const edits = matches.slice().reverse().map(m => ({ range: m.range, text: replaceText }));
    model.pushEditOperations([], edits, () => null);
    refreshMatches();
  }, [editor, findText, replaceText, matchCase, wholeWord, useRegex, refreshMatches]);

  const close = useCallback(() => {
    decorationsRef.current = editor?.deltaDecorations(decorationsRef.current, []) || [];
    setFindText(''); setReplaceText(''); setShowReplace(false);
    editor?.focus();
  }, [editor]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.ctrlKey && e.key === 'h') { e.preventDefault(); setShowReplace(p => !p); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close]);

  return (
    <div className="find-replace-bar">
      <div className="find-row">
        <input ref={findInputRef} className="find-input" placeholder={t('find.findPlaceholder')} value={findText}
          onChange={e => setFindText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { (e.shiftKey ? findPrev : findNext)(); } }} />
        <span className="find-count" style={{ color: findText ? (matchCount > 0 ? 'var(--text-primary)' : 'var(--red)') : 'var(--text-muted)' }}>
          {findText ? `${currentMatch}/${matchCount}` : ''}
        </span>
        <button className={`find-btn ${matchCase ? 'active' : ''}`} onClick={() => setMatchCase(!matchCase)} title={t('find.matchCase')} aria-label={t('find.matchCase')}>Aa</button>
        <button className={`find-btn ${wholeWord ? 'active' : ''}`} onClick={() => setWholeWord(!wholeWord)} title={t('find.wholeWord')} aria-label={t('find.wholeWord')}>ab</button>
        <button className={`find-btn ${useRegex ? 'active' : ''}`} onClick={() => setUseRegex(!useRegex)} title={t('find.regex')} aria-label={t('find.regex')}>.*</button>
        <button className="find-btn" onClick={findPrev} title={t('find.previous')} aria-label={t('find.previous')}><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
        <button className="find-btn" onClick={findNext} title={t('find.next')} aria-label={t('find.next')}><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
        <button className="find-btn" onClick={close} title={t('find.close')} aria-label={t('find.close')}><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg></button>
      </div>
      {showReplace && (
        <div className="find-row">
          <input className="find-input" placeholder={t('find.replacePlaceholder')} value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') replaceOne(); }} />
          <button className="find-btn" onClick={replaceOne} title={t('find.replaceOne')} aria-label={t('find.replaceOne')} style={{ fontSize: 11 }}>1</button>
          <button className="find-btn" onClick={replaceAll} title={t('find.replaceAll')} aria-label={t('find.replaceAll')} style={{ fontSize: 11 }}>{t('find.replaceAll')}</button>
        </div>
      )}
    </div>
  );
}
