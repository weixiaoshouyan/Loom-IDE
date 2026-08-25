/**
 * Loom Plugin System
 * Manages VSCode-compatible extensions with lifecycle, API surface, and marketplace.
 *
 * Lifecycle:
 *   - Built-in plugins are auto-activated at startup.
 *   - User-installed plugins are activated the first time they're enabled
 *     (`activate(plugin, api)` is called once).
 *   - `api` exposes a small, safe set of operations: registering commands,
 *     status-bar items, and listening to events.
 *
 * Manifest schema (compatible with a subset of VS Code's `package.json`):
 *   {
 *     "name": "my.plugin",
 *     "displayName": "My Plugin",
 *     "version": "1.0.0",
 *     "main": "./index.js",        // entry point, optional
 *     "activationEvents": ["*", "onCommand:foo"],  // default: ["*"]
 *     "contributes": {
 *       "commands": [{ "command": "foo", "title": "Do Foo" }],
 *       "configuration": { "foo.bar": { "type": "string", "default": "x" } }
 *     }
 *   }
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { loadPluginSandboxed, findUnknownCapabilities } from './plugin-sandbox';
import { PluginWorkerHost } from './plugin-worker';

/**
 * Validate a plugin manifest `main` entry so that `require()` cannot escape the
 * plugin directory (prevents path-traversal RCE from a malicious manifest).
 */
function sanitizePluginEntry(main?: string): { ok: boolean; main?: string; msg?: string } {
  if (!main) return { ok: true };
  // Reject absolute paths, parent traversal, and any null bytes.
  const normalized = main.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('..')) {
    return { ok: false, msg: 'Invalid plugin entry: path traversal is not allowed.' };
  }
  if (/[\0]/.test(main)) return { ok: false, msg: 'Invalid plugin entry.' };
  return { ok: true, main };
}

