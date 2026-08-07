import { spawn, spawnSync } from 'child_process';
import os from 'os';

export interface CliAgentDefinition {
  id: string;
  name: string;
  command: string;
  argsTemplate: string[];
}

export interface CliAgentInfo extends CliAgentDefinition {
  installed: boolean;
  path?: string;
}

export const KNOWN_CLI_AGENTS: Record<string, CliAgentDefinition> = {
  claude: { id: 'claude', name: 'Claude CLI', command: 'claude', argsTemplate: ['-p', '{{prompt}}'] },
  opencode: { id: 'opencode', name: 'OpenCode CLI', command: 'opencode', argsTemplate: ['run', '{{prompt}}'] },
  codex: { id: 'codex', name: 'Codex CLI', command: 'codex', argsTemplate: ['exec', '{{prompt}}'] },
};

export function buildCliAgentArgs(agent: CliAgentDefinition, prompt: string): string[] {
  return agent.argsTemplate.map(arg => arg.replace('{{prompt}}', prompt));
}

function resolveCommand(command: string): string | undefined {
  const resolver = os.platform() === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(resolver, [command], { encoding: 'utf-8', shell: false });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
}

export function listCliAgents(): CliAgentInfo[] {
  return Object.values(KNOWN_CLI_AGENTS).map(agent => {
    const resolved = resolveCommand(agent.command);
    return { ...agent, installed: !!resolved, path: resolved };
  });
}

export interface CliAgentRunResult {
  stdout: string;
  stderr: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  ok: boolean;
}

export function runCliAgent(agentId: string, prompt: string, cwd?: string, timeoutMs = 120000): Promise<CliAgentRunResult> {
  const agent = KNOWN_CLI_AGENTS[agentId];
  if (!agent) return Promise.reject(new Error(`Unknown CLI agent: ${agentId}`));
  const resolved = resolveCommand(agent.command);
  if (!resolved) return Promise.reject(new Error(`${agent.name} is not installed or not in PATH.`));

  return new Promise((resolve, reject) => {
    const child = spawn(resolved, buildCliAgentArgs(agent, prompt), {
      cwd: cwd || process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${agent.name} timed out.`));
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    // NOTE: a non-zero exit code is a *result*, not a failure to run the
    // command. Resolve with structured fields so the renderer can show the
    // output instead of permanently spinning on an unhandled rejection.
    child.on('close', code => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode, ok: exitCode === 0 });
    });
  });
}
