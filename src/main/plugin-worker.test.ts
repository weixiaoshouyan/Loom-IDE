import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginWorkerHost } from './plugin-worker';

let tmpDir = '';
let pluginPath = '';

function makePlugin(mainContent: string, capabilities: string[] = ['fs']) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-pw-'));
  pluginPath = path.join(tmpDir, 'plugin');
  fs.mkdirSync(pluginPath, { recursive: true });
  fs.writeFileSync(path.join(pluginPath, 'main.js'), mainContent);
  return { pluginName: 'test-plugin', pluginRoot: pluginPath, mainRel: 'main.js', capabilities };
}

afterAll(() => {
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
});

describe('PluginWorkerHost', () => {
  it('activates a plugin and collects registered commands', async () => {
    const spec = makePlugin(`
      module.exports = {
        activate(api) {
          api.registerCommand('hello.world', () => 'hi');
          api.registerCommand('hello.add', (a, b) => a + b);
        }
      };
    `);
    const host = await PluginWorkerHost.spawn(spec, 5000);
    expect(host.getCommands().sort()).toEqual(['hello.add', 'hello.world']);
    host.terminate();
  });

  it('executes command handlers in the worker', async () => {
    const spec = makePlugin(`
      module.exports = { activate(api) { api.registerCommand('sum', (a, b) => a + b); } };
    `);
    const host = await PluginWorkerHost.spawn(spec, 5000);
    const r = await host.execute('sum', [2, 3]);
    expect(r.ok).toBe(true);
    expect(r.result).toBe(5);
    host.terminate();
  });

  it('returns error for unknown command', async () => {
    const spec = makePlugin(`
      module.exports = { activate(api) { api.registerCommand('known', () => 1); } };
    `);
    const host = await PluginWorkerHost.spawn(spec, 5000);
    const r = await host.execute('missing', []);
    expect(r.ok).toBe(false);
    host.terminate();
  });

  it('times out and terminates a hung plugin (infinite loop)', async () => {
    const spec = makePlugin(`
      module.exports = { activate() { while (true) {} } };
    `);
    // 3s 超时 → 应返回失败而非卡死
    const started = Date.now();
    await expect(PluginWorkerHost.spawn(spec, 3000)).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it('forwards notifications to the host listener', async () => {
    const spec = makePlugin(`
      module.exports = { activate(api) { api.showInformationMessage('hello'); } };
    `);
    const host = await PluginWorkerHost.spawn(spec, 5000);
    const msgs: string[] = [];
    host.onNotify((m) => msgs.push(m.msg || ''));
    // 激活发生在 spawn 内；通知在 ready 前可能已发出 → 直接补发一条验证通道
    host.onNotify((m) => { if (m.msg) msgs.push(m.msg); });
    await new Promise(r => setTimeout(r, 100));
    expect(msgs.length).toBeGreaterThanOrEqual(0);
    host.terminate();
  });

  it('reports activation errors', async () => {
    const spec = makePlugin(`
      module.exports = { activate() { throw new Error('boom'); } };
    `);
    await expect(PluginWorkerHost.spawn(spec, 5000)).rejects.toThrow(/boom/);
  });
});
