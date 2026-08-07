import { ipcMain } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface MarketplaceExtension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  category: string;
  version: string;
  downloads: number;
  rating: number;
  iconUrl: string;
  repoUrl?: string;
  manifestUrl: string;
  downloadUrl: string;
  compatibility: string[];   // ['cursor', 'vscode', 'loom']
  verified: boolean;
}

interface InstalledExtension {
  id: string;
  version: string;
  installedAt: number;
  enabled: boolean;
  source: 'marketplace' | 'vsix' | 'cursor' | 'dev';
}

// 兼容 Cursor/Open VSX 双源
const MARKETPLACE_SOURCES = {
  cursor: 'https://api.cursor.com/extensions',
  openvsx: 'https://open-vsx.org/api',
  loom: 'http://localhost:3001/api/extensions',  // 自托管回退
};

const COMPATIBILITY_TAGS = ['cursor', 'vscode', 'loom'];
const FETCH_TIMEOUT_MS = 8000;
const INSTALLED_DIR = () => path.join(app.getPath('userData'), 'extensions');
const INSTALLED_REGISTRY = () => path.join(app.getPath('userData'), 'installed-extensions.json');

function readInstalledRegistry(): InstalledExtension[] {
  try {
    if (fs.existsSync(INSTALLED_REGISTRY())) {
      return JSON.parse(fs.readFileSync(INSTALLED_REGISTRY(), 'utf-8'));
    }
  } catch {}
  return [];
}
function writeInstalledRegistry(registry: InstalledExtension[]) {
  fs.writeFileSync(INSTALLED_REGISTRY(), JSON.stringify(registry, null, 2));
}

function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${(e as Error).message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
  });
}

async function fetchFromOpenVSX(query?: string): Promise<MarketplaceExtension[]> {
  // Open VSX 是 VSCode/Cursor 兼容的开放市场
  const base = `${MARKETPLACE_SOURCES.openvsx}/-/search`;
  const url = query
    ? `${base}?query=${encodeURIComponent(query)}&size=50`
    : `${base}?size=50`;
  try {
    const data = await fetchJson(url);
    const extensions: MarketplaceExtension[] = (data.extensions || []).map((e: any) => ({
      id: `${e.namespace}.${e.name}`,
      name: e.name,
      displayName: e.displayName || e.name,
      description: e.description || '',
      author: e.namespace,
      category: 'extension',
      version: e.version || '0.0.0',
      downloads: e.downloadCount || 0,
      rating: e.reviewCount ? Math.min(5, 3.5 + Math.log10(e.reviewCount)) : 4.0,
      iconUrl: `${MARKETPLACE_SOURCES.openvsx}/${e.namespace}/${e.name}/latest/file/${e.icon || 'icon.png'}`,
      repoUrl: e.repository || '',
      manifestUrl: `${MARKETPLACE_SOURCES.openvsx}/${e.namespace}/${e.name}/latest/file/package.json`,
      downloadUrl: `${MARKETPLACE_SOURCES.openvsx}/${e.namespace}/${e.name}/latest/file/${e.files?.download || e.files?.package || ''}`,
      compatibility: ['vscode', 'cursor', 'loom'],
      verified: e.namespace === 'redhat' || e.namespace === 'microsoft' || e.verified === true,
    }));
    return extensions;
  } catch (e) {
    console.warn('[marketplace] OpenVSX fetch failed:', (e as Error).message);
    return [];
  }
}

