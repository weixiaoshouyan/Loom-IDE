/**
 * Command policy IPC handlers — expose the user-configurable allow/block list
 * to the renderer and persist changes via the existing settings:set channel.
 */
import { ipcMain } from 'electron';
import { loadConfig, saveConfig } from './config';
import { getAllowedCommands, getBlockedCommands, reloadCommandPolicy, isInlineInterpreterCodeAllowed, DEFAULT_ALLOWED_COMMANDS, DEFAULT_BLOCKED_COMMANDS } from './command-policy';

export function registerCommandPolicyHandlers() {
  // Return the current policy to the UI (includes defaults + user overrides).
  ipcMain.handle('command-policy:get', () => {
    return {
      allowedCommands: [...getAllowedCommands()],
      blockedCommands: [...getBlockedCommands()],
      defaultAllowed: [...DEFAULT_ALLOWED_COMMANDS],
      defaultBlocked: [...DEFAULT_BLOCKED_COMMANDS],
      // Whether interpreter inline-code flags (node -e, python -c,
      // powershell -Command, …) are permitted. Default false (strict).
      allowInlineInterpreterCode: isInlineInterpreterCodeAllowed(),
    };
  });

  // Replace the allowed list entirely (or pass null to restore defaults).
  ipcMain.handle('command-policy:setAllowed', (_e: any, commands: string[] | null) => {
    const cfg = loadConfig();
    if (!cfg.agent) cfg.agent = {};
    if (!cfg.agent.commandPolicy) cfg.agent.commandPolicy = {};
    cfg.agent.commandPolicy.allowedCommands =
      Array.isArray(commands) && commands.length > 0 ? commands : null;
    saveConfig(cfg);
    reloadCommandPolicy();
    return { ok: true };
  });

  // Extend (or clear) the extra blocked list appended to the default block.
  ipcMain.handle('command-policy:setExtraBlocked', (_e: any, commands: string[]) => {
    const cfg = loadConfig();
    if (!cfg.agent) cfg.agent = {};
    if (!cfg.agent.commandPolicy) cfg.agent.commandPolicy = {};
    cfg.agent.commandPolicy.extraBlockedCommands = Array.isArray(commands) ? commands : [];
    saveConfig(cfg);
    reloadCommandPolicy();
    return { ok: true };
  });

  // Opt in/out of interpreter inline-code execution (node -e, python -c,
  // powershell -Command, …). Off by default; enabling it is an explicit,
  // security-relevant choice surfaced in settings.
  ipcMain.handle('command-policy:setAllowInlineInterpreterCode', (_e: any, allow: boolean) => {
    const cfg = loadConfig();
    if (!cfg.agent) cfg.agent = {};
    if (!cfg.agent.commandPolicy) cfg.agent.commandPolicy = {};
    cfg.agent.commandPolicy.allowInlineInterpreterCode = allow === true;
    saveConfig(cfg);
    reloadCommandPolicy();
    return { ok: true };
  });
}
