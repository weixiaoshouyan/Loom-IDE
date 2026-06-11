import React, { useState, useEffect, useCallback } from "react";

interface AIProvider {
  id: string; name: string; baseUrl: string; apiKey: string;
  models: string[]; activeModel: string; isCustom: boolean;
}
interface AgentProfile {
  id: string; name: string; systemPrompt: string; providerId: string;
  model: string; temperature: number; maxTokens: number; icon: string;
}
interface AIConfig {
  providers: AIProvider[]; activeProviderId: string;
  profiles: AgentProfile[]; activeProfileId: string; streamEnabled: boolean;
  mode?: 'orca' | 'builtin'; orcaBaseUrl?: string;
}
interface PluginInfo {
  id: string; manifest: { name: string; displayName: string; description: string; version: string; author: string; contributes?: any };
  enabled: boolean; builtin: boolean; path: string;
}
interface SettingsData {
  aiConfig: AIConfig | null; theme: "dark" | "light";
  editor: { fontSize: number; fontFamily: string; tabSize: number; wordWrap: "off" | "on"; minimap: boolean; lineNumbers: boolean; cursorBlinking: string; smoothScrolling: boolean; formatOnSave: boolean; autoSave: "off" | "afterDelay"; };
  recentFolders: string[];
}
interface Props { onClose: () => void; }

