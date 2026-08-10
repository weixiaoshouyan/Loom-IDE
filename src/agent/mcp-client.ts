/**
 * Loom MCP (Model Context Protocol) Client
 * Connects to MCP servers for tool discovery and execution.
 *
 * Supports:
 * - stdio transport (local processes, JSON-RPC 2.0 over stdin/stdout)
 * - HTTP endpoints (Loom-specific REST shape: GET /tools/list, POST /tools/call)
 *
 * NOTE: the HTTP transport is NOT the MCP HTTP/SSE standard — standard remote
 * MCP servers (SSE + /messages) are not supported yet. The transport is
 * documented honestly as a Loom-specific protocol extension.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// === Types ===

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;        // For stdio: command to run
  args?: string[];         // For stdio: command arguments
  env?: Record<string, string>;
  url?: string;            // For http: server URL
  headers?: Record<string, string>;
  enabled: boolean;
  autoConnect: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverId: string;
  serverName: string;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// === MCP Client ===

// Allowed MCP stdio executables. Shell interpreters are excluded to prevent RCE.
const ALLOWED_MCP_COMMANDS = new Set([
  'npx', 'node', 'python', 'python3',
]);

const BLOCKED_MCP_COMMANDS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh',
  'curl', 'wget', 'rm', 'del', 'format', 'sudo', 'su', 'runas',
]);

export function isValidMcpCommand(command: string): { ok: boolean; message?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, message: 'Command is empty' };

  // Reject shell metacharacters that would enable injection even with spawn(..., shell:false)
  if (/[;&|`$(){}[\]<>]/.test(trimmed)) {
    return { ok: false, message: `Command contains disallowed characters: ${trimmed}` };
  }

  const baseName = path.basename(trimmed).toLowerCase();
  if (BLOCKED_MCP_COMMANDS.has(baseName)) {
    return { ok: false, message: `Command "${baseName}" is not allowed for MCP servers` };
  }

  // Allow absolute paths to known safe directories or workspace-relative executables
  if (path.isAbsolute(trimmed)) {
    const lower = trimmed.toLowerCase();
    const isInProgramFiles = lower.startsWith('c:\\program files\\') || lower.startsWith('c:\\program files (x86)\\');
    const isInNodeModules = trimmed.includes('node_modules') && (lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1'));
    if (!isInProgramFiles && !isInNodeModules) {
      return { ok: false, message: `Absolute command path not allowed: ${trimmed}` };
    }
    return { ok: true };
  }

  if (!ALLOWED_MCP_COMMANDS.has(baseName)) {
    return { ok: false, message: `Command "${baseName}" is not in the allowed MCP command list` };
  }

  return { ok: true };
}

export function isValidMcpArgs(args?: string[]): { ok: boolean; message?: string } {
  if (!args) return { ok: true };
  for (const arg of args) {
    if (/[;&|`$(){}[\]<>]/.test(arg)) {
      return { ok: false, message: `Argument contains disallowed characters: ${arg}` };
    }
  }
  return { ok: true };
}

/**
 * SECURITY: reject MCP HTTP targets that make no sense for a user-configured
 * server — non-http(s) protocols, cloud-metadata / link-local addresses
 * (SSRF via 169.254.169.254 and friends). Localhost and private ranges stay
 * allowed: local MCP servers are a legitimate use case.
 */
export function isForbiddenMcpHttpUrl(urlStr: string): boolean {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return true;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (host === '0.0.0.0') return true;
  if (host === '169.254.169.254' || /^169\.254\./.test(host)) return true;
  if (host.startsWith('fe80:') || host === '::' || host === '[::]') return true;
  return false;
}

export class MCPClient {
  private servers: Map<string, MCPServerConfig> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private buffers: Map<string, string> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number, { serverId: string; resolve: (v: any) => void; reject: (e: Error) => void }> = new Map();
  private onUpdate?: (servers: MCPServerConfig[]) => void;
  private onToolsUpdate?: (tools: MCPTool[]) => void;

  constructor(configs?: MCPServerConfig[] | Record<string, any>) {
    const normalized = normalizeMCPServerConfigs(configs);
    if (normalized) {
      for (const cfg of normalized) this.servers.set(cfg.id, cfg);
    }
  }

