import { describe, expect, it, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractPathFromArgv, extractPathFromLoomUrl } from './cli-path';

let realDir = '';
beforeAll(() => {
  realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-cli-test-'));
});

describe('extractPathFromArgv (CLI open folder)', () => {
  it('extracts a Windows absolute path that exists', () => {
    expect(extractPathFromArgv(['Loom IDE.exe', realDir])).toBe(realDir);
  });

  it('ignores switches and the app path placeholder', () => {
    expect(extractPathFromArgv(['electron.exe', '.', '--no-sandbox', realDir])).toBe(realDir);
    expect(extractPathFromArgv(['electron.exe', '.', '--remote-debugging-port=9222'])).toBeNull();
  });

  it('ignores non-path args', () => {
    expect(extractPathFromArgv(['app.exe', 'hello', 'world'])).toBeNull();
  });

  it('ignores paths that do not exist', () => {
    expect(extractPathFromArgv(['app.exe', 'Z:\\definitely\\not\\here'])).toBeNull();
  });
});

describe('extractPathFromLoomUrl', () => {
  it('extracts path query param', () => {
    expect(extractPathFromLoomUrl('loom://open?path=C%3A%5CUsers%5Cme%5Cproj'))
      .toBe('C:\\Users\\me\\proj');
  });

  it('rejects non-loom protocols', () => {
    expect(extractPathFromLoomUrl('https://example.com/open?path=x')).toBeNull();
  });

  it('returns null when no path param', () => {
    expect(extractPathFromLoomUrl('loom://open')).toBeNull();
  });

  it('handles malformed urls gracefully', () => {
    expect(extractPathFromLoomUrl('not a url')).toBeNull();
  });
});
