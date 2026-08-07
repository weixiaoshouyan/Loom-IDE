import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIEngine, type AIConfig } from './ai-engine';

const config: Partial<AIConfig> = {
  mode: 'builtin',
  activeProviderId: 'custom',
  activeProfileId: 'coder',
  providers: [{
    id: 'custom',
    name: 'Custom',
    baseUrl: 'https://example.test/v1',
    apiKey: 'sk-test',
    models: ['custom-model'],
    activeModel: 'custom-model',
    isCustom: true,
  }],
  profiles: [{
    id: 'coder',
    name: 'Coder',
    systemPrompt: 'Help with code.',
    providerId: 'custom',
    model: 'custom-model',
    temperature: 0.2,
    maxTokens: 1000,
    icon: 'A',
  }],
};

const tempDirs: string[] = [];

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-ai-engine-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n', 'utf8');
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AIEngine agent tool compatibility', () => {
  it('retries OpenAI-compatible providers without native tools when the API rejects tools', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('unsupported field: tools', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Done without native tools.' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new AIEngine(config);
    const chunks = [];
    for await (const chunk of engine.agentChatStream(
      [{ role: 'user', content: 'List files' }],
      { workspacePath: 'D:/demo', openFiles: [] },
      1,
    )) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.tools).toBeDefined();
    expect(retryBody.tools).toBeUndefined();
    expect(retryBody.tool_choice).toBeUndefined();
    // Filter out state chunks (implementation detail of state machine)
    const nonStateChunks = chunks.filter(c => c.type !== 'state');
    expect(nonStateChunks).toEqual([{ type: 'text', content: 'Done without native tools.' }]);
  });

  it('emits a plan and stops before tool execution when planOnly is enabled', async () => {
    const planContent = [
      '```json',
      JSON.stringify({
        goal: 'Inspect the project',
        steps: [{ id: 1, description: 'List files', tool: 'list_files', dependsOn: [] }],
      }),
      '```',
    ].join('\n');
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{
        message: {
          content: planContent,
          tool_calls: [{
            id: 'call_list',
            type: 'function',
            function: { name: 'list_files', arguments: JSON.stringify({ dirPath: '.' }) },
          }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new AIEngine(config);
    const chunks = [];
    for await (const chunk of engine.agentChatStream(
      [{ role: 'user', content: 'List files' }],
      { workspacePath: 'D:/demo', openFiles: [] },
      1,
      undefined,
      { plannerMode: true, planOnly: true },
    )) {
      chunks.push(chunk);
    }

    // Filter out state chunks (implementation detail of state machine)
    const nonStateChunks = chunks.filter(c => c.type !== 'state');
    expect(nonStateChunks).toEqual([{ type: 'plan', content: '## Plan: Inspect the project\n\n1. **List files** *(tool: list_files)*\n' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not leak tool placeholder text into follow-up model requests', async () => {
    const workspace = makeWorkspace();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_list',
              type: 'function',
              function: { name: 'list_files', arguments: JSON.stringify({ dirPath: '.', depth: 1 }) },
            }],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'The project contains a README file.' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new AIEngine(config);
    const chunks = [];
    for await (const chunk of engine.agentChatStream(
      [{ role: 'user', content: 'Summarize this project' }],
      { workspacePath: workspace, openFiles: [] },
      2,
    )) {
      chunks.push(chunk);
    }

    expect(chunks.some(chunk => chunk.type === 'text' && chunk.content.includes('The project contains'))).toBe(true);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(JSON.stringify(secondBody.messages)).not.toContain('Using tool:');
  });

  it('asks for a final summary when max tool rounds are reached', async () => {
    const workspace = makeWorkspace();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_list',
              type: 'function',
              function: { name: 'list_files', arguments: JSON.stringify({ dirPath: '.', depth: 1 }) },
            }],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Final summary from gathered files.' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new AIEngine(config);
    const chunks = [];
    for await (const chunk of engine.agentChatStream(
      [{ role: 'user', content: 'Summarize this project' }],
      { workspacePath: workspace, openFiles: [] },
      1,
    )) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks).toContainEqual({ type: 'text', content: 'Final summary from gathered files.' });
  });
});