/** Ensure a resolved entry path stays inside the plugin root directory. */
function isInsidePluginRoot(pluginPath: string, entryPath: string): boolean {
  const root = path.resolve(pluginPath);
  const resolved = path.resolve(entryPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export interface PluginManifest {
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  author?: string;
  engines?: { loom?: string };
  main?: string;
  activationEvents?: string[];
  /**
   * Node capabilities the plugin's entry code is allowed to acquire. Without a
   * matching entry here, the sandbox `require` refuses to hand out `fs`,
   * `child_process`, networking, etc. Known values: see KNOWN_CAPABILITIES.
   */
  capabilities?: string[];
  contributes?: {
    commands?: { command: string; title: string; category?: string; icon?: string }[];
    keybindings?: { command: string; key: string; when?: string }[];
    configuration?: Record<string, { type: string; default: any; description?: string }>;
    languages?: { id: string; extensions: string[]; aliases?: string[] }[];
    themes?: { id: string; label: string; path: string }[];
    snippets?: { language: string; path: string }[];
    views?: { id: string; name: string; location?: 'sidebar' | 'panel'; icon?: string }[];
    webviews?: { id: string; title: string; route: string }[];
  };
}

export interface Plugin {
  id: string;
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  builtin: boolean;
  activated?: boolean;
  // last error during activation, surfaced to the UI
  lastError?: string;
}

const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    name: 'builtin-monaco-enhanced',
    displayName: 'Monaco Editor Enhanced',
    description: 'Advanced code editing features powered by Monaco Editor',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      commands: [
        { command: 'editor.format', title: 'Format Document', category: 'Editor' },
        { command: 'editor.foldAll', title: 'Fold All', category: 'Editor' },
        { command: 'editor.unfoldAll', title: 'Unfold All', category: 'Editor' },
        { command: 'editor.toggleMinimap', title: 'Toggle Minimap', category: 'Editor' },
        { command: 'editor.toggleWordWrap', title: 'Toggle Word Wrap', category: 'Editor' },
        { command: 'workbench.action.openSettings', title: 'Open Settings', category: 'Preferences' },
      ],
    },
  },
  {
    name: 'builtin-git',
    displayName: 'Git Integration',
    description: 'Source control management with Git support',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      commands: [
        { command: 'git.commit', title: 'Commit', category: 'Git' },
        { command: 'git.push', title: 'Push', category: 'Git' },
        { command: 'git.pull', title: 'Pull', category: 'Git' },
        { command: 'git.stage', title: 'Stage Changes', category: 'Git' },
        { command: 'git.unstage', title: 'Unstage Changes', category: 'Git' },
      ],
    },
  },
  {
    name: 'builtin-terminal',
    displayName: 'Integrated Terminal',
    description: 'Built-in terminal with xterm.js support',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
  },
  {
    name: 'builtin-search',
    displayName: 'Search',
    description: 'Full-text search across workspace files',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
  },
  {
    name: 'builtin-emmet',
    displayName: 'Emmet Abbreviations',
    description: 'HTML/CSS abbreviation expansion support',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      languages: [
        { id: 'html', extensions: ['.html', '.htm'], aliases: ['HTML'] },
        { id: 'css', extensions: ['.css'], aliases: ['CSS'] },
      ],
    },
  },
  {
    name: 'builtin-json',
    displayName: 'JSON Language Features',
    description: 'JSON language support with validation and schema',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      languages: [{ id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON'] }],
    },
  },
  {
    name: 'builtin-typescript',
    displayName: 'TypeScript/JavaScript Language Features',
    description: 'TypeScript and JavaScript language support with IntelliSense',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      languages: [
        { id: 'typescript', extensions: ['.ts', '.tsx'], aliases: ['TypeScript'] },
        { id: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], aliases: ['JavaScript'] },
      ],
    },
  },
  {
    name: 'builtin-python',
    displayName: 'Python Language Features',
    description: 'Python language support with syntax highlighting',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      languages: [{ id: 'python', extensions: ['.py', '.pyw'], aliases: ['Python'] }],
    },
  },
  {
    name: 'builtin-markdown',
    displayName: 'Markdown Language Features',
    description: 'Markdown editing and preview support',
    version: '1.0.0',
    author: 'Loom',
    engines: { loom: '>=0.1.0' },
    contributes: {
      languages: [{ id: 'markdown', extensions: ['.md', '.markdown'], aliases: ['Markdown'] }],
    },
  },
];

export interface WebviewPanel {
  id: string;
  title: string;
  html?: string;
  url?: string;
  postMessage(message: any): void;
  onDidReceiveMessage?: (message: any) => void;
  dispose(): void;
}

