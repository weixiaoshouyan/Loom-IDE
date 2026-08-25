import React, { useState, useEffect } from 'react';
import { t } from '@/shared/i18n';
import { getLoom } from '../loom-ipc';
import { emitLoomEvent } from '../loom-events';

interface Props {
  workspacePath: string;
  onClose: () => void;
}

export default function TeamPanel({ workspacePath, onClose }: Props) {
  const [rules, setRules] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const rulesText = await getLoom()?.team?.loadRules?.(workspacePath);
        setRules(rulesText || '');
        const currentUser = await getLoom()?.team?.getUser?.();
        setUser(currentUser || null);
      } catch {
        setRules('');
      } finally {
        setLoading(false);
      }
    })();
  }, [workspacePath]);

  const saveRules = async () => {
    await getLoom()?.team?.saveRules?.(workspacePath, rules);
    emitLoomEvent('loom:notify', { message: t('team.rulesSaved'), type: 'success' });
  };

  return (
    <div className="team-panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{t('team.title')}</h3>
        <button className="ai-input-action" onClick={onClose} aria-label={t('team.closeAria')}>×</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <strong>{t('team.currentUser')}</strong>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          {user ? `${user.name || user.email} (${user.email})` : t('team.notLoggedIn')}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>{t('team.rulesLabel')}</strong>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 8px' }}>
          {t('team.rulesHint')}
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>{t('team.loading')}</div>
      ) : (
        <>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            style={{ width: '100%', height: 200, fontFamily: 'monospace', fontSize: 13 }}
            placeholder={t('team.placeholder')}
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="ai-submit-btn" onClick={saveRules}>{t('team.saveRules')}</button>
            <button className="ai-quick-btn" onClick={onClose}>{t('team.cancel')}</button>
          </div>
        </>
      )}
    </div>
  );
}
