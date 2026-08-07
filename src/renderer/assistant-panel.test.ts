import { describe, expect, it } from 'vitest';
import { buildCodexTerminalInput, clampAssistantPanelWidth } from './assistant-panel';

describe('assistant-panel', () => {
  it('allows the assistant panel to expand left up to a wider Cursor-like width', () => {
    expect(clampAssistantPanelWidth(200)).toBe(340);
    expect(clampAssistantPanelWidth(620)).toBe(620);
    expect(clampAssistantPanelWidth(900)).toBe(900);
    expect(clampAssistantPanelWidth(1300)).toBe(1040);
  });

  it('uses a terminal newline suitable for launching codex cli', () => {
    expect(buildCodexTerminalInput()).toBe('codex\r');
  });
});
