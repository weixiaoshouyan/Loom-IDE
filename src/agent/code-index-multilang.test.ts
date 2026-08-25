import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCodeIndex, searchCodeIndex, type CodeIndex } from './code-index';
import { invalidateSearchCache } from './semantic-search';

let tmpDir = '';
afterEach(() => {
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  invalidateSearchCache();
});

function makeTmp(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-ml-index-'));
  return tmpDir;
}

describe('multi-language code index', () => {
  it('indexes Python functions and classes', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'app.py'), [
      'class User:',
      '    def __init__(self, name):',
      '        self.name = name',
      '    def greet(self):',
      '        return f"hi {self.name}"',
      '',
      'def create_user(name):',
      '    return User(name)',
    ].join('\n'));
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('User');
    expect(names).toContain('greet');
    expect(names).toContain('create_user');
    const r = searchCodeIndex(index, 'create_user', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name).toBe('create_user');
  });

  it('indexes Go functions and methods', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'main.go'), [
      'package main',
      '',
      'type Server struct { port int }',
      '',
      'func (s *Server) Start() {}',
      '',
      'func main() {}',
    ].join('\n'));
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('Start');
    expect(names).toContain('main');
    expect(names.some(n => n === 'Server' || n === 'server')).toBe(true);
  });

  it('indexes Rust functions and structs', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'lib.rs'), [
      'pub struct Config { pub name: String }',
      '',
      'pub fn load_config() -> Config {',
      '    Config { name: String::from("x") }',
      '}',
      '',
      'impl Config {',
      '    pub fn display(&self) {}',
      '}',
    ].join('\n'));
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('Config');
    expect(names).toContain('load_config');
  });

  it('indexes Java classes and methods', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'Main.java'), [
      'public class Main {',
      '    public static void main(String[] args) {}',
      '    private int helper() { return 1; }',
      '}',
    ].join('\n'));
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('Main');
    expect(names).toContain('main');
    expect(names).toContain('helper');
  });

  it('indexes C functions', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'util.c'), [
      '#include <stdio.h>',
      'int add(int a, int b) { return a + b; }',
      'struct Point { int x; int y; };',
    ].join('\n'));
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    const names = index.symbols.map(s => s.name);
    expect(names).toContain('add');
  });

  it('skips non-code files entirely', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Hello\n');
    fs.writeFileSync(path.join(dir, 'data.json'), '{"a": 1}\n');
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    expect(index.symbols.length).toBe(0);
  });

  it('incremental update keeps other-language symbols', async () => {
    const dir = makeTmp();
    fs.writeFileSync(path.join(dir, 'a.py'), 'def alpha():\n    pass\n');
    fs.writeFileSync(path.join(dir, 'b.rs'), 'fn beta() {}\n');
    const index = await buildCodeIndex(dir, { maxFileSize: 1048576 });
    expect(index.symbols.length).toBe(2);
    // mtime 判定存在同毫秒竞态：先确保修改文件的 mtime 晚于索引时间戳
    await new Promise(r => setTimeout(r, 30));
    fs.writeFileSync(path.join(dir, 'a.py'), 'def alpha2():\n    pass\n');
    const { updateCodeIndexIncremental, detectFileChanges } = await import('./code-index');
    const { changed, deleted } = await detectFileChanges(dir, index);
    const updated = await updateCodeIndexIncremental(index, changed, deleted, { maxFileSize: 1048576 });
    const names = updated.symbols.map(s => s.name);
    expect(names).toContain('alpha2');
    expect(names).toContain('beta'); // rust 符号保留
  });
});
