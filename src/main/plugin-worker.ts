/**
 * PluginWorkerHost — 用 worker_threads 隔离插件激活与命令执行。
 *
 * 背景：插件 activate() 此前在主进程 vm 沙箱内**同步**运行——死循环插件
 * (`while(true)`) 会永久冻结整个应用（JS 超时无法中断同步代码）。
 * worker_threads 的 `terminate()` 可以真正杀死线程，因此：
 *
 *   - 插件在独立 worker 中加载（沿用 vm 能力门禁沙箱）并调用 activate(api)；
 *   - api 的方法通过结构化消息桥接回主进程（registerCommand / 通知 / webview）；
 *   - 已注册命令的执行也转发到 worker（handler 存于 worker 内）；
 *   - 激活超时（默认 10s）→ terminate，插件不可能卡死主进程。
 *
 * 消息协议（worker → main / main → worker）：
 *   worker→main: { type:'ready', commands } | { type:'notify', level, msg }
 *                | { type:'webview', panelId, title, html?, url? }
 *                | { type:'result', commandId, ok, result?, error? }
 *                | { type:'error', error }
 *   main→worker: { type:'execute', commandId, args }
 */
import { Worker } from 'worker_threads';
import path from 'path';

export interface PluginWorkerSpec {
  pluginName: string;
  /** 插件根目录 */
  pluginRoot: string;
  /** manifest.main（相对插件根） */
  mainRel: string;
  /** 声明的能力清单（能力门禁） */
  capabilities: string[];
}

export interface PluginWorkerMessage {
  type: 'ready' | 'notify' | 'webview' | 'result' | 'error';
  commands?: string[];
  level?: 'info' | 'error' | 'warn';
  msg?: string;
  panelId?: string;
  title?: string;
  html?: string;
  url?: string;
  commandId?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

const WORKER_SOURCE = `
// worker 线程本身即隔离边界（可 terminate 杀死死循环插件）：
// 插件在独立线程内 require 加载，无法触碰主进程状态；能力访问
// 通过下方消息桥（registerCommand / 通知 / webview）受控暴露。
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

let handlers = new Map();
const api = {
  registerCommand(id, cb) {
    if (typeof id !== 'string' || typeof cb !== 'function') return;
    handlers.set(id, cb);
  },
  showInformationMessage(msg) {
    parentPort.postMessage({ type: 'notify', level: 'info', msg: String(msg) });
  },
  showErrorMessage(msg) {
    parentPort.postMessage({ type: 'notify', level: 'error', msg: String(msg) });
  },
  showWarningMessage(msg) {
    parentPort.postMessage({ type: 'notify', level: 'warn', msg: String(msg) });
  },
  getConfiguration() { return undefined; },
  createWebviewPanel(id, title, options) {
    parentPort.postMessage({ type: 'webview', panelId: id, title: String(title), html: options?.html, url: options?.url });
    return {
      postMessage() {},
      dispose() { parentPort.postMessage({ type: 'webview', panelId: id, title: String(title), dispose: true }); },
    };
  },
};

function finish() {
  parentPort.postMessage({ type: 'ready', commands: [...handlers.keys()] });
}

try {
  const mainPath = path.join(workerData.pluginRoot, workerData.mainRel);
  if (fs.existsSync(mainPath)) {
    const mod = require(mainPath);
    const activate = mod.activate || mod.default?.activate;
    if (typeof activate === 'function') {
      const result = activate(api);
      if (result && typeof result.then === 'function') {
        result.then(() => finish()).catch((e) => parentPort.postMessage({ type: 'error', error: (e && e.message) || String(e) }));
      } else {
        finish();
      }
    } else {
      finish();
    }
  } else {
    finish();
  }
} catch (e) {
  parentPort.postMessage({ type: 'error', error: (e && e.message) || String(e) });
}

parentPort.on('message', (m) => {
  if (!m || m.type !== 'execute') return;
  const handler = handlers.get(m.commandId);
  if (!handler) {
    parentPort.postMessage({ type: 'result', commandId: m.commandId, ok: false, error: 'no handler' });
    return;
  }
  try {
    Promise.resolve(handler(...(Array.isArray(m.args) ? m.args : [])))
      .then((r) => parentPort.postMessage({ type: 'result', commandId: m.commandId, ok: true, result: r }))
      .catch((e) => parentPort.postMessage({ type: 'result', commandId: m.commandId, ok: false, error: (e && e.message) || String(e) }));
  } catch (e) {
    parentPort.postMessage({ type: 'result', commandId: m.commandId, ok: false, error: (e && e.message) || String(e) });
  }
});
`;

export class PluginWorkerHost {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (r: { ok: boolean; result?: unknown; error?: string }) => void }>();
  private commands: string[] = [];
  private listeners = new Map<string, (msg: PluginWorkerMessage) => void>();
  readonly pluginName: string;