  onUpdateConfig(cb: (servers: MCPServerConfig[]) => void) { this.onUpdate = cb; }
  onToolsUpdateConfig(cb: (tools: MCPTool[]) => void) { this.onToolsUpdate = cb; }

  getAllServers(): MCPServerConfig[] { return [...this.servers.values()]; }

  addServer(config: MCPServerConfig) {
    this.servers.set(config.id, config);
    this.onUpdate?.(this.getAllServers());
    if (config.autoConnect) this.connect(config.id);
  }

  updateServer(id: string, patch: Partial<MCPServerConfig>) {
    const server = this.servers.get(id);
    if (!server) return;
    Object.assign(server, patch);
    this.servers.set(id, server);
    this.onUpdate?.(this.getAllServers());
  }

  removeServer(id: string) {
    this.disconnect(id);
    this.servers.delete(id);
    // Remove associated tools
    for (const [name, tool] of this.tools) {
      if (tool.serverId === id) this.tools.delete(name);
    }
    this.onUpdate?.(this.getAllServers());
    this.onToolsUpdate?.(this.getAllTools());
  }

  // === Connection Management ===

  async connect(serverId: string): Promise<{ ok: boolean; message: string }> {
    const server = this.servers.get(serverId);
    if (!server) return { ok: false, message: `Server "${serverId}" not found` };
    if (!server.enabled) return { ok: false, message: 'Server is disabled' };

    if (this.processes.has(serverId)) this.disconnect(serverId);

    if (server.transport === 'stdio' && server.command) {
      return this.connectStdio(server);
    } else if (server.transport === 'http' && server.url) {
      if (isForbiddenMcpHttpUrl(server.url)) {
        return { ok: false, message: `HTTP MCP server URL is not allowed: ${server.url}` };
      }
      return this.connectHttp(server);
    }
    return { ok: false, message: 'Invalid transport configuration' };
  }

