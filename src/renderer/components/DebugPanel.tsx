/**
 * Debug Panel — read-only runtime diagnostics surface for Loom IDE.
 *
 * Surfaces:
 *   - OS / Node / Electron memory + uptime
 *   - Active terminal sessions
 *   - Active AI streams
 *   - Path-permission granted roots + denied-attempts counter
 *   - Local history file count + size
 *   - Installed plugins
 *   - Masked config snapshot (API keys stripped)
 *
 * Everything shown here is read-only; there is no way to mutate live services
 * through this panel. API keys are always masked by the main process before
 * reaching the renderer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { t } from '@/shared/i18n';
import { getLoom } from '../loom-ipc';

interface DebugState {
  collectedAt: number;
  os?: {
    platform: string; release: string; arch: string; hostname: string;
    cpus: number; totalMemoryMB: number; freeMemoryMB: number; uptimeHours: number;
  };
  node?: {
    version: string; pid: number;
    memoryUsageMB: { rss: number; heapTotal: number; heapUsed: number; external: number };
  };
  app?: { version: string; dataDir: string; historyDirSizeBytes: number };
  terminals?: { id: string; shell: string; isPty: boolean; pid: number | null }[];
  streams?: { id: string; startedAt: number }[];
  permissions?: { grantedRoots: string[]; deniedAttempts: number };
  history?: { files: number; totalBytes: number };
  plugins?: { id: string; name: string; version: string; enabled: boolean }[];
  config?: any;
}

const formatBytes = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const Section = ({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="debug-section" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{title}</summary>
      <div className="debug-section-body">{children}</div>
    </details>
  );
};

const KV = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="debug-kv">
    <span className="debug-kv-label">{label}</span>
    <span className="debug-kv-value">{value ?? '—'}</span>
  </div>
);

const MonoList = ({ items, emptyText = '(none)' }: { items: string[]; emptyText?: string }) => {
  if (!items || items.length === 0) return <span className="debug-empty">{emptyText}</span>;
  return (
    <ul className="debug-mono-list">
      {items.map((s, i) => <li key={i}><code>{s}</code></li>)}
    </ul>
  );
};

export default function DebugPanel() {
  const [state, setState] = useState<DebugState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = (await getLoom()?.debugRuntime?.getState?.()) as
        { ok?: boolean; data?: DebugState; error?: string } | undefined;
      if (result?.ok) {
        setState(result.data ?? null);
        setError(null);
      } else {
        setError(result?.error || 'Failed to fetch runtime state');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000); // poll every 5s for live terminal/stream counts
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) return <div className="debug-panel">{t('debugPanel.loadingState')}</div>;
  if (error) return (
    <div className="debug-panel debug-error">
      <strong>Error: </strong>{error}
      <button className="debug-refresh-btn" onClick={refresh}>{t('debugPanel.retry')}</button>
    </div>
  );
  if (!state) return null;

  const s = state;

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <h3>{t('panel.runtimeState')}</h3>
        <span className="debug-timestamp">{t('debugPanel.updated', { time: new Date(s.collectedAt).toLocaleTimeString() })}</span>
        <button className="debug-refresh-btn" onClick={refresh}>{t('debugPanel.refresh')}</button>
      </div>

      <Section title={`OS · ${s.os?.platform || '?'} ${s.os?.arch || ''}`}>
        <KV label="Hostname" value={s.os?.hostname} />
        <KV label="Release" value={s.os?.release} />
        <KV label="CPUs" value={s.os?.cpus} />
        <KV label="Memory" value={s.os ? `${s.os.freeMemoryMB} MB free / ${s.os.totalMemoryMB} MB total` : undefined} />
        <KV label="Uptime" value={s.os ? `${s.os.uptimeHours} h` : undefined} />
      </Section>

      <Section title={`Node ${s.node?.version || ''}`}>
        <KV label="PID" value={s.node?.pid} />
        <KV label="RSS" value={s.node ? `${s.node.memoryUsageMB.rss} MB` : undefined} />
        <KV label="Heap" value={s.node ? `${s.node.memoryUsageMB.heapUsed} / ${s.node.memoryUsageMB.heapTotal} MB` : undefined} />
      </Section>

      <Section title={t('debugPanel.appSection')}>
        <KV label={t('debugPanel.version')} value={s.app?.version} />
        <KV label="Data Dir" value={s.app?.dataDir} />
        <KV label="History Dir Size" value={s.app ? formatBytes(s.app.historyDirSizeBytes) : undefined} />
      </Section>

      <Section title={`Terminals (${s.terminals?.length || 0})`}>
        {s.terminals && s.terminals.length > 0 ? (
          <table className="debug-table">
            <thead><tr><th>ID</th><th>Shell</th><th>PTY</th><th>PID</th></tr></thead>
            <tbody>
              {s.terminals.map((t) => (
                <tr key={t.id}><td><code>{t.id.slice(0, 12)}</code></td><td>{t.shell}</td><td>{t.isPty ? '✓' : '✗'}</td><td>{t.pid ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <span className="debug-empty">No active terminals</span>}
      </Section>

      <Section title={`Active Streams (${s.streams?.length || 0})`}>
        {s.streams && s.streams.length > 0 ? (
          <MonoList items={s.streams.map((st) => `${st.id.slice(0, 16)} · started ${new Date(st.startedAt).toLocaleTimeString()}`)} />
        ) : <span className="debug-empty">{t('debugPanel.noActiveStreams')}</span>}
      </Section>

      <Section title={`Permissions · ${s.permissions?.deniedAttempts || 0} denied`}>
        <KV label="Denied Attempts" value={s.permissions?.deniedAttempts} />
        <KV label="Granted Roots" value={s.permissions?.grantedRoots.length} />
        <MonoList items={s.permissions?.grantedRoots || []} emptyText="No workspace roots granted" />
      </Section>

      <Section title={`Local History (${s.history?.files || 0} files · ${formatBytes(s.history?.totalBytes || 0)})`}>
        <KV label="Snapshot Files" value={s.history?.files} />
        <KV label="Total Size" value={formatBytes(s.history?.totalBytes || 0)} />
      </Section>

      <Section title={`Plugins (${s.plugins?.length || 0})`}>
        {s.plugins && s.plugins.length > 0 ? (
          <table className="debug-table">
            <thead><tr><th>ID</th><th>{t('debugPanel.version')}</th><th>{t('debugPanel.enabled')}</th></tr></thead>
            <tbody>
              {s.plugins.map((p) => (
                <tr key={p.id}>
                  <td>{p.name || p.id}</td>
                  <td>{p.version}</td>
                  <td>{p.enabled ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <span className="debug-empty">No plugins</span>}
      </Section>

      <Section title={t('debugPanel.configMasked')} defaultOpen={false}>
        <pre className="debug-config">{JSON.stringify(s.config, null, 2)}</pre>
      </Section>
    </div>
  );
}
