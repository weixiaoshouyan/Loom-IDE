/**
 * AI config / provider / profile handlers — get and mutate the AIEngine config.
 *
 * Returns are always masked (no plaintext API keys sent to renderer).
 */
import { ipcMain } from 'electron';
import { AIProvider, AgentProfile, AIConfig } from '../agent/ai-engine';
import { maskConfig } from './config';

// Set by index.ts.
let _aiEngine: any = null;
export function setAIEngineForConfigHandlers(e: any) { _aiEngine = e; }
function engine() {
  if (!_aiEngine) throw new Error('AIEngine not ready');
  return _aiEngine;
}

// Env-variable provider auto-detection keys.
const ENV_PROVIDER_MAP: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  doubao: 'ARK_API_KEY',
  baichuan: 'BAICHUAN_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  lingyiwanwu: 'LINGYI_API_KEY',
  xiaomi: 'XIAOMI_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  yi: 'YI_API_KEY',
};

export function registerAIConfigHandlers() {
  ipcMain.handle('ai:getConfig', () => maskConfig(engine().getConfig()));

  ipcMain.handle('ai:updateConfig', (_e: any, patch: Partial<AIConfig>) => {
    engine().updateConfig(patch);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:updateProvider', (_e: any, id: string, patch: Partial<AIProvider>) => {
    engine().updateProvider(id, patch);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:addProvider', (_e: any, provider: AIProvider) => {
    engine().addProvider(provider);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:removeProvider', (_e: any, id: string) => {
    engine().removeProvider(id);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:updateProfile', (_e: any, id: string, patch: Partial<AgentProfile>) => {
    engine().updateProfile(id, patch);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:addProfile', (_e: any, profile: AgentProfile) => {
    engine().addProfile(profile);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:removeProfile', (_e: any, id: string) => {
    engine().removeProfile(id);
    return maskConfig(engine().getConfig());
  });

  ipcMain.handle('ai:testConnection', async (_e: any, providerId: string) => {
    return engine().testConnection(providerId);
  });

  ipcMain.handle('ai:listModels', async (_e: any, providerId: string) => {
    return engine().listModels(providerId);
  });

  // Env-variable provider detection.
  ipcMain.handle('ai:detectEnvProviders', () => {
    const cfg = engine().getConfig();
    return cfg.providers
      .filter((p: any) => { const v = ENV_PROVIDER_MAP[p.id]; return !!v && !!process.env[v]; })
      .map((p: any) => ({ providerId: p.id, name: p.name, envVar: ENV_PROVIDER_MAP[p.id], hasKey: !!p.apiKey }));
  });

  ipcMain.handle('ai:applyEnvProvider', async (_e: any, providerId: string) => {
    const envVar = ENV_PROVIDER_MAP[providerId];
    const val = envVar ? process.env[envVar] : undefined;
    if (!val) return { ok: false, msg: '环境变量未设置' };
    engine().updateProvider(providerId, { apiKey: val });
    return { ok: true, config: maskConfig(engine().getConfig()) };
  });

  ipcMain.handle('ai:checkOrcaStatus', async () => engine().checkOrcaStatus());
  ipcMain.handle('ai:getOrcaProviders', async () => engine().getOrcaProviders());
}
