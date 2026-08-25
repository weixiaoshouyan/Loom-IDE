/**
 * useGitStatus — Git 状态领域 hook（App.tsx 拆出的模块）。
 *
 * 拥有 gitStatusMap / gitBranch 状态：监听 focus/blur 低频轮询（30s），
 * 文件 watcher 或保存动作通过 refreshGitStatus() 触发即时刷新。
 */
import { useCallback, useEffect, useState } from 'react';

export function useGitStatus(workspace: string) {
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, string>>({});
  const [gitBranch, setGitBranch] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!workspace) { setGitStatusMap({}); setGitBranch(null); return; }
    window.loom?.git?.status?.(workspace).then((result: any) => {
      const map: Record<string, string> = {};
      (result?.changes || []).forEach((c: any) => { if (c.file) map[c.file] = c.status; });
      setGitStatusMap(map);
      setGitBranch(result?.branch || null);
    }).catch(() => { setGitStatusMap({}); setGitBranch(null); });
  }, [workspace]);

  useEffect(() => {
    if (!workspace) { setGitStatusMap({}); setGitBranch(null); return; }
    refresh();
    // Low-frequency fallback poll (30s) — the file watcher handles real-time updates.
    let timer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => { if (!timer && document.hasFocus()) timer = setInterval(refresh, 30000); };
    const stopPolling = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (document.hasFocus()) startPolling();
    const onFocus = () => { refresh(); startPolling(); };
    const onBlur = () => stopPolling();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      stopPolling();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [workspace, refresh]);

  return { gitStatusMap, gitBranch, refreshGitStatus: refresh };
}
