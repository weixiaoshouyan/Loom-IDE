import { describe, expect, it } from 'vitest';
import { toSaveFileResult } from './dialog-contract';

describe('toSaveFileResult', () => {
  it('returns a stable object contract for selected save paths', () => {
    expect(toSaveFileResult({ canceled: false, filePath: 'D:/tmp/example.ts' })).toEqual({
      canceled: false,
      filePath: 'D:/tmp/example.ts',
    });
  });

  it('returns a canceled object instead of null when the dialog is canceled', () => {
    expect(toSaveFileResult({ canceled: true })).toEqual({
      canceled: true,
      filePath: null,
    });
  });
});
