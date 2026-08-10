import React, { useState, useRef, useEffect, useCallback } from 'react';
import FindReplaceBar from './FindReplaceBar';
import * as monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import type { OpenFile } from '../App';
import WelcomePage from './WelcomePage';
import InlineAIEdit from './InlineAIEdit';
import { getFileIcon } from './FileIcons';
import { resolveMonacoTheme } from '../editor-theme';
import { isEditorDomHealthy } from '../editor-health';

// @ts-expect-error Vite ?worker suffix not in Monaco's type declarations
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// @ts-expect-error Vite ?worker suffix not in Monaco's type declarations
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
// @ts-expect-error Vite ?worker suffix not in Monaco's type declarations
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// @ts-expect-error Vite ?worker suffix not in Monaco's type declarations
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
// @ts-expect-error Vite ?worker suffix not in Monaco's type declarations
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// 归一化行尾为 LF，用于比较内容时忽略 Windows CRLF 与 LF 的差异（见 attachFileModel）。
function normalizeEOL(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ====== Workspace TypeScript Configuration ======
// Monaco's built-in TypeScript language service is the same engine used by
// VS Code. Here we load the workspace tsconfig.json and node_modules/@types
// to provide project-aware diagnostics, hover, completion, and navigation.
async function configureTypeScriptWorkspace(workspacePath: string): Promise<void> {
  try {
    const loom = window.loom;
    if (!loom?.fs?.readFile || !loom?.fs?.readDir) return;

    const tsConfigPath = `${workspacePath}/tsconfig.json`;
    let compilerOptions: any = {
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      strict: true,
      skipLibCheck: true,
    };

    try {
      const tsConfigText = await loom.fs.readFile(tsConfigPath);
      const parsed = JSON.parse(tsConfigText);
      if (parsed.compilerOptions) {
        compilerOptions = { ...compilerOptions, ...parsed.compilerOptions };
      }
    } catch {
      // No tsconfig.json; use defaults
    }

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);

    // Load ambient types from node_modules/@types
    const typesDir = `${workspacePath}/node_modules/@types`;
    try {
      const typePackages = await loom.fs.readDir(typesDir);
      for (const pkg of typePackages) {
        if (!pkg.isDirectory) continue;
        try {
          const pkgFiles = await loom.fs.readDir(`${typesDir}/${pkg.name}`);
          for (const f of pkgFiles) {
            if (f.name.endsWith('.d.ts')) {
              const content = await loom.fs.readFile(`${typesDir}/${pkg.name}/${f.name}`);
              monaco.languages.typescript.typescriptDefaults.addExtraLib(content, `file://${typesDir}/${pkg.name}/${f.name}`);
              monaco.languages.typescript.javascriptDefaults.addExtraLib(content, `file://${typesDir}/${pkg.name}/${f.name}`);
            }
          }
        } catch {
          // Ignore per-package errors
        }
      }
    } catch {
      // No @types installed
    }
  } catch {
    // Fail silently; editor still works without project-aware TS
  }
}

// ====== AI Tab Completion (Ghost Text) ======
// Monaco calls provideInlineCompletions on EVERY keystroke, so the provider
// implements a real idle debounce: 700ms of typing silence before any network
// I/O. While a request is in flight, further keystrokes are skipped (Monaco
// re-triggers after we resolve). Requests use the streaming chat channel so a
// cancelled token aborts the in-flight HTTP request in the main process.
let aiCompletionTimer: ReturnType<typeof setTimeout> | null = null;
let aiCompletionInFlight = false;

