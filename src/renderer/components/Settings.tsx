import React, { useState, useEffect, useCallback } from "react";
import { t, setLocale, getLocale } from '@/shared/i18n';

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

const PROVIDER_META: Record<string, { group: string; tags?: string[] }> = {
  deepseek: { group: '国产优选', tags: ['性价比', '推荐'] },
  doubao: { group: '国产优选', tags: ['长上下文'] },
  dashscope: { group: '国产优选', tags: ['推荐'] },
  zhipu: { group: '国产优选', tags: ['长上下文'] },
  moonshot: { group: '国产优选', tags: ['长上下文', '推荐'] },
  siliconflow: { group: '国产优选', tags: ['性价比'] },
  xiaomi: { group: '国产优选', tags: ['性价比'] },
  yi: { group: '国产优选' },
  baichuan: { group: '国产优选' },
  minimax: { group: '国产优选' },
  openai: { group: '国际', tags: ['能力强'] },
};
interface PluginInfo {
  id: string; manifest: { name: string; displayName: string; description: string; version: string; author: string; contributes?: any };
  enabled: boolean; builtin: boolean; path: string;
}
interface SettingsData {
  aiConfig: AIConfig | null; theme: "dark" | "light" | "system";
  editor: { fontSize: number; fontFamily: string; tabSize: number; wordWrap: "off" | "on"; minimap: boolean; lineNumbers: boolean; cursorBlinking: string; smoothScrolling: boolean; formatOnSave: boolean; autoSave: "off" | "afterDelay"; };
  recentFolders: string[];
  locale?: 'zh-CN' | 'en-US';
  history?: { maxEntriesPerFile: number; maxAgeDays: number; maxTotalMB: number };
}
interface Props { onClose: () => void; locale?: 'zh-CN' | 'en-US'; }

