import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPluginSandboxed, findUnknownCapabilities, KNOWN_CAPABILITIES } from './plugin-sandbox';

let pluginRoot = '';
let outsideDir = '';

function writePlugin(file: string, code: string): string {
  // Resolve + boundary check: fixtures must stay inside the temp plugin root.
  const full = path.resolve(pluginRoot, file);
  if (full !== pluginRoot && !full.startsWith(pluginRoot + path.sep)) {
    throw new Error(`fixture escapes plugin root: ${file}`);
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, code);
  return full;
}

beforeAll(() => {
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-plugin-sbx-'));
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-plugin-out-'));
  fs.writeFileSync(path.join(outsideDir, 'evil.js'), 'module.exports = { stolen: true };');
});

afterAll(() => {
  for (const dir of [pluginRoot, outsideDir]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('findUnknownCapabilities', () => {
  it('accepts every known capability', () => {
    expect(findUnknownCapabilities([...KNOWN_CAPABILITIES])).toEqual([]);
  });

  it('flags unknown entries', () => {
    expect(findUnknownCapabilities(['fs', 'root', 'kernel'])).toEqual(['root', 'kernel']);
  });
});

describe('loadPluginSandboxed', () => {
  it('loads a simple plugin and returns module.exports', () => {
    const entry = writePlugin('simple/index.js', `
      exports.activate = function (api) { return 'activated'; };
      exports.marker = 42;
    `);
    const mod = loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'simple') });
    expect(mod.marker).toBe(42);
    expect(typeof mod.activate).toBe('function');
    expect(mod.activate({})).toBe('activated');
  });

  it('allows safe built-ins without any capability', () => {
    const entry = writePlugin('safe/index.js', `
      const path = require('path');
      exports.joined = path.join('a', 'b');
    `);
    const mod = loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'safe') });
    expect(mod.joined).toBe(path.join('a', 'b'));
  });

  it('blocks child_process without the capability', () => {
    const entry = writePlugin('nocp/index.js', `
      require('child_process');
    `);
    expect(() => loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'nocp') }))
      .toThrow(/no matching capability/);
  });

  it('blocks fs and node:fs without the capability', () => {
    const entry = writePlugin('nofs/index.js', `
      require('node:fs');
    `);
    expect(() => loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'nofs') }))
      .toThrow(/no matching capability/);
  });

  it('grants fs when the capability is declared', () => {
    const entry = writePlugin('withfs/index.js', `
      const fs = require('fs');
      exports.hasReadFile = typeof fs.readFileSync === 'function';
    `);
    const mod = loadPluginSandboxed(entry, {
      pluginRoot: path.join(pluginRoot, 'withfs'),
      capabilities: ['fs'],
    });
    expect(mod.hasReadFile).toBe(true);
  });

  it('resolves relative requires inside the plugin root', () => {
    writePlugin('multi/lib/helper.js', 'module.exports = { helped: true };');
    const entry = writePlugin('multi/index.js', `
      exports.helper = require('./lib/helper.js');
    `);
    const mod = loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'multi') });
    expect(mod.helper.helped).toBe(true);
  });

  it('rejects requires that escape the plugin root', () => {
    const rel = path.relative(path.join(pluginRoot, 'escape'), path.join(outsideDir, 'evil.js'))
      .split(path.sep).join('/');
    // 测试夹具：生成一段「逃逸 require」的插件源码，验证沙箱拒绝加载。
    // rel 是相对路径字符串，经 JSON.stringify 序列化后嵌入源码。
    const reqLine = ['require(', JSON.stringify(rel), ');'].join('');
    const entry = writePlugin('escape/index.js', ['\n  ', reqLine, '\n'].join(''));
    expect(() => loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'escape') }))
      .toThrow(/escapes the plugin directory|failed to resolve/);
  });

  it('rejects an entry file outside the plugin root', () => {
    expect(() => loadPluginSandboxed(path.join(outsideDir, 'evil.js'), {
      pluginRoot: path.join(pluginRoot, 'whatever'),
    })).toThrow(/escapes the plugin directory/);
  });

  it('does not expose process by default, but does with the capability', () => {
    const entry = writePlugin('proc/index.js', `
      exports.processType = typeof process;
    `);
    const mod = loadPluginSandboxed(entry, { pluginRoot: path.join(pluginRoot, 'proc') });
    expect(mod.processType).toBe('undefined');

    const entry2 = writePlugin('proc2/index.js', `
      exports.processType = typeof process;
    `);
    const mod2 = loadPluginSandboxed(entry2, {
      pluginRoot: path.join(pluginRoot, 'proc2'),
      capabilities: ['process'],
    });
    expect(mod2.processType).toBe('object');
  });
});
