import { describe, expect, it } from 'vitest';
import { buildCliAgentArgs, KNOWN_CLI_AGENTS } from './cli-agents';

describe('cli agents', () => {
  it('builds Claude CLI prompt args', () => {
    expect(buildCliAgentArgs(KNOWN_CLI_AGENTS.claude, 'fix bug')).toEqual(['-p', 'fix bug']);
  });

  it('builds OpenCode CLI prompt args', () => {
    expect(buildCliAgentArgs(KNOWN_CLI_AGENTS.opencode, 'fix bug')).toEqual(['run', 'fix bug']);
  });
});
