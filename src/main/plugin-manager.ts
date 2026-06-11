/**
 * Loom Plugin System
 * Manages VSCode-compatible extensions with lifecycle, API surface, and marketplace
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface PluginManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  engines: { loom: string };
  main?: string;
  contributes?: {
    commands?: { command: string; title: string; category?: string }[];
    menus?: Record<string, { command: string; when?: string; group?: string }[]>;
    keybindings?: { command: string; key: string; when?: string }[];
    themes?: { id: string; label: string; path: string }[];
    languages?: { id: string; extensions: string[]; aliases?: string[] }[];
    snippets?: { language: string; path: string }[];
    views?: { id: string; name: string; when?: string }[];
  };
}

export interface Plugin {
  id: string;
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  builtin: boolean;
  instance?: any;
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
        { id: 'javascript', extensions: ['.js', '.jsx'], aliases: ['JavaScript'] },
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

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private pluginDir: string;
  private configPath: string;

  constructor() {
    const userData = app.getPath('userData');
    this.pluginDir = path.join(userData, 'plugins');
    this.configPath = path.join(userData, 'data', 'plugins.json');
    this.initBuiltinPlugins();
    this.loadInstalledPlugins();
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
        } catch {}
      }
    } catch {}
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
    if (!plugin || plugin.builtin) return false;
    plugin.enabled = enabled;
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

      const destDir = path.join(this.pluginDir, manifest.name);
      if (!fs.existsSync(this.pluginDir)) fs.mkdirSync(this.pluginDir, { recursive: true });
      fs.cpSync(pluginPath, destDir, { recursive: true });

      this.plugins.set(manifest.name, {
        id: manifest.name,
        manifest,
        path: destDir,
        enabled: true,
        builtin: false,
      });
      this.saveConfig();
      return { ok: true, msg: `Installed ${manifest.displayName || manifest.name} v${manifest.version}` };
    } catch (e: any) {
      return { ok: false, msg: e.message || 'Installation failed' };
    }
  }

  uninstallPlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin || plugin.builtin) return false;
    try {
      if (plugin.path && fs.existsSync(plugin.path)) {
        fs.rmSync(plugin.path, { recursive: true, force: true });
      }
    } catch {}
    this.plugins.delete(id);
    this.saveConfig();
    return true;
  }

  getAllCommands(): { command: string; title: string; category?: string; plugin: string }[] {
    const cmds: { command: string; title: string; category?: string; plugin: string }[] = [];
    for (const plugin of this.getEnabledPlugins()) {
      if (plugin.manifest.contributes?.commands) {
        for (const cmd of plugin.manifest.contributes.commands) {
          cmds.push({ ...cmd, plugin: plugin.manifest.displayName || plugin.manifest.name });
        }
      }
    }
    return cmds;
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
}