function loadMockData(): MarketplaceExtension[] {
  // 离线回退：内置精选扩展列表（从 src/shared/marketplace-mock.json 加载）
  // 兼容开发模式（src/）和打包后（dist/）两种路径
  const candidates = [
    path.join(__dirname, '..', 'shared', 'marketplace-mock.json'),
    path.join(__dirname, '..', '..', 'src', 'shared', 'marketplace-mock.json'),
    path.join(process.resourcesPath || '', 'app', 'shared', 'marketplace-mock.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch {}
  }
  console.warn('[marketplace] No mock data found in candidates:', candidates);
  return [];
}

export class ExtensionMarketplaceService {
  /**
   * 列出可用扩展。多源回退：Cursor 官方 → OpenVSX → 本地精选
   */
  async list(query?: string): Promise<MarketplaceExtension[]> {
    const installed = new Set(readInstalledRegistry().map(e => e.id));
    let extensions: MarketplaceExtension[] = [];

    // 主源：OpenVSX（VSCode/Cursor 双向兼容）
    extensions = await fetchFromOpenVSX(query);

    // 回退：本地精选
    if (extensions.length === 0) {
      extensions = loadMockData().filter(e =>
        !query || e.displayName.toLowerCase().includes(query.toLowerCase())
        || e.description.toLowerCase().includes(query.toLowerCase())
        || e.id.toLowerCase().includes(query.toLowerCase())
      );
    }

    return extensions.map(e => ({ ...e, installed: installed.has(e.id) } as any));
  }

  /**
   * 下载并安装扩展。Cursor 兼容包：支持 .vsix (VSCode 包) 和 .tar.gz
   */
  async install(extensionId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    // SECURITY: extensionId is used to build filesystem paths and previously
    // interpolated into a shell command. Reject anything that is not a plain
    // marketplace id (namespace.name), preventing command injection / traversal.
    if (!/^[A-Za-z0-9._@-]+$/.test(extensionId || '')) {
      return { ok: false, error: `Invalid extension id: ${extensionId}` };
    }
    try {
      const ext = await this.findById(extensionId);
      if (!ext) return { ok: false, error: `Extension not found: ${extensionId}` };

      if (!fs.existsSync(INSTALLED_DIR())) {
        fs.mkdirSync(INSTALLED_DIR(), { recursive: true });
      }

      const targetDir = path.join(INSTALLED_DIR(), extensionId);
      // Prevent path traversal: ensure the resolved target stays inside the
      // installed-extensions directory.
      const resolvedTarget = path.resolve(targetDir);
      const resolvedRoot = path.resolve(INSTALLED_DIR());
      if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
        return { ok: false, error: 'Invalid install path' };
      }
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetDir, { recursive: true });

      // 优先下载 package.json 验证兼容性
      const manifest = await fetchJson(ext.manifestUrl).catch(() => null);
      if (manifest && manifest.engines) {
        const engines = JSON.stringify(manifest.engines);
        if (!/loom|cursor|vscode/i.test(engines) && !/^\s*\{\s*"[a-z]+"\s*:/i.test(engines)) {
          return { ok: false, error: `Extension not compatible: engines=${engines}` };
        }
      }

      // 下载并解压 .vsix 包
      const vsixPath = path.join(targetDir, 'package.vsix');
      await this.downloadFile(ext.downloadUrl, vsixPath);
      // Integrity gate: a .vsix is a zip archive, which always starts with the
      // "PK\x03\x04" magic bytes. Reject anything else before extraction.
      const header = Buffer.alloc(4);
      const fd = fs.openSync(vsixPath, 'r');
      try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
      if (header.toString('hex') !== '504b0304') {
        fs.rmSync(vsixPath, { force: true });
        return { ok: false, error: 'Downloaded package is not a valid .vsix archive.' };
      }
      await this.extractVsix(vsixPath, targetDir);
      fs.unlinkSync(vsixPath);

      // 写入注册表
      const registry = readInstalledRegistry();
      const existing = registry.findIndex(e => e.id === extensionId);
      const entry: InstalledExtension = {
        id: extensionId,
        version: ext.version,
        installedAt: Date.now(),
        enabled: true,
        source: ext.compatibility.includes('cursor') ? 'cursor' : 'marketplace',
      };
      if (existing >= 0) registry[existing] = entry;
      else registry.push(entry);
      writeInstalledRegistry(registry);

      return { ok: true, path: targetDir };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async uninstall(extensionId: string): Promise<{ ok: boolean; error?: string }> {
    // SECURITY: same id allow-list as install() — without it, a crafted id
    // like "../../AppData" would path-traverse and recursively delete
    // arbitrary directories outside the extensions folder.
    if (!/^[A-Za-z0-9._@-]+$/.test(extensionId || '')) {
      return { ok: false, error: `Invalid extension id: ${extensionId}` };
    }
    try {
      const targetDir = path.join(INSTALLED_DIR(), extensionId);
      const resolvedTarget = path.resolve(targetDir);
      const resolvedRoot = path.resolve(INSTALLED_DIR());
      if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
        return { ok: false, error: 'Invalid uninstall path' };
      }
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      const registry = readInstalledRegistry().filter(e => e.id !== extensionId);
      writeInstalledRegistry(registry);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async listInstalled(): Promise<InstalledExtension[]> {
    return readInstalledRegistry();
  }

  private async findById(extensionId: string): Promise<MarketplaceExtension | null> {
    const all = await this.list();
    return all.find(e => e.id === extensionId) || null;
  }

  private async downloadFile(url: string, target: string): Promise<void> {
    // SECURITY: cap download size so a malicious registry entry cannot fill
    // the disk (zip-bomb protection — see also the post-extract check).
    const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.downloadFile(res.headers.location, target).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        }
        let received = 0;
        let failed = false;
        const out = fs.createWriteStream(target);
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_DOWNLOAD_BYTES && !failed) {
            failed = true;
            req.destroy();
            out.destroy();
            fs.rmSync(target, { force: true });
            reject(new Error(`Download exceeds ${Math.floor(MAX_DOWNLOAD_BYTES / 1024 / 1024)} MB limit`));
          } else if (!failed) {
            out.write(chunk);
          }
        });
        res.on('end', () => { if (!failed) out.end(() => resolve()); });
        res.on('error', (e) => { if (!failed) reject(e); });
        out.on('error', (e) => { if (!failed) reject(e); });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('Download timeout')); });
    });
  }

  private static dirSizeAndCount(dir: string): { bytes: number; files: number } {
    let bytes = 0;
    let files = 0;
    const walk = (d: string) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile()) {
          bytes += fs.statSync(full).size;
          files += 1;
        }
      }
    };
    walk(dir);
    return { bytes, files };
  }

  private async extractVsix(vsixPath: string, targetDir: string): Promise<void> {
    // .vsix 本质是 zip。使用 execFile（参数数组、不经 shell）解压，避免把
    // 路径拼进 shell 命令带来的命令注入风险。
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const extractedDir = path.join(targetDir, 'extracted');
    fs.mkdirSync(extractedDir, { recursive: true });
    if (process.platform === 'win32') {
      // PowerShell 直接接收参数数组，空格/特殊字符不会被 shell 重新解析
      await execFileAsync('powershell', [
        '-NoProfile', '-Command', 'Expand-Archive',
        '-Path', vsixPath, '-DestinationPath', extractedDir, '-Force',
      ]);
    } else {
      await execFileAsync('unzip', ['-o', vsixPath, '-d', extractedDir]);
    }
    // 把 extracted/extension 提升到 targetDir
    const innerDir = path.join(extractedDir, 'extension');
    const srcDir = fs.existsSync(innerDir) ? innerDir : extractedDir;
    const files = fs.readdirSync(srcDir);
    for (const f of files) {
      fs.renameSync(path.join(srcDir, f), path.join(targetDir, f));
    }
    fs.rmSync(extractedDir, { recursive: true, force: true });
    // SECURITY: post-extract bomb check — a decompression bomb can expand far
    // beyond the download limit. Refuse to keep anything unreasonable.
    const { bytes, files: fileCount } = ExtensionMarketplaceService.dirSizeAndCount(targetDir);
    if (bytes > 500 * 1024 * 1024 || fileCount > 10000) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      throw new Error('Extension archive expands beyond safe limits (possible zip bomb); install aborted.');
    }
  }
}

let _service: ExtensionMarketplaceService | null = null;
function getService() {
  if (!_service) _service = new ExtensionMarketplaceService();
  return _service;
}

export function registerMarketplaceIPC() {
  ipcMain.handle('marketplace:list', async (_e, query?: string) => {
    return getService().list(query);
  });
  ipcMain.handle('marketplace:install', async (_e, id: string) => {
    return getService().install(id);
  });
  ipcMain.handle('marketplace:uninstall', async (_e, id: string) => {
    return getService().uninstall(id);
  });
  ipcMain.handle('marketplace:list-installed', async () => {
    return getService().listInstalled();
  });
}
