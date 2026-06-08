import React, { useState, useEffect, useCallback } from 'react';

interface ProviderConfig {
  id: string;
  name: string;
  keyField: string;
  baseUrl: string;
  models: string[];
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'deepseek', name: 'DeepSeek', keyField: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'] },
  { id: 'dashscope', name: 'Tongyi / DashScope', keyField: 'DASHSCOPE_API_KEY', baseUrl: 'https://dashscope.aliyuncs.com', models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'] },
  { id: 'zhipu', name: 'Zhipu AI', keyField: 'ZHIPU_API_KEY', baseUrl: 'https://open.bigmodel.cn/api/paas', models: ['glm-4', 'glm-4-flash', 'glm-4-plus'] },
  { id: 'moonshot', name: 'Moonshot / Kimi', keyField: 'MOONSHOT_API_KEY', baseUrl: 'https://api.moonshot.cn', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { id: 'baichuan', name: 'Baichuan', keyField: 'BAICHUAN_API_KEY', baseUrl: 'https://api.baichuan-ai.com', models: ['Baichuan4', 'Baichuan3-Turbo'] },
  { id: 'yi', name: 'Yi / Lingyiwanwu', keyField: 'YI_API_KEY', baseUrl: 'https://api.lingyiwanwu.com', models: ['yi-large', 'yi-medium', 'yi-spark'] },
  { id: 'doubao', name: 'Doubao / Volcengine', keyField: 'DOUBAO_API_KEY', baseUrl: 'https://ark.cn-beijing.volces.com', models: ['doubao-pro-256k', 'doubao-pro-128k', 'doubao-lite-128k'] },
  { id: 'siliconflow', name: 'SiliconFlow', keyField: 'SILICONFLOW_API_KEY', baseUrl: 'https://api.siliconflow.cn', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'] },
  { id: 'anthropic', name: 'Anthropic Claude', keyField: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] },
  { id: 'openai', name: 'OpenAI', keyField: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'custom', name: 'Custom Provider', keyField: 'CUSTOM_API_KEY', baseUrl: '', models: [] },
];

interface SettingsData {
  activeProviderId: string;
  providerKeys: Record<string, string>;
  activeModel: Record<string, string>;
  customProvider: { name: string; baseUrl: string; apiKey: string; models: string };
  orcaPort: number;
  theme: 'dark' | 'light';
  editor: {
    fontSize: number;
    fontFamily: string;
    tabSize: number;
    wordWrap: 'off' | 'on';
    minimap: boolean;
    lineNumbers: boolean;
    cursorBlinking: string;
    smoothScrolling: boolean;
    formatOnSave: boolean;
    autoSave: 'off' | 'afterDelay';
  };
}

const DEFAULT_SETTINGS: SettingsData = {
  activeProviderId: 'deepseek',
  providerKeys: {},
  activeModel: {},
  customProvider: { name: '', baseUrl: '', apiKey: '', models: '' },
  orcaPort: 18080,
  theme: 'dark',
  editor: {
    fontSize: 14,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    tabSize: 2,
    wordWrap: 'off',
    minimap: true,
    lineNumbers: true,
    cursorBlinking: 'blink',
    smoothScrolling: true,
    formatOnSave: false,
    autoSave: 'off',
  },
};

interface Props { onClose: () => void; }

export default function Settings({ onClose }: Props) {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [section, setSection] = useState('providers');
  const [activeTab, setActiveTab] = useState('ai');
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (window as any).loom.settings?.getAll().then((s: any) => {
      if (s) setSettings(prev => ({ ...prev, ...s }));
    }).catch(() => {});
  }, []);