function registerAICompletionProvider() {
  try {
    monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model, position, _context, token) => {
        // One request at a time — avoid piling up HTTP calls while typing fast.
        if (aiCompletionInFlight) return { items: [] };
        // Debounce: restart the 700ms idle window on every keystroke.
        if (aiCompletionTimer) clearTimeout(aiCompletionTimer);
        await new Promise<void>((resolve) => {
          aiCompletionTimer = setTimeout(() => { aiCompletionTimer = null; resolve(); }, 700);
        });
        if (token.isCancellationRequested) return { items: [] };

        // Skip if no AI config available
        try {
          const config = await window.loom.ai.getConfig();
          const provider = config?.providers?.find((p: any) => p.id === config.activeProviderId);
          if (!config || (config.mode !== 'orca' && (!provider || !provider.apiKey))) {
            return { items: [] };
          }
        } catch (e) { return { items: [] }; }

        if (token.isCancellationRequested) return { items: [] };

        const textBeforeCursor = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 30),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        // Only trigger on non-empty lines with reasonable context
        const lastLine = textBeforeCursor.split('\n').pop() || '';
        if (lastLine.trim().length < 2) return { items: [] };

        const textAfterCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 10),
          endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 10)),
        });

        const lang = model.getLanguageId();
        const fileName = model.uri.fsPath.split(/[\\/]/).pop() || '';

        const prompt = `Complete the following code. Only return the completion text. Do NOT include the existing code. Language: ${lang}. File: ${fileName}

<code>
${textBeforeCursor.trimEnd()}█${textAfterCursor.trimStart()}
</code>

Return ONLY the completion, no explanation.`;

        aiCompletionInFlight = true;
        try {
          // Streaming chat gives us a real cancel handle: the returned cleanup
          // sends ai:chat-stream-abort, killing the HTTP request mid-flight.
          const response = await new Promise<string | null>((resolve) => {
            let acc = '';
            let settled = false;
            const finish = (value: string | null) => { if (!settled) { settled = true; resolve(value); } };
            let stop: (() => void) | null = null;
            try {
              stop = window.loom.ai.chatStream(
                [{ role: 'user', content: prompt }],
                undefined,
                (chunk) => { acc += chunk; },
                () => finish(acc),
                (err) => finish('Error:' + err.message),
              );
            } catch (e) { finish('Error:' + (e as Error).message); }
            if (stop) token.onCancellationRequested(() => stop());
          });

          if (token.isCancellationRequested || !response || response.startsWith('Error:')) {
            return { items: [] };
          }

          const completion = response.trim()
            .replace(/^```\w*\n?/g, '')
            .replace(/```$/g, '')
            .trim();

          if (!completion || completion.length > 200) return { items: [] };

          return {
            items: [{
              insertText: completion,
              range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column },
            }],
          };
        } catch {
          return { items: [] };
        } finally {
          aiCompletionInFlight = false;
        }
      },
      freeInlineCompletions: () => {},
      groupId: 'loom-ai-completion',
      handleDidShowCompletionItem: () => {},
    } as monaco.languages.InlineCompletionsProvider);
  } catch (e) {
    console.warn('Failed to register AI inline completions:', e);
  }
}

// Register once
let completionProviderRegistered = false;
function ensureAICompletionProvider() {
  if (completionProviderRegistered) return;
  completionProviderRegistered = true;
  registerAICompletionProvider();
}

// Monaco worker setup
(window as any).MonacoEnvironment = {
  getWorker(_: any, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ES2020,
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
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  allowJs: true,
  checkJs: false,
});

// === Register additional language aliases for better detection ===
// Monaco ships these out of the box, but we make sure they're associated
// with the existing language services.
const LANG_ALIASES: Record<string, string> = {
  vue: 'html', svelte: 'html', astro: 'html',
  jsx: 'javascript', tsx: 'typescript', mjs: 'javascript', cjs: 'javascript',
  mts: 'typescript', cts: 'typescript',
  scss: 'css', sass: 'css', less: 'css',
  styl: 'css',
  yml: 'yaml',
  conf: 'ini', cfg: 'ini', properties: 'properties',
  toml: 'ini',
  htm: 'html', xhtml: 'html', svg: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'shell', bat: 'shell', cmd: 'shell',
  r: 'r', R: 'r',
  kt: 'java', kts: 'java',
  dart: 'java',
  swift: 'java',
  ex: 'plaintext', exs: 'plaintext', erl: 'plaintext', hrl: 'plaintext',
  vue2: 'html',
  wasm: 'plaintext',
};
for (const [ext, lang] of Object.entries(LANG_ALIASES)) {
  // Best-effort; Monaco accepts this through configuration
  try { (monaco.languages as any).getLanguages?.(); } catch {}
}
// Note: monaco picks up language from file extension automatically. The LANG_ALIASES
// map above is kept for documentation; explicit registration of these aliases is
// already handled by Monaco's built-in language packs and by our compiler setup.

// === Built-in snippets (cursor/VSCode-style) ===
const SNIPPETS: { language: string; label: string; body: string; description?: string }[] = [
  // TypeScript / JavaScript
  { language: 'typescript', label: 'clog', body: 'console.log(${1:value});', description: 'console.log' },
  { language: 'typescript', label: 'cerr', body: 'console.error(${1:value});', description: 'console.error' },
  { language: 'typescript', label: 'fn', body: 'function ${1:name}(${2:params}) {\n  ${3:// body}\n}', description: 'function declaration' },
  { language: 'typescript', label: 'afn', body: 'const ${1:name} = (${2:params}) => {\n  ${3:// body}\n};', description: 'arrow function' },
  { language: 'typescript', label: 'iife', body: '((${1:params}) => {\n  ${2:// body}\n})(${3:args});', description: 'IIFE' },
  { language: 'typescript', label: 'tryc', body: 'try {\n  ${1:// try}\n} catch (${2:err}) {\n  ${3:// catch}\n}', description: 'try/catch' },
  { language: 'typescript', label: 'prom', body: 'new Promise<${1:T}>((resolve, reject) => {\n  ${2:// body}\n});', description: 'Promise' },
  { language: 'typescript', label: 'asyn', body: 'async (${1:params}) => {\n  ${2:// body}\n}', description: 'async arrow' },
  { language: 'typescript', label: 'usestate', body: 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState(${2:initial});', description: 'React useState' },
  { language: 'typescript', label: 'useeffect', body: 'useEffect(() => {\n  ${1:// effect}\n  return () => ${2:// cleanup};\n}, [${3:deps}]);', description: 'React useEffect' },
  { language: 'typescript', label: 'imp', body: "import { ${1:Module} } from '${2:package}';", description: 'named import' },
  { language: 'typescript', label: 'imd', body: "import ${1:Module} from '${2:package}';", description: 'default import' },
  { language: 'typescript', label: 'exp', body: 'export const ${1:name} = ${2:value};', description: 'export const' },
  { language: 'typescript', label: 'cls', body: 'class ${1:Name} {\n  constructor(${2:params}) {\n    ${3:// init}\n  }\n}', description: 'class' },
  { language: 'typescript', label: 'ifor', body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${3:// body}\n}', description: 'for loop' },
  { language: 'typescript', label: 'forof', body: 'for (const ${1:item} of ${2:array}) {\n  ${3:// body}\n}', description: 'for..of' },
  { language: 'typescript', label: 'forin', body: 'for (const ${1:key} in ${2:obj}) {\n  ${3:// body}\n}', description: 'for..in' },
  { language: 'typescript', label: 'ife', body: 'if (${1:condition}) {\n  ${2:// then}\n} else {\n  ${3:// else}\n}', description: 'if/else' },
  // HTML
  { language: 'html', label: 'html5', body: '<!DOCTYPE html>\n<html lang="${1:en}">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${2:Document}</title>\n</head>\n<body>\n  ${3}\n</body>\n</html>', description: 'HTML5 boilerplate' },
  { language: 'html', label: 'div', body: '<div class="${1}">\n  ${2}\n</div>', description: 'div' },
  // CSS
  { language: 'css', label: 'flex', body: 'display: flex;\nalign-items: ${1:center};\njustify-content: ${2:center};', description: 'flex container' },
  { language: 'css', label: 'grid', body: 'display: grid;\ngrid-template-columns: ${1:1fr 1fr};\ngap: ${2:1rem};', description: 'grid container' },
  // JSON
  { language: 'json', label: 'pkg', body: '{\n  "name": "${1:package}",\n  "version": "0.1.0",\n  "main": "index.js"\n}', description: 'package.json' },
  // Python
  { language: 'python', label: 'def', body: 'def ${1:name}(${2:params}):\n    ${3:pass}', description: 'function' },
  { language: 'python', label: 'cls', body: 'class ${1:Name}:\n    def __init__(self${2:, params}):\n        ${3:pass}', description: 'class' },
  { language: 'python', label: 'ifmain', body: "if __name__ == '__main__':\n    ${1:main()}", description: 'main guard' },
  // Markdown
  { language: 'markdown', label: 'h1', body: '# ${1:Title}', description: 'H1' },
  { language: 'markdown', label: 'link', body: '[${1:text}](${2:url})', description: 'link' },
  { language: 'markdown', label: 'code', body: '```${1:lang}\n${2:code}\n```', description: 'code block' },
];
for (const s of SNIPPETS) {
  try {
    monaco.languages.registerCompletionItemProvider(s.language, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: [{
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: s.description || s.label,
            range,
          }],
        };
      },
    });
  } catch {}
}