  disconnect(serverId: string) {
    const proc = this.processes.get(serverId);
    if (proc) {
      try {
        const pid = proc.pid;
        if (pid) {
          if (process.platform === 'win32') {
            // Windows：主进程终止后 stdio 管道关闭，孙进程随父退出。
            try { process.kill(pid, 'SIGKILL'); } catch {}
          } else if (proc.killed === false) {
            // POSIX：spawn 时设了 detached，pid 即进程组组长，杀整组。
            try { process.kill(-pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
          }
        }
        proc.kill();
      } catch {}
      this.processes.delete(serverId);
    }
    this.buffers.delete(serverId);
    // A manually disconnected server exposes no tools until reconnected.
    this.removeServerTools(serverId);
  }

  /** Remove every tool belonging to a server and notify listeners. */
  private removeServerTools(serverId: string) {
    let changed = false;
    for (const [name, tool] of this.tools) {
      if (tool.serverId === serverId) { this.tools.delete(name); changed = true; }
    }
    if (changed) this.onToolsUpdate?.(this.getAllTools());
  }

  /** Reject every in-flight request for a dead server (no 30s hang). */
  private rejectServerRequests(serverId: string, error: Error) {
    for (const [id, entry] of this.pendingRequests) {
      if (entry.serverId === serverId) {
        this.pendingRequests.delete(id);
        entry.reject(error);
      }
    }
  }

  private async connectStdio(server: MCPServerConfig): Promise<{ ok: boolean; message: string }> {
    const command = server.command;
    if (!command) return { ok: false, message: 'Missing command for stdio transport' };

    const commandValidation = isValidMcpCommand(command);
    if (!commandValidation.ok) return { ok: false, message: commandValidation.message || 'Invalid MCP command' };

    const argsValidation = isValidMcpArgs(server.args);
    if (!argsValidation.ok) return { ok: false, message: argsValidation.message || 'Invalid MCP arguments' };

    try {
      const proc = spawn(command, server.args || [], {
        env: { ...process.env, ...(server.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        // On POSIX, detach so the child becomes its own process-group leader;
        // disconnect() can then kill the whole group (including npx grandchildren).
        detached: process.platform !== 'win32',
      });

      this.processes.set(server.id, proc);
      this.buffers.set(server.id, '');

      if (proc.stdout) {
        proc.stdout.on('data', (data: Buffer) => {
          this.handleData(server.id, data.toString('utf-8'));
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          console.error(`[MCP:${server.id}] stderr:`, data.toString('utf-8'));
        });
      }

      proc.on('exit', (code) => {
        // Superseded guard: a reconnect may have replaced this process before
        // the old one's exit event fired — only the current process cleans up.
        if (this.processes.get(server.id) !== proc) return;
        console.log(`[MCP:${server.id}] exited with code ${code}`);
        this.processes.delete(server.id);
        this.buffers.delete(server.id);
        // A dead server must not leave callers hanging for the 30s timeout,
        // and its tools must not be advertised as available.
        this.rejectServerRequests(server.id, new Error(`MCP server "${server.name}" exited unexpectedly (code ${code}).`));
        this.removeServerTools(server.id);
      });

      proc.on('error', (err) => {
        if (this.processes.get(server.id) !== proc) return;
        console.error(`[MCP:${server.id}] error:`, err.message);
        this.processes.delete(server.id);
        this.buffers.delete(server.id);
        this.rejectServerRequests(server.id, new Error(`MCP server "${server.name}" failed to start: ${err.message}`));
        this.removeServerTools(server.id);
      });

      // Initialize connection
      const initResp = await this.sendRequest(server.id, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'Loom IDE', version: '0.2.1' },
      });
      console.log(`[MCP:${server.id}] initialized:`, initResp?.serverInfo?.name);
      this.sendNotification(server.id, 'notifications/initialized', {});

      // Discover tools
      const toolsResp = await this.sendRequest(server.id, 'tools/list', {});
      if (toolsResp?.tools) {
        for (const tool of toolsResp.tools) {
          this.tools.set(`${server.id}:${tool.name}`, {
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || {},
            serverId: server.id,
            serverName: server.name,
          });
        }
        this.onToolsUpdate?.(this.getAllTools());
      }

      return { ok: true, message: `Connected to ${server.name} (${toolsResp?.tools?.length || 0} tools)` };
    } catch (e: any) {
      this.disconnect(server.id);
      return { ok: false, message: e.message };
    }
  }

  private async connectHttp(server: MCPServerConfig): Promise<{ ok: boolean; message: string }> {
    // Loom-specific REST endpoints (NOT the MCP HTTP/SSE standard — see the
    // module header). Tool discovery is GET {url}/tools/list.
    try {
      const resp = await fetch(`${server.url}/tools/list`, {
        headers: { 'Content-Type': 'application/json', ...(server.headers || {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
      const data = await resp.json() as any;
      const tools = data.tools || [];
      for (const tool of tools) {
        this.tools.set(`${server.id}:${tool.name}`, {
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          serverId: server.id,
          serverName: server.name,
        });
      }
      this.onToolsUpdate?.(this.getAllTools());
      return { ok: true, message: `Connected to ${server.name} (${tools.length} tools)` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  }

  async reconnectAll() {
    await Promise.allSettled(
      Array.from(this.servers.entries())
        .filter(([_, server]) => server.enabled)
        .map(([id]) => this.connect(id))
    );
  }

  // === Tool Management ===

  getAllTools(): MCPTool[] { return [...this.tools.values()]; }

  getToolsByServer(serverId: string): MCPTool[] {
    return this.getAllTools().filter(t => t.serverId === serverId);
  }

  getServerTools(serverId: string): MCPTool[] {
    return this.getToolsByServer(serverId);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    const tool = this.tools.get(`${serverId}:${toolName}`);
    if (!tool) throw new Error(`Tool "${toolName}" not found for server "${serverId}"`);

    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server "${serverId}" not found`);

    if (server.transport === 'stdio') {
      // Lazy reconnect: if the process died (crash or external kill), bring
      // the server back up once before retrying the call.
      if (!this.processes.has(serverId) && server.enabled) {
        const result = await this.connect(serverId);
        if (!result.ok) {
          throw new Error(`MCP server "${server.name}" is not connected: ${result.message}`);
        }
      }
      return this.sendRequest(serverId, 'tools/call', { name: toolName, arguments: args });
    } else if (server.transport === 'http' && server.url) {
      if (isForbiddenMcpHttpUrl(server.url)) {
        throw new Error(`HTTP MCP server URL is not allowed: ${server.url}`);
      }
      const resp = await fetch(`${server.url}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(server.headers || {}) },
        body: JSON.stringify({ name: toolName, arguments: args }),
        signal: AbortSignal.timeout(30000),
      });
      return resp.json();
    }
    throw new Error('Invalid transport');
  }

  // === JSON-RPC Protocol ===

  private handleData(serverId: string, data: string) {
    let buffer = this.buffers.get(serverId) || '';
    buffer += data;

    // Process complete lines
    const lines = buffer.split('\n');
    this.buffers.set(serverId, lines.pop() || '');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
          else resolve(msg.result);
        }
      } catch (e) {
        // Ignore non-JSON lines (log messages, etc.)
      }
    }
  }

  private sendRequest(serverId: string, method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const proc = this.processes.get(serverId);
      if (!proc) { reject(new Error('Not connected')); return; }

      const id = ++this.requestId;
      const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };
      this.pendingRequests.set(id, { serverId, resolve, reject });

      // Timeout after 30 seconds
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 30000);

      // Clear timeout when request resolves to prevent memory leak
      const originalResolve = resolve;
      const originalReject = reject;
      this.pendingRequests.set(id, {
        serverId,
        resolve: (value: any) => { clearTimeout(timeoutId); originalResolve(value); },
        reject: (err: any) => { clearTimeout(timeoutId); originalReject(err); },
      });

      try {
        proc.stdin!.write(JSON.stringify(request) + '\n');
      } catch (e: any) {
        // Dead process → EPIPE. Abort the pending request instead of crashing.
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          clearTimeout(timeoutId);
          reject(new Error('MCP process is not available (EPIPE).'));
        }
        return;
      }
    });
  }

  private sendNotification(serverId: string, method: string, params?: any) {
    const proc = this.processes.get(serverId);
    if (!proc) return;
    try {
      proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    } catch (e: any) {
      // Process may have exited; a dead stdin throws EPIPE. Ignore.
      if (e?.code !== 'EPIPE') console.error(`[MCP:${serverId}] write error:`, e?.message);
    }
  }

  /**
   * Get a summary of all available tools for the AI system prompt
   */
  getToolsSummary(): string {
    const tools = this.getAllTools();
    if (tools.length === 0) return '';
    let summary = '\n\nAvailable MCP Tools:\n';
    for (const tool of tools) {
      const params = tool.inputSchema?.properties
        ? Object.entries(tool.inputSchema.properties as Record<string, any>)
            .map(([k, v]: [string, any]) => `${k}: ${v.type || 'string'}`)
            .join(', ')
        : 'no parameters';
      summary += `- [${tool.serverName}] ${tool.name}: ${tool.description} (params: ${params})\n`;
    }
    return summary;
  }
}

export function normalizeMCPServerConfigs(configs?: MCPServerConfig[] | Record<string, any>): MCPServerConfig[] | undefined {
  if (!configs) return undefined;
  if (Array.isArray(configs)) return configs;

  const source = configs.mcpServers && typeof configs.mcpServers === 'object'
    ? configs.mcpServers
    : configs;

  return Object.entries(source).map(([id, raw]: [string, any]) => {
    const transport: 'stdio' | 'http' = raw.transport || (raw.url ? 'http' : 'stdio');
    const config: MCPServerConfig = {
      id: raw.id || id,
      name: raw.name || id,
      transport,
      enabled: raw.enabled ?? true,
      autoConnect: raw.autoConnect ?? true,
    };
    if (raw.command) config.command = raw.command;
    if (raw.args) config.args = raw.args;
    if (raw.env) config.env = raw.env;
    if (raw.url) config.url = raw.url;
    if (raw.headers) config.headers = raw.headers;
    return config;
  });
}