  const update = useCallback(<K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      (window as any).loom.settings?.set(key, value);
      window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key, value } }));
      return next;
    });
  }, []);

  const updateEditor = useCallback(<K extends keyof SettingsData['editor']>(key: K, value: SettingsData['editor'][K]) => {
    setSettings(prev => {
      const next = { ...prev, editor: { ...prev.editor, [key]: value } };
      (window as any).loom.settings?.set('editor', next.editor);
      window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'editor.' + key, value } }));
      return next;
    });
  }, []);

  const saveAll = async () => {
    await (window as any).loom.settings?.setAll(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testProvider = async (providerId: string) => {
    setTestingProvider(providerId);
    setTestResult(null);
    try {
      const result = await (window as any).loom.agent?.testProvider?.(providerId, settings.providerKeys[providerId] || '');
      setTestResult(result || { ok: false, msg: 'No response' });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message || 'Connection failed' });
    }
    setTestingProvider(null);
  };

  const activeProvider = PROVIDERS.find(p => p.id === settings.activeProviderId) || PROVIDERS[0];

  const renderProviderSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-label">Active Provider</div>
        <select className="settings-select" value={settings.activeProviderId}
          onChange={e => { update('activeProviderId', e.target.value); setTestResult(null); }}>
          {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="settings-divider" />

      {PROVIDERS.filter(p => p.id !== 'custom').map(p => (
        <div key={p.id} className="settings-provider-card">
          <div className="settings-provider-header">
            <span className="settings-provider-name">{p.name}</span>
            {settings.activeProviderId === p.id && <span className="settings-provider-active">Active</span>}
          </div>
          <div className="settings-group">
            <div className="settings-label">API Key</div>
            <div className="settings-input-row">
              <input className="settings-input" type="password" placeholder={`sk-...`}
                value={settings.providerKeys[p.keyField] || ''}
                onChange={e => update('providerKeys', { ...settings.providerKeys, [p.keyField]: e.target.value })} />
              <button className="settings-btn-sm" onClick={() => testProvider(p.id)}
                disabled={testingProvider === p.id || !settings.providerKeys[p.keyField]}>
                {testingProvider === p.id ? '...' : 'Test'}
              </button>
            </div>
          </div>
          {settings.activeProviderId === p.id && p.models.length > 0 && (
            <div className="settings-group">
              <div className="settings-label">Model</div>
              <select className="settings-select"
                value={settings.activeModel[p.id] || p.models[0]}
                onChange={e => update('activeModel', { ...settings.activeModel, [p.id]: e.target.value })}>
                {p.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
        </div>
      ))}

      <div className="settings-provider-card">
        <div className="settings-provider-header">
          <span className="settings-provider-name">Custom Provider (OpenAI-compatible)</span>
        </div>
        <div className="settings-group">
          <div className="settings-label">Base URL</div>
          <input className="settings-input" placeholder="https://your-api.com/v1"
            value={settings.customProvider.baseUrl}
            onChange={e => update('customProvider', { ...settings.customProvider, baseUrl: e.target.value })} />
        </div>
        <div className="settings-group">
          <div className="settings-label">API Key</div>
          <input className="settings-input" type="password" placeholder="sk-..."
            value={settings.customProvider.apiKey}
            onChange={e => update('customProvider', { ...settings.customProvider, apiKey: e.target.value })} />
        </div>
        <div className="settings-group">
          <div className="settings-label">Models (comma separated)</div>
          <input className="settings-input" placeholder="model-1, model-2"
            value={settings.customProvider.models}
            onChange={e => update('customProvider', { ...settings.customProvider, models: e.target.value })} />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Orca Proxy Port</div>
        <input className="settings-input" type="number" value={settings.orcaPort}
          onChange={e => update('orcaPort', parseInt(e.target.value) || 18080)} style={{ width: 120 }} />
      </div>

      {testResult && (
        <div className={`settings-test-result ${testResult.ok ? 'success' : 'error'}`}>
          {testResult.ok ? 'Connected: ' : 'Error: '}{testResult.msg}
        </div>
      )}
    </div>
  );

  const renderEditorSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-label">Font Size</div>
        <div className="settings-input-row">
          <input className="settings-input" type="number" min="8" max="32" value={settings.editor.fontSize}
            onChange={e => updateEditor('fontSize', parseInt(e.target.value) || 14)} style={{ width: 80 }} />
          <span className="settings-unit">px</span>
        </div>
      </div>
      <div className="settings-group">
        <div className="settings-label">Font Family</div>
        <input className="settings-input" value={settings.editor.fontFamily}
          onChange={e => updateEditor('fontFamily', e.target.value)} />
      </div>
      <div className="settings-group">
        <div className="settings-label">Tab Size</div>
        <select className="settings-select" value={settings.editor.tabSize}
          onChange={e => updateEditor('tabSize', parseInt(e.target.value))} style={{ width: 80 }}>
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
        </select>
      </div>
      <div className="settings-group">
        <div className="settings-label">Word Wrap</div>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.editor.wordWrap === 'on'}
            onChange={e => updateEditor('wordWrap', e.target.checked ? 'on' : 'off')} />
          <span className="settings-toggle-slider" />
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-label">Minimap</div>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.editor.minimap}
            onChange={e => updateEditor('minimap', e.target.checked)} />
          <span className="settings-toggle-slider" />
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-label">Line Numbers</div>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.editor.lineNumbers}
            onChange={e => updateEditor('lineNumbers', e.target.checked)} />
          <span className="settings-toggle-slider" />
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-label">Cursor Blinking</div>
        <select className="settings-select" value={settings.editor.cursorBlinking}
          onChange={e => updateEditor('cursorBlinking', e.target.value)} style={{ width: 140 }}>
          <option value="blink">Blink</option>
          <option value="smooth">Smooth</option>
          <option value="phase">Phase</option>
          <option value="expand">Expand</option>
          <option value="solid">Solid</option>
        </select>
      </div>
      <div className="settings-group">
        <div className="settings-label">Smooth Scrolling</div>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.editor.smoothScrolling}
            onChange={e => updateEditor('smoothScrolling', e.target.checked)} />
          <span className="settings-toggle-slider" />
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-label">Format on Save</div>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.editor.formatOnSave}
            onChange={e => updateEditor('formatOnSave', e.target.checked)} />
          <span className="settings-toggle-slider" />
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-label">Auto Save</div>
        <select className="settings-select" value={settings.editor.autoSave}
          onChange={e => updateEditor('autoSave', e.target.value as any)} style={{ width: 160 }}>
          <option value="off">Off</option>
          <option value="afterDelay">After Delay</option>
        </select>
      </div>
    </div>
  );

  const renderThemeSettings = () => (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-label">Theme</div>
        <div className="settings-theme-grid">
          <div className={`settings-theme-card ${settings.theme === 'dark' ? 'active' : ''}`}
            onClick={() => update('theme', 'dark')}>
            <div className="settings-theme-preview dark-preview">
              <div style={{ background: '#1e1e1e', width: '100%', height: '100%', borderRadius: 4 }} />
            </div>
            <span>Dark</span>
          </div>
          <div className={`settings-theme-card ${settings.theme === 'light' ? 'active' : ''}`}
            onClick={() => update('theme', 'light')}>
            <div className="settings-theme-preview light-preview">
              <div style={{ background: '#f8f9fa', width: '100%', height: '100%', borderRadius: 4 }} />
            </div>
            <span>Light</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderKeybindings = () => (
    <div className="settings-section">
      <table className="settings-keybindings-table">
        <thead><tr><th>Command</th><th>Shortcut</th></tr></thead>
        <tbody>
          {[
            ['Save', 'Ctrl+S'],
            ['Open File', 'Ctrl+O'],
            ['Open Folder', 'Ctrl+K'],
            ['Find', 'Ctrl+F'],
            ['Find & Replace', 'Ctrl+H'],
            ['Command Palette', 'Ctrl+Shift+P'],
            ['Toggle Sidebar', 'Ctrl+B'],
            ['Toggle Terminal', 'Ctrl+`'],
            ['Toggle Word Wrap', 'Alt+Z'],
            ['Close Tab', 'Ctrl+W'],
            ['Settings', 'Ctrl+,'],
          ].map(([cmd, key]) => (
            <tr key={cmd}><td>{cmd}</td><td><kbd>{key}</kbd></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const sections = [
    { id: 'providers', label: 'AI Providers', icon: 'P' },
    { id: 'editor', label: 'Editor', icon: 'E' },
    { id: 'theme', label: 'Appearance', icon: 'A' },
    { id: 'keybindings', label: 'Keybindings', icon: 'K' },
  ];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <span style={{ fontWeight: 600, fontSize: 13 }}>Settings</span>
            <button className="settings-close-btn" onClick={onClose}>
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
          </div>
          {sections.map(s => (
            <div key={s.id} className={`settings-nav-item ${section === s.id ? 'active' : ''}`}
              onClick={() => setSection(s.id)}>
              <span className="settings-nav-icon">{s.icon}</span>
              <span>{s.label}</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div className="settings-sidebar-footer">
            {saved && <span style={{ color: 'var(--green)', fontSize: 11 }}>Saved</span>}
            <button className="settings-save-btn" onClick={saveAll}>Save All</button>
          </div>
        </div>
        <div className="settings-content">
          <div className="settings-content-header">
            <h2>{sections.find(s => s.id === section)?.label}</h2>
          </div>
          <div className="settings-scroll">
            {section === 'providers' && renderProviderSettings()}
            {section === 'editor' && renderEditorSettings()}
            {section === 'theme' && renderThemeSettings()}
            {section === 'keybindings' && renderKeybindings()}
          </div>
        </div>
      </div>
    </div>
  );
}
