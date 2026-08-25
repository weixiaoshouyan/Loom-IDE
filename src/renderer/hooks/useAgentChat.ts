/**
 * useAgentChat — Agent 对话核心领域 hook（AIAgent.tsx 拆出的最大模块）。
 *
 * 封装输入框、消息流、发送（@mention 解析、CLI Agent、Agent/聊天双通道流式）、
 * 停止生成、工具调用展示、逐文件审阅队列、破坏性操作审批等待。
 * AIAgent 组件只消费状态与动作。
 *
 * 依赖通过 options 注入；逻辑与渲染解耦，可独立测试。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/shared/i18n';
import type { NotificationType } from '../components/Notification';
import type { Message, ToolCallDisplay } from '../components/AIAgent';
import type { AgentReviewItem } from '../agent-review-queue';
import {
  acceptReviewItem,
  addOrUpdateReviewItem,
  rejectReviewItem,
} from '../agent-review-queue';
import {
  basename,
  cleanAssistantDisplayText,
  compactContext,
  createReviewId,
  currentLocale,
  getLocalizedErrorMessage,
  normalizeChunk,
} from '../agent-format';
import { formatUsage } from '../ai-usage';

export interface AgentTaskActions {
  startPlanningTask: () => void;
  markRunning: () => void;
  markCompleted: () => void;
  failTaskWith: (error: string) => void;
  cancelTaskNow: () => void;
  markReviewing: () => void;
  receivePlanTask: (plan: string) => void;
  markVerifying: (command: string) => void;
  markVerificationResult: (passed: boolean, exitCode: number | null, output: string) => void;
}

export interface DestructiveRequest {
  type: 'delete' | 'rename';
  filePath: string;
  newPath?: string;
}

export interface UseAgentChatOptions {
  workspacePath: string;
  openFiles: { path: string; name: string; content: string }[];
  workspaceRules?: string;
  /** 当前激活模型名（usage 展示用）。 */
  activeModel?: string;
  agentMode: boolean;
  plannerMode: boolean;
  verifyMode: boolean;
  autoApplySafeEdits: boolean;
  activeSkillId: string | null;
  selectedCliAgent: { id: string; name: string } | null;
  notify: (message: string, type?: NotificationType, duration?: number) => void;
  task: AgentTaskActions;
  /** 断点续跑引用（来自 useAgentCheckpoint）。 */
  resumeCheckpointIdRef: React.MutableRefObject<string | null>;
  refreshAgentTasks: () => void;
  setUsageText: (text: string) => void;
  onApplyEdit?: (filePath: string, content: string) => void;
  onOpenFile?: (path: string, content: string) => void;
  /** 对比模式发送（组件提供 runCompare）。 */
  onCompare?: () => void;
  compareMode?: boolean;
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const {
    workspacePath, openFiles, workspaceRules, activeModel,
    agentMode, plannerMode, verifyMode, autoApplySafeEdits, activeSkillId,
    selectedCliAgent, notify, task, resumeCheckpointIdRef, refreshAgentTasks,
    setUsageText, onApplyEdit, onOpenFile, onCompare, compareMode,
  } = opts;

  const [messages, setMessages] = useState<Message[]>([]);
  const [reviewQueue, setReviewQueue] = useState<AgentReviewItem[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDestructive, setPendingDestructive] = useState<{ request: DestructiveRequest; sid: string } | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const currentStreamIdRef = useRef<string | null>(null);
  const pendingPlanStreamIdRef = useRef<string | null>(null);

  // ---- 消息流工具 ----
  const appendAssistantChunk = useCallback((requestId: string, chunk: string) => {
    const visibleChunk = cleanAssistantDisplayText(chunk);
    if (!visibleChunk) return;
    setMessages(prev => prev.map(message => (
      message.requestId === requestId
        ? { ...message, content: message.content + visibleChunk, isStreaming: true }
        : message
    )));
  }, []);

  const addToolCall = useCallback((requestId: string, toolCall: ToolCallDisplay) => {
    setMessages(prev => prev.map(message => (
      message.requestId === requestId
        ? { ...message, toolCalls: [...(message.toolCalls || []), toolCall] }
        : message
    )));
  }, []);

  const updateLastToolCall = useCallback((requestId: string, patch: Partial<ToolCallDisplay>) => {
    setMessages(prev => prev.map(message => {
      if (message.requestId !== requestId) return message;
      const toolCalls = [...(message.toolCalls || [])];
      if (toolCalls.length === 0) return message;
      toolCalls[toolCalls.length - 1] = { ...toolCalls[toolCalls.length - 1]!, ...patch };
      return { ...message, toolCalls };
    }));
  }, []);

  const finishAssistantMessage = useCallback((requestId: string) => {
    setMessages(prev => prev.map(message => (
      message.requestId === requestId ? { ...message, isStreaming: false } : message
    )));
  }, []);

  // ---- 审阅队列 ----
  const addReview = useCallback((filePath: string, content: string, existed: boolean, originalContent: string) => {
    const id = createReviewId(filePath);
    setReviewQueue(prev => addOrUpdateReviewItem(prev, {
      id,
      filePath,
      original: originalContent || '',
      modified: content,
      existed,
      status: 'pending',
    }));
    setSelectedReviewId(id);
    task.markReviewing();
  }, [task]);

  const acceptChange = useCallback((id: string) => {
    const item = reviewQueue.find(entry => entry.id === id);
    if (item && item.status === 'pending') {
      onApplyEdit?.(item.filePath, item.modified);
      onOpenFile?.(item.filePath, item.modified);
      notify(t('agent.notifyAccepted', { file: basename(item.filePath) }), 'success');
    }
    setReviewQueue(prev => acceptReviewItem(prev, id));
  }, [notify, onApplyEdit, onOpenFile, reviewQueue]);

  const rejectChange = useCallback(async (id: string) => {
    const item = reviewQueue.find(entry => entry.id === id);
    if (!item) return;
    let applied = false;
    const sid = currentStreamIdRef.current;
    if (sid && item.filePath) {
      try {
        const res = await window.loom?.ai?.rejectAgentEdit?.(sid, item.filePath);
        applied = !!res?.applied;
      } catch { /* IPC 失败时按未知处理，仅本地移除 */ }
    }
    if (applied) {
      notify(t('agent.notifyRejectedDisk', { file: basename(item.filePath) }), 'info');
    } else {
      notify(t('agent.notifyRejected', { file: basename(item.filePath) }), 'info');
    }
    setReviewQueue(prev => rejectReviewItem(prev, id));
  }, [notify, reviewQueue]);

  // ---- Agent 流式 chunk 处理 ----
  const handleAgentChunk = useCallback((requestId: string, rawChunk: unknown) => {
    const chunk = normalizeChunk(rawChunk);
    if (chunk.type === 'text') {
      appendAssistantChunk(requestId, chunk.content || '');
      return;
    }
    if (chunk.type === 'plan') {
      task.receivePlanTask(chunk.content || '');
      appendAssistantChunk(requestId, `\n\n${chunk.content || ''}`);
      return;
    }
    if (chunk.type === 'tool_call') {
      addToolCall(requestId, {
        name: chunk.toolName || 'tool',
        args: chunk.toolArgs,
        status: 'running',
        expanded: false,
      });
      return;
    }
    if (chunk.type === 'tool_result') {
      updateLastToolCall(requestId, { status: 'done', result: chunk.content || '' });
      return;
    }
    if (chunk.type === 'task_event') {
      const event = chunk.taskEvent;
      if (event?.type === 'verify-start') {
        task.markVerifying(event.command);
        return;
      }
      if (event?.type === 'verify-done') {
        task.markVerificationResult(event.exitCode === 0, event.exitCode ?? 1, event.data || '');
        return;
      }
      const eventText = [event?.command, ...(event?.args || [])].join(' ').trim();
      if (eventText) {
        addToolCall(requestId, {
          name: `PowerShell ${event?.type || ''}`.trim(),
          args: { command: eventText, attempt: event?.attempt },
          status: event?.type === 'error' ? 'error' : event?.type === 'exit' ? 'done' : 'running',
          result: event?.data || event?.error || '',
          expanded: false,
        });
      }
      refreshAgentTasks();
      return;
    }
    if (chunk.type === 'error') {
      task.failTaskWith(chunk.content || 'Agent failed');
      appendAssistantChunk(requestId, `\n\n${chunk.content || 'Agent failed'}`);
    }
  }, [appendAssistantChunk, task, addToolCall, updateLastToolCall, refreshAgentTasks]);

  // ---- 发送 ----
  const sendWith = useCallback(async (prompt: string) => {
    if (compareMode) {
      onCompare?.();
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    const requestId = crypto.randomUUID();
    currentRequestIdRef.current = requestId;
    const attachedFiles = [...openFiles];
    const userMessage: Message = { role: 'user', content: trimmed, attachedFiles };
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [],
      isStreaming: true,
      requestId,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setLoading(true);
    setUsageText('');
    if (agentMode) task.startPlanningTask(); else task.markRunning();

    // 解析 @relativePath / @codebase 引用
    const mentionContext = await (async (): Promise<string> => {
      const parts: string[] = [];
      const fileMentions = trimmed.match(/(?:^|\s)@(?!codebase\b)([\w./\\-]+\.\w+)/g) || [];
      const seenPaths = new Set<string>();
      for (const m of fileMentions) {
        const rel = m.trim().replace(/^@/, '');
        const fullPath = workspacePath ? `${workspacePath}/${rel}`.replace(/\\/g, '/') : rel;
        if (seenPaths.has(fullPath)) continue;
        seenPaths.add(fullPath);
        try {
          const content = await window.loom?.fs?.readFile?.(fullPath);
          if (typeof content === 'string' && !content.startsWith('__ERR__:')) {
            parts.push(`Referenced file ${rel}:\n${content.slice(0, 8000)}`);
          }
        } catch {}
      }
      const codebaseMentions = trimmed.match(/@codebase\s+([\w./\\-]+)(?::(\d+))?/g) || [];
      for (const m of codebaseMentions) {
        const match = m.match(/@codebase\s+([\w./\\-]+)(?::(\d+))?/);
        if (!match) continue;
        const rel = match[1]!;
        const line = match[2] ? parseInt(match[2], 10) : undefined;
        const fullPath = workspacePath ? `${workspacePath}/${rel}`.replace(/\\/g, '/') : rel;
        try {
          const content = await window.loom?.fs?.readFile?.(fullPath);
          if (typeof content === 'string' && !content.startsWith('__ERR__:')) {
            if (line) {
              const lines = content.split('\n');
              const start = Math.max(0, line - 5);
              const end = Math.min(lines.length, line + 40);
              parts.push(`Symbol @codebase ${rel}:${line}:\n${lines.slice(start, end).join('\n')}`);
            } else {
              parts.push(`@codebase ${rel}:\n${content.slice(0, 6000)}`);
            }
          }
        } catch {}
      }
      return parts.join('\n\n---\n\n');
    })();

    const context = compactContext(attachedFiles, workspaceRules);
    const finalPrompt = [
      trimmed,
      context ? `\n\nContext:\n${context}` : '',
      mentionContext ? `\n\nMentioned:\n${mentionContext}` : '',
      plannerMode ? '\n\n先输出计划，等待我确认后再继续执行。' : '',
    ].join('');

    try {
      if (selectedCliAgent) {
        const result = await window.loom?.cliAgents?.run?.(selectedCliAgent.id, finalPrompt, workspacePath) as any;
        const stdout = result?.stdout || '';
        const stderr = result?.stderr || '';
        if (result?.ok === false || (typeof result?.exitCode === 'number' && result.exitCode !== 0)) {
          appendAssistantChunk(requestId, stderr || t('agent.cliAgentFailed', { code: result?.exitCode ?? '?' }));
          task.failTaskWith(stderr || `CLI Agent failed: ${result.exitCode}`);
        } else {
          appendAssistantChunk(requestId, stdout || t('agent.pluginDoneEmpty'));
          task.markCompleted();
        }
        setLoading(false);
        finishAssistantMessage(requestId);
        return;
      }

      const history = [...messages, { role: 'user', content: finalPrompt }];
      if (agentMode) {
        abortRef.current = window.loom?.ai?.agentChatStream?.(
          history,
          workspacePath,
          attachedFiles,
          (chunk: unknown) => handleAgentChunk(requestId, chunk),
          (usage?: any) => {
            finishAssistantMessage(requestId);
            setLoading(false);
            task.markCompleted();
            if (usage) setUsageText(formatUsage(usage, activeModel));
            abortRef.current = null;
            pendingPlanStreamIdRef.current = null;
            setPendingDestructive(null);
            currentRequestIdRef.current = null;
            refreshAgentTasks();
          },
          (error: Error) => {
            const errorMsg = getLocalizedErrorMessage(error.message, currentLocale());
            appendAssistantChunk(requestId, `\n\n${errorMsg}`);
            finishAssistantMessage(requestId);
            setLoading(false);
            task.failTaskWith(errorMsg);
            abortRef.current = null;
            pendingPlanStreamIdRef.current = null;
            setPendingDestructive(null);
            currentRequestIdRef.current = null;
          },
          (filePath: string, content: string, existed: boolean, originalContent: string, sid?: string) => {
            if (sid) currentStreamIdRef.current = sid;
            addReview(filePath, content, existed, originalContent);
          },
          (filePath: string, content: string) => addReview(filePath, content, false, ''),
          (filePath: string, content: string) => addReview(filePath, content, true, openFiles.find(file => file.path === filePath)?.content || ''),
          (planText: string, sid: string) => {
            pendingPlanStreamIdRef.current = sid;
          },
          (request: DestructiveRequest, sid: string) => {
            setPendingDestructive({ request, sid });
          },
          {
            previewFileWrites: true,
            autoApplySafeEdits,
            plannerMode,
            verifyMode,
            activeSkillId: activeSkillId || undefined,
            checkpointId: resumeCheckpointIdRef.current || undefined,
            planOnly: false,
          },
        );
      } else {
        abortRef.current = window.loom?.ai?.chatStream?.(
          history,
          context,
          (chunk: string) => appendAssistantChunk(requestId, chunk),
          () => {
            finishAssistantMessage(requestId);
            setLoading(false);
            task.markCompleted();
            abortRef.current = null;
          },
          (error: Error) => {
            const errorMsg = getLocalizedErrorMessage(error.message, currentLocale());
            appendAssistantChunk(requestId, `\n\n${errorMsg}`);
            finishAssistantMessage(requestId);
            setLoading(false);
            task.failTaskWith(errorMsg);
            abortRef.current = null;
          },
          (usage: { input: number; output: number }) => {
            setUsageText(formatUsage(usage, activeModel));
          },
        );
      }
    } catch (error: any) {
      appendAssistantChunk(requestId, error?.message || 'Agent request failed');
      finishAssistantMessage(requestId);
      setLoading(false);
      task.failTaskWith(error?.message || 'Agent request failed');
    }
  }, [
    compareMode, onCompare, loading, openFiles, workspacePath, workspaceRules,
    agentMode, plannerMode, task, setUsageText, activeModel, selectedCliAgent,
    messages, handleAgentChunk, appendAssistantChunk, finishAssistantMessage,
    autoApplySafeEdits, verifyMode, activeSkillId, resumeCheckpointIdRef,
    addReview, refreshAgentTasks,
  ]);

  // 卸载时中止进行中的流
  useEffect(() => () => { abortRef.current?.(); }, []);

  // ---- 停止 ----
  const stopGeneration = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setLoading(false);
    task.cancelTaskNow();
    const rid = currentRequestIdRef.current;
    if (rid) finishAssistantMessage(rid);
    currentRequestIdRef.current = null;
  }, [task, finishAssistantMessage]);

  return {
    messages, setMessages,
    reviewQueue, setReviewQueue,
    selectedReviewId, setSelectedReviewId,
    loading, setLoading,
    pendingDestructive, setPendingDestructive,
    abortRef, currentRequestIdRef, currentStreamIdRef, pendingPlanStreamIdRef,
    sendWith, stopGeneration,
    acceptChange, rejectChange,
    appendAssistantChunk, finishAssistantMessage,
  };
}
