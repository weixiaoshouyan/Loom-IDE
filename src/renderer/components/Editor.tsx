import React, { useRef, useEffect, useCallback, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { OpenFile } from '../App';
import WelcomePage from './WelcomePage';
import InlineAIEdit from './InlineAIEdit';

// Monaco worker setup
(window as any).MonacoEnvironment = {
  getWorker(_: any, label: string) {
    const getModule = (url: string) => new Worker(new URL(url, import.meta.url), { type: 'module' });
    switch (label) {
      case 'json': return getModule('monaco-editor/esm/vs/language/json/json.worker?worker');
      case 'css': case 'scss': case 'less': return getModule('monaco-editor/esm/vs/language/css/css.worker?worker');
      case 'html': case 'handlebars': case 'razor': return getModule('monaco-editor/esm/vs/language/html/html.worker?worker');
      case 'typescript': case 'javascript': return getModule('monaco-editor/esm/vs/language/typescript/ts.worker?worker');
      default: return getModule('monaco-editor/esm/vs/editor/editor.worker?worker');
    }
  },
};

// Configure TypeScript/JavaScript IntelliSense
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2022,
  allowNonTsExtensions: true,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  noEmit: true,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  checkJs: false,
  strict: true,
  esModuleInterop: true,
});
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: [6133, 6192, 6196, 6198, 7027],
});
monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2022,
  allowNonTsExtensions: true,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  allowJs: true,
  checkJs: false,
});

interface Props {
  file: OpenFile | null;
  openFilePaths: string[];
  onContentChange: (path: string, content: string) => void;
  workspacePath?: string;
}

// Find/Replace bar
function FindReplaceBar({ editor }: { editor: monaco.editor.IStandaloneCodeEditor | null }) {
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

  useEffect(() => { setTimeout(() => findInputRef.current?.focus(), 50); }, []);

  useEffect(() => {
    if (!editor || !findText) {
      decorationsRef.current = editor?.deltaDecorations(decorationsRef.current, []) || [];
      setMatchCount(0); setCurrentMatch(0); return;
    }
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord, false);
    setMatchCount(matches.length);
    setCurrentMatch(matches.length > 0 ? 1 : 0);
    const newDecorations = matches.map((m: any) => ({
      range: m.range,
      options: { inlineClassName: 'search-highlight-match', stickiness: 1 },
    }));
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    if (matches.length > 0) editor.revealRangeInCenter(matches[0].range);
  }, [findText, matchCase, wholeWord, useRegex, editor]);

  const findNext = useCallback(() => {
    if (!editor || !findText) return;
    editor.getAction('editor.action.nextMatchFindAction')?.run();
  }, [editor, findText]);

  const findPrev = useCallback(() => {
    if (!editor || !findText) return;
    editor.getAction('editor.action.previousMatchFindAction')?.run();
  }, [editor, findText]);

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
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord, false);
      const nextMatch = matches.find(m => m.range.getStartPosition().isAfterOrEqual(fromPos));
      if (nextMatch) {
        model.pushEditOperations([], [{ range: nextMatch.range, text: replaceText }], () => null);
        editor.setSelection(nextMatch.range.collapseToStart());
      }
    } else {
      model.pushEditOperations([], [{ range: selection, text: replaceText }], () => null);
      editor.setSelection(selection.collapseToStart());
    }
  }, [editor, findText, replaceText, matchCase, wholeWord, useRegex]);

  const replaceAll = useCallback(() => {
    if (!editor || !findText) return;
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(findText, false, useRegex, matchCase, wholeWord, false);
    if (matches.length === 0) return;
    const edits = matches.slice().reverse().map(m => ({ range: m.range, text: replaceText }));
    model.pushEditOperations([], edits, () => null);
  }, [editor, findText, replaceText, matchCase, wholeWord, useRegex]);

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
        <input ref={findInputRef} className="find-input" placeholder="Find" value={findText}
          onChange={e => setFindText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.shiftKey ? findPrev() : findNext(); } }} />
        <span className="find-count" style={{ color: findText ? (matchCount > 0 ? 'var(--text-primary)' : 'var(--red)') : 'var(--text-muted)' }}>
          {findText ? `${currentMatch}/${matchCount}` : ''}
        </span>
        <button className={`find-btn ${matchCase ? 'active' : ''}`} onClick={() => setMatchCase(!matchCase)} title="Match Case">Aa</button>
        <button className={`find-btn ${wholeWord ? 'active' : ''}`} onClick={() => setWholeWord(!wholeWord)} title="Whole Word">ab</button>
        <button className={`find-btn ${useRegex ? 'active' : ''}`} onClick={() => setUseRegex(!useRegex)} title="Regex">.*</button>
        <button className="find-btn" onClick={findPrev} title="Previous"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
        <button className="find-btn" onClick={findNext} title="Next"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></button>
        <button className="find-btn" onClick={close} title="Close"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg></button>
      </div>
      {showReplace && (
        <div className="find-row">
          <input className="find-input" placeholder="Replace" value={replaceText}
            onChange={e => setReplaceText(e.target.value)} />
          <button className="find-btn" onClick={replaceOne} title="Replace" style={{ fontSize: 11 }}>1</button>
          <button className="find-btn" onClick={replaceAll} title="Replace All" style={{ fontSize: 11 }}>All</button>
        </div>
      )}
    </div>
  );
}

