// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  getLocalizedErrorMessage,
  normalizeChunk,
  renderTaskEvent,
  makeSessionTitle,
  makeSessionPreview,
  cleanAssistantDisplayText,
  loadChatSessions,
  saveChatSessions,
  basename,
  createReviewId,
  compactContext,
  CHAT_HISTORY_KEY,
} from './agent-format';

describe('getLocalizedErrorMessage', () => {
  it('localizes API key errors', () => {
    const zh = getLocalizedErrorMessage('Invalid API key provided: 401', 'zh-CN');
    expect(zh).toContain('API Key');
    const en = getLocalizedErrorMessage('Invalid API key provided: 401', 'en-US');
    expect(en).toContain('API Key');
  });

  it('localizes rate limit errors', () => {
    expect(getLocalizedErrorMessage('429 Too Many Requests', 'zh-CN')).toContain('速率限制');
    expect(getLocalizedErrorMessage('rate limit exceeded', 'en-US')).toContain('Rate limit');
  });

  it('passes through unknown errors', () => {
    expect(getLocalizedErrorMessage('Some weird error: xyz', 'zh-CN')).toBe('Some weird error: xyz');
  });
});

describe('normalizeChunk', () => {
  it('wraps strings as text chunks', () => {
    expect(normalizeChunk('hello')).toEqual({ type: 'text', content: 'hello' });
  });

  it('passes object chunks through', () => {
    const chunk = { type: 'tool_call', content: 'x', toolName: 'read_file' };
    expect(normalizeChunk(chunk)).toEqual(chunk);
  });

  it('handles null/undefined', () => {
    expect(normalizeChunk(null)).toEqual({ type: 'text', content: '' });
    expect(normalizeChunk(undefined)).toEqual({ type: 'text', content: '' });
  });
});

describe('renderTaskEvent', () => {
  it('renders exit with code', () => {
    expect(renderTaskEvent({ type: 'exit', command: 'npm', args: ['test'], attempt: 1, exitCode: 0 }))
      .toContain('Command finished (0)');
  });

  it('renders stdout data', () => {
    expect(renderTaskEvent({ type: 'stdout', command: 'x', args: [], attempt: 1, data: 'line1' })).toBe('line1');
  });

  it('returns empty for missing event', () => {
    expect(renderTaskEvent(undefined)).toBe('');
  });
});

describe('session title/preview', () => {
  it('builds title from first user message', () => {
    expect(makeSessionTitle([{ role: 'user', content: '  帮我写个  函数  ' }])).toBe('帮我写个 函数');
  });

  it('defaults for empty', () => {
    expect(makeSessionTitle([])).toBe('New chat');
  });

  it('preview uses last assistant text', () => {
    const preview = makeSessionPreview([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'Using tool: read_file\n\n好的，我来看一下。' },
    ]);
    expect(preview).not.toContain('Using tool');
    expect(preview).toContain('好的');
  });

  it('cleanAssistantDisplayText strips tool lines', () => {
    expect(cleanAssistantDisplayText('Using tool: read_file\n\n正文\n\n\n\n')).toBe('正文\n\n');
    expect(cleanAssistantDisplayText('Calling tool: write_file\n正文')).toBe('正文');
  });
});

describe('chat session persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('round-trips sessions', () => {
    const sessions = [{ id: 'a', title: 't' }];
    saveChatSessions(sessions);
    expect(loadChatSessions()).toEqual(sessions);
  });

  it('caps at 40 entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }));
    saveChatSessions(many);
    expect(loadChatSessions().length).toBe(40);
  });

  it('handles corrupt storage', () => {
    localStorage.setItem(CHAT_HISTORY_KEY, 'not-json{');
    expect(loadChatSessions()).toEqual([]);
  });
});

describe('helpers', () => {
  it('basename splits both separators', () => {
    expect(basename('C:\\a\\b.ts')).toBe('b.ts');
    expect(basename('/a/b.ts')).toBe('b.ts');
  });

  it('createReviewId normalizes separators', () => {
    expect(createReviewId('C:\\My Dir\\a.ts')).toBe('c-my-dir-a.ts');
  });

  it('compactContext caps files and content', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `f${i}.ts`, name: `f${i}.ts`, content: 'x'.repeat(20000),
    }));
    const ctx = compactContext(files, 'rules');
    expect(ctx).toContain('Workspace rules');
    expect(ctx).toContain('f0.ts');
    expect(ctx).not.toContain('f9.ts'); // 只取前 6 个
  });
});
