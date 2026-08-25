import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getConfiguredModelOptions,
  modelSelectionValue,
  parseModelSelection,
} from '../ai-model-options';
import type { ModelOption } from '../ai-model-options';
import {
  acceptReviewItem,
  addOrUpdateReviewItem,
  rejectReviewItem,
  type AgentReviewItem,
} from '../agent-review-queue';
import { buildCodexTerminalInput } from '../assistant-panel';
import { formatUsage } from '../ai-usage';
import AgentPlanApproval from './AgentPlanApproval';
import { AgentMessageItem, AgentRunStatus } from './AgentMessageItem';
import AgentReviewQueue from './AgentReviewQueue';
import AgentTaskCenter from './AgentTaskCenter';
import AgentHistoryPanel from './AgentHistoryPanel';
import AgentComparePanel from './AgentComparePanel';
import AgentVerificationPanel from './AgentVerificationPanel';
import Terminal from './Terminal';
import { getLoom } from '../loom-ipc';
import { emitLoomEvent, onLoomEvent } from '../loom-events';
import { useAgentCheckpoint } from '../hooks/useAgentCheckpoint';
import { useAgentChat } from '../hooks/useAgentChat';
import { useAgentTask } from '../hooks/useAgentTask';
import {
  basename,
  cleanAssistantDisplayText,
  compactContext,
  createReviewId,
  currentLocale,
  getLocalizedErrorMessage,
  loadChatSessions,
  makeSessionPreview,
  makeSessionTitle,
  normalizeChunk,
  renderTaskEvent,
  saveChatSessions,
} from '../agent-format';

// Token 用量 / 成本估算已抽到 ../ai-usage（formatUsage / estimateRates）。
// 纯函数（错误文案/会话标题/chunk 归一化/持久化）已抽到 ../agent-format。

interface Props {
  workspacePath: string;
  onClose: () => void;
  openFiles?: { path: string; name: string; content: string }[];
  onOpenFile?: (path: string, content: string) => void;
  onApplyEdit?: (filePath: string, content: string) => void;
  workspaceRules?: string;
  width?: number;
  locale?: 'zh-CN' | 'en-US';
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCallDisplay[];
  attachedFiles?: { path: string; name: string; content: string }[];
  isStreaming?: boolean;
  requestId?: string;
}

export interface ToolCallDisplay {
  name: string;
  args: unknown;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  expanded?: boolean;
}

interface AgentChunk {
  type: 'text' | 'plan' | 'tool_call' | 'tool_result' | 'task_event' | 'error';
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  taskEvent?: {
    taskId: string;
    type: 'queued' | 'started' | 'stdout' | 'stderr' | 'exit' | 'error' | 'retry' | 'cancelled' | 'verify-start' | 'verify-done';
    command: string;
    args: string[];
    attempt: number;
    data?: string;
    exitCode?: number | null;
    error?: string;
  };
}

interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabledModels?: string[];
  activeModel: string;
  isCustom: boolean;
}

interface AgentProfile {
  id: string;
  name: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  icon: string;
}

interface AIConfig {
  providers: AIProvider[];
  activeProviderId: string;
  profiles: AgentProfile[];
  activeProfileId: string;
  streamEnabled: boolean;
  mode?: 'builtin';
  orcaBaseUrl?: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  prompt: string;
  icon: string;
  builtin: boolean;
}

interface CliAgentInfo {
  id: string;
  name: string;
  installed: boolean;
  path?: string;
}

interface AgentCommandTask {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: { command: string; args: string[]; cwd: string };
  history: Array<{ type: string; data?: string; error?: string; exitCode?: number | null; timestamp?: string }>;
  result?: { exitCode: number | null; stdout?: string; stderr?: string; error?: string };
}

export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  messages: Message[];
}

function selectedReview(queue: AgentReviewItem[], id: string | null): AgentReviewItem | null {
  return queue.find(item => item.id === id) || queue.find(item => item.status === 'pending') || queue[0] || null;
}

