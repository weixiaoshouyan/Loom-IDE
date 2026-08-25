import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// IPC contract consistency gate.
//
// The renderer talks to the main process purely through string channel names.
// A typo on either side (e.g. the historical `codeindex:prebuild` mismatch)
// compiles fine but fails silently at runtime. This test parses the channel
// literals out of `preload.ts` (the renderer-facing bridge) and every main
// handler module, then asserts the two sides agree:
//
//   * every `ipcRenderer.invoke(ch)` has a matching `ipcMain.handle(ch)`
//   * every `ipcRenderer.send(ch)`   has a matching `ipcMain.on(ch)`
//   * no main handler/listener is left orphaned outside a documented allow-list
//
// It is intentionally source-text based (no imports of Electron) so it can run
// in the plain Node test environment and stays cheap enough for `npm test`.

// Resolved from the repo root; the test scripts (`vitest run --root . src`)
// always execute with the project root as the working directory.
const MAIN_DIR = path.resolve(process.cwd(), 'src', 'main');
const PRELOAD_FILE = path.join(MAIN_DIR, 'preload.ts');

/** Main handlers that are intentionally NOT bridged through `window.loom`. */
const KNOWN_UNEXPOSED_HANDLE = new Set<string>([
  // Command policy is administered through a dedicated settings surface rather
  // than the generic renderer bridge.
  'command-policy:get',
  'command-policy:setAllowed',
  'command-policy:setExtraBlocked',
  'command-policy:setAllowInlineInterpreterCode',
  // Maintenance / diagnostic channels called internally, not from the renderer.
  'history:cleanup',
  'history:stats',
  'team:getRulesForFile',
  'code-index:build',
  'ai:chat',
  'ai:get-usage',
  'ai:ask-with',
  'ai:getOrcaProviders',
  'agent-tasks:get',
  'plugins:install',
  'plugins:getConfigurations',
  'plugins:getUserConfig',
  'plugins:setUserConfig',
  'plugins:getNotifications',
  'plugins:clearNotifications',
  'skills:getByCategory',
  'skills:resolvePrompt',
  'marketplace:list-installed',
  'mcp:getServers',
  'mcp:addServer',
  'mcp:updateServer',
  'mcp:removeServer',
  'mcp:connect',
  'mcp:disconnect',
  'mcp:getTools',
  'mcp:callTool',
  'recent:clearFolders',
  'conversations:save',
  'conversations:load',
  'conversations:list',
  'conversations:delete',
  'conversations:clear',
  'conversations:search',
  'conversations:export',
  'team:signIn',
  'team:signOut',
  'telemetry:setConfig',
  'telemetry:getAuditLog',
  'telemetry:clearAuditLog',
  'fs:stat',
  'git:diff',
]);

/** Main listeners that are intentionally NOT driven by the preload bridge. */
const KNOWN_UNEXPOSED_ON = new Set<string>([
  // Posted by webview guests directly, not through `window.loom`.
  'plugins:webviewEvent',
  'ai:sub-agent-stream',
]);

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function extractChannels(source: string, prefix: RegExp): Set<string> {
  const channels = new Set<string>();
  const pattern = new RegExp(prefix.source + String.raw`\(\s*['"]([^'"]+)['"]`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) channels.add(match[1]!);
  return channels;
}

function collectMainChannels(): { handle: Set<string>; on: Set<string> } {
  const handle = new Set<string>();
  const on = new Set<string>();
  for (const file of walkTsFiles(MAIN_DIR)) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const ch of extractChannels(source, /ipcMain\.handle/)) handle.add(ch);
    for (const ch of extractChannels(source, /ipcMain\.on/)) on.add(ch);
  }
  return { handle, on };
}

function collectPreloadChannels(): { invoke: Set<string>; send: Set<string> } {
  const source = fs.readFileSync(PRELOAD_FILE, 'utf-8');
  return {
    invoke: extractChannels(source, /ipcRenderer\.invoke/),
    send: extractChannels(source, /ipcRenderer\.send/),
  };
}

describe('IPC channel contract', () => {
  const { handle, on } = collectMainChannels();
  const { invoke, send } = collectPreloadChannels();

  it('parses a non-trivial number of channels from both sides', () => {
    // Guards against a broken regex silently turning every assertion into a
    // no-op (empty sets trivially satisfy the subset checks below).
    expect(invoke.size).toBeGreaterThan(20);
    expect(handle.size).toBeGreaterThan(20);
    expect(send.size).toBeGreaterThan(0);
    expect(on.size).toBeGreaterThan(0);
  });

  it('every renderer invoke channel has a matching main handler', () => {
    const missing = [...invoke].filter(ch => !handle.has(ch)).sort();
    expect(missing).toEqual([]);
  });

  it('every renderer send channel has a matching main listener', () => {
    const missing = [...send].filter(ch => !on.has(ch)).sort();
    expect(missing).toEqual([]);
  });

  it('has no undocumented orphan main handlers', () => {
    const orphans = [...handle]
      .filter(ch => !invoke.has(ch) && !KNOWN_UNEXPOSED_HANDLE.has(ch))
      .sort();
    expect(orphans).toEqual([]);
  });

  it('has no undocumented orphan main listeners', () => {
    const orphans = [...on]
      .filter(ch => !send.has(ch) && !KNOWN_UNEXPOSED_ON.has(ch))
      .sort();
    expect(orphans).toEqual([]);
  });
});