export interface LoomPluginAPI {
  registerCommand(id: string, callback: (...args: any[]) => any): void;
  showInformationMessage(msg: string): void;
  showErrorMessage(msg: string): void;
  getConfiguration(key: string): any;
  createWebviewPanel(id: string, title: string, options?: { html?: string; url?: string }): WebviewPanel;
  // Reserved for future extension: getActiveTextEditor, etc.
}

  export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private pluginDir: string;
  private configPath: string;
  private userConfigPath: string;
  // command id -> array of handlers (multi-extension is allowed; we call all)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin command handlers are dynamic
  private commandRegistry: Map<string, Array<{ plugin: string; handler: (...args: any[]) => any }>> = new Map();
  // configuration key -> { type, default, scope, plugin }
  private configurationRegistry: Map<string, { type: string; default: any; description?: string; plugin: string }> = new Map();
  // listener for status notifications, surfaced to renderer
  private notifications: { id: string; type: 'info' | 'error' | 'warn'; message: string; plugin: string; ts: number }[] = [];
  private maxNotifications = 200;
  // webview panels created by plugins, keyed by panel id
  private webviewPanels: Map<string, WebviewPanel> = new Map();
  // renderer-facing listener for webview lifecycle events
  private webviewListener?: (event: { type: 'create' | 'dispose' | 'message'; panelId: string; payload?: any }) => void;
  // worker 隔离线程宿主：plugin name → PluginWorkerHost（激活/命令执行在独立线程）
  private pluginHosts: Map<string, PluginWorkerHost> = new Map();

  constructor() {
    const userData = app.getPath('userData');
    this.pluginDir = path.join(userData, 'plugins');
    this.configPath = path.join(userData, 'data', 'plugins.json');
    this.userConfigPath = path.join(userData, 'data', 'plugin-config.json');
    this.initBuiltinPlugins();
    this.loadInstalledPlugins();
  }

  private readUserConfiguration(): Record<string, any> {
    try {
      if (fs.existsSync(this.userConfigPath)) {
        return JSON.parse(fs.readFileSync(this.userConfigPath, 'utf-8')) || {};
      }
    } catch {}
    return {};
  }

  private writeUserConfiguration(cfg: Record<string, any>) {
    try {
      const dir = path.dirname(this.userConfigPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.userConfigPath, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch (e) {
      console.error('PluginManager: failed to write user config', e);
    }
  }

  private initBuiltinPlugins() {
    for (const manifest of BUILTIN_PLUGINS) {
      this.plugins.set(manifest.name, {
        id: manifest.name,
        manifest,
        path: '',
        enabled: true,
        builtin: true,
      });
    }
  }

  private loadInstalledPlugins() {
    try {
      if (!fs.existsSync(this.pluginDir)) fs.mkdirSync(this.pluginDir, { recursive: true });
      if (!fs.existsSync(this.configPath)) {
        fs.writeFileSync(this.configPath, JSON.stringify({ enabled: {}, installed: [] }, null, 2));
        return;
      }
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      for (const pluginInfo of (config.installed || [])) {
        const pluginPath = pluginInfo.path;
        if (!fs.existsSync(pluginPath)) continue;
        try {
          const manifestPath = path.join(pluginPath, 'package.json');
          if (!fs.existsSync(manifestPath)) continue;
          const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const enabled = config.enabled?.[manifest.name] !== false;
          this.plugins.set(manifest.name, {
            id: manifest.name,
            manifest,
            path: pluginPath,
            enabled,
            builtin: false,
          });
        } catch (e: any) {
          console.error(`PluginManager: Failed to load plugin from ${pluginPath}:`, e.message);
        }
      }
    } catch (e: any) {
      console.error('PluginManager: Failed to list installed plugins dir:', e.message);
    }
  }

  private saveConfig() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const enabled: Record<string, boolean> = {};
      const installed: { name: string; path: string }[] = [];
      for (const [name, plugin] of this.plugins) {
        enabled[name] = plugin.enabled;
        if (!plugin.builtin && plugin.path) {
          installed.push({ name, path: plugin.path });
        }
      }
      fs.writeFileSync(this.configPath, JSON.stringify({ enabled, installed }, null, 2));
    } catch {}
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.enabled);
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    if (plugin.builtin && !enabled) return false; // can't disable builtins
    const wasEnabled = plugin.enabled;
    plugin.enabled = enabled;
    if (!wasEnabled && enabled && !plugin.activated) this.activatePlugin(plugin);
    if (wasEnabled && !enabled && plugin.activated) this.deactivatePlugin(plugin);
    this.saveConfig();
    return true;
  }

  installPlugin(pluginPath: string): { ok: boolean; msg: string } {
    try {
      const manifestPath = path.join(pluginPath, 'package.json');
      if (!fs.existsSync(manifestPath)) return { ok: false, msg: 'No package.json found' };
      const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.name || !manifest.version) return { ok: false, msg: 'Invalid manifest: missing name or version' };
      if (this.plugins.has(manifest.name)) return { ok: false, msg: `Plugin "${manifest.name}" already installed` };

      // Prevent path traversal via malicious manifest names like "../../system"
      if (!/^[@a-z0-9_.-]+$/i.test(manifest.name)) {
        return { ok: false, msg: 'Invalid plugin name: only alphanumeric, dots, dashes, underscores and @ are allowed' };
      }

      if (!fs.existsSync(this.pluginDir)) fs.mkdirSync(this.pluginDir, { recursive: true });
      const destDir = path.join(this.pluginDir, manifest.name);
      const resolvedDest = path.resolve(destDir);
      const resolvedPluginDir = path.resolve(this.pluginDir);
      if (!resolvedDest.startsWith(resolvedPluginDir + path.sep) && resolvedDest !== resolvedPluginDir) {
        return { ok: false, msg: 'Invalid plugin install path' };
      }
      fs.cpSync(pluginPath, destDir, { recursive: true });

      const plugin: Plugin = {
        id: manifest.name,
        manifest,
        path: destDir,
        enabled: true,
        builtin: false,
      };
      this.plugins.set(manifest.name, plugin);
      this.saveConfig();
      this.activatePlugin(plugin);
      return { ok: true, msg: `Installed ${manifest.displayName || manifest.name} v${manifest.version}` };
    } catch (e: any) {
      return { ok: false, msg: e.message || 'Installation failed' };
    }
  }

  uninstallPlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin || plugin.builtin) return false;
    if (plugin.activated) this.deactivatePlugin(plugin);
    try {
      if (plugin.path && fs.existsSync(plugin.path)) {
        fs.rmSync(plugin.path, { recursive: true, force: true });
      }
    } catch {}
    this.plugins.delete(id);
    this.saveConfig();
    return true;
  }

  /**
   * Activate a plugin: register contributed commands/configuration, then load
   * its main entry (if any) and call `activate(api)` if defined.
   * Built-in plugins have no main, but we still register contributions.
   *
   * Main loading + activate() run through `activateInHost` (vm sandbox + 30s
   * timeout) — see plugin-host.ts. A hung plugin activation resolves as a
   * failure instead of blocking startup indefinitely.
   */
  private async activatePlugin(plugin: Plugin) {
    try {
      // 1. Register contributes
      const contribs = plugin.manifest.contributes;
      if (contribs?.commands) {
        for (const cmd of contribs.commands) {
          // commands are placeholders; the actual handlers are registered via
          // api.registerCommand from the plugin's activate() function.
          // We index them so getAllCommands() can list them.
          if (!this.commandRegistry.has(cmd.command)) {
            this.commandRegistry.set(cmd.command, []);
          }
        }
      }
      if (contribs?.configuration) {
        for (const [key, schema] of Object.entries(contribs.configuration)) {
          this.configurationRegistry.set(key, {
            type: schema.type,
            default: schema.default,
            description: schema.description,
            plugin: plugin.manifest.name,
          });
        }
      }

      // 2. Load main entry in an isolated worker thread (PluginWorkerHost).
      //    worker 可被 terminate —— 死循环插件激活无法再卡死主进程
      //    （旧 activateInHost 的 JS 超时无法中断同步死循环）。
      if (plugin.manifest.main) {
        const sane = sanitizePluginEntry(plugin.manifest.main);
        if (!sane.ok) {
          plugin.lastError = sane.msg;
          this.pushNotification('error', `Plugin "${plugin.manifest.name}" activation error: ${sane.msg}`, plugin.manifest.name);
          return;
        }
        const declared = Array.isArray(plugin.manifest.capabilities) ? plugin.manifest.capabilities : [];
        try {
          const host = await PluginWorkerHost.spawn({
            pluginName: plugin.manifest.name,
            pluginRoot: plugin.path,
            mainRel: sane.main || plugin.manifest.main,
            capabilities: declared,
          }, 30000);
          this.pluginHosts.set(plugin.manifest.name, host);
          // worker 通知 → 主进程通知队列
          host.onNotify((m) => {
            const level = m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'info';
            this.pushNotification(level, m.msg || '', plugin.manifest.name);
          });
          // worker webview 面板（沿用主进程 webview 面板语义）
          host.onWebview((m) => {
            if (m.dispose) {
              this.webviewPanels.delete(m.panelId || '');
              this.webviewListener?.({ type: 'dispose', panelId: m.panelId || '' });
              return;
            }
            const panel: WebviewPanel = {
              id: m.panelId || '',
              title: m.title || '',
              html: m.html,
              url: m.url,
              postMessage: () => {},
              dispose: () => { this.webviewPanels.delete(m.panelId || ''); },
            };
            this.webviewPanels.set(m.panelId || '', panel);
            this.webviewListener?.({ type: 'create', panelId: m.panelId || '', payload: { title: m.title, html: m.html, url: m.url } });
          });
          // 把 worker 内注册的命令桥接进主进程命令注册表
          for (const cmd of host.getCommands()) {
            const arr = this.commandRegistry.get(cmd) || [];
            arr.push({
              plugin: plugin.manifest.name,
              handler: async (...args: unknown[]) => {
                const r = await host.execute(cmd, args);
                if (!r.ok) throw new Error(r.error || 'command failed');
                return r.result;
              },
            });
            this.commandRegistry.set(cmd, arr);
          }
        } catch (e: any) {
          plugin.lastError = e?.message || 'activation failed';
          this.pushNotification('error', `Plugin "${plugin.manifest.name}" activation error: ${e?.message || e}`, plugin.manifest.name);
          return;
        }
      }
      plugin.activated = true;
      plugin.lastError = undefined;
    } catch (e: any) {
      plugin.lastError = e.message;
      this.pushNotification('error', `Plugin "${plugin.manifest.name}" activation error: ${e.message}`, plugin.manifest.name);
    }
  }

  private deactivatePlugin(plugin: Plugin) {
    // Remove this plugin's command handlers from the registry so a deactivated
    // plugin can never receive command invocations again.
    for (const [cmd, handlers] of this.commandRegistry) {
      const remaining = handlers.filter(h => h.plugin !== plugin.manifest.name);
      if (remaining.length === 0) this.commandRegistry.delete(cmd);
      else this.commandRegistry.set(cmd, remaining);
    }
    for (const [key, cfg] of this.configurationRegistry) {
      if (cfg.plugin === plugin.manifest.name) this.configurationRegistry.delete(key);
    }
    // terminate worker 隔离线程
    this.pluginHosts.get(plugin.manifest.name)?.terminate();
    this.pluginHosts.delete(plugin.manifest.name);
    plugin.activated = false;
  }

  /**
   * Activate all enabled plugins that haven't been activated yet.
   * Called once at startup. Activations run through activateInHost (30s
   * timeout) so a misbehaving plugin cannot freeze the main process forever.
   */
  async activateAll() {
    for (const plugin of this.getEnabledPlugins()) {
      if (!plugin.activated) await this.activatePlugin(plugin);
    }
  }

  private buildAPI(plugin: Plugin): LoomPluginAPI {
    const registry = this.commandRegistry;
    const configuration = this.configurationRegistry;
    const panels = this.webviewPanels;
    const listener = this.webviewListener;
    const readConfig = this.readUserConfiguration.bind(this);
    const pushNotif = this.pushNotification.bind(this);
    return {
      registerCommand(id, callback) {
        const arr = registry.get(id) || [];
        arr.push({ plugin: plugin.manifest.name, handler: callback });
        registry.set(id, arr);
      },
      showInformationMessage(msg) {
        pushNotif('info', msg, plugin.manifest.name);
      },
      showErrorMessage(msg) {
        pushNotif('error', msg, plugin.manifest.name);
      },
      getConfiguration(key) {
        const schema = configuration.get(key);
        if (!schema) return undefined;
        const user = readConfig();
        return user[key] !== undefined ? user[key] : schema.default;
      },
      createWebviewPanel(id, title, options) {
        const panel: WebviewPanel = {
          id,
          title,
          html: options?.html,
          url: options?.url,
          postMessage(message) {
            listener?.({ type: 'message', panelId: id, payload: message });
          },
          dispose() {
            panels.delete(id);
            listener?.({ type: 'dispose', panelId: id });
          },
        };
        panels.set(id, panel);
        listener?.({ type: 'create', panelId: id, payload: { title, html: options?.html, url: options?.url } });
        return panel;
      },
    };
  }

  getWebviewPanels(): WebviewPanel[] {
    return Array.from(this.webviewPanels.values());
  }

  onWebviewEvent(listener: (event: { type: 'create' | 'dispose' | 'message'; panelId: string; payload?: any }) => void) {
    this.webviewListener = listener;
  }

  postMessageToWebview(panelId: string, message: any): boolean {
    const panel = this.webviewPanels.get(panelId);
    if (!panel) return false;
    panel.onDidReceiveMessage?.(message);
    return true;
  }

  private pushNotification(type: 'info' | 'error' | 'warn', message: string, plugin: string) {
    const n = { id: `${plugin}:${Date.now()}:${Math.random()}`, type, message, plugin, ts: Date.now() };
    this.notifications.push(n);
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(-this.maxNotifications);
    }
  }

  getNotifications(): typeof this.notifications {
    return [...this.notifications];
  }

  clearNotifications() { this.notifications = []; }

  /**
   * Execute a command by id. Returns the first non-undefined result.
   * This is what the renderer uses to dispatch `loom:execute-command`.
   */
  async executeCommand(id: string, ...args: any[]): Promise<any> {
    const handlers = this.commandRegistry.get(id);
    if (!handlers || handlers.length === 0) {
      // Command not registered. If it matches a contributed title, return
      // an "unbound" marker so the UI can show it as available but not active.
      return { ok: false, msg: `Command "${id}" has no registered handler.` };
    }
    for (const { handler: h } of handlers) {
      try {
        const r = await h(...args);
        if (r !== undefined) return { ok: true, result: r };
      } catch (e: any) {
        this.pushNotification('error', `Command "${id}" threw: ${e.message}`, '');
        return { ok: false, msg: e.message };
      }
    }
    return { ok: true, result: undefined };
  }

  getAllCommands(): { command: string; title: string; category?: string; plugin: string; hasHandler: boolean }[] {
    const out: { command: string; title: string; category?: string; plugin: string; hasHandler: boolean }[] = [];
    for (const plugin of this.getEnabledPlugins()) {
      if (plugin.manifest.contributes?.commands) {
        for (const cmd of plugin.manifest.contributes.commands) {
          out.push({
            ...cmd,
            plugin: plugin.manifest.displayName || plugin.manifest.name,
            hasHandler: (this.commandRegistry.get(cmd.command)?.length || 0) > 0,
          });
        }
      }
    }
    return out;
  }

  getAllLanguages(): { id: string; extensions: string[]; aliases?: string[] }[] {
    const langs: { id: string; extensions: string[]; aliases?: string[] }[] = [];
    for (const plugin of this.getEnabledPlugins()) {
      if (plugin.manifest.contributes?.languages) {
        langs.push(...plugin.manifest.contributes.languages);
      }
    }
    return langs;
  }

  getAllConfigurations(): Record<string, { type: string; default: any; description?: string; plugin: string }> {
    const out: Record<string, any> = {};
    for (const [key, cfg] of this.configurationRegistry) {
      out[key] = cfg;
    }
    return out;
  }

  getUserConfiguration(): Record<string, any> {
    return this.readUserConfiguration();
  }

  setUserConfiguration(key: string, value: any) {
    const cfg = this.readUserConfiguration();
    cfg[key] = value;
    this.writeUserConfiguration(cfg);
  }
}
