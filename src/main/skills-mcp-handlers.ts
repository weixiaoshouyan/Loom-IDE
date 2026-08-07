/**
 * Skills + MCP server IPC handlers.
 *
 * Skills: list, filter by category, resolve prompt templates.
 * MCP: CRUD for server configs, connect/disconnect, list tools, call tools.
 * All mutating MCP operations validate command/args before applying.
 */
import { ipcMain } from 'electron';
import { SkillManager } from '../agent/skills';
import { MCPClient, MCPServerConfig, isValidMcpCommand, isValidMcpArgs } from '../agent/mcp-client';

// Set by index.ts.
let _skillManager: SkillManager | null = null;
let _mcpClient: MCPClient | null = null;

export function setSkillsMcpSingletons(skillMgr: SkillManager, mcp: MCPClient) {
  _skillManager = skillMgr;
  _mcpClient = mcp;
  // Expose MCP client globally so dialog-handlers can import Cursor config.
  (global as any).__loom_mcpClient = mcp;
}

function skills() { return _skillManager!; }
function mcp() { return _mcpClient!; }

export function registerSkillsHandlers() {
  ipcMain.handle('skills:getAll', () => skills().getAll());

  ipcMain.handle('skills:getByCategory', (_e: any, category: string) => skills().getByCategory(category as any));

  ipcMain.handle('skills:resolvePrompt', (_e: any, skillId: string, variables: Record<string, string>) => {
    return skills().resolvePrompt(skillId, variables);
  });
}

function validateMcpConfig(config: Partial<MCPServerConfig>): { ok: boolean; message?: string } {
  if (config.transport === 'stdio' && config.command) {
    const cmdValidation = isValidMcpCommand(config.command);
    if (!cmdValidation.ok) return cmdValidation;
    const argsValidation = isValidMcpArgs(config.args);
    if (!argsValidation.ok) return argsValidation;
  }
  return { ok: true };
}

export function registerMcpHandlers() {
  ipcMain.handle('mcp:getServers', () => mcp().getAllServers());

  ipcMain.handle('mcp:addServer', (_e: any, config: MCPServerConfig) => {
    const validation = validateMcpConfig(config);
    if (!validation.ok) return { ok: false, message: validation.message || 'Invalid MCP configuration' };
    mcp().addServer(config);
    return { ok: true };
  });

  ipcMain.handle('mcp:updateServer', (_e: any, id: string, patch: Partial<MCPServerConfig>) => {
    const validation = validateMcpConfig(patch);
    if (!validation.ok) return { ok: false, message: validation.message || 'Invalid MCP configuration' };
    mcp().updateServer(id, patch);
    return { ok: true };
  });

  ipcMain.handle('mcp:removeServer', (_e: any, id: string) => {
    mcp().removeServer(id);
    return true;
  });

  ipcMain.handle('mcp:connect', async (_e: any, serverId: string) => mcp().connect(serverId));

  ipcMain.handle('mcp:disconnect', (_e: any, serverId: string) => {
    mcp().disconnect(serverId);
    return true;
  });

  ipcMain.handle('mcp:getTools', () => mcp().getAllTools());

  ipcMain.handle('mcp:callTool', async (_e: any, serverId: string, toolName: string, args: Record<string, any>) => {
    try {
      const result = await mcp().callTool(serverId, toolName, args);
      return { ok: true, result };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  });
}
