/**
 * Notepads — Cursor-style scratchpad for quick notes
 * Stores notes in localStorage, grouped by workspace.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { readJSON, writeJSON } from '../storage';
import { confirmDialog } from './ConfirmModal';

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  workspacePath: string;
  locale?: 'zh-CN' | 'en-US';
}

const STORAGE_PREFIX = 'loom-notepads-';

function getStorageKey(workspace: string): string {
  const hash = btoa(workspace).replace(/[/+=]/g, '_').substring(0, 32);
  return STORAGE_PREFIX + hash;
}

function loadNotes(workspace: string): Note[] {
  return readJSON<Note[]>(getStorageKey(workspace), []);
}

function saveNotes(workspace: string, notes: Note[]) {
  writeJSON(getStorageKey(workspace), notes);
}

export default function Notepads({ workspacePath, locale = 'zh-CN' }: Props) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes(workspacePath));
  const [activeNoteId, setActiveNoteId] = useState<string | null>(notes[0]?.id || null);
  const [titleInput, setTitleInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => { setNotes(loadNotes(workspacePath)); setActiveNoteId(null); }, [workspacePath]);
  useEffect(() => { if (notes.length > 0) saveNotes(workspacePath, notes); }, [notes, workspacePath]);

  const activeNote = notes.find(n => n.id === activeNoteId) || null;

  const createNote = useCallback(() => {
    const id = 'note-' + Date.now();
    const newNote: Note = {
      id,
      title: locale === 'zh-CN' ? '新笔记' : 'New Note',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setNotes(prev => [newNote, ...prev]);
    setActiveNoteId(id);
    setIsCreating(false);
    setTitleInput('');
  }, [locale]);

  const deleteNote = useCallback(async (id: string) => {
    const ok = await confirmDialog.ask({
      title: locale === 'zh-CN' ? '删除笔记' : 'Delete Note',
      message: locale === 'zh-CN' ? '删除这条笔记？' : 'Delete this note?',
      confirmText: locale === 'zh-CN' ? '删除' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    setNotes(prev => prev.filter(n => n.id !== id));
    if (activeNoteId === id) setActiveNoteId(notes[0]?.id || null);
  }, [activeNoteId, locale, notes]);

  const updateNoteTitle = useCallback((id: string, title: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title, updatedAt: new Date().toISOString() } : n));
  }, []);

  const updateNoteContent = useCallback((id: string, content: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, content, updatedAt: new Date().toISOString() } : n));
  }, []);

  return (
    <>
      <div className="sidebar-header">
        <span>{locale === 'zh-CN' ? '记事本' : 'NOTEPADS'}</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-header-btn" title={locale === 'zh-CN' ? '新建笔记' : 'New Note'} aria-label={locale === 'zh-CN' ? '新建笔记' : 'New Note'} onClick={() => { setIsCreating(true); setTitleInput(''); }}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>
          </button>
        </div>
      </div>
      <div className="sidebar-content">
        {isCreating && (
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="search-input"
              style={{ flex: 1, height: 24, fontSize: 12 }}
              placeholder={locale === 'zh-CN' ? '笔记标题' : 'Note title'}
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createNote();
                if (e.key === 'Escape') { setIsCreating(false); setTitleInput(''); }
              }}
              autoFocus
            />
            <button className="settings-btn-sm primary" onClick={createNote}>OK</button>
          </div>
        )}

        {notes.length === 0 && !isCreating ? (
          <div className="panel-empty-state">
            <div>{locale === 'zh-CN' ? '暂无笔记' : 'No notes yet'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{locale === 'zh-CN' ? '点击 + 创建新笔记' : 'Click + to create a note'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
            {/* Note list */}
            <div style={{ width: 140, borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
              {notes.map(note => (
                <div
                  key={note.id}
                  className={`tree-item ${note.id === activeNoteId ? 'selected' : ''}`}
                  style={{ paddingLeft: 10, fontSize: 12, cursor: 'pointer', gap: 4 }}
                  onClick={() => setActiveNoteId(note.id)}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{note.title}</span>
                  <button
                    className="sidebar-header-btn"
                    onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                    style={{ width: 18, height: 18, opacity: 0.5 }}
                    title={locale === 'zh-CN' ? '删除' : 'Delete'}
                  >
                    <svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Note editor */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {activeNote ? (
                <>
                  <input
                    style={{
                      border: 'none', borderBottom: '1px solid var(--border)',
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                      fontSize: 13, fontWeight: 600, padding: '6px 10px', outline: 'none',
                    }}
                    value={activeNote.title}
                    onChange={e => updateNoteTitle(activeNote.id, e.target.value)}
                  />
                  <textarea
                    style={{
                      flex: 1, border: 'none', background: 'transparent',
                      color: 'var(--text-primary)', fontSize: 13, padding: '8px 10px',
                      resize: 'none', outline: 'none', fontFamily: 'inherit',
                      lineHeight: 1.6,
                    }}
                    value={activeNote.content}
                    onChange={e => updateNoteContent(activeNote.id, e.target.value)}
                    placeholder={locale === 'zh-CN' ? '开始写笔记...' : 'Start writing...'}
                  />
                </>
              ) : (
                <div className="panel-empty-state">
                  {locale === 'zh-CN' ? '选择一条笔记' : 'Select a note'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
