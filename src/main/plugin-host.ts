/**
 * Plugin Host - Optional Worker/utility layer for plugin isolation.
 *
 * Current scope: exposes helper functions for running plugin code in a
 * controlled manner. A future iteration can spawn a Worker or a dedicated
 * renderer process to isolate plugin execution from the main process.
 */

import type { Plugin, LoomPluginAPI } from './plugin-manager';
import { loadPluginSandboxed, findUnknownCapabilities } from './plugin-sandbox';

export interface PluginHostOptions {
  plugin: Plugin;
  api: LoomPluginAPI;
  timeoutMs?: number;
}

/**
 * Run a plugin activation function with a timeout and basic error isolation.
 * This is intentionally lightweight; full process isolation is a future step.
 */
export async function activateInHost(options: PluginHostOptions): Promise<{ ok: boolean; error?: string }> {
  const { plugin, api, timeoutMs = 30000 } = options;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: `Plugin "${plugin.manifest.name}" activation timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    try {
      if (!plugin.manifest.main) {
        clearTimeout(timer);
        resolve({ ok: true });
        return;
      }
      const mainPath = plugin.path ? `${plugin.path}/${plugin.manifest.main}` : plugin.manifest.main;
      // Sanitize the entry: reject traversal so require() cannot load code
      // outside the plugin directory.
      const normalized = String(plugin.manifest.main).replace(/\\/g, '/');
      // Reject path traversal segment-by-segment: `my..plugin.js` is a legal
      // file name, only a literal `..` *segment* is dangerous.
      const segments = normalized.split('/');
      if (
        normalized.startsWith('/') ||
        normalized.startsWith('../') ||
        segments.includes('..') ||
        /[\0]/.test(plugin.manifest.main || '')
      ) {
        clearTimeout(timer);
        resolve({ ok: false, error: `Plugin "${plugin.manifest.name}" entry is invalid (path traversal).` });
        return;
      }
      const declared = Array.isArray(plugin.manifest.capabilities) ? plugin.manifest.capabilities : [];
      const unknown = findUnknownCapabilities(declared);
      if (unknown.length > 0) {
        clearTimeout(timer);
        resolve({ ok: false, error: `Plugin "${plugin.manifest.name}" declares unknown capabilities: ${unknown.join(', ')}` });
        return;
      }
      // Load inside the capability-gated vm sandbox (see plugin-sandbox.ts).
      const mod = loadPluginSandboxed(mainPath, { pluginRoot: plugin.path || '.', capabilities: declared });
      const activate = mod.activate || mod.default?.activate;
      if (typeof activate === 'function') {
        const result = activate(api);
        if (result && typeof result.then === 'function') {
          result
            .then(() => { clearTimeout(timer); resolve({ ok: true }); })
            .catch((e: any) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
        } else {
          clearTimeout(timer);
          resolve({ ok: true });
        }
      } else {
        clearTimeout(timer);
        resolve({ ok: true });
      }
    } catch (e: any) {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    }
  });
}