function DiffPreview({
  item,
  onAccept,
  onReject,
}: {
  item: AgentReviewItem | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (!item) return null;

  return (
    <div className="agent-diff-preview" data-testid="agent-diff-preview">
      <div className="agent-diff-header">
        <div>
          <div className="agent-diff-title">{basename(item.filePath)}</div>
          <div className="agent-diff-path" title={item.filePath}>{item.filePath}</div>
        </div>
        {item.status === 'pending' && (
          <div className="agent-diff-actions">
            <button
              type="button"
              className="agent-review-reject"
              aria-label={`回滚 ${basename(item.filePath)}`}
              data-testid="agent-change-reject"
              onClick={() => onReject(item.id)}
            >
              回滚
            </button>
            <button
              type="button"
              className="agent-review-accept"
              aria-label={`接受 ${basename(item.filePath)}`}
              data-testid="agent-change-accept"
              onClick={() => onAccept(item.id)}
            >
              接受
            </button>
          </div>
        )}
      </div>
      <div className="agent-diff-grid">
        <div>
          <div className="agent-diff-label">原始</div>
          <pre>{item.original || '(new file)'}</pre>
        </div>
        <div>
          <div className="agent-diff-label">建议</div>
          <pre>{item.modified}</pre>
        </div>
      </div>
    </div>
  );
}

function AIAgent({
  workspacePath,
  onClose,
  openFiles = [],
  onOpenFile,
  onApplyEdit,
  workspaceRules,
  width = 400,
  locale = 'zh-CN',
}: Props) {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [cliAgents, setCliAgents] = useState<CliAgentInfo[]>([]);
  const [input, setInput] = useState('');
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState(true);
  const [plannerMode, setPlannerMode] = useState(false);
  const [autoApplySafeEdits, setAutoApplySafeEdits] = useState(false);
  const [verifyMode, setVerifyMode] = useState(false);
  const [selectedCliAgentId, setSelectedCliAgentId] = useState('builtin');
  const [showTaskCenter, setShowTaskCenter] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [agentCommandTasks, setAgentCommandTasks] = useState<AgentCommandTask[]>([]);
  // 领域 hook：Agent 任务状态机（计划/运行/审阅/验证/失败/取消）
  const {
    agentTask,
    markReviewing,
    receivePlanTask,
    markVerifying,
    markVerificationResult,
    failTaskWith,
    startPlanningTask,
    markRunning,
    markCompleted,
    cancelTaskNow,
    resetTask,
    approvePlanTask,
  } = useAgentTask();
  const [assistantTerminalVisible, setAssistantTerminalVisible] = useState(false);
  const [usageText, setUsageText] = useState('');
  // 断点续跑引用（组件级创建，useAgentChat 与 useAgentCheckpoint 共享）
  const resumeCheckpointIdRef = useRef<string | null>(null);

  // 多模型对比 / 投票
  const [compareMode, setCompareMode] = useState(false);
  const [compareModelA, setCompareModelA] = useState('');
  const [compareModelB, setCompareModelB] = useState('');
  const [compareResult, setCompareResult] = useState<{ a: { text: string; usage: any }; b: { text: string; usage: any } } | null>(null);
  const [compareError, setCompareError] = useState('');
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareVotes, setCompareVotes] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const labelOf = (value: string) => modelOptions.find((o: ModelOption) => o.value === value)?.label || value;
  const compareAbortRef = useRef<{ a?: () => void; b?: () => void }>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentSessionIdRef = useRef<string>(crypto.randomUUID());
  const terminalId = useMemo(() => `assistant-agent-${Math.random().toString(36).slice(2)}`, []);

  // ===== @-mention popover =====
  // textarea 输入 @ 触发文件/符号引用 popover；@codebase 触发语义检索。
  const [mention, setMention] = useState<{
    open: boolean;
    query: string;          // @ 后的查询词
    start: number;          // @ 在输入框中的起始位置
    type: 'file' | 'codebase';
    results: { path: string; name: string; relativePath: string; kind?: string; startLine?: number }[];
    selectedIdx: number;
  }>({ open: false, query: '', start: 0, type: 'file', results: [], selectedIdx: 0 });

  // 检测 textarea 中光标前是否刚输入 @，触发 popover
  const detectMention = useCallback((value: string, selectionStart: number) => {
    // 从光标向前找 @
    const before = value.slice(0, selectionStart);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) { setMention(m => ({ ...m, open: false })); return; }
    // @ 必须在行首或前面是空白（避免邮箱地址误触发）
    const charBefore = atIdx > 0 ? before[atIdx - 1] : ' ';
    if (charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\t') {
      setMention(m => ({ ...m, open: false }));
      return;
    }
    // @ 后到光标的文本
    const query = value.slice(atIdx + 1, selectionStart);
    // 不能包含换行（跨行不算 mention）
    if (query.includes('\n')) { setMention(m => ({ ...m, open: false })); return; }
    // 判断类型：@codebase 触发语义检索
    const isCodebase = query.startsWith('codebase');
    const searchQuery = isCodebase ? query.slice('codebase'.length).trim() : query.trim();
    setMention(m => ({
      ...m,
      open: true,
      query: searchQuery,
      start: atIdx,
      type: isCodebase ? 'codebase' : 'file',
      selectedIdx: 0,
    }));
  }, []);

  // mention 触发后的搜索（debounced）
  useEffect(() => {
    if (!mention.open || !workspacePath) return;
    if (!mention.query && mention.type === 'file') {
      // 无查询词时显示最近打开文件
      const recents = openFiles.slice(0, 8).map(f => ({
        path: f.path,
        name: f.name,
        relativePath: workspacePath ? (f.path || '').replace(workspacePath, '').replace(/^[\\/]/, '') : f.path,
      }));
      setMention(m => ({ ...m, results: recents }));
      return;
    }
    if (!mention.query && mention.type === 'codebase') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (mention.type === 'file') {
        window.loom?.fs?.searchFiles?.(workspacePath, mention.query).then((paths: string[]) => {
          if (cancelled) return;
          const results = (paths || []).slice(0, 12).map((p: string) => {
            const name = p.split(/[\\/]/).pop() || p;
            const relativePath = workspacePath ? p.replace(workspacePath, '').replace(/^[\\/]/, '') : p;
            return { path: p, name, relativePath };
          });
          setMention(m => ({ ...m, results }));
        }).catch(() => {});
      } else {
        // @codebase 语义检索
        window.loom?.codeIndex?.search?.(workspacePath, mention.query, 12).then((syms: any[]) => {
          if (cancelled) return;
          const results = (syms || []).map(s => {
            const relativePath = workspacePath ? s.filePath.replace(workspacePath, '').replace(/^[\\/]/, '') : s.filePath;
            return { path: s.filePath, name: s.name, relativePath, kind: s.kind, startLine: s.startLine };
          });
          setMention(m => ({ ...m, results }));
        }).catch(() => {
          if (!cancelled) setMention(m => ({ ...m, results: [] }));
        });
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mention.open, mention.query, mention.type, workspacePath, openFiles]);

  // 选中 mention 项后，把 @query 替换为 @relativePath（或 @codebase query）
  const acceptMention = useCallback((item?: { path: string; name: string; relativePath: string; kind?: string; startLine?: number }) => {
    if (!mention.open) return;
    const ta = textareaRef.current;
    if (!ta) return;
    if (!item) {
      // 没有选中项，关闭 popover
      setMention(m => ({ ...m, open: false }));
      return;
    }
    const before = input.slice(0, mention.start);
    const after = input.slice(ta.selectionStart);
    // 文件引用：插入 @relativePath；@codebase：插入 @codebase relativePath:symbol
    let insertion: string;
    if (mention.type === 'codebase') {
      insertion = `@codebase ${item.relativePath}${item.startLine ? `:${item.startLine}` : ''}`;
    } else {
      insertion = `@${item.relativePath}`;
    }
    const newValue = before + insertion + ' ' + after;
    setInput(newValue);
    setMention(m => ({ ...m, open: false }));
    // 把光标移到插入内容后
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = before.length + insertion.length + 1;
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
        textareaRef.current.focus();
      }
    });
  }, [mention, input]);

  const refreshAgentTasks = useCallback(async () => {
    try {
      const tasks = await window.loom?.agentTasks?.list?.();
      setAgentCommandTasks(Array.isArray(tasks) ? tasks : []);
    } catch {
      setAgentCommandTasks([]);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    const [nextConfig, nextSkills, nextCliAgents] = await Promise.all([
      window.loom?.ai?.getConfig?.(),
      window.loom?.skills?.getAll?.(),
      window.loom?.cliAgents?.list?.(),
    ]);
    if (nextConfig) setConfig(nextConfig as unknown as typeof config);
    if (Array.isArray(nextSkills)) setSkills(nextSkills);
    if (Array.isArray(nextCliAgents)) setCliAgents(nextCliAgents);
  }, []);

  useEffect(() => {
    loadConfig();
    refreshAgentTasks();
  }, [loadConfig, refreshAgentTasks]);

  useEffect(() => {
    setChatSessions(loadChatSessions());
  }, []);

  // 面板打开时自动聚焦输入框（与 Cursor 的 Ctrl+L 心智一致）
  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const activeProvider = useMemo(() => {
    if (!config) return null;
    return config.providers.find(provider => provider.id === config.activeProviderId) || config.providers[0] || null;
  }, [config]);

  const activeProfile = useMemo(() => {
    if (!config) return null;
    return config.profiles.find(profile => profile.id === config.activeProfileId) || config.profiles[0] || null;
  }, [config]);

  const modelOptions = useMemo(() => config ? getConfiguredModelOptions(config) : [], [config]);

  const modelValue = useMemo(() => {
    if (!config || !activeProvider) return modelOptions[0]?.value || '';
    const activeValue = modelSelectionValue(config.mode, activeProvider.id, activeProvider.activeModel);
    return modelOptions.some(option => option.value === activeValue) ? activeValue : (modelOptions[0]?.value || '');
  }, [config, activeProvider, modelOptions]);

  const groupedModelOptions = useMemo(() => {
    const groups = new Map<string, typeof modelOptions>();
    modelOptions.forEach(option => {
      const items = groups.get(option.providerName) || [];
      items.push(option);
      groups.set(option.providerName, items);
    });
    return [...groups.entries()];
  }, [modelOptions]);

  const selectedCliAgent = useMemo(
    () => cliAgents.find(agent => agent.id === selectedCliAgentId && agent.installed) || null,
    [cliAgents, selectedCliAgentId],
  );

  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    emitLoomEvent('loom:notify', { message, type });
  }, []);

  // 领域 hook：对话核心（消息/发送/流式/审阅队列/破坏性审批）
  const {
    messages, setMessages,
    reviewQueue, setReviewQueue,
    selectedReviewId, setSelectedReviewId,
    loading, setLoading,
    pendingDestructive, setPendingDestructive,
    abortRef, currentRequestIdRef, currentStreamIdRef, pendingPlanStreamIdRef,
    sendWith, stopGeneration,
    acceptChange, rejectChange,
    appendAssistantChunk, finishAssistantMessage,
  } = useAgentChat({
    workspacePath,
    openFiles,
    workspaceRules,
    activeModel: activeProvider?.activeModel,
    agentMode,
    plannerMode,
    verifyMode,
    autoApplySafeEdits,
    activeSkillId,
    selectedCliAgent,
    notify,
    task: { startPlanningTask, markRunning, markCompleted, failTaskWith, cancelTaskNow, markReviewing, receivePlanTask, markVerifying, markVerificationResult },
    resumeCheckpointIdRef,
    refreshAgentTasks,
    setUsageText,
    onApplyEdit,
    onOpenFile,
    onCompare: () => runCompareRef.current?.(),
    compareMode,
  });

  // ===== Checkpoint resume（断点续跑）—— 已抽到 useAgentCheckpoint hook =====
  const {
    showResumePanel,
    setShowResumePanel,
    checkpointList,
    openResumePanel,
    applyCheckpoint,
    resetCheckpoint,
  } = useAgentCheckpoint({
    workspacePath,
    notify,
    onRestoreMessages: setMessages,
    resumeCheckpointIdRef,
  });

  // 发送包装：读取最新 input（sendWith 由 useAgentChat 提供）
  const inputRef = useRef(input);
  useEffect(() => { inputRef.current = input; }, [input]);
  const send = useCallback(() => { void sendWith(inputRef.current); }, [sendWith]);
  const sendRef = useRef<() => void>(() => {});
  useEffect(() => { sendRef.current = send; });
  // 对比模式发送引用（runCompare 定义在其后，经 ref 解耦时序）
  const runCompareRef = useRef<() => void>(() => {});
  useEffect(() => { runCompareRef.current = runCompare; });

  // 会话保存（消息稳定时写入历史）
  useEffect(() => {
    if (messages.length === 0 || messages.some(message => message.isStreaming)) return;
    const hasAssistant = messages.some(message => message.role === 'assistant' && message.content.trim());
    if (!hasAssistant) return;
    const session: ChatSession = {
      id: currentSessionIdRef.current,
      title: makeSessionTitle(messages),
      preview: makeSessionPreview(messages),
      updatedAt: Date.now(),
      messages,
    };
    setChatSessions(prev => {
      const next = [session, ...prev.filter(item => item.id !== session.id)].slice(0, 40);
      saveChatSessions(next);
      return next;
    });
  }, [messages]);

  // 任务中心轮询
  useEffect(() => {
    if (!showTaskCenter && !loading) return undefined;
    const timer = window.setInterval(refreshAgentTasks, 1500);
    return () => window.clearInterval(timer);
  }, [showTaskCenter, loading, refreshAgentTasks]);

  // 卸载时中止进行中的流
  useEffect(() => () => abortRef.current?.(), []);

  const hasConfiguredModel = Boolean(modelOptions.length > 0 || selectedCliAgent);
  const canSend = input.trim().length > 0 && !loading && hasConfiguredModel;
  const reviewItem = selectedReview(reviewQueue, selectedReviewId);

  const applySkillPrompt = useCallback((skill: Skill) => {
    setActiveSkillId(skill.id);
    setInput(prev => prev.trim() ? `${skill.prompt}\n\n${prev}` : skill.prompt);
    setShowSkills(false);
    textareaRef.current?.focus();
  }, []);

  const switchModel = useCallback(async (value: string) => {
    if (!config) return;
    const parsed = parseModelSelection(value);
    if (parsed.mode !== 'builtin') return;
    await window.loom?.ai?.updateProvider?.(parsed.providerId, { activeModel: parsed.model });
    const nextConfig = await window.loom?.ai?.updateConfig?.({
      mode: 'builtin',
      activeProviderId: parsed.providerId,
    }) as unknown as typeof config;
    setConfig(nextConfig || {
      ...config,
      mode: 'builtin',
      activeProviderId: parsed.providerId,
      providers: config.providers.map(provider => (
        provider.id === parsed.providerId ? { ...provider, activeModel: parsed.model } : provider
      )),
    });
  }, [config]);

  const runCompare = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || compareRunning) return;
    if (!compareModelA || !compareModelB) {
      setCompareError('请先选择两个对比模型');
      return;
    }
    const a = parseModelSelection(compareModelA);
    const b = parseModelSelection(compareModelB);
    if (a.mode !== 'builtin' || b.mode !== 'builtin') {
      setCompareError('对比模式仅支持内置模型');
      return;
    }
    setCompareRunning(true);
    setCompareError('');
    setCompareVotes({ a: 0, b: 0 });
    // 初始化两侧空文本，流式过程中实时填充，用户可看到回复逐字生成
    setCompareResult({ a: { text: '', usage: null }, b: { text: '', usage: null } });
    const attachedFiles = [...openFiles];
    const history = [...messages, { role: 'user', content: prompt }];
    const context = compactContext(attachedFiles, workspaceRules);

    const runSide = (side: 'a' | 'b', providerId: string, model: string) => new Promise<void>((resolve) => {
      let acc = '';
      const cancel = window.loom?.ai?.askWithStream?.(
        providerId,
        model,
        history,
        context,
        (chunk: string) => {
          acc += chunk;
          setCompareResult(prev => {
            if (!prev) return prev;
            return { ...prev, [side]: { ...prev[side], text: acc } };
          });
        },
        () => { resolve(); },
        (err: Error) => {
          setCompareError(prev => `${prev ? prev + ' ' : ''}[${side === 'a' ? compareModelA : compareModelB}] ${err.message}`);
          resolve();
        },
        (usage: { input: number; output: number }) => {
          setCompareResult(prev => {
            if (!prev) return prev;
            return { ...prev, [side]: { ...prev[side], usage } };
          });
        },
      );
      if (side === 'a') compareAbortRef.current.a = cancel;
      else compareAbortRef.current.b = cancel;
    });

    try {
      await Promise.all([
        runSide('a', a.providerId, a.model),
        runSide('b', b.providerId, b.model),
      ]);
    } finally {
      compareAbortRef.current = {};
      setCompareRunning(false);
    }
  }, [input, messages, openFiles, workspaceRules, compareModelA, compareModelB, compareRunning]);

  const stopCompare = useCallback(() => {
    compareAbortRef.current.a?.();
    compareAbortRef.current.b?.();
    compareAbortRef.current = {};
    setCompareRunning(false);
  }, []);

  // 运行结束后一键继续：以当前对话历史再发一轮。
  const continueAgent = useCallback(() => {
    if (loading) return;
    setInput(locale === 'zh-CN' ? '继续' : 'Continue');
    setTimeout(() => sendRef.current(), 0);
  }, [loading, locale]);

  const startNewChat = useCallback(() => {
    stopGeneration();
    currentSessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setReviewQueue([]);
    setSelectedReviewId(null);
    resetTask();
    setUsageText('');
    resetCheckpoint();
  }, [stopGeneration, resetTask, resetCheckpoint]);

  const restoreChatSession = useCallback((session: ChatSession) => {
    stopGeneration();
    currentSessionIdRef.current = session.id;
    setMessages(session.messages || []);
    setReviewQueue([]);
    setSelectedReviewId(null);
    resetTask();
    setUsageText('');
    setShowHistory(false);
  }, [stopGeneration, resetTask]);

  const deleteChatSession = useCallback((sessionId: string) => {
    setChatSessions(prev => {
      const next = prev.filter(session => session.id !== sessionId);
      saveChatSessions(next);
      return next;
    });
    if (currentSessionIdRef.current === sessionId) {
      currentSessionIdRef.current = crypto.randomUUID();
      setMessages([]);
    }
  }, []);

  const approveCurrentPlan = useCallback(() => {
    const sid = pendingPlanStreamIdRef.current;
    if (sid) {
      getLoom()?.ai?.approvePlan(sid);
      pendingPlanStreamIdRef.current = null;
    }
    approvePlanTask();
    setPlannerMode(false);
    notify('计划已确认，可以继续执行。', 'success');
  }, [notify, approvePlanTask]);

  const rejectCurrentPlan = useCallback(() => {
    const sid = pendingPlanStreamIdRef.current;
    if (sid) {
      getLoom()?.ai?.rejectPlan(sid);
      pendingPlanStreamIdRef.current = null;
    }
    cancelTaskNow();
  }, [cancelTaskNow]);

  const approveDestructiveAction = useCallback(() => {
    const pending = pendingDestructive;
    if (!pending) return;
    getLoom()?.ai?.approveDestructive?.(pending.sid);
    setPendingDestructive(null);
  }, [pendingDestructive]);

  const rejectDestructiveAction = useCallback(() => {
    const pending = pendingDestructive;
    if (!pending) return;
    getLoom()?.ai?.rejectDestructive?.(pending.sid);
    setPendingDestructive(null);
  }, [pendingDestructive]);


  const cancelAgentCommandTask = useCallback(async (taskId: string) => {
    await window.loom?.agentTasks?.cancel?.(taskId);
    await refreshAgentTasks();
  }, [refreshAgentTasks]);

  const retryAgentCommandTask = useCallback(async (taskId: string) => {
    await window.loom?.agentTasks?.retry?.(taskId);
    await refreshAgentTasks();
    notify('已重新加入 Agent 命令队列', 'info');
  }, [notify, refreshAgentTasks]);

  const runTerminalCommand = useCallback(() => {
    setAssistantTerminalVisible(true);
    setTimeout(() => {
      window.loom?.terminal?.write?.(terminalId, buildCodexTerminalInput());
    }, 250);
  }, [terminalId]);

  const quickActions = [
    { id: 'review', title: locale === 'zh-CN' ? '代码审查' : 'Code Review', text: locale === 'zh-CN' ? '审查当前代码，找出 bug 和改进点。' : 'Review the current code and find bugs or improvements.' },
    { id: 'explain', title: locale === 'zh-CN' ? '解释代码' : 'Explain', text: locale === 'zh-CN' ? '详细解释这段代码的工作原理。' : 'Explain how this code works in detail.' },
    { id: 'refactor', title: locale === 'zh-CN' ? '重构建议' : 'Refactor', text: locale === 'zh-CN' ? '为提升代码质量给出重构建议。' : 'Suggest refactoring improvements for better code quality.' },
    { id: 'tests', title: locale === 'zh-CN' ? '编写测试' : 'Add Tests', text: locale === 'zh-CN' ? '为这段代码编写单元测试。' : 'Write unit tests for this code.' },
  ];

  if (!config) {
    return (
      <div className="ai-agent-panel" style={{ width }}>
        <div className="ai-header">
          <span className="ai-header-title">{locale === 'zh-CN' ? '智能体' : 'Agent'}</span>
          <button type="button" onClick={onClose} className="ai-header-btn" aria-label="关闭 Agent 面板" data-testid="ai-close">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div className="ai-loading">{locale === 'zh-CN' ? '加载中…' : 'Loading...'}</div>
      </div>
    );
  }

  return (
    <div className="ai-agent-panel" style={{ width }} data-testid="ai-agent-panel">
      <div className="ai-header">
        <div className="ai-header-title">
          {locale === 'zh-CN' ? '智能体' : 'Agent'} <span className="ai-header-subtitle">{activeProvider?.name || '未配置模型'}</span>
        </div>
        <div className="ai-header-actions">
          <button type="button" onClick={runTerminalCommand} className="ai-header-btn" title="打开终端" aria-label="打开终端" data-testid="ai-toggle-terminal">
            <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="2.5" width="14" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M4 7l1.8 1.8L4 10.6M7.5 10.5h4" fill="none" stroke="currentColor" strokeWidth="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" onClick={startNewChat} className="ai-header-btn" title="新对话" aria-label="新对话" data-testid="ai-new-chat">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" stroke-linecap="round"/></svg>
          </button>
          <button
            type="button"
            onClick={openResumePanel}
            className={`ai-header-btn ${resumeCheckpointIdRef.current ? 'active' : ''}`}
            title={locale === 'zh-CN' ? '恢复上次运行（断点续跑）' : 'Resume last run (checkpoint)'}
            aria-label={locale === 'zh-CN' ? '恢复上次运行' : 'Resume last run'}
            data-testid="ai-resume"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M8 2v6l3.5 2M8 2a6 6 0 105 2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 2v6l3.5 2" fill="currentColor" stroke="currentColor" strokeWidth="0.4"/></svg>
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(value => !value)}
            className="ai-header-btn"
            title="历史对话"
            aria-label="历史对话"
            data-testid="ai-history"
          >
            <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M8 4.5v3.7l2.3 1.3" fill="none" stroke="currentColor" strokeWidth="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button
            type="button"
            onClick={() => { setShowTaskCenter(value => !value); refreshAgentTasks(); }}
            className="ai-header-btn"
            title="任务中心"
            aria-label="任务中心"
            data-testid="ai-task-center"
          >
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 4l1.5 1.5L7 3M3 9l1.5 1.5L7 8M9 4h4M9 9h4" fill="none" stroke="currentColor" strokeWidth="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" onClick={onClose} className="ai-header-btn" title="关闭面板" aria-label="关闭面板" data-testid="ai-close-panel">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>

      <div className="ai-mode-bar">
        <button
          type="button"
          className={`ai-mode-tab ${agentMode ? 'active' : ''}`}
          aria-label="Agent 模式"
          data-testid="ai-mode-agent"
          onClick={() => setAgentMode(true)}
        >
          Agent 模式
        </button>
        <button
          type="button"
          className={`ai-mode-tab ${!agentMode ? 'active' : ''}`}
          aria-label="聊天模式"
          data-testid="ai-mode-chat"
          onClick={() => setAgentMode(false)}
        >
          {locale === 'zh-CN' ? '对话' : 'Chat'}
        </button>
        <label className="ai-safe-edit-toggle">
          <input
            type="checkbox"
            checked={autoApplySafeEdits}
            onChange={event => setAutoApplySafeEdits(event.target.checked)}
            aria-label="自动应用安全编辑"
            data-testid="ai-auto-apply"
          />
          自动应用安全编辑
        </label>
        <label className="ai-safe-edit-toggle" title="完成后自动运行类型检查与测试，未通过则继续修复">
          <input
            type="checkbox"
            checked={verifyMode}
            onChange={event => setVerifyMode(event.target.checked)}
            aria-label="完成后验证"
            data-testid="ai-verify-mode"
          />
          完成后验证
        </label>
      </div>

      {showTaskCenter && (
        <AgentTaskCenter
          tasks={agentCommandTasks}
          onRefresh={refreshAgentTasks}
          onCancel={cancelAgentCommandTask}
          onRetry={retryAgentCommandTask}
          onClose={() => setShowTaskCenter(false)}
        />
      )}

      {showHistory && (
        <AgentHistoryPanel
          sessions={chatSessions}
          onRestore={restoreChatSession}
          onDelete={deleteChatSession}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showResumePanel && (
        <div className="agent-resume-panel" data-testid="agent-resume-panel">
          <div className="agent-resume-header">
            <span>{locale === 'zh-CN' ? '恢复运行（检查点）' : 'Resume (checkpoints)'}</span>
            <button type="button" className="ai-header-btn" onClick={() => setShowResumePanel(false)} aria-label="关闭">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="agent-resume-list">
            {checkpointList.length === 0 ? (
              <div className="agent-resume-empty">
                {locale === 'zh-CN'
                  ? '暂无检查点。Agent 运行结束后会自动保存，可随时从这里继续。'
                  : 'No checkpoints yet. Agent runs are saved automatically — resume anytime.'}
              </div>
            ) : checkpointList.map(ckpt => (
              <div key={ckpt.id} className="agent-resume-item">
                <div className="agent-resume-item-main">
                  <div className="agent-resume-item-title">{ckpt.id}</div>
                  <div className="agent-resume-item-meta">
                    {new Date(ckpt.createdAt).toLocaleString()} · {ckpt.messageCount} 条消息
                    {ckpt.preview ? ` · ${ckpt.preview.slice(0, 60)}` : ''}
                  </div>
                </div>
                <div className="agent-resume-item-actions">
                  <button
                    type="button"
                    className="settings-btn-sm primary"
                    onClick={() => applyCheckpoint(ckpt.id)}
                  >
                    {locale === 'zh-CN' ? '恢复' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className="settings-btn-sm"
                    title={locale === 'zh-CN' ? '删除检查点' : 'Delete checkpoint'}
                    onClick={async () => {
                      await window.loom?.ai?.checkpointDelete?.(workspacePath, ckpt.id).catch(() => {});
                      openResumePanel();
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AgentPlanApproval task={agentTask} onApprove={approveCurrentPlan} onCancel={rejectCurrentPlan} locale={locale} />

      <AgentRunStatus
        task={agentTask}
        usageText={usageText}
        toolCount={messages.reduce((n, m) => n + (m.toolCalls?.length || 0), 0)}
        locale={locale}
        onContinue={continueAgent}
      />

      {agentTask.verification && (
        <AgentVerificationPanel task={agentTask} />
      )}

      {pendingDestructive && (
        <div className="agent-destructive-bar" data-testid="agent-destructive-bar">
          <div className="agent-destructive-info">
            <span className="agent-destructive-icon">⚠</span>
            <span className="agent-destructive-text">
              {pendingDestructive.request.type === 'delete'
                ? (locale === 'zh-CN' ? 'Agent 请求删除：' : 'Agent wants to delete: ')
                : (locale === 'zh-CN' ? 'Agent 请求重命名：' : 'Agent wants to rename: ')}
              {pendingDestructive.request.filePath}
              {pendingDestructive.request.newPath ? ` → ${pendingDestructive.request.newPath}` : ''}
            </span>
          </div>
          <div className="agent-destructive-actions">
            <button type="button" className="agent-destructive-btn approve" onClick={approveDestructiveAction}>
              {locale === 'zh-CN' ? '允许' : 'Approve'}
            </button>
            <button type="button" className="agent-destructive-btn reject" onClick={rejectDestructiveAction}>
              {locale === 'zh-CN' ? '拒绝' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      <div className="ai-messages" data-testid="ai-messages">
        {messages.length === 0 && (
          <div className="ai-empty-state">
            <div className="ai-quick-actions">
              {quickActions.map(action => (
                <button
                  key={action.id}
                  type="button"
                  className="ai-quick-action"
                  aria-label={action.title}
                  data-testid={`ai-quick-${action.id}`}
                  onClick={() => setInput(action.text)}
                >
                  <strong>{action.title}</strong>
                  <span>{action.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <AgentMessageItem
            key={`${message.role}-${index}`}
            role={message.role}
            content={message.content}
            isStreaming={message.isStreaming}
            toolCalls={message.toolCalls}
            attachedFiles={message.attachedFiles}
            locale={locale}
          />
        ))}
      </div>

      {compareMode && (
        <AgentComparePanel
          labelA={labelOf(compareModelA)}
          labelB={labelOf(compareModelB)}
          votes={compareVotes}
          onVote={side => setCompareVotes(v => side === 'a' ? { ...v, a: v.a + 1 } : { ...v, b: v.b + 1 })}
          running={compareRunning}
          error={compareError}
          result={compareResult}
        />
      )}

      <AgentReviewQueue
        items={reviewQueue}
        selectedId={selectedReviewId}
        onSelect={setSelectedReviewId}
        onAccept={acceptChange}
        onReject={rejectChange}
        locale={locale}
      />
      <DiffPreview item={reviewItem} onAccept={acceptChange} onReject={rejectChange} />

      {assistantTerminalVisible && (
        <div className="assistant-terminal-panel" data-testid="assistant-terminal-panel">
          <div className="assistant-terminal-header">
            <span>PowerShell / Codex</span>
            <button
              type="button"
              className="ai-header-btn"
              aria-label="关闭终端"
              data-testid="assistant-terminal-close"
              onClick={() => setAssistantTerminalVisible(false)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" stroke-linecap="round"/></svg>
            </button>
          </div>
          <Terminal visible={assistantTerminalVisible} termId={terminalId} workspacePath={workspacePath} />
        </div>
      )}

      <div className="ai-input-area">
        <div className="ai-input-toolbar">
          <div className="ai-input-tabs">
            <button
              type="button"
              className={`ai-mode-tab ${agentMode ? 'active' : ''}`}
              aria-label="切换到 Agent"
              data-testid="ai-bottom-agent"
              onClick={() => { setAgentMode(true); setCompareMode(false); }}
            >
              Agent
            </button>
            <button
              type="button"
              className={`ai-mode-tab ${plannerMode ? 'active' : ''}`}
              aria-label="计划模式"
              data-testid="ai-plan-mode"
              onClick={() => setPlannerMode(value => !value)}
            >
              Plan
            </button>
            <button
              type="button"
              className={`ai-mode-tab ${!agentMode ? 'active' : ''}`}
              aria-label="切换到 Chat"
              data-testid="ai-bottom-chat"
              onClick={() => { setAgentMode(false); setCompareMode(false); }}
            >
              Chat
            </button>
            <button
              type="button"
              className={`ai-mode-tab ${compareMode ? 'active' : ''}`}
              aria-label="多模型对比"
              data-testid="ai-compare-tab"
              onClick={() => { setCompareMode(v => !v); if (!compareMode) setAgentMode(false); }}
            >
              对比
            </button>
          </div>

          {compareMode ? (
            <div className="ai-compare-selects">
              <select
                className="ai-model-select"
                value={compareModelA}
                aria-label="对比模型 A"
                data-testid="ai-compare-model-a"
                onChange={event => setCompareModelA(event.target.value)}
              >
                <option value="">模型 A…</option>
                {modelOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="ai-compare-vs">VS</span>
              <select
                className="ai-model-select"
                value={compareModelB}
                aria-label="对比模型 B"
                data-testid="ai-compare-model-b"
                onChange={event => setCompareModelB(event.target.value)}
              >
                <option value="">模型 B…</option>
                {modelOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <select
              className="ai-model-select"
              value={selectedCliAgent ? `cli:${selectedCliAgent.id}` : modelValue}
              aria-label="选择模型或 CLI Agent"
              data-testid="ai-model-select"
              onChange={event => {
                const value = event.target.value;
                if (value.startsWith('cli:')) {
                  setSelectedCliAgentId(value.slice(4));
                  return;
                }
                setSelectedCliAgentId('builtin');
                switchModel(value);
              }}
            >
              {modelOptions.length === 0 && (
                <option value="">请先在设置中填写 API Key 并勾选模型</option>
              )}
              {groupedModelOptions.map(([providerName, options]) => (
                <optgroup key={providerName} label={providerName}>
                  {options.map(option => (
                    <option key={option.value} value={option.value}>{option.model}</option>
                  ))}
                </optgroup>
              ))}
              {cliAgents.filter(agent => agent.installed).map(agent => (
                <option key={agent.id} value={`cli:${agent.id}`}>{agent.name} CLI</option>
              ))}
            </select>
          )}
        </div>

        {showSkills && (
          <div className="ai-skills-popover" data-testid="ai-skills-popover">
            {skills.slice(0, 16).map(skill => (
              <button
                key={skill.id}
                type="button"
                className={`ai-skill-item ${activeSkillId === skill.id ? 'active' : ''}`}
                aria-label={`使用技能 ${skill.name}`}
                data-testid={`ai-skill-${skill.id}`}
                onClick={() => applySkillPrompt(skill)}
              >
                <span>{skill.icon}</span>
                <strong>{skill.name}</strong>
                <small>{skill.description}</small>
              </button>
            ))}
          </div>
        )}

        <div className="ai-input-wrapper">
          {mention.open && (
            <div className="ai-mention-popover" role="listbox" aria-label="引用文件或符号">
              <div className="ai-mention-header">
                <span className="ai-mention-title">
                  {mention.type === 'codebase' ? '🔍 代码库符号（语义检索）' : '📄 引用文件'}
                </span>
                <span className="ai-mention-count">↑↓ 选择 · Enter 确认 · Esc 取消</span>
              </div>
              {mention.results.length === 0 ? (
                <div className="ai-mention-empty">
                  {mention.type === 'codebase'
                    ? (mention.query ? '正在搜索符号...' : '输入 @codebase 后跟查询词进行语义检索')
                    : (mention.query ? '无匹配文件' : '开始输入以搜索文件')}
                </div>
              ) : (
                mention.results.map((r, idx) => (
                  <div
                    key={`${r.path}-${idx}`}
                    className={`ai-mention-item ${idx === mention.selectedIdx ? 'active' : ''}`}
                    role="option"
                    aria-selected={idx === mention.selectedIdx}
                    onMouseEnter={() => setMention(m => ({ ...m, selectedIdx: idx }))}
                    onMouseDown={(e) => { e.preventDefault(); acceptMention(r); }}
                  >
                    <span className="ai-mention-item-icon">
                      {mention.type === 'codebase' ? 'ƒ' : '📄'}
                    </span>
                    <div className="ai-mention-item-info">
                      <div className="ai-mention-item-name">
                        {r.name}
                        {r.kind && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', fontStyle: 'italic' }}>{r.kind}</span>}
                      </div>
                      <div className="ai-mention-item-path">
                        {r.relativePath}{r.startLine ? `:${r.startLine}` : ''}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="ai-textarea"
            value={input}
            aria-label="Agent 输入"
            data-testid="ai-input"
            placeholder={hasConfiguredModel ? '问 Agent 实现某个功能... (Enter 发送，Shift+Enter 换行，@ 引用文件，@codebase 语义检索)' : '请先在设置里配置 API Key 并勾选模型'}
            onChange={event => {
              setInput(event.target.value);
              detectMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={event => {
              // mention popover 键盘导航
              if (mention.open && mention.results.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMention(m => ({ ...m, selectedIdx: (m.selectedIdx + 1) % m.results.length }));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setMention(m => ({ ...m, selectedIdx: (m.selectedIdx - 1 + m.results.length) % m.results.length }));
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMention(m => ({ ...m, open: false }));
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  acceptMention(mention.results[mention.selectedIdx]);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            onBlur={() => {
              // 延迟关闭，让 popover 的 onClick 有机会触发
              setTimeout(() => setMention(m => ({ ...m, open: false })), 150);
            }}
          />
          <div className="ai-input-actions">
            <button
              type="button"
              className="ai-input-action"
              aria-label="插入已打开文件引用"
              data-testid="ai-attach-open-files"
              onClick={() => {
                const names = openFiles.map(file => `@${file.name}`).join(' ');
                setInput(prev => [prev, names].filter(Boolean).join(' '));
              }}
            >
              @
            </button>
            <button
              type="button"
              className="ai-input-action"
              aria-label="选择技能"
              data-testid="ai-open-skills"
              onClick={() => setShowSkills(value => !value)}
            >
              /
            </button>
            {(loading || (compareMode && compareRunning)) ? (
              <button type="button" className="ai-send-btn stop" aria-label="停止生成" data-testid="ai-stop" onClick={() => (compareMode ? stopCompare() : stopGeneration)}>
                {locale === 'zh-CN' ? '停止' : 'Stop'}
              </button>
            ) : (
              <button type="button" className="ai-send-btn" aria-label="发送给 Agent" data-testid="ai-send" disabled={compareMode ? (!input.trim() || !compareModelA || !compareModelB || compareRunning) : !canSend} onClick={send}>
                {compareMode ? (compareRunning ? '对比中…' : '对比') : (locale === 'zh-CN' ? '发送' : 'Send')}
              </button>
            )}
          </div>
        </div>

        <div className="ai-input-hints">
          <span>Enter 发送</span>
          <span>Shift + Enter 换行</span>
          <span>@ 引用文件</span>
          {usageText && <span>{usageText}</span>}
        </div>
      </div>
    </div>
  );
}

// 性能：App 已把 openFiles 快照防抖为 aiContextFiles，加上 memo 后，输入过程
// 中 AI 面板不再随每次按键重渲染（props 均为稳定引用）。
export default React.memo(AIAgent);
