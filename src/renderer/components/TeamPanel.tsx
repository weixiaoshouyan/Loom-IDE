import React, { useState, useEffect } from 'react';
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
    emitLoomEvent('loom:notify', { message: '团队规则已保存', type: 'success' });
  };

  return (
    <div className="team-panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>团队协作</h3>
        <button className="ai-input-action" onClick={onClose} aria-label="关闭">×</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <strong>当前用户</strong>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          {user ? `${user.name || user.email} (${user.email})` : '未登录'}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>.loom/rules 团队规则</strong>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 8px' }}>
          可输入 Markdown 或 JSON；Agent 会将其注入系统提示。
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>加载中...</div>
      ) : (
        <>
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            style={{ width: '100%', height: 200, fontFamily: 'monospace', fontSize: 13 }}
            placeholder={`例如：\n{\n  "instructions": "使用 TypeScript 严格模式",\n  "conventions": { "imports": "优先使用 @/ 别名" }\n}`}
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="ai-submit-btn" onClick={saveRules}>保存规则</button>
            <button className="ai-quick-btn" onClick={onClose}>取消</button>
          </div>
        </>
      )}
    </div>
  );
}
