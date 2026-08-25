import { describe, expect, it } from 'vitest';
import {
  resolveKeybindings,
  findKeybindingConflicts,
  parseChord,
  eventToChord,
  normalizeChord,
  matchKeybinding,
  DEFAULT_KEYBINDINGS,
} from './keybindings';

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return init as KeyboardEvent;
}

describe('keybindings table', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_KEYBINDINGS.map(k => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves defaults without overrides', () => {
    const r = resolveKeybindings();
    expect(r.find(k => k.id === 'ai.toggle')?.chord).toBe('Ctrl+L');
    expect(r.every(k => !k.isOverride)).toBe(true);
  });

  it('applies user overrides and unbinds', () => {
    const r = resolveKeybindings({ 'ai.toggle': 'Ctrl+Shift+A', 'editor.find': null });
    expect(r.find(k => k.id === 'ai.toggle')?.chord).toBe('Ctrl+Shift+A');
    expect(r.find(k => k.id === 'ai.toggle')?.isOverride).toBe(true);
    expect(r.find(k => k.id === 'editor.find')?.chord).toBeNull();
  });
});

describe('conflict detection', () => {
  it('finds chords bound to multiple commands', () => {
    const conflicts = findKeybindingConflicts(resolveKeybindings({ 'editor.rename': 'F5' }));
    expect(conflicts.some(c => c.chord === 'F5' && c.commands.length > 1)).toBe(true);
  });

  it('has no conflicts in the default table', () => {
    expect(findKeybindingConflicts(resolveKeybindings())).toEqual([]);
  });
});

describe('chord parsing & matching', () => {
  it('parses modifiers and key', () => {
    expect(parseChord('Ctrl+Shift+P')).toEqual({ ctrl: true, shift: true, alt: false, meta: false, key: 'p' });
    expect(parseChord('F5')).toEqual({ ctrl: false, shift: false, alt: false, meta: false, key: 'f5' });
  });

  it('normalizes ctrl/meta to Ctrl', () => {
    expect(normalizeChord('ctrl+shift+p')).toBe('Ctrl+Shift+P');
    expect(normalizeChord('Cmd+S')).toBe('Ctrl+S');
  });

  it('eventToChord builds comparable strings', () => {
    expect(eventToChord(keyEvent({ ctrlKey: true, shiftKey: true, key: 'P' }))).toBe('Ctrl+Shift+P');
    expect(eventToChord(keyEvent({ key: 'F5' }))).toBe('F5');
    expect(eventToChord(keyEvent({ key: ' ' }))).toBe('Space');
    expect(eventToChord(keyEvent({ ctrlKey: true, key: ' ' }))).toBe('Ctrl+Space');
  });

  it('matches events to keybinding ids', () => {
    const r = resolveKeybindings();
    expect(matchKeybinding(keyEvent({ ctrlKey: true, key: 'l' }), r)).toBe('ai.toggle');
    expect(matchKeybinding(keyEvent({ ctrlKey: true, shiftKey: true, key: 'p' }), r)).toBe('view.commandPalette');
    expect(matchKeybinding(keyEvent({ key: 'F8' }), r)).toBe('problems.next');
  });
});
