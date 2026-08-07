import { describe, expect, it } from 'vitest';
import { isEditorDomHealthy } from './editor-health';

describe('editor health', () => {
  it('treats a visible editor with view lines as healthy', () => {
    expect(isEditorDomHealthy({
      clientWidth: 800,
      clientHeight: 500,
      querySelector: selector => selector === '.view-lines' ? {} : null,
    })).toBe(true);
  });

  it('treats a partially initialized Monaco container as unhealthy', () => {
    expect(isEditorDomHealthy({
      clientWidth: 800,
      clientHeight: 500,
      querySelector: () => null,
    })).toBe(false);
  });
});