function OrcaStatusIndicator({ baseUrl }: { baseUrl: string }) {
  const [status, setStatus] = useState<{ ok: boolean; version?: string } | null>(null);
  useEffect(() => {
    window.loom.ai.checkOrcaStatus().then((s: any) => setStatus(s)).catch(() => setStatus(null));
  }, [baseUrl]);
  if (!status) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>...</span>;
  if (status.ok) return <span style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />Online v{status.version}</span>;
  return <span style={{ fontSize: 11, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)' }} />Offline</span>;
}

export default function Settings({ onClose, locale = 'zh-CN' }: Props) {
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
  const [currentLocale, setCurrentLocale] = useState(locale);

  useEffect(() => {
    window.loom.settings.getAll().then((s: any) => setSettings(s)).catch(() => {});
    window.loom.ai.getConfig().then((c: AIConfig) => setAiConfig(c)).catch(() => {});
    window.loom.plugins.getAll().then((p: any[]) => setPlugins(p)).catch(() => {});
  }, []);

  const updateEditor = useCallback(<K extends keyof SettingsData["editor"]>(key: K, value: any) => {
    setSettings(s => {
      if (!s) return s;
      const next = { ...s.editor, [key]: value };
      window.loom.settings.set("editor", next);
      window.dispatchEvent(new CustomEvent("loom:setting-change", { detail: { key: "editor." + key, value } }));
      return { ...s, editor: next };
    });
  }, []);

  const updateTheme = useCallback((theme: "dark" | "light" | "system") => {
    setSettings(s => {
      if (!s) return s;
      window.loom.settings.set("theme", theme);
      document.documentElement.setAttribute('data-theme', theme);
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.style.colorScheme = prefersDark ? 'dark' : 'light';
      }
      window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'theme', value: theme } }));
      return { ...s, theme };
    });
  }, []);

  const updateLocaleSetting = useCallback((newLocale: 'zh-CN' | 'en-US') => {
    setCurrentLocale(newLocale);
    setLocale(newLocale);
    window.loom.settings.set('locale', newLocale);
    window.dispatchEvent(new CustomEvent('loom:setting-change', { detail: { key: 'locale', value: newLocale } }));
  }, []);

  const saveAll = async () => {
    if (settings) await window.loom.settings.setAll(settings);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const updateAiProvider = async (id: string, patch: Partial<AIProvider>) => {
    setAiConfig(prev => prev ? ({ ...prev, providers: prev.providers.map(p => p.id === id ? { ...p, ...patch } : p) }) : prev);
    try { await window.loom.ai.updateProvider(id, patch); } catch { try { setAiConfig(await window.loom.ai.getConfig()); } catch {} }
  };
  const setActiveProvider = async (id: string) => {
    setAiConfig(prev => prev ? { ...prev, activeProviderId: id } : prev);
    try { await window.loom.ai.updateConfig({ activeProviderId: id }); } catch { try { setAiConfig(await window.loom.ai.getConfig()); } catch {} }
  };
  const updateAiConfig = async (patch: Partial<AIConfig>) => {
    setAiConfig(prev => prev ? { ...prev, ...patch } : prev);
    try { await window.loom.ai.updateConfig(patch); } catch { try { setAiConfig(await window.loom.ai.getConfig()); } catch {} }
  };
  const testConn = async (providerId: string) => {
    setTesting(providerId); setTestResult(null);
    try { const r = await window.loom.ai.testConnection(providerId); setTestResult(r); }
    catch (e: any) { setTestResult({ ok: false, msg: e.message }); }
    setTesting(null);
  };
  const addCustomProvider = async () => {
    const id = "custom-" + Date.now();
    const updated = await window.loom.ai.addProvider({ id, name: "New Provider", baseUrl: "", apiKey: "", models: [], activeModel: "", isCustom: true });
    setAiConfig(updated); setEditProvider(id);
  };
  const removeProvider = async (id: string) => {
    const updated = await window.loom.ai.removeProvider(id);
    setAiConfig(updated); if (editProvider === id) setEditProvider(null);
  };
  const updateProfile = async (id: string, patch: Partial<AgentProfile>) => {
    setAiConfig(prev => prev ? ({ ...prev, profiles: prev.profiles.map(p => p.id === id ? { ...p, ...patch } : p) }) : prev);
    try { await window.loom.ai.updateProfile(id, patch); } catch { try { setAiConfig(await window.loom.ai.getConfig()); } catch {} }
  };
  const addProfile = async () => {
    const id = "profile-" + Date.now();
    const updated = await window.loom.ai.addProfile({ id, name: "New Agent", systemPrompt: "You are a helpful assistant.", providerId: "", model: "", temperature: 0.7, maxTokens: 4096, icon: "\u{1F916}" });
    setAiConfig(updated); setEditProfile(id);
  };
  const removeProfile = async (id: string) => {
    const updated = await window.loom.ai.removeProfile(id);
    setAiConfig(updated); if (editProfile === id) setEditProfile(null);
  };
  const togglePlugin = async (id: string, enabled: boolean) => {
    await window.loom.plugins.setEnabled(id, enabled);
    setPlugins(p => p.map(pl => pl.id === id ? { ...pl, enabled } : pl));
  };
  const installPlugin = async () => {
    const result = await window.loom.plugins.installFromFile();
    if (result?.ok) { const all = await window.loom.plugins.getAll() as any[]; setPlugins(all); }
  };
  const uninstallPlugin = async (id: string) => {
    await window.loom.plugins.uninstall(id);
    setPlugins(p => p.filter(pl => pl.id !== id));
  };

  const [fetchingModels, setFetchingModels] = useState<string | null>(null);
  const [envProviders, setEnvProviders] = useState<any[]>([]);
  const [showUrlWizard, setShowUrlWizard] = useState(false);
  const [wizardName, setWizardName] = useState('');
  const [wizardUrl, setWizardUrl] = useState('');
  const [wizardKey, setWizardKey] = useState('');
  const [wizardBusy, setWizardBusy] = useState(false);

  useEffect(() => {
    window.loom?.ai?.detectEnvProviders?.().then((list: any[]) => setEnvProviders(list || [])).catch(() => {});
  }, []);

  if (!settings || !aiConfig) {
    return (
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text-muted)" }}>{t('settings.loading')}</span>
        </div>
      </div>
    );
  }

  const tk = (key: string) => t(`settings.${key}`);

  const sections = [
    { id: "providers", label: tk('sectionProviders'), icon: "P" },
    { id: "profiles", label: tk('sectionProfiles'), icon: "A" },
    { id: "plugins", label: tk('sectionPlugins'), icon: "E" },
    { id: "editor", label: tk('sectionEditor'), icon: "e" },
    { id: "theme", label: tk('sectionAppearance'), icon: "T" },
    { id: "language", label: tk('sectionLanguage'), icon: "L" },
    { id: "keybindings", label: tk('sectionKeybindings'), icon: "K" },
  ];

  const fetchModels = async (providerId: string) => {
    setFetchingModels(providerId);
    try {
      const r = await window.loom.ai.listModels(providerId);
      const refreshed = await window.loom.ai.getConfig();
      setAiConfig(refreshed);
      setTestResult({ ok: r.ok, msg: r.ok ? `已拉取 ${r.models.length} 个模型` : (r.msg || '拉取失败') });
    } catch (e: any) { setTestResult({ ok: false, msg: e.message }); }
    setFetchingModels(null);
  };

  const groupedProviders = () => {
    const groups: Record<string, AIProvider[]> = {};
    for (const p of aiConfig.providers) {
      const g = (PROVIDER_META[p.id]?.group) || (p.isCustom ? tk('customGroup') : '其他');
      (groups[g] = groups[g] || []).push(p);
    }
    const order = ['国产优选', '国际', tk('customGroup'), '其他'];
    return Object.entries(groups).sort((a, b) => (order.indexOf(a[0]) + 1) - (order.indexOf(b[0]) + 1));
  };

  const renderProviderCard = (p: AIProvider) => {
    const meta = PROVIDER_META[p.id];
    return (
      <div key={p.id} className="settings-provider-card">
        <div className="settings-provider-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="settings-provider-name">{p.name}</span>
            {meta?.tags?.map(t => <span key={t} className="settings-tag">{t}</span>)}
            {aiConfig.activeProviderId === p.id && <span className="settings-provider-active">{tk('active')}</span>}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="settings-btn-sm" onClick={() => setEditProvider(editProvider === p.id ? null : p.id)}>
              {editProvider === p.id ? tk('close') : tk('edit')}
            </button>
            {p.isCustom && <button className="settings-btn-sm" style={{ color: "var(--red)" }} onClick={() => removeProvider(p.id)}>{tk('delete')}</button>}
          </div>
        </div>
        {editProvider === p.id ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="settings-group"><div className="settings-label">{tk('name')}</div><input className="settings-input" value={p.name} onChange={e => updateAiProvider(p.id, { name: e.target.value })} /></div>
            <div className="settings-group"><div className="settings-label">{tk('baseUrl')}</div><input className="settings-input" value={p.baseUrl} placeholder="https://api.example.com/v1" onChange={e => updateAiProvider(p.id, { baseUrl: e.target.value })} /></div>
            <div className="settings-group"><div className="settings-label">{tk('apiKey')}</div><div className="settings-input-row"><input className="settings-input" type="password" value={p.apiKey} placeholder="sk-..." onChange={e => {
              const v = e.target.value;
              // 掩码占位符只读：一碰输入框就用掩码覆盖真实密钥会让 AI 静默失效（主进程同样有过滤）
              if (v === '********') return;
              updateAiProvider(p.id, { apiKey: v });
            }} /><button className="settings-btn-sm" onClick={() => testConn(p.id)} disabled={testing === p.id || !p.apiKey}>{testing === p.id ? "..." : tk('test')}</button><button className="settings-btn-sm" onClick={() => fetchModels(p.id)} disabled={fetchingModels === p.id || !p.apiKey || !p.baseUrl}>{fetchingModels === p.id ? "..." : tk('fetchModels')}</button></div></div>
            <div className="settings-group"><div className="settings-label">{tk('models')}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>{p.models.map((m, i) => (<span key={`${i}-${m}`} style={{ padding: "2px 8px", background: m === p.activeModel ? "var(--accent)" : "var(--bg-tertiary)", color: m === p.activeModel ? "white" : "var(--text-primary)", borderRadius: 3, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }} onClick={() => updateAiProvider(p.id, { activeModel: m })}>{m}<span onClick={e => { e.stopPropagation(); const nm = p.models.filter((_, idx) => idx !== i); updateAiProvider(p.id, { models: nm, activeModel: p.activeModel === m ? (nm[0] || "") : p.activeModel }); }} style={{ cursor: "pointer", opacity: 0.6 }}>&times;</span></span>))}</div><div style={{ display: "flex", gap: 4 }}><input className="settings-input" style={{ flex: 1 }} placeholder={tk('addModelPlaceholder')} value={newModelInput} onChange={e => setNewModelInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newModelInput.trim()) { updateAiProvider(p.id, { models: [...p.models, newModelInput.trim()] }); setNewModelInput(""); } }} /><button className="settings-btn-sm" onClick={() => { if (newModelInput.trim()) { updateAiProvider(p.id, { models: [...p.models, newModelInput.trim()] }); setNewModelInput(""); } }}>{tk('add')}</button></div></div>
            <div className="settings-group"><div className="settings-label">{tk('activeModel')}</div><select className="settings-select" value={p.activeModel} onChange={e => updateAiProvider(p.id, { activeModel: e.target.value })}>{p.models.map(m => <option key={m} value={m}>{m}</option>)}{p.models.length === 0 && <option value="">{tk('noModels')}</option>}</select></div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.baseUrl || tk('noUrl')} · {p.models.length} {tk('models')} · Key: {p.apiKey ? tk('keyEncryptedSaved') : tk('keyNotSet')}</div>
        )}
      </div>
    );
  };

  const renderProviders = () => (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "10px 12px", background: "var(--bg-tertiary)", borderRadius: 6, border: "1px solid var(--border)" }}>
        <div>
          <div className="settings-label" style={{ fontSize: 13, marginBottom: 2 }}>{tk('aiMode')}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{aiConfig.mode === 'orca' ? tk('usingOrca') : tk('usingBuiltin')}</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`settings-btn-sm ${aiConfig.mode === 'orca' ? 'active' : ''}`} style={aiConfig.mode === 'orca' ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : {}} onClick={() => updateAiConfig({ mode: 'orca' })}>{tk('orca')}</button>
          <button className={`settings-btn-sm ${aiConfig.mode === 'builtin' ? 'active' : ''}`} style={aiConfig.mode === 'builtin' ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : {}} onClick={() => updateAiConfig({ mode: 'builtin' })}>{tk('builtin')}</button>
        </div>
      </div>
      {aiConfig.mode === 'orca' && (
        <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--bg-tertiary)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <div className="settings-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="settings-label">{tk('orcaServerAddress')}</div>
              <OrcaStatusIndicator baseUrl={aiConfig.orcaBaseUrl || 'http://127.0.0.1:18080'} />
            </div>
            <input className="settings-input" value={aiConfig.orcaBaseUrl || 'http://127.0.0.1:18080'} placeholder="http://127.0.0.1:18080" onChange={e => updateAiConfig({ orcaBaseUrl: e.target.value })} />
          </div>
        </div>
      )}
      {envProviders.length > 0 && (
        <div style={{ marginBottom: 10, padding: "8px 10px", background: "var(--accent-soft)", borderRadius: 6, border: "1px solid var(--accent-border)" }}>
          <div className="settings-label" style={{ fontSize: 12, marginBottom: 4 }}>{tk('detectedEnvKey')}</div>
          {envProviders.map(ep => (
            <div key={ep.providerId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 2 }}>
              <span>{ep.name} <code style={{ opacity: 0.7 }}>{ep.envVar}</code> {ep.hasKey ? `· ${tk('active')}` : ""}</span>
              {!ep.hasKey && (
                <button className="settings-btn-sm" onClick={async () => {
                  const r: any = await window.loom.ai.applyEnvProvider(ep.providerId);
                  if (r?.ok) { setAiConfig(r.config); setEnvProviders(e => e.map(x => x.providerId === ep.providerId ? { ...x, hasKey: true } : x)); }
                }}>{tk('import')}</button>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <button className="settings-btn-sm" style={{ marginBottom: 6 }} onClick={() => setShowUrlWizard(v => !v)}>
          {showUrlWizard ? tk('collapseGuide') : tk('addFromUrl')}
        </button>
        {showUrlWizard && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", background: "var(--bg-tertiary)", borderRadius: 6, border: "1px solid var(--border)" }}>
            <input className="settings-input" placeholder={tk('providerNamePlaceholder')} value={wizardName} onChange={e => setWizardName(e.target.value)} />
            <input className="settings-input" placeholder={tk('providerUrlPlaceholder')} value={wizardUrl} onChange={e => setWizardUrl(e.target.value)} />
            <input className="settings-input" type="password" placeholder={tk('apiKey')} value={wizardKey} onChange={e => setWizardKey(e.target.value)} />
            <button className="settings-btn-sm" disabled={wizardBusy || !wizardUrl || !wizardKey} onClick={async () => {
              setWizardBusy(true);
              try {
                const id = "custom-" + Date.now();
                await window.loom.ai.addProvider({ id, name: wizardName || "Custom Provider", baseUrl: wizardUrl, apiKey: wizardKey, models: [], activeModel: "", isCustom: true });
                const r: any = await window.loom.ai.listModels(id);
                setAiConfig(await window.loom.ai.getConfig());
                setShowUrlWizard(false); setWizardName(""); setWizardUrl(""); setWizardKey("");
                setTestResult({ ok: r.ok, msg: r.ok ? `已添加并拉取 ${r.models.length} 个模型` : (r.msg || tk('fetchFailed')) });
              } catch (e: any) { setTestResult({ ok: false, msg: e.message }); }
              setWizardBusy(false);
            }}>{tk('fetchModelsAndAdd')}</button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="settings-label" style={{ fontSize: 13 }}>{tk('activeProvider')}</div>
        <select className="settings-select" value={aiConfig.activeProviderId} onChange={e => setActiveProvider(e.target.value)}>
          {aiConfig.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="settings-divider" />
      {groupedProviders().map(([group, list]) => (
        <div key={group}>
          <div className="settings-group-title">{group}</div>
          {list.map(p => renderProviderCard(p))}
        </div>
      ))}
      <button className="settings-btn-sm" style={{ marginTop: 8 }} onClick={addCustomProvider}>{tk('addCustomProvider')}</button>
      {testResult && (<div className={`settings-test-result ${testResult.ok ? "success" : "error"}`}>{testResult.ok ? tk('connected') + ": " : tk('error') + ": "}{testResult.msg}</div>)}
    </div>
  );

  const renderProfiles = () => (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="settings-label" style={{ fontSize: 13 }}>{tk('activeProfile')}</div>
        <select className="settings-select" value={aiConfig.activeProfileId} onChange={e => updateAiConfig({ activeProfileId: e.target.value })}>
          {aiConfig.profiles.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </div>
      <div className="settings-divider" />
      {aiConfig.profiles.map(p => (
        <div key={p.id} className="settings-provider-card">
          <div className="settings-provider-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16 }}>{p.icon}</span><span className="settings-provider-name">{p.name}</span>{aiConfig.activeProfileId === p.id && <span className="settings-provider-active">{tk('active')}</span>}</div>
            <div style={{ display: "flex", gap: 4 }}><button className="settings-btn-sm" onClick={() => setEditProfile(editProfile === p.id ? null : p.id)}>{editProfile === p.id ? tk('close') : tk('edit')}</button><button className="settings-btn-sm" style={{ color: "var(--red)" }} onClick={() => removeProfile(p.id)}>{tk('delete')}</button></div>
          </div>
          {editProfile === p.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="settings-group"><div className="settings-label">{tk('name')}</div><input className="settings-input" value={p.name} onChange={e => updateProfile(p.id, { name: e.target.value })} /></div>
              <div className="settings-group"><div className="settings-label">{tk('icon')}</div><input className="settings-input" value={p.icon} style={{ width: 60 }} onChange={e => updateProfile(p.id, { icon: e.target.value })} /></div>
              <div className="settings-group"><div className="settings-label">{tk('systemPrompt')}</div><textarea className="settings-input" value={p.systemPrompt} rows={4} style={{ resize: "vertical", padding: "6px 8px" }} onChange={e => updateProfile(p.id, { systemPrompt: e.target.value })} /></div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="settings-group" style={{ flex: 1 }}><div className="settings-label">{tk('temperature')}</div><input className="settings-input" type="number" min="0" max="2" step="0.1" value={p.temperature} onChange={e => updateProfile(p.id, { temperature: parseFloat(e.target.value) || 0.7 })} /></div>
                <div className="settings-group" style={{ flex: 1 }}><div className="settings-label">{tk('maxTokens')}</div><input className="settings-input" type="number" min="256" max="128000" step="256" value={p.maxTokens} onChange={e => updateProfile(p.id, { maxTokens: parseInt(e.target.value) || 4096 })} /></div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tk('tempMaxTokens').replace('{temp}', String(p.temperature)).replace('{max}', String(p.maxTokens))} · {p.systemPrompt.substring(0, 80)}...</div>
          )}
        </div>
      ))}
      <button className="settings-btn-sm" style={{ marginTop: 8 }} onClick={addProfile}>{tk('addAgentProfile')}</button>
    </div>
  );

  const renderPlugins = () => (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="settings-label" style={{ fontSize: 13 }}>{tk('extensionsCount').replace('{count}', String(plugins.length))}</div>
        <button className="settings-btn-sm" onClick={installPlugin}>{tk('installFromFolder')}</button>
      </div>
      <div className="settings-divider" />
      {plugins.map(p => (
        <div key={p.id} className="settings-provider-card" style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.manifest.displayName || p.manifest.name}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>v{p.manifest.version}</span>
                {p.builtin && <span style={{ fontSize: 9, background: "var(--accent)", color: "white", padding: "1px 6px", borderRadius: 3 }}>{tk('builtIn')}</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.manifest.description}</div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>{p.manifest.author}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label className="settings-toggle"><input type="checkbox" checked={p.enabled} disabled={p.builtin} onChange={e => togglePlugin(p.id, e.target.checked)} /><span className={`settings-toggle-slider ${p.builtin ? 'disabled' : ''}`} /></label>
              {!p.builtin && <button className="settings-btn-sm" style={{ color: "var(--red)" }} onClick={() => uninstallPlugin(p.id)}>{tk('uninstall')}</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderEditor = () => (
    <div className="settings-section">
      <div className="settings-group"><div className="settings-label">{tk('fontSize')}</div><div className="settings-input-row"><input className="settings-input" type="number" min="8" max="32" value={settings.editor.fontSize} onChange={e => updateEditor("fontSize", parseInt(e.target.value) || 14)} /><span className="settings-unit">px</span></div></div>
      <div className="settings-group"><div className="settings-label">{tk('fontFamily')}</div><input className="settings-input" value={settings.editor.fontFamily} onChange={e => updateEditor("fontFamily", e.target.value)} /></div>
      <div className="settings-group"><div className="settings-label">{tk('tabSize')}</div><select className="settings-select" value={settings.editor.tabSize} onChange={e => updateEditor("tabSize", parseInt(e.target.value))}><option value={2}>2</option><option value={4}>4</option><option value={8}>8</option></select></div>
      {[{ label: tk('wordWrap'), key: "wordWrap" as const, check: settings.editor.wordWrap === "on", toggle: () => updateEditor("wordWrap", settings.editor.wordWrap === "on" ? "off" : "on") },
        { label: tk('minimap'), key: "minimap" as const, check: settings.editor.minimap, toggle: () => updateEditor("minimap", !settings.editor.minimap) },
        { label: tk('lineNumbers'), key: "lineNumbers" as const, check: settings.editor.lineNumbers, toggle: () => updateEditor("lineNumbers", !settings.editor.lineNumbers) },
        { label: tk('smoothScrolling'), key: "smoothScrolling" as const, check: settings.editor.smoothScrolling, toggle: () => updateEditor("smoothScrolling", !settings.editor.smoothScrolling) },
        { label: tk('formatOnSave'), key: "formatOnSave" as const, check: settings.editor.formatOnSave, toggle: () => updateEditor("formatOnSave", !settings.editor.formatOnSave) },
      ].map((item, i) => (<div key={i} className="settings-group"><div className="settings-label">{item.label}</div><label className="settings-toggle"><input type="checkbox" checked={item.check} onChange={item.toggle} /><span className="settings-toggle-slider" /></label></div>))}
      <div className="settings-group"><div className="settings-label">{tk('cursorBlinking')}</div><select className="settings-select" value={settings.editor.cursorBlinking} onChange={e => updateEditor("cursorBlinking", e.target.value)}><option value="blink">{tk('blink')}</option><option value="smooth">{tk('smooth')}</option><option value="phase">{tk('phase')}</option><option value="expand">{tk('expand')}</option><option value="solid">{tk('solid')}</option></select></div>
      <div className="settings-group"><div className="settings-label">{tk('autoSave')}</div><select className="settings-select" value={settings.editor.autoSave} onChange={e => updateEditor("autoSave", e.target.value)}><option value="off">{tk('off')}</option><option value="afterDelay">{tk('afterDelay')}</option></select></div>
    </div>
  );

  const renderTheme = () => (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-label">{tk('sectionAppearance')}</div>
        <div className="settings-theme-grid">
          {[
            { id: "dark" as const, label: tk('darkTheme'), bg: "#1e1e1e" },
            { id: "light" as const, label: tk('lightTheme'), bg: "#f8f9fa" },
            { id: "system" as const, label: tk('systemTheme'), bg: "linear-gradient(135deg, #1e1e1e 0 50%, #f8f9fa 50% 100%)" },
          ].map(t => (
            <div key={t.id} className={`settings-theme-card ${settings.theme === t.id ? "active" : ""}`} onClick={() => updateTheme(t.id)}>
              <div className="settings-theme-preview" style={{ background: t.bg }} /><span>{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderLanguage = () => (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-label">{tk('language')}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>{tk('languageDesc')}</div>
        <div className="settings-theme-grid">
          {[
            { id: 'zh-CN' as const, label: tk('languageChinese'), flag: '🇨🇳' },
            { id: 'en-US' as const, label: tk('languageEnglish'), flag: '🇺🇸' },
          ].map(l => (
            <div key={l.id} className={`settings-theme-card ${currentLocale === l.id ? "active" : ""}`} onClick={() => updateLocaleSetting(l.id)}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{l.flag}</div>
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="settings-divider" />
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
        💡 {locale === 'zh-CN' ? '提示：更改语言后建议重启应用以获得最佳体验。' : 'Tip: For best experience, restart the app after changing language.'}
      </div>
    </div>
  );

  const renderKeybindings = () => (
    <div className="settings-section">
      <table className="settings-keybindings-table">
        <thead><tr><th>{tk('command')}</th><th>{tk('shortcut')}</th></tr></thead>
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
            <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
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
            {saved && <span style={{ color: "var(--green)", fontSize: 11 }}>{tk('saved')}</span>}
            <button className="settings-save-btn" onClick={saveAll}>{tk('saveAll')}</button>
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
            {section === "language" && renderLanguage()}
            {section === "keybindings" && renderKeybindings()}
          </div>
        </div>
      </div>
    </div>
  );
}