  private constructor(pluginName: string) {
    this.pluginName = pluginName;
  }

  /** 派生 Worker 源码（把 sandbox 模块路径注入 workerData）。 */
  private static buildWorkerSource(): string {
    return WORKER_SOURCE;
  }

  /**
   * 在 worker 中激活插件。超时（默认 10s）→ terminate 并返回失败，
   * 插件死循环不可能卡死主进程。
   */
  static async spawn(spec: PluginWorkerSpec, timeoutMs = 10000): Promise<PluginWorkerHost> {
    const host = new PluginWorkerHost(spec.pluginName);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(host);
      };
      const timer = setTimeout(() => {
        host.terminate();
        finish(new Error(`Plugin "${spec.pluginName}" activation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const worker = new Worker(PluginWorkerHost.buildWorkerSource(), {
          eval: true,
          workerData: {
            pluginRoot: path.resolve(spec.pluginRoot),
            mainRel: spec.mainRel,
            capabilities: spec.capabilities || [],
          },
        });
        host.worker = worker;
        worker.on('message', (msg: PluginWorkerMessage) => {
          if (msg?.type === 'ready') {
            host.commands = Array.isArray(msg.commands) ? msg.commands : [];
            finish();
          } else if (msg?.type === 'error') {
            finish(new Error(msg.error || 'Plugin activation failed'));
          } else if (msg?.type === 'result' && msg.commandId) {
            const p = host.pending.get(msg.commandId);
            if (p) {
              host.pending.delete(msg.commandId);
              p.resolve({ ok: !!msg.ok, result: msg.result, error: msg.error });
            }
          } else if (msg?.type === 'notify' || msg?.type === 'webview') {
            const cb = host.listeners.get(msg.type);
            cb?.(msg);
          }
        });
        worker.on('error', (e) => finish(e));
        worker.on('exit', () => {
          // 进程意外退出：把 pending 命令全部按失败结算
          host.pending.forEach((p, id) => p.resolve({ ok: false, error: 'plugin worker exited' }));
          host.pending.clear();
          host.worker = null;
        });
      } catch (e) {
        finish(e as Error);
      }
    });
  }

  /** 激活期间已注册的命令 id 列表。 */
  getCommands(): string[] {
    return [...this.commands];
  }

  /** 转发命令到 worker 执行（handler 存于 worker 内）。 */
  execute(commandId: string, args: unknown[]): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ ok: false, error: 'plugin worker not running' });
        return;
      }
      this.pending.set(commandId, { resolve });
      this.worker.postMessage({ type: 'execute', commandId, args });
    });
  }

  onNotify(cb: (msg: { level?: 'info' | 'error' | 'warn'; msg?: string }) => void): void {
    this.listeners.set('notify', cb as (m: PluginWorkerMessage) => void);
  }

  onWebview(cb: (msg: { panelId?: string; title?: string; html?: string; url?: string; dispose?: boolean }) => void): void {
    this.listeners.set('webview', cb as (m: PluginWorkerMessage) => void);
  }

  terminate(): void {
    try { this.worker?.terminate(); } catch { /* ignore */ }
    this.worker = null;
    this.pending.forEach((p) => p.resolve({ ok: false, error: 'plugin worker terminated' }));
    this.pending.clear();
  }

  get running(): boolean {
    return !!this.worker;
  }
}
