import { describe, expect, it } from 'vitest';
import { normalizeMCPServerConfigs } from './mcp-client';

describe('normalizeMCPServerConfigs', () => {
  it('keeps Loom array configs unchanged enough for persistence', () => {
    expect(normalizeMCPServerConfigs([
      { id: 'local', name: 'Local', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true, autoConnect: false },
    ])).toEqual([
      { id: 'local', name: 'Local', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true, autoConnect: false },
    ]);
  });

  it('imports Cursor-style mcpServers objects', () => {
    const normalized = normalizeMCPServerConfigs({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'token' },
      },
      remote: {
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      },
    });

    expect(normalized).toEqual([
      {
        id: 'github',
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'token' },
        enabled: true,
        autoConnect: true,
      },
      {
        id: 'remote',
        name: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        enabled: true,
        autoConnect: true,
      },
    ]);
  });
});
