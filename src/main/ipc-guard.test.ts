import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './ipc-guard';

describe('ipc-guard isTrustedSender', () => {
  it('accepts the main window top-level frame', () => {
    const event = {
      sender: { getType: () => 'window' },
      senderFrame: { parent: null },
    };
    expect(isTrustedSender(event as any)).toBe(true);
  });

  it('rejects webview guests (plugin panels)', () => {
    const event = {
      sender: { getType: () => 'webview' },
      senderFrame: { parent: null },
    };
    expect(isTrustedSender(event as any)).toBe(false);
  });

  it('rejects iframe subframes', () => {
    const event = {
      sender: { getType: () => 'window' },
      senderFrame: { parent: { frameTreeNodeId: 1 } },
    };
    expect(isTrustedSender(event as any)).toBe(false);
  });

  it('rejects missing sender / frame', () => {
    expect(isTrustedSender({} as any)).toBe(false);
    expect(isTrustedSender({ sender: null } as any)).toBe(false);
    expect(isTrustedSender({ sender: { getType: () => 'window' } } as any)).toBe(false);
  });

  it('rejects a sender whose getType throws', () => {
    const event = {
      sender: { getType: () => { throw new Error('destroyed'); } },
      senderFrame: { parent: null },
    };
    expect(isTrustedSender(event as any)).toBe(false);
  });
});