export default function Editor({ file, openFilePaths, onContentChange, workspacePath: wsPath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const viewStatesRef = useRef<Record<string, monaco.editor.ICodeEditorViewState | null>>({});
  const cbRef = useRef(onContentChange);
  const [showFind, setShowFind] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [editorReady, setEditorReady] = useState(false);
  const [showInlineAI, setShowInlineAI] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');
  useEffect(() => { cbRef.current = onContentChange; }, [onContentChange]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); setShowFind(p => !p); }
      if (e.ctrlKey && e.key === 'k' && !e.shiftKey && !e.altKey) { 
        e.preventDefault(); 
        if (editorRef.current?.hasTextFocus()) {
          setShowInlineAI(p => !p);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load recent folders for welcome page
  useEffect(() => {
    (window as any).loom?.recent?.getFolders?.().then((folders: string[]) => {
      setRecentFolders(folders || []);
    }).catch(() => {});
  }, []);

  // Sync workspace path
  useEffect(() => {
    setWorkspacePath(wsPath || '');
  }, [wsPath]);

  // Listen for settings changes
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { key, value } = e.detail;
      if (!editorRef.current) return;
      if (key === 'editor.wordWrap') editorRef.current.updateOptions({ wordWrap: value === 'on' ? 'on' : 'off' });
      if (key === 'editor.minimap') editorRef.current.updateOptions({ minimap: { enabled: value } });
      if (key === 'editor.fontSize') editorRef.current.updateOptions({ fontSize: value });
      if (key === 'editor.lineNumbers') editorRef.current.updateOptions({ lineNumbers: value ? 'on' : 'off' });
      if (key === 'theme') {
        const isDark = value === 'dark';
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
      }
    };
    window.addEventListener('loom:setting-change' as any, handler);
    return () => window.removeEventListener('loom:setting-change' as any, handler);
  }, []);

  // Listen for go-to-line events (from Outline view)
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { line } = e.detail;
      const ed = editorRef.current;
      if (!ed || !line) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    };
    window.addEventListener('loom:go-to-line' as any, handler);
    return () => window.removeEventListener('loom:go-to-line' as any, handler);
  }, []);

  // Listen for editor actions (undo/redo/format/go to def from menu)
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { action } = e.detail;
      const ed = editorRef.current;
      if (!ed) return;
      if (action === 'undo') ed.trigger('keyboard', 'undo', null);
      if (action === 'redo') ed.trigger('keyboard', 'redo', null);
      if (action === 'format') ed.getAction('editor.action.formatDocument')?.run();
      if (action === 'goToDefinition') ed.getAction('editor.action.revealDefinition')?.run();
      if (action === 'findReferences') ed.getAction('editor.action.referenceSearch.trigger')?.run();
      if (action === 'rename') ed.getAction('editor.action.rename')?.run();
      if (action === 'peekDefinition') ed.getAction('editor.action.peekDefinition')?.run();
      if (action === 'toggleComment') ed.getAction('editor.action.commentLine')?.run();
      if (action === 'toggleBlockComment') ed.getAction('editor.action.blockComment')?.run();
      if (action === 'find') { setShowFind(true); }
      if (action === 'replace') { setShowFind(true); }
    };
    window.addEventListener('loom:editor-action' as any, handler);
    return () => window.removeEventListener('loom:editor-action' as any, handler);
  }, []);

  // Create Monaco editor - always keep it alive
  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: '', language: 'plaintext', theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark',
      fontSize: 14, fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      minimap: { enabled: true, scale: 1, showSlider: 'mouseover' },
      scrollBeyondLastLine: false, automaticLayout: true,
      lineNumbers: 'on', renderWhitespace: 'selection', tabSize: 2,
      wordWrap: 'off', smoothScrolling: true, cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
      matchBrackets: 'always',
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoSurround: 'languageDefined',
      padding: { top: 4 },
      folding: true, foldingStrategy: 'auto',
      showFoldingControls: 'mouseover',
      renderLineHighlight: 'all',
      occurrencesHighlight: 'singleFile',
      selectionHighlight: true,
      links: true,
      colorDecorators: true,
      contextmenu: true,
      mouseWheelZoom: true,
      suggest: { showKeywords: true, showSnippets: true, showMethods: true, showFunctions: true, showConstructors: true, showFields: true, showVariables: true, showClasses: true, showStructs: true, showInterfaces: true, showModules: true, showProperties: true, showEvents: true, showOperators: true, showUnits: true, showValues: true, showConstants: true, showEnums: true, showEnumMembers: true, showText: true, showColors: true, showFiles: true, showReferences: true, showFolders: true, showTypeParameters: true, showIssues: true, preview: true, previewMode: 'subwordSmart' },
      quickSuggestions: { other: true, comments: true, strings: true },
      guides: { indentation: true, bracketPairs: true, bracketPairsHorizontal: true, highlightActiveIndentation: true },
      renderLineHighlightOnlyWhenFocus: false,
      cursorBlinking: 'blink',
      fontLigatures: true,
      glyphMargin: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      stickyScroll: { enabled: true },
      inlayHints: { enabled: 'on' },
      parameterHints: { enabled: true, cycle: true },
      lightbulb: { enabled: 'on' },
      codeLens: true,
    });
    editor.onDidChangeCursorPosition((e) => {
      window.dispatchEvent(new CustomEvent('loom:cursor-change', { detail: { line: e.position.lineNumber, column: e.position.column } }));
    });
    editorRef.current = editor;
    setEditorReady(true);
    return () => { editor.dispose(); editorRef.current = null; };
  }, []);

  // Forward Monaco diagnostics to Problems panel
  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    const disposable = monaco.editor.onDidChangeMarkers((uris) => {
      const problems: { severity: string; message: string; file?: string; line?: number }[] = [];
      for (const uri of uris) {
        const markers = monaco.editor.getModelMarkers({ resource: uri });
        for (const m of markers) {
          const severity = m.severity === monaco.MarkerSeverity.Error ? 'error'
            : m.severity === monaco.MarkerSeverity.Warning ? 'warning' : 'info';
          problems.push({ severity, message: m.message, file: uri.fsPath, line: m.startLineNumber });
        }
      }
      window.dispatchEvent(new CustomEvent('loom:diagnostics', { detail: problems }));
    });
    return () => disposable.dispose();
  }, [editorReady]);

  // Switch model when file changes
  useEffect(() => {
    if (!editorRef.current) return;
    if (prevPathRef.current) viewStatesRef.current[prevPathRef.current] = editorRef.current.saveViewState();
    if (!file) { prevPathRef.current = null; return; }
    const uri = monaco.Uri.file(file.path);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(file.content, file.language, uri);
      model.onDidChangeContent(() => { if (model) cbRef.current(file.path, model.getValue()); });
    } else if (model.getValue() !== file.content) {
      model.setValue(file.content);
    }
    editorRef.current.setModel(model);
    const saved = viewStatesRef.current[file.path];
    if (saved) editorRef.current.restoreViewState(saved);
    editorRef.current.focus();
    prevPathRef.current = file.path;
  }, [file]);

  // Clean up models for closed files
  useEffect(() => {
    const open = new Set(openFilePaths);
    monaco.editor.getModels().forEach(m => {
      if (m.uri.scheme === 'file' && !open.has(m.uri.fsPath)) {
        m.dispose();
        delete viewStatesRef.current[m.uri.fsPath];
      }
    });
  }, [openFilePaths]);

  return (
    <>
      {showFind && <FindReplaceBar editor={editorRef.current} />}
      {showInlineAI && <InlineAIEdit editorRef={editorRef} workspacePath={workspacePath} onClose={() => setShowInlineAI(false)} />}
      <div className="editor-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {!file && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-editor)', zIndex: 1, overflow: 'auto' }}>
            <WelcomePage 
              onOpenFile={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openFile' }))}
              onOpenFolder={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openFolder' }))}
              onNewFile={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'newFile' }))}
              onOpenSettings={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openSettings' }))}
            />
          </div>
        )}
      </div>
    </>
  );
}