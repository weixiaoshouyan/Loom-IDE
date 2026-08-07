/**
 * Snippet Manager - Manage reusable code snippets
 * Provides a UI for creating, editing, and inserting code snippets
 */

import React, { useState, useEffect, useCallback } from 'react';
import { confirmDialog } from './ConfirmModal';

interface Snippet {
  id: string;
  name: string;
  description: string;
  prefix: string;
  body: string;
  language: string;
  scope: string[];
  builtin: boolean;
}

interface Props {
  onClose: () => void;
  onInsert: (snippet: Snippet) => void;
  currentLanguage?: string;
  locale?: 'zh-CN' | 'en-US';
}

const BUILTIN_SNIPPETS: Snippet[] = [
  // TypeScript/JavaScript
  {
    id: 'ts-function',
    name: 'Function Declaration',
    description: 'Create a function',
    prefix: 'fn',
    body: 'function ${1:name}(${2:params}) {\n  ${3:// body}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-arrow',
    name: 'Arrow Function',
    description: 'Create an arrow function',
    prefix: 'afn',
    body: 'const ${1:name} = (${2:params}) => {\n  ${3:// body}\n};',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-async',
    name: 'Async Function',
    description: 'Create an async function',
    prefix: 'async',
    body: 'async function ${1:name}(${2:params}) {\n  ${3:// body}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-class',
    name: 'Class',
    description: 'Create a class',
    prefix: 'cls',
    body: 'class ${1:Name} {\n  constructor(${2:params}) {\n    ${3:// init}\n  }\n\n  ${4:// methods}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-interface',
    name: 'Interface',
    description: 'Create an interface',
    prefix: 'intf',
    body: 'interface ${1:Name} {\n  ${2:property}: ${3:type};\n}',
    language: 'typescript',
    scope: ['typescript'],
    builtin: true,
  },
  {
    id: 'ts-try',
    name: 'Try/Catch',
    description: 'Create a try/catch block',
    prefix: 'tryc',
    body: 'try {\n  ${1:// try}\n} catch (${2:err}) {\n  ${3:// handle error}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-if',
    name: 'If/Else',
    description: 'Create an if/else block',
    prefix: 'ife',
    body: 'if (${1:condition}) {\n  ${2:// then}\n} else {\n  ${3:// else}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-for',
    name: 'For Loop',
    description: 'Create a for loop',
    prefix: 'for',
    body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${3:// body}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-forof',
    name: 'For...of Loop',
    description: 'Create a for...of loop',
    prefix: 'forof',
    body: 'for (const ${1:item} of ${2:array}) {\n  ${3:// body}\n}',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-import',
    name: 'Import',
    description: 'Create an import statement',
    prefix: 'imp',
    body: "import { ${1:Module} } from '${2:package}';",
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  {
    id: 'ts-export',
    name: 'Export',
    description: 'Create an export statement',
    prefix: 'exp',
    body: 'export ${1:default} ${2:name};',
    language: 'typescript',
    scope: ['typescript', 'javascript'],
    builtin: true,
  },
  // React
  {
    id: 'react-component',
    name: 'React Component',
    description: 'Create a React component',
    prefix: 'rfc',
    body: 'import React from \'react\';\n\ninterface Props {\n  ${1:// props}\n}\n\nexport default function ${2:Component}({ ${3:props} }: Props) {\n  return (\n    <div>\n      ${4:// content}\n    </div>\n  );\n}',
    language: 'typescript',
    scope: ['typescriptreact', 'javascriptreact'],
    builtin: true,
  },
  {
    id: 'react-usestate',
    name: 'useState Hook',
    description: 'Create a useState hook',
    prefix: 'usestate',
    body: 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState(${2:initial});',
    language: 'typescript',
    scope: ['typescriptreact', 'javascriptreact'],
    builtin: true,
  },
  {
    id: 'react-useeffect',
    name: 'useEffect Hook',
    description: 'Create a useEffect hook',
    prefix: 'useeffect',
    body: 'useEffect(() => {\n  ${1:// effect}\n  return () => {\n    ${2:// cleanup}\n  };\n}, [${3:deps}]);',
    language: 'typescript',
    scope: ['typescriptreact', 'javascriptreact'],
    builtin: true,
  },
  // Python
  {
    id: 'py-function',
    name: 'Python Function',
    description: 'Create a Python function',
    prefix: 'def',
    body: 'def ${1:name}(${2:params}):\n    ${3:pass}',
    language: 'python',
    scope: ['python'],
    builtin: true,
  },
  {
    id: 'py-class',
    name: 'Python Class',
    description: 'Create a Python class',
    prefix: 'cls',
    body: 'class ${1:Name}:\n    def __init__(self${2:, params}):\n        ${3:pass}',
    language: 'python',
    scope: ['python'],
    builtin: true,
  },
  {
    id: 'py-ifmain',
    name: 'Main Guard',
    description: 'Create a main guard',
    prefix: 'ifmain',
    body: "if __name__ == '__main__':\n    ${1:main()}",
    language: 'python',
    scope: ['python'],
    builtin: true,
  },
  // HTML
  {
    id: 'html5',
    name: 'HTML5 Boilerplate',
    description: 'Create HTML5 boilerplate',
    prefix: 'html5',
    body: '<!DOCTYPE html>\n<html lang="${1:en}">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${2:Document}</title>\n</head>\n<body>\n  ${3}\n</body>\n</html>',
    language: 'html',
    scope: ['html'],
    builtin: true,
  },
  // CSS
  {
    id: 'css-flex',
    name: 'Flexbox',
    description: 'Create a flex container',
    prefix: 'flex',
    body: 'display: flex;\nalign-items: ${1:center};\njustify-content: ${2:center};',
    language: 'css',
    scope: ['css', 'scss', 'less'],
    builtin: true,
  },
  {
    id: 'css-grid',
    name: 'Grid',
    description: 'Create a grid container',
    prefix: 'grid',
    body: 'display: grid;\ngrid-template-columns: ${1:1fr 1fr};\ngap: ${2:1rem};',
    language: 'css',
    scope: ['css', 'scss', 'less'],
    builtin: true,
  },
];

const STORAGE_KEY = 'loom-snippets-v1';

function loadCustomSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomSnippets(snippets: Snippet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  } catch { /* storage full or unavailable */ }
}

export default function SnippetManager({ onClose, onInsert, currentLanguage, locale = 'zh-CN' }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Snippet>>({});

  useEffect(() => {
    const custom = loadCustomSnippets();
    setSnippets([...BUILTIN_SNIPPETS, ...custom]);
  }, []);

  const filtered = snippets.filter(s => {
    const matchesSearch = !search || 
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.prefix.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    
    const matchesLanguage = !currentLanguage || 
      s.scope.includes(currentLanguage) || 
      s.scope.includes('*');
    
    return matchesSearch && matchesLanguage;
  });

  const selected = selectedId ? snippets.find(s => s.id === selectedId) : null;

  const handleInsert = useCallback((snippet: Snippet) => {
    onInsert(snippet);
    onClose();
  }, [onInsert, onClose]);

  const handleSave = useCallback(() => {
    if (!editForm.name || !editForm.prefix || !editForm.body) return;
    
    const custom = loadCustomSnippets();
    const newSnippet: Snippet = {
      id: editForm.id || `custom-${Date.now()}`,
      name: editForm.name,
      description: editForm.description || '',
      prefix: editForm.prefix,
      body: editForm.body,
      language: editForm.language || 'plaintext',
      scope: editForm.scope || ['*'],
      builtin: false,
    };

    if (editForm.id) {
      const updated = custom.map(s => s.id === editForm.id ? newSnippet : s);
      saveCustomSnippets(updated);
    } else {
      saveCustomSnippets([...custom, newSnippet]);
    }

    setSnippets([...BUILTIN_SNIPPETS, ...loadCustomSnippets()]);
    setIsEditing(false);
    setEditForm({});
  }, [editForm]);

  const handleDelete = useCallback(async (id: string) => {
    const ok = await confirmDialog.ask({
      title: locale === 'zh-CN' ? '删除代码片段' : 'Delete Snippet',
      message: locale === 'zh-CN' ? '确定删除此代码片段？' : 'Delete this snippet?',
      confirmText: locale === 'zh-CN' ? '删除' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    const custom = loadCustomSnippets();
    saveCustomSnippets(custom.filter(s => s.id !== id));
    setSnippets([...BUILTIN_SNIPPETS, ...loadCustomSnippets()]);
    if (selectedId === id) setSelectedId(null);
  }, [selectedId, locale]);

  const startEdit = useCallback((snippet?: Snippet) => {
    if (snippet) {
      setEditForm(snippet);
    } else {
      setEditForm({
        name: '',
        description: '',
        prefix: '',
        body: '',
        language: currentLanguage || 'plaintext',
        scope: currentLanguage ? [currentLanguage] : ['*'],
      });
    }
    setIsEditing(true);
  }, [currentLanguage]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ width: 700, maxWidth: '90vw' }}>
        <div className="settings-sidebar" style={{ width: 200 }}>
          <div className="settings-sidebar-header">
            <span className="settings-sidebar-title">{locale === 'zh-CN' ? '代码片段' : 'Snippets'}</span>
            <button className="settings-close-btn" onClick={onClose} aria-label={locale === 'zh-CN' ? '关闭' : 'Close'}>
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            </button>
          </div>
          <div style={{ padding: '8px 12px' }}>
            <input
              className="settings-input"
              placeholder={locale === 'zh-CN' ? '搜索片段...' : 'Search snippets...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {filtered.map(s => (
              <div
                key={s.id}
                className={`settings-nav-item ${selectedId === s.id ? 'active' : ''}`}
                onClick={() => setSelectedId(s.id)}
                style={{ padding: '6px 12px' }}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)' }}>{s.prefix}</span>
                <span style={{ marginLeft: 8, fontSize: 12 }}>{s.name}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
            <button
              className="settings-btn-sm primary"
              onClick={() => startEdit()}
              style={{ width: '100%' }}
            >
              {locale === 'zh-CN' ? '+ 新建片段' : '+ New Snippet'}
            </button>
          </div>
        </div>
        <div className="settings-content">
          {isEditing ? (
            <div style={{ padding: 16 }}>
              <h3 style={{ marginTop: 0 }}>{editForm.id ? (locale === 'zh-CN' ? '编辑片段' : 'Edit Snippet') : (locale === 'zh-CN' ? '新建片段' : 'New Snippet')}</h3>
              <div className="settings-group">
                <div className="settings-label">{locale === 'zh-CN' ? '名称' : 'Name'}</div>
                <input
                  className="settings-input"
                  value={editForm.name || ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="My Snippet"
                />
              </div>
              <div className="settings-group">
                <div className="settings-label">{locale === 'zh-CN' ? '前缀' : 'Prefix'}</div>
                <input
                  className="settings-input"
                  value={editForm.prefix || ''}
                  onChange={e => setEditForm(f => ({ ...f, prefix: e.target.value }))}
                  placeholder="mysnippet"
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div className="settings-group">
                <div className="settings-label">{locale === 'zh-CN' ? '描述' : 'Description'}</div>
                <input
                  className="settings-input"
                  value={editForm.description || ''}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What this snippet does"
                />
              </div>
              <div className="settings-group">
                <div className="settings-label">{locale === 'zh-CN' ? '语言' : 'Language'}</div>
                <select
                  className="settings-select"
                  value={editForm.language || 'plaintext'}
                  onChange={e => setEditForm(f => ({ ...f, language: e.target.value }))}
                >
                  <option value="*">All Languages</option>
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown</option>
                </select>
              </div>
              <div className="settings-group">
                <div className="settings-label">{locale === 'zh-CN' ? '内容' : 'Body'}</div>
                <textarea
                  className="settings-input"
                  value={editForm.body || ''}
                  onChange={e => setEditForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="Snippet content with ${1:placeholders}"
                  style={{ fontFamily: 'monospace', minHeight: 150, resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="settings-btn-sm primary" onClick={handleSave}>
                  {locale === 'zh-CN' ? '保存' : 'Save'}
                </button>
                <button className="settings-btn-sm" onClick={() => { setIsEditing(false); setEditForm({}); }}>
                  {locale === 'zh-CN' ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : selected ? (
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0 }}>{selected.name}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="settings-btn-sm primary" onClick={() => handleInsert(selected)}>
                    {locale === 'zh-CN' ? '插入' : 'Insert'}
                  </button>
                  {!selected.builtin && (
                    <>
                      <button className="settings-btn-sm" onClick={() => startEdit(selected)}>
                        {locale === 'zh-CN' ? '编辑' : 'Edit'}
                      </button>
                      <button className="settings-btn-sm" style={{ color: 'var(--red)' }} onClick={() => handleDelete(selected.id)}>
                        {locale === 'zh-CN' ? '删除' : 'Delete'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {selected.description && (
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px' }}>{selected.description}</p>
              )}
              <div style={{ marginBottom: 16 }}>
                <div className="settings-label">{locale === 'zh-CN' ? '前缀' : 'Prefix'}</div>
                <code style={{ padding: '4px 8px', background: 'var(--bg-tertiary)', borderRadius: 4, fontFamily: 'monospace' }}>
                  {selected.prefix}
                </code>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div className="settings-label">{locale === 'zh-CN' ? '语言' : 'Language'}</div>
                <span>{selected.language}</span>
              </div>
              <div>
                <div className="settings-label">{locale === 'zh-CN' ? '内容' : 'Body'}</div>
                <pre style={{
                  padding: 12,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  fontFamily: "'Cascadia Code', Consolas, monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  overflow: 'auto',
                  maxHeight: 300,
                  margin: 0,
                }}>
                  {selected.body}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              {locale === 'zh-CN' ? '选择一个片段查看' : 'Select a snippet to view'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
