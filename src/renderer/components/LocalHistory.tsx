import React, { useState, useEffect, useCallback } from 'react';
import { confirmDialog } from './ConfirmModal';
import { getLoom } from '../loom-ipc';

interface Props {
  filePath: string;
  onClose: () => void;
  onRestore: (content: string) => void;
  locale?: 'zh-CN' | 'en-US';
}

interface Snapshot {
  ts: number;
  size: number;
  isInitial: boolean;
}

export default function LocalHistory({ filePath, onClose, onRestore, locale = 'zh-CN' }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getLoom()?.history?.list?.(filePath);
      setSnapshots(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [filePath]);

  useEffect(() => { refresh(); }, [refresh]);

  // Keyboard: Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadPreview = useCallback(async (ts: number) => {
    setSelected(ts);
    setPreviewContent(null);
    setPreviewLoading(true);
    try {
      const content = await getLoom()?.history?.get?.(filePath, ts);
      setPreviewContent(typeof content === 'string' ? content : '');
    } catch (e: any) {
      setError(e.message);
    }
    setPreviewLoading(false);
  }, [filePath]);

  const fmt = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
  };

  const filename = filePath.split(/[\\/]/).pop() || filePath;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()} style={{ width: 760, maxWidth: '90vw', height: 560, maxHeight: '80vh' }}>
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <span className="settings-sidebar-title">{locale === 'zh-CN' ? '本地历史' : 'Local History'}</span>
            <button className="settings-close-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            </button>
          </div>
          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            {filename}
          </div>
          {loading && <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>...</div>}
          {error && <div style={{ padding: 16, color: 'var(--red)', fontSize: 12 }}>{error}</div>}
          {!loading && snapshots.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
              {locale === 'zh-CN' ? '尚无快照,30 秒后或保存时自动记录。' : 'No snapshots yet. Snapshots are taken on save or every 30s while editing.'}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {snapshots.map(s => (
              <div
                key={s.ts}
                className={`settings-nav-item ${selected === s.ts ? 'active' : ''}`}
                onClick={() => loadPreview(s.ts)}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, height: 'auto', padding: '8px 12px' }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{fmt(s.ts)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                  <span>{(s.size / 1024).toFixed(1)} KB</span>
                  {s.isInitial && <span style={{ color: 'var(--accent)' }}>● initial</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="settings-content">
          <div className="settings-content-header">
            <h2>{locale === 'zh-CN' ? '快照预览' : 'Snapshot Preview'}</h2>
            {selected !== null && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button
                  className="settings-btn-sm primary"
                  onClick={async () => {
                    if (previewContent !== null) {
                      const ok = await confirmDialog.ask({
                        title: locale === 'zh-CN' ? '恢复快照' : 'Restore Snapshot',
                        message: locale === 'zh-CN' ? '恢复此快照? 当前未保存的修改将丢失。' : 'Restore this snapshot? Unsaved changes will be lost.',
                        confirmText: locale === 'zh-CN' ? '恢复' : 'Restore',
                        danger: true,
                      });
                      if (!ok) return;
                      onRestore(previewContent);
                    }
                  }}
                >
                  {locale === 'zh-CN' ? '恢复此版本' : 'Restore'}
                </button>
              </div>
            )}
          </div>
          <div className="settings-scroll" style={{ padding: 12 }}>
            {selected === null && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 12 }}>
                {locale === 'zh-CN' ? '选择左侧的快照以预览' : 'Select a snapshot to preview'}
              </div>
            )}
            {previewLoading && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>...</div>}
            {previewContent !== null && !previewLoading && (
              <pre style={{
                margin: 0,
                fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
                fontSize: 12,
                background: 'var(--bg-tertiary)',
                padding: 12,
                borderRadius: 4,
                whiteSpace: 'pre',
                overflow: 'auto',
                maxHeight: '60vh',
                color: 'var(--text-primary)',
              }}>{previewContent}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