function OrcaStatusIndicator({ baseUrl }: { baseUrl: string }) {
  const [status, setStatus] = useState<{ ok: boolean; version?: string } | null>(null);
  useEffect(() => {
    (window as any).loom.ai.checkOrcaStatus().then((s: any) => setStatus(s)).catch(() => setStatus(null));
  }, [baseUrl]);
  if (!status) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Checking...</span>;
  if (status.ok) return <span style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />Online v{status.version}</span>;
  return <span style={{ fontSize: 11, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)' }} />Offline</span>;
}

export default function Settings({ onClose }: Props) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [section, setSection] = useState("providers");
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState<string | null>(null);
  const [newModelInput, setNewModelInput] = useState("");

  useEffect(() => {
    (window as any).loom.settings.getAll().then((s: any) => setSettings(s)).catch(() => {});
    (window as any).loom.ai.getConfig().then((c: AIConfig) => setAiConfig(c)).catch(() => {});
    (window as any).loom.plugins.getAll().then((p: PluginInfo[]) => setPlugins(p)).catch(() => {});
  }, []);

  const updateEditor = useCallback(<K extends keyof SettingsData["editor"]>(key: K, value: any) => {
    setSettings(s => {
      if (!s) return s;
      const next = { ...s.editor, [key]: value };
      (window as any).loom.settings.set("editor", next);
      window.dispatchEvent(new CustomEvent("loom:setting-change", { detail: { key: "editor." + key, value } }));
      return { ...s, editor: next };
    });
  }, []);

  const updateTheme = useCallback((theme: "dark" | "light") => {
    setSettings(s => {
      if (!s) return s;
      (window as any).loom.settings.set("theme", theme);
      document.documentElement.setAttribute('data-theme', theme);
      return { ...s, theme };
    });
  }, []);

  const saveAll = async () => {
    if (settings) await (window as any).loom.settings.setAll(settings);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const updateAiProvider = async (id: string, patch: Partial<AIProvider>) => {
    const updated = await (window as any).loom.ai.updateProvider(id, patch);
    setAiConfig(updated);
  };
  const setActiveProvider = async (id: string) => {
    const updated = await (window as any).loom.ai.updateConfig({ activeProviderId: id });
    setAiConfig(updated);
  };
  const testConn = async (providerId: string) => {
    setTesting(providerId); setTestResult(null);
    try { const r = await (window as any).loom.ai.testConnection(providerId); setTestResult(r); }
    catch (e: any) { setTestResult({ ok: false, msg: e.message }); }
    setTesting(null);
  };
  const addCustomProvider = async () => {
    const id = "custom-" + Date.now();
    const updated = await (window as any).loom.ai.addProvider({ id, name: "New Provider", baseUrl: "", apiKey: "", models: [], activeModel: "", isCustom: true });
    setAiConfig(updated); setEditProvider(id);
  };
  const removeProvider = async (id: string) => {
    const updated = await (window as any).loom.ai.removeProvider(id);
    setAiConfig(updated); if (editProvider === id) setEditProvider(null);
  };
  const updateProfile = async (id: string, patch: Partial<AgentProfile>) => {
    const updated = await (window as any).loom.ai.updateProfile(id, patch);
    setAiConfig(updated);
  };
  const addProfile = async () => {
    const id = "profile-" + Date.now();
    const updated = await (window as any).loom.ai.addProfile({ id, name: "New Agent", systemPrompt: "You are a helpful assistant.", providerId: "", model: "", temperature: 0.7, maxTokens: 4096, icon: "\u{1F916}" });
    setAiConfig(updated); setEditProfile(id);
  };
  const removeProfile = async (id: string) => {
    const updated = await (window as any).loom.ai.removeProfile(id);
    setAiConfig(updated); if (editProfile === id) setEditProfile(null);
  };
  const togglePlugin = async (id: string, enabled: boolean) => {
    await (window as any).loom.plugins.setEnabled(id, enabled);
    setPlugins(p => p.map(pl => pl.id === id ? { ...pl, enabled } : pl));
  };
  const installPlugin = async () => {
    const result = await (window as any).loom.plugins.installFromFile();
    if (result?.ok) { const all = await (window as any).loom.plugins.getAll(); setPlugins(all); }
  };
  const uninstallPlugin = async (id: string) => {
    await (window as any).loom.plugins.uninstall(id);
    setPlugins(p => p.filter(pl => pl.id !== id));
  };

  if (!settings || !aiConfig) {
    return (
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text-muted)" }}>Loading settings...</span>
        </div>
      </div>
    );
  }

  const sections = [
    { id: "providers", label: "AI Providers", icon: "P" },
    { id: "profiles", label: "Agent Profiles", icon: "A" },
    { id: "plugins", label: "Extensions", icon: "E" },
    { id: "editor", label: "Editor", icon: "e" },
    { id: "theme", label: "Appearance", icon: "T" },
    { id: "keybindings", label: "Keybindings", icon: "K" },
  ];

  const renderProviders = () => (
    <div className="settings-section">
      {/* AI Mode Switcher */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "10px 12px", background: "var(--bg-tertiary)", borderRadius: 6, border: "1px solid var(--border)" }}>
        <div>
          <div className="settings-label" style={{ fontSize: 13, marginBottom: 2 }}>AI Mode</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{aiConfig.mode === 'orca' ? 'Using Orca Agent proxy (recommended)' : 'Using built-in direct API'}</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`settings-btn-sm ${aiConfig.mode === 'orca' ? 'active' : ''}`} style={aiConfig.mode === 'orca' ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : {}} onClick={async () => { const c = await (window as any).loom.ai.updateConfig({ mode: 'orca' }); setAiConfig(c); }}>Orca</button>
          <button className={`settings-btn-sm ${aiConfig.mode === 'builtin' ? 'active' : ''}`} style={aiConfig.mode === 'builtin' ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : {}} onClick={async () => { const c = await (window as any).loom.ai.updateConfig({ mode: 'builtin' }); setAiConfig(c); }}>Built-in</button>
        </div>
      </div>
      {/* Orca Address Config */}
      {aiConfig.mode === 'orca' && (
        <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--bg-tertiary)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <div className="settings-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="settings-label">Orca Server Address</div>
              <OrcaStatusIndicator baseUrl={aiConfig.orcaBaseUrl || 'http://127.0.0.1:18080'} />
            </div>
            <input className="settings-input" value={aiConfig.orcaBaseUrl || 'http://127.0.0.1:18080'} placeholder="http://127.0.0.1:18080" onChange={async (e) => { const c = await (window as any).loom.ai.updateConfig({ orcaBaseUrl: e.target.value }); setAiConfig(c); }} />
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="settings-label" style={{ fontSize: 13 }}>Active Provider</div>
        <select className="settings-select" value={aiConfig.activeProviderId} onChange={e => setActiveProvider(e.target.value)}>
          {aiConfig.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="settings-divider" />
      {aiConfig.providers.map(p => (
        <div key={p.id} className="settings-provider-card">
          <div className="settings-provider-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="settings-provider-name">{p.name}</span>
              {aiConfig.activeProviderId === p.id && <span className="settings-provider-active">Active</span>}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="settings-btn-sm" onClick={() => setEditProvider(editProvider === p.id ? null : p.id)}>
                {editProvider === p.id ? "Close" : "Edit"}
              </button>
              {p.isCustom && <button className="settings-btn-sm" style={{ color: "var(--red)" }} onClick={() => removeProvider(p.id)}>Delete</button>}
            </div>
          </div>
          {editProvider === p.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="settings-group"><div className="settings-label">Name</div><input className="settings-input" value={p.name} onChange={e => updateAiProvider(p.id, { name: e.target.value })} /></div>
              <div className="settings-group"><div className="settings-label">Base URL</div><input className="settings-input" value={p.baseUrl} placeholder="https://api.example.com/v1" onChange={e => updateAiProvider(p.id, { baseUrl: e.target.value })} /></div>
              <div className="settings-group"><div className="settings-label">API Key</div><div className="settings-input-row"><input className="settings-input" type="password" value={p.apiKey} placeholder="sk-..." onChange={e => updateAiProvider(p.id, { apiKey: e.target.value })} /><button className="settings-btn-sm" onClick={() => testConn(p.id)} disabled={testing === p.id || !p.apiKey}>{testing === p.id ? "..." : "Test"}</button></div></div>
              <div className="settings-group"><div className="settings-label">Models</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>{p.models.map((m, i) => (<span key={i} style={{ padding: "2px 8px", background: m === p.activeModel ? "var(--accent)" : "var(--bg-tertiary)", color: m === p.activeModel ? "white" : "var(--text-primary)", borderRadius: 3, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }} onClick={() => updateAiProvider(p.id, { activeModel: m })}>{m}<span onClick={e => { e.stopPropagation(); const nm = p.models.filter((_, idx) => idx !== i); updateAiProvider(p.id, { models: nm, activeModel: p.activeModel === m ? (nm[0] || "") : p.activeModel }); }} style={{ cursor: "pointer", opacity: 0.6 }}>&times;</span></span>))}</div><div style={{ display: "flex", gap: 4 }}><input className="settings-input" style={{ flex: 1 }} placeholder="Add model name..." value={newModelInput} onChange={e => setNewModelInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newModelInput.trim()) { updateAiProvider(p.id, { models: [...p.models, newModelInput.trim()] }); setNewModelInput(""); } }} /><button className="settings-btn-sm" onClick={() => { if (newModelInput.trim()) { updateAiProvider(p.id, { models: [...p.models, newModelInput.trim()] }); setNewModelInput(""); } }}>Add</button></div></div>
              <div className="settings-group"><div className="settings-label">Active Model</div><select className="settings-select" value={p.activeModel} onChange={e => updateAiProvider(p.id, { activeModel: e.target.value })}>{p.models.map(m => <option key={m} value={m}>{m}</option>)}{p.models.length === 0 && <option value="">No models</option>}</select></div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.baseUrl || "No URL"} · {p.models.length} models · Key: {p.apiKey ? "****" : "Not set"}</div>
          )}
        </div>
      ))}
      <button className="settings-btn-sm" style={{ marginTop: 8 }} onClick={addCustomProvider}>+ Add Custom Provider</button>
      {testResult && (<div className={`settings-test-result ${testResult.ok ? "success" : "error"}`}>{testResult.ok ? "Connected: " : "Error: "}{testResult.msg}</div>)}
    </div>
  );

  const renderProfiles = () => (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="settings-label" style={{ fontSize: 13 }}>Active Profile</div>
        <select className="settings-select" value={aiConfig.activeProfileId} onChange={e => (window as any).loom.ai.updateConfig({ activeProfileId: e.target.value }).then((c: AIConfig) => setAiConfig(c))}>
          {aiConfig.profiles.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </div>
      <div className="settings-divider" />
      {aiConfig.profiles.map(p => (
        <div key={p.id} className="settings-provider-card">
          <div className="settings-provider-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16 }}>{p.icon}</span><span className="settings-provider-name">{p.name}</span>{aiConfig.activeProfileId === p.id && <span className="settings-provider-active">Active</span>}</div>
            <div style={{ display: "flex", gap: 4 }}><button className="settings-btn-sm" onClick={() => setEditProfile(editProfile === p.id ? null : p.id)}>{editProfile === p.id ? "Close" : "Edit"}</button><button className="settings-btn-sm" style={{ color: "var(--red)" }} onClick={() => removeProfile(p.id)}>Delete</button></div>
          </div>
          {editProfile === p.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="settings-group"><div className="settings-label">Name</div><input className="settings-input" value={p.name} onChange={e => updateProfile(p.id, { name: e.target.value })} /></div>
              <div className="settings-group"><div className="settings-label">Icon (emoji)</div><input className="settings-input" value={p.icon} style={{ width: 60 }} onChange={e => updateProfile(p.id, { icon: e.target.value })} /></div>
              <div className="settings-group"><div className="settings-label">System Prompt</div><textarea className="settings-input" value={p.systemPrompt} rows={4} style={{ resize: "vertical", padding: "6px 8px" }} onChange={e => updateProfile(p.id, { systemPrompt: e.target.value })} /></div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="settings-group" style={{ flex: 1 }}><div className="settings-label">Temperature</div><input className="settings-input" type="number" min="0" max="2" step="0.1" value={p.temperature} onChange={e => updateProfile(p.id, { temperature: parseFloat(e.target.value) || 0.7 })} /></div>
                <div className="settings-group" style={{ flex: 1 }}><div className="settings-label">Max Tokens</div><input className="settings-input" type="number" min="256" max="128000" step="256" value={p.maxTokens} onChange={e => updateProfile(p.id, { maxTokens: parseInt(e.target.value) || 4096 })} /></div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Temp: {p.temperature} · Max tokens: {p.maxTokens} · {p.systemPrompt.substring(0, 80)}...</div>
          )}
        </div>
      ))}
      <button className="settings-btn-sm" style={{ marginTop: 8 }} onClick={addProfile}>+ Add Agent Profile</button>
    </div>
  );

  const renderPlugins = () => (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="settings-label" style={{ fontSize: 13 }}>{plugins.length} Extensions</div>
        <button className="settings-btn-sm" onClick={installPlugin}>Install from Folder...</button>
      </div>
      <div className="settings-divider" />
      {plugins.map(p => (
        <div key={p.id} className="settings-provider-card" style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.manifest.displayName || p.manifest.name}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>v{p.manifest.version}</span>
                {p.builtin && <span style={{ fontSize: 9, background: "var(--accent)", color: "white", padding: "1px 6px", borderRadius: 3 }}>Built-in</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.manifest.description}</div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>{p.manifest.author}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label className="settings-toggle"><input type="checkbox" checked={p.enabled} disabled={p.builtin} onChange={e => togglePlugin(p.id, e.target.checked)} /><span className={`settings-toggle-slider ${p.builtin ? 'disabled' : ''}`} /></label>
              {!p.builtin && <button className="settings-btn-sm" style={{ color: "var(--red)" }} onClick={() => uninstallPlugin(p.id)}>Uninstall</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderEditor = () => (
    <div className="settings-section">
      <div className="settings-group"><div className="settings-label">Font Size</div><div className="settings-input-row"><input className="settings-input" type="number" min="8" max="32" value={settings.editor.fontSize} onChange={e => updateEditor("fontSize", parseInt(e.target.value) || 14)} /><span className="settings-unit">px</span></div></div>
      <div className="settings-group"><div className="settings-label">Font Family</div><input className="settings-input" value={settings.editor.fontFamily} onChange={e => updateEditor("fontFamily", e.target.value)} /></div>
      <div className="settings-group"><div className="settings-label">Tab Size</div><select className="settings-select" value={settings.editor.tabSize} onChange={e => updateEditor("tabSize", parseInt(e.target.value))}><option value={2}>2</option><option value={4}>4</option><option value={8}>8</option></select></div>
      {[{ label: "Word Wrap", check: settings.editor.wordWrap === "on", toggle: () => updateEditor("wordWrap", settings.editor.wordWrap === "on" ? "off" : "on") },
        { label: "Minimap", check: settings.editor.minimap, toggle: () => updateEditor("minimap", !settings.editor.minimap) },
        { label: "Line Numbers", check: settings.editor.lineNumbers, toggle: () => updateEditor("lineNumbers", !settings.editor.lineNumbers) },
        { label: "Smooth Scrolling", check: settings.editor.smoothScrolling, toggle: () => updateEditor("smoothScrolling", !settings.editor.smoothScrolling) },
        { label: "Format on Save", check: settings.editor.formatOnSave, toggle: () => updateEditor("formatOnSave", !settings.editor.formatOnSave) },
      ].map((item, i) => (<div key={i} className="settings-group"><div className="settings-label">{item.label}</div><label className="settings-toggle"><input type="checkbox" checked={item.check} onChange={item.toggle} /><span className="settings-toggle-slider" /></label></div>))}
      <div className="settings-group"><div className="settings-label">Cursor Blinking</div><select className="settings-select" value={settings.editor.cursorBlinking} onChange={e => updateEditor("cursorBlinking", e.target.value)}><option value="blink">Blink</option><option value="smooth">Smooth</option><option value="phase">Phase</option><option value="expand">Expand</option><option value="solid">Solid</option></select></div>
      <div className="settings-group"><div className="settings-label">Auto Save</div><select className="settings-select" value={settings.editor.autoSave} onChange={e => updateEditor("autoSave", e.target.value)}><option value="off">Off</option><option value="afterDelay">After Delay</option></select></div>
    </div>
  );

  const renderTheme = () => (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-label">Theme</div>
        <div className="settings-theme-grid">
          {[{ id: "dark" as const, label: "Dark", bg: "#1e1e1e" }, { id: "light" as const, label: "Light", bg: "#f8f9fa" }].map(t => (
            <div key={t.id} className={`settings-theme-card ${settings.theme === t.id ? "active" : ""}`} onClick={() => updateTheme(t.id)}>
              <div className="settings-theme-preview" style={{ background: t.bg }} /><span>{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderKeybindings = () => (
    <div className="settings-section">
      <table className="settings-keybindings-table">
        <thead><tr><th>Command</th><th>Shortcut</th></tr></thead>
        <tbody>
          {[["Save","Ctrl+S"],["Save All","Ctrl+Shift+S"],["Open File","Ctrl+O"],["Open Folder","Ctrl+K"],["New File","Ctrl+N"],["Find","Ctrl+F"],["Find & Replace","Ctrl+H"],["Command Palette","Ctrl+Shift+P"],["Toggle Sidebar","Ctrl+B"],["Toggle Terminal","Ctrl+`"],["Toggle Word Wrap","Alt+Z"],["Close Tab","Ctrl+W"],["Settings","Ctrl+,"],["Go to Definition","F12"],["Find References","Shift+F12"],["Rename Symbol","F2"],["Format Document","Shift+Alt+F"],["Toggle Comment","Ctrl+/"],["Start Debug","F5"],["Stop Debug","Shift+F5"],["Step Over","F10"],["Step Into","F11"]].map(([cmd, key]) => (
            <tr key={cmd}><td>{cmd}</td><td><kbd>{key}</kbd></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );

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
            <div key={s.id} className={`settings-nav-item ${section === s.id ? "active" : ""}`} onClick={() => setSection(s.id)}>
              <span className="settings-nav-icon">{s.icon}</span><span>{s.label}</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div className="settings-sidebar-footer">
            {saved && <span style={{ color: "var(--green)", fontSize: 11 }}>Saved</span>}
            <button className="settings-save-btn" onClick={saveAll}>Save All</button>
          </div>
        </div>
        <div className="settings-content">
          <div className="settings-content-header"><h2>{sections.find(s => s.id === section)?.label}</h2></div>
          <div className="settings-scroll">
            {section === "providers" && renderProviders()}
            {section === "profiles" && renderProfiles()}
            {section === "plugins" && renderPlugins()}
            {section === "editor" && renderEditor()}
            {section === "theme" && renderTheme()}
            {section === "keybindings" && renderKeybindings()}
          </div>
        </div>
      </div>
    </div>
  );
}
