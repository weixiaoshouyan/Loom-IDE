/**
 * useAgentCheckpoint — Agent 断点续跑领域 hook（AIAgent.tsx 拆出）。
 *
 * 封装 checkpoint 列表加载 / 选择恢复 / 引用管理：
 *   - checkpointList / showResumePanel 面板状态；
 *   - openResumePanel：从主进程拉取检查点列表；
 *   - applyCheckpoint：加载检查点并把会话消息恢复到聊天（经 onRestoreMessages）；
 *   - resumeCheckpointIdRef：下一次发送携带的 checkpointId。
 */
import { useCallback, useState } from 'react';
import { t } from '@/shared/i18n';
import type { NotificationType } from '../components/Notification';
import type { Message } from '../components/AIAgent';

export interface CheckpointItem {
  id: string;
  createdAt: number;
  messageCount: number;
  preview: string;
}

export function useAgentCheckpoint(opts: {
  workspacePath: string;
  notify: (message: string, type?: NotificationType, duration?: number) => void;
  /** 恢复会话消息（AIAgent 的 setMessages）。 */
  onRestoreMessages: (messages: Message[]) => void;
  /** 断点引用（组件级创建，与 useAgentChat 共享）。 */
  resumeCheckpointIdRef: React.MutableRefObject<string | null>;
}) {
  const { workspacePath, notify, onRestoreMessages, resumeCheckpointIdRef } = opts;
  const [showResumePanel, setShowResumePanel] = useState(false);
  const [checkpointList, setCheckpointList] = useState<CheckpointItem[]>([]);

  const openResumePanel = useCallback(async () => {
    if (!workspacePath) return;
    setShowResumePanel(true);
    try {
      const res = await window.loom?.ai?.checkpointList?.(workspacePath) as { ok?: boolean; checkpoints?: CheckpointItem[] } | undefined;
      setCheckpointList(res?.ok ? (res.checkpoints || []) : []);
    } catch {
      setCheckpointList([]);
    }
  }, [workspacePath]);

  const applyCheckpoint = useCallback(async (id: string) => {
    if (!workspacePath) return;
    try {
      const res = await window.loom?.ai?.checkpointLoad?.(workspacePath, id) as { ok?: boolean; checkpoint?: any } | undefined;
      if (!res?.ok || !res.checkpoint) {
        notify(t('agent.checkpointLoadFailed'), 'error');
        return;
      }
      const ck = res.checkpoint;
      const restored: Message[] = [];
      for (const m of (ck.messages || [])) {
        if (!m || m.role === 'system') continue;
        if (m.role === 'tool') {
          const last = restored[restored.length - 1];
          if (last && last.role === 'assistant') {
            last.toolCalls = [...(last.toolCalls || []), {
              name: 'tool_result',
              args: {},
              status: 'done' as const,
              result: String(m.content || '').slice(0, 2000),
              expanded: false,
            }];
          }
          continue;
        }
        const msg: Message = {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        };
        if (Array.isArray(m.tool_calls)) {
          msg.toolCalls = (m.tool_calls as any[]).map(tc => {
            let args: unknown = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep {} */ }
            return {
              name: tc.function?.name || tc.name || 'tool',
              args,
              status: 'done' as const,
              result: '',
              expanded: false,
            };
          });
        }
        restored.push(msg);
      }
      onRestoreMessages(restored);
      resumeCheckpointIdRef.current = id;
      setShowResumePanel(false);
      notify(t('agent.checkpointRestored', { id }), 'info');
    } catch {
      notify(t('agent.checkpointRestoreFailed'), 'error');
    }
  }, [workspacePath, notify, onRestoreMessages]);

  const resetCheckpoint = useCallback(() => {
    resumeCheckpointIdRef.current = null;
  }, [resumeCheckpointIdRef]);

  return {
    showResumePanel,
    setShowResumePanel,
    checkpointList,
    openResumePanel,
    applyCheckpoint,
    resetCheckpoint,
  };
}