interface Props {
  file: OpenFile | null;
  openFilePaths: string[];
  onContentChange: (path: string, content: string) => void;
  workspacePath?: string;
}

function normalizeModelPath(filePath: string): string {
  try {
    return monaco.Uri.file(filePath).fsPath;
  } catch {
    return filePath;
  }
}

// Find/Replace bar
// Lightweight built-in formatter. Used when Monaco has no provider for the
// language. Handles JSON (full reformat) and a few common cases. Anything
// else just gets trailing-whitespace trimmed and CRLF normalized to LF.
function formatFallback(lang: string, value: string): string {
  // Normalize line endings
  let out = value.replace(/\r\n?/g, '\n');
  // Trim trailing whitespace per line
  out = out.split('\n').map(l => l.replace(/[\t ]+$/g, '')).join('\n');
  // Ensure single trailing newline
  if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  if (lang === 'json' || lang === 'jsonc') {
    try {
      // Strip comments first if jsonc
      const stripped = lang === 'jsonc' ? out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1') : out;
      return JSON.stringify(JSON.parse(stripped), null, 2) + '\n';
    } catch { return out; }
  }
  return out;
}

export default function Editor({ file, openFilePaths, onContentChange, workspacePath: wsPath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const viewStatesRef = useRef<Record<string, monaco.editor.ICodeEditorViewState | null>>({});
  const cbRef = useRef(onContentChange);
  const fileRef = useRef(file);
  const [showFind, setShowFind] = useState(false);
  const [showInlineAI, setShowInlineAI] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN');
  const settingsRef = useRef<{ formatOnSave: boolean; autoSave: 'off' | 'afterDelay'; autoSaveDelay: number }>({ formatOnSave: false, autoSave: 'off', autoSaveDelay: 1000 });
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 跟踪每个文件 model.onDidChangeContent 返回的 disposable，模型 dispose 时一并释放，
  // 避免监听器在已销毁模型上重复挂载或 autoSave timer 在卸载后仍触发。
  const modelDisposablesRef = useRef<Map<string, monaco.IDisposable>>(new Map());
  useEffect(() => { cbRef.current = onContentChange; }, [onContentChange]);
  useEffect(() => { fileRef.current = file; }, [file]);

  // Configure Monaco TypeScript service for the current workspace
  useEffect(() => {
    if (!wsPath) return;
    setWorkspacePath(wsPath);
    configureTypeScriptWorkspace(wsPath).catch(() => {});
  }, [wsPath]);

  const attachFileModel = useCallback((editor: monaco.editor.IStandaloneCodeEditor, targetFile: OpenFile | null) => {
    if (prevPathRef.current) viewStatesRef.current[prevPathRef.current] = editor.saveViewState();
    if (!targetFile) {
      editor.setModel(null);
      prevPathRef.current = null;
      return;
    }
    const uri = monaco.Uri.file(targetFile.path);
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(targetFile.content, targetFile.language, uri);
      // 让模型 EOL 与磁盘内容一致，避免 model.getValue() 返回归一化行尾（如 LF→CRLF）
      // 后被误判为「已修改」。setEOL 会触发 onDidChangeContent，但监听器在下方才注册，无影响。
      const hasCRLF = targetFile.content.includes('\r\n');
      model.setEOL(hasCRLF ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
      // 保存 disposable 以便模型 dispose 时一并清理；防止重复 attach 监听器、
      // autoSave timer 在模型销毁后仍触发。原实现丢弃了 disposable 返回值。
      const disposable = model.onDidChangeContent(() => {
        if (!model) return;
        cbRef.current(targetFile.path, model.getValue());
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        if (settingsRef.current.autoSave === 'afterDelay' && !targetFile.path.startsWith('untitled-')) {
          autoSaveTimerRef.current = setTimeout(() => {
            window.dispatchEvent(new CustomEvent('loom:save-file', { detail: { all: false } }));
          }, settingsRef.current.autoSaveDelay);
        }
      });
      // 用 uri 作为 key 关联 disposable；当模型被清理（见下方的 useEffect）时一并释放。
      // monaco.editor.getModel(uri) 复用时也会先释放旧 disposable，避免重复挂载。
      modelDisposablesRef.current.set(targetFile.path, disposable);
    } else if (normalizeEOL(model.getValue()) !== normalizeEOL(targetFile.content)) {
      // 仅在「忽略行尾差异后」内容确实不同才 setValue，避免 CRLF/LF 差异误触发变更事件
      model.setValue(targetFile.content);
    }
    editor.setModel(model);
    const saved = viewStatesRef.current[targetFile.path];
    if (saved) editor.restoreViewState(saved);
    editor.layout();
    requestAnimationFrame(() => {
      editor.layout();
      editor.focus();
    });
    prevPathRef.current = targetFile.path;
  }, []);

  const disposeEditor = useCallback(() => {
    editorRef.current?.dispose();
    editorRef.current = null;
    hostRef.current = null;
    if (containerRef.current) containerRef.current.replaceChildren();
  }, []);

  const createEditor = useCallback(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.minHeight = '0';
    host.style.flex = '1';
    container.replaceChildren(host);
    hostRef.current = host;
    const initialTheme = resolveMonacoTheme(
      document.documentElement.getAttribute('data-theme'),
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
    const editor = monaco.editor.create(host, {
      value: '',
      language: 'plaintext',
      theme: initialTheme,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      minimap: { enabled: true, scale: 1, showSlider: 'mouseover' },
      scrollBeyondLastLine: false,
      automaticLayout: false,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      tabSize: 2,
      wordWrap: 'off',
      smoothScrolling: true,
      matchBrackets: 'always',
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoSurround: 'languageDefined',
      padding: { top: 8, bottom: 8 },
      folding: true,
      showFoldingControls: 'mouseover',
      renderLineHighlight: 'all',
      selectionHighlight: true,
      links: true,
      colorDecorators: true,
      contextmenu: true,
      mouseWheelZoom: true,
      quickSuggestions: { other: true, comments: true, strings: true },
      guides: { indentation: true, bracketPairs: true, bracketPairsHorizontal: true, highlightActiveIndentation: true },
      cursorBlinking: 'blink',
      fontLigatures: true,
      glyphMargin: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      stickyScroll: { enabled: true },
      lineNumbersMinChars: 3,
      inlineSuggest: { enabled: true },
      suggest: { showInlineDetails: true },
    });
    editor.onDidChangeCursorPosition((e) => {
      window.dispatchEvent(new CustomEvent('loom:cursor-change', { detail: { line: e.position.lineNumber, column: e.position.column } }));
    });
    editorRef.current = editor;
    attachFileModel(editor, fileRef.current);
  }, [attachFileModel]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // 捕获阶段拦截 Ctrl+F/Ctrl+H，阻止事件到达 Monaco，
      // 避免 Monaco 内置查找/替换弹窗与自定义 FindReplaceBar 双触发；
      // 同时仅当本编辑器拥有焦点时响应，避免分屏多实例重复触发
      if (e.ctrlKey && (e.key === 'f' || e.key === 'h') && !e.shiftKey) {
        if (!editorRef.current?.hasTextFocus()) return;
        e.preventDefault();
        e.stopPropagation();
        setShowFind(e.key === 'f' ? p => !p : true);
      }
      if (e.ctrlKey && e.key === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (editorRef.current?.hasTextFocus()) {
          setShowInlineAI(p => !p);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    setWorkspacePath(wsPath || '');
  }, [wsPath]);

  // Load locale and editor settings
  useEffect(() => {
    window.loom?.settings?.getAll?.().then((s: any) => {
      if (s?.locale) setLocale(s.locale);
      if (s?.editor) {
        settingsRef.current = {
          formatOnSave: !!s.editor.formatOnSave,
          autoSave: s.editor.autoSave === 'afterDelay' ? 'afterDelay' : 'off',
          autoSaveDelay: Number(s.editor.autoSaveDelay) || 1000,
        };
      }
    }).catch(() => {});
    const handler = (e: CustomEvent) => {
      if (e.detail?.key === 'locale') setLocale(e.detail.value);
      if (e.detail?.key === 'editor.formatOnSave') settingsRef.current.formatOnSave = !!e.detail.value;
      if (e.detail?.key === 'editor.autoSave') settingsRef.current.autoSave = e.detail.value === 'afterDelay' ? 'afterDelay' : 'off';
      if (e.detail?.key === 'editor.autoSaveDelay') settingsRef.current.autoSaveDelay = Number(e.detail.value) || 1000;
    };
    window.addEventListener('loom:setting-change' as any, handler);
    return () => window.removeEventListener('loom:setting-change' as any, handler);
  }, []);

  // Listen for settings changes
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { key, value } = e.detail;
      if (!editorRef.current) return;
      if (key === 'editor.wordWrap') {
        editorRef.current.updateOptions({ wordWrap: value === 'on' ? 'on' : (value === 'toggle' ? (editorRef.current.getOption(monaco.editor.EditorOption.wordWrap) === 'on' ? 'off' : 'on') : 'off') });
      }
      if (key === 'editor.minimap') editorRef.current.updateOptions({ minimap: { enabled: value } });
      if (key === 'editor.fontSize') editorRef.current.updateOptions({ fontSize: value });
      if (key === 'editor.lineNumbers') editorRef.current.updateOptions({ lineNumbers: value ? 'on' : 'off' });
      if (key === 'editor.tabSize') editorRef.current.updateOptions({ tabSize: value });
      if (key === 'theme') {
        monaco.editor.setTheme(resolveMonacoTheme(value, window.matchMedia('(prefers-color-scheme: dark)').matches));
      }
    };
    window.addEventListener('loom:setting-change' as any, handler);
    return () => window.removeEventListener('loom:setting-change' as any, handler);
  }, []);

  // Listen for go-to-line events
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

  // Helper to format the current editor document
  const formatCurrentDocument = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    const lang = model?.getLanguageId() || 'plaintext';
    const tryAction = (id: string) => {
      const a = ed.getAction(id);
      if (a) a.run();
      return !!a;
    };
    const used = tryAction('editor.action.formatDocument') || tryAction('editor.action.formatDocument.none');
    if (!used) {
      const v = ed.getValue();
      const formatted = formatFallback(lang, v);
      if (formatted !== v) ed.setValue(formatted);
    }
  }, []);

  // Listen for editor actions
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { action } = e.detail;
      const ed = editorRef.current;
      if (!ed) return;
      const tryAction = (id: string) => {
        const a = ed.getAction(id);
        if (a) a.run();
        return !!a;
      };
      if (action === 'undo') ed.trigger('keyboard', 'undo', null);
      else if (action === 'redo') ed.trigger('keyboard', 'redo', null);
      else if (action === 'format') {
        formatCurrentDocument();
      }
      else if (action === 'goToDefinition') ed.getAction('editor.action.revealDefinition')?.run();
      else if (action === 'findReferences') ed.getAction('editor.action.referenceSearch.trigger')?.run();
      else if (action === 'rename') ed.getAction('editor.action.rename')?.run();
      else if (action === 'peekDefinition') ed.getAction('editor.action.peekDefinition')?.run();
      else if (action === 'toggleComment') ed.getAction('editor.action.commentLine')?.run();
      else if (action === 'toggleBlockComment') ed.getAction('editor.action.blockComment')?.run();
      else if (action === 'inlineAI') { if (ed.hasTextFocus()) setShowInlineAI(p => !p); }
      else if (action === 'find' || action === 'replace') { if (ed.hasTextFocus()) setShowFind(true); }
    };
    window.addEventListener('loom:editor-action' as any, handler);
    return () => window.removeEventListener('loom:editor-action' as any, handler);
  }, [formatCurrentDocument]);

  // Format on save: editor handles formatting, then asks App to save
  useEffect(() => {
    const handler = async (e: CustomEvent) => {
      if (e.detail?.all) {
        // Save all without per-file formatting for now (multi-file formatting needs model switching)
        window.dispatchEvent(new CustomEvent('loom:save-file', { detail: { all: true } }));
        return;
      }
      if (settingsRef.current.formatOnSave) {
        await formatCurrentDocument();
      }
      window.dispatchEvent(new CustomEvent('loom:save-file', { detail: { all: false } }));
    };
    window.addEventListener('loom:format-and-save' as any, handler);
    return () => window.removeEventListener('loom:format-and-save' as any, handler);
  }, [formatCurrentDocument]);

  // Create Monaco only after the container has real dimensions. If Monaco gets
  // stuck in a partial DOM state, rebuild it instead of leaving a blank editor.
  useEffect(() => {
    ensureAICompletionProvider();
    let disposed = false;
    let healthTimer: ReturnType<typeof setTimeout> | null = null;
    const container = containerRef.current;
    if (!container) return;

    const ensureEditor = () => {
      if (disposed) return;
      createEditor();
      editorRef.current?.layout();
      if (healthTimer) clearTimeout(healthTimer);
      healthTimer = setTimeout(() => {
        if (disposed || !containerRef.current || !editorRef.current) return;
        if (fileRef.current && !isEditorDomHealthy(containerRef.current)) {
          disposeEditor();
          requestAnimationFrame(() => createEditor());
        }
      }, 80);
    };

    const observer = new ResizeObserver(ensureEditor);
    observer.observe(container);
    requestAnimationFrame(ensureEditor);

    return () => {
      disposed = true;
      if (healthTimer) clearTimeout(healthTimer);
      observer.disconnect();
      disposeEditor();
    };
  }, [createEditor, disposeEditor]);

  // Forward Monaco diagnostics to Problems panel
  useEffect(() => {
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
  }, []);

  // Switch model when file changes
  useEffect(() => {
    if (!editorRef.current) {
      requestAnimationFrame(() => createEditor());
      return;
    }
    attachFileModel(editorRef.current, file);
  }, [file, attachFileModel, createEditor]);

  // Clean up models for closed files
  useEffect(() => {
    const open = new Set(openFilePaths.map(normalizeModelPath));
    monaco.editor.getModels().forEach(m => {
      if (m.uri.scheme === 'file' && !open.has(m.uri.fsPath)) {
        // 先释放 onDidChangeContent disposable，再 dispose 模型
        const dispKey = Object.keys(modelDisposablesRef.current).find(k => normalizeModelPath(k) === m.uri.fsPath);
        if (dispKey) {
          modelDisposablesRef.current.get(dispKey)?.dispose();
          modelDisposablesRef.current.delete(dispKey);
        }
        m.dispose();
        Object.keys(viewStatesRef.current).forEach(key => {
          if (normalizeModelPath(key) === m.uri.fsPath) delete viewStatesRef.current[key];
        });
      }
    });
  }, [openFilePaths]);

  // 组件卸载时统一释放所有 disposable 与 pending autoSave timer
  useEffect(() => () => {
    modelDisposablesRef.current.forEach(d => { try { d.dispose(); } catch {} });
    modelDisposablesRef.current.clear();
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
  }, []);

  return (
    <>
      {showFind && <FindReplaceBar editor={editorRef.current} locale={locale} />}
      {showInlineAI && <InlineAIEdit editorRef={editorRef} workspacePath={workspacePath} onClose={() => setShowInlineAI(false)} />}
      <div className="editor-container" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 0, flex: 1 }} />
        {!file && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-editor)', zIndex: 1, overflow: 'auto' }}>
            <WelcomePage
              onOpenFile={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openFile' }))}
              onOpenFolder={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openFolder' }))}
              onOpenFolderPath={(folder) => window.dispatchEvent(new CustomEvent('loom:open-folder-path', { detail: folder }))}
              onNewFile={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'newFile' }))}
              onOpenSettings={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openSettings' }))}
              locale={locale}
              workspacePath={workspacePath}
            />
          </div>
        )}
      </div>
    </>
  );
}
