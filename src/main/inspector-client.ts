/**
 * Node Inspector (CDP) 客户端 — 让「调试」成为真正的断点调试。
 *
 * 连接 `node --inspect-brk` 暴露的 WebSocket 调试端点，实现：
 *   - 继续 / 暂停 / 单步（stepOver/stepInto/stepOut）
 *   - 断点设置（Debugger.setBreakpointByUrl，按行号）
 *   - 调用栈 + 作用域变量（Debugger.paused → Debugger.getStackTrace →
 *     Runtime.getProperties / Debugger.evaluateOnCallFrame）
 *
 * 依赖 Node 24+ 内置全局 WebSocket（Electron 主进程可用）。协议消息收发为
 * 可单测的纯逻辑（见 inspector-client.test.ts）。
 */

export interface CdpResponse {
  id: number;
  result?: any;
  error?: { message: string };
}

export interface InspectorCallFrame {
  callFrameId: string;
  functionName: string;
  location: { lineNumber: number; columnNumber?: number; scriptId: string };
  url?: string;
  scopeChain: { type: string; object: { objectId: string } }[];
}

export interface InspectorPausedEvent {
  callFrames: InspectorCallFrame[];
  reason: string;
}

/** 等待 CDP 调试端口的 websocket 调试地址出现（--inspect-brk 启动延迟）。 */
export async function waitForInspectorEndpoint(port: number, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const list = await res.json() as { webSocketDebuggerUrl?: string }[];
        const page = list.find(t => t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Inspector did not start on port ${port} within ${timeoutMs}ms`);
}

/**
 * InspectorClient — 极简 CDP 客户端。
 * 用法：connect(url) → waitForPaused() → 读取栈/变量 → continue()。
 * 所有命令以 request/response id 关联；事件（Debugger.paused 等）经 onEvent 回调。
 */
export class InspectorClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  private pausedResolvers: Array<(ev: InspectorPausedEvent) => void> = [];
  onEvent: ((method: string, params: any) => void) | null = null;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(new Error('Inspector WebSocket error'));
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as CdpResponse & { method?: string; params?: any };
          if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          } else if (msg.method) {
            if (msg.method === 'Debugger.paused' && msg.params?.callFrames) {
              const evt: InspectorPausedEvent = { callFrames: msg.params.callFrames, reason: msg.params.reason };
              this.pausedResolvers.forEach(r => r(evt));
              this.pausedResolvers = [];
            }
            this.onEvent?.(msg.method, msg.params);
          }
        };
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Inspector not connected'));
        return;
      }
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 等待下一次 Debugger.paused 事件（断点/暂停/单步后触发）。 */
  waitForPaused(timeoutMs = 10000): Promise<InspectorPausedEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Debugger.paused')), timeoutMs);
      this.pausedResolvers.push((ev) => { clearTimeout(timer); resolve(ev); });
    });
  }

  async enable(): Promise<void> {
    await this.send('Debugger.enable');
  }

  async resume(): Promise<void> {
    await this.send('Debugger.resume');
  }

  async pause(): Promise<void> {
    await this.send('Debugger.pause');
  }

  async stepOver(): Promise<void> {
    await this.send('Debugger.stepOver');
  }

  async stepInto(): Promise<void> {
    await this.send('Debugger.stepInto');
  }

  async stepOut(): Promise<void> {
    await this.send('Debugger.stepOut');
  }

  /** 按 URL（脚本绝对路径）与行号设置断点；返回 breakpointId。 */
  async setBreakpointByUrl(url: string, lineNumber: number): Promise<string> {
    const res = await this.send('Debugger.setBreakpointByUrl', {
      url,
      lineNumber,
      columnNumber: 0,
    });
    return res?.breakpointId || '';
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    await this.send('Debugger.removeBreakpoint', { breakpointId });
  }

  /** 求值当前调用帧上的表达式（查看变量/对象属性）。 */
  async evaluateOnCallFrame(callFrameId: string, expression: string): Promise<any> {
    const res = await this.send('Debugger.evaluateOnCallFrame', { callFrameId, expression });
    return res?.result;
  }

  async getProperties(objectId: string): Promise<{ name: string; value?: string }[]> {
    const res = await this.send('Runtime.getProperties', { objectId, ownProperties: false });
    const out: { name: string; value?: string }[] = [];
    for (const p of (res?.result || [])) {
      if (p.name === '__proto__') continue;
      out.push({
        name: String(p.name),
        value: p.value?.description !== undefined ? String(p.value.description) : undefined,
      });
    }
    return out;
  }

  disconnect(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.pending.clear();
    this.pausedResolvers = [];
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
