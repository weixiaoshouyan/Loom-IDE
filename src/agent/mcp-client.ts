/**
 * Loom MCP (Model Context Protocol) Client
 * Connects to MCP servers for tool discovery and execution.
 * 
 * Supports:
 * - stdio transport (local processes)
 * - HTTP/SSE transport (remote servers)
 */

import { spawn, ChildProcess } from 'child_process';

// === Types ===

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;        // For stdio: command to run
  args?: string[];         // For stdio: command arguments
  env?: Record<string, string>;
  url?: string;            // For http: server URL
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

export class MCPClient {
  private servers: Map<string, MCPServerConfig> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private buffers: Map<string, string> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map();
  private onUpdate?: (servers: MCPServerConfig[]) => void;
  private onToolsUpdate?: (tools: MCPTool[]) => void;

  constructor(configs?: MCPServerConfig[]) {
    if (configs) {
      for (const cfg of configs) this.servers.set(cfg.id, cfg);
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
      return this.connectHttp(server);
    }
    return { ok: false, message: 'Invalid transport configuration' };
  }

  disconnect(serverId: string) {
    const proc = this.processes.get(serverId);
    if (proc) { try { proc.kill(); } catch {} this.processes.delete(serverId); }
    this.buffers.delete(serverId);
  }

  private async connectStdio(server: MCPServerConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const proc = spawn(server.command!, server.args || [], {
        env: { ...process.env, ...(server.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.processes.set(server.id, proc);
      this.buffers.set(server.id, '');

      proc.stdout!.on('data', (data: Buffer) => {
        this.handleData(server.id, data.toString('utf-8'));
      });

      proc.stderr!.on('data', (data: Buffer) => {
        console.error(`[MCP:${server.id}] stderr:`, data.toString('utf-8'));
      });

      proc.on('exit', (code) => {
        console.log(`[MCP:${server.id}] exited with code ${code}`);
        this.processes.delete(server.id);
        this.buffers.delete(server.id);
      });

      proc.on('error', (err) => {
        console.error(`[MCP:${server.id}] error:`, err.message);
      });

      // Initialize connection
      const initResp = await this.sendRequest(server.id, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'Loom IDE', version: '0.2.0' },
      });
      console.log(`[MCP:${server.id}] initialized:`, initResp?.serverInfo?.name);

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
    try {
      const resp = await fetch(`${server.url}/tools/list`, {
        headers: { 'Content-Type': 'application/json' },
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
    for (const [id, server] of this.servers) {
      if (server.enabled) await this.connect(id);
    }
  }

  // === Tool Management ===

  getAllTools(): MCPTool[] { return [...this.tools.values()]; }

  getToolsByServer(serverId: string): MCPTool[] {
    return this.getAllTools().filter(t => t.serverId === serverId);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    const tool = this.tools.get(`${serverId}:${toolName}`);
    if (!tool) throw new Error(`Tool "${toolName}" not found for server "${serverId}"`);

    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server "${serverId}" not found`);

    if (server.transport === 'stdio') {
      return this.sendRequest(serverId, 'tools/call', { name: toolName, arguments: args });
    } else if (server.transport === 'http' && server.url) {
      const resp = await fetch(`${server.url}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 30000);

      proc.stdin!.write(JSON.stringify(request) + '\n');
    });
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
