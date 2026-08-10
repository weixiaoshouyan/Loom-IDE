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
import {
  approvePlan,
  cancelTask,
  createAgentTaskState,
  failTask,
  receivePlan,
  startPlanning,
} from '../agent-task-state';
import { buildCodexTerminalInput } from '../assistant-panel';
import { formatUsage } from '../ai-usage';
import AgentPlanApproval from './AgentPlanApproval';
import { AgentMessageItem, AgentRunStatus } from './AgentMessageItem';
import AgentReviewQueue from './AgentReviewQueue';
import AgentTaskCenter from './AgentTaskCenter';
import AgentHistoryPanel from './AgentHistoryPanel';
import AgentComparePanel from './AgentComparePanel';
import Terminal from './Terminal';
import { getLoom } from '../loom-ipc';
import { getLocale } from '@/shared/i18n';

// Token 用量 / 成本估算已抽到 ../ai-usage（formatUsage / estimateRates）。

/**
 * Convert raw API error messages into localized, user-friendly messages.
 */
function getLocalizedErrorMessage(rawMessage: string, locale: 'zh-CN' | 'en-US'): string {
  const msg = rawMessage.toLowerCase();

  // Image input not supported
  if (msg.includes('image') && (msg.includes('not support') || msg.includes('unsupported') || msg.includes('cannot read'))) {
    return locale === 'zh-CN'
      ? '❌ 当前模型不支持图片输入。请使用支持视觉的模型（如 GPT-4o、Claude 3.5 Sonnet 等），或移除图片后重试。'
      : '❌ The current model does not support image input. Please use a vision-capable model (e.g., GPT-4o, Claude 3.5 Sonnet) or remove the image and try again.';
  }

  // API key issues
  if (msg.includes('api key') && (msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('401'))) {
    return locale === 'zh-CN'
      ? '❌ API Key 无效或已过期。请在设置中检查并更新您的 API Key。'
      : '❌ API Key is invalid or expired. Please check and update your API Key in Settings.';
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return locale === 'zh-CN'
      ? '❌ 请求过于频繁，已触发速率限制。请稍后再试。'
      : '❌ Too many requests. Rate limit exceeded. Please try again later.';
  }

  // Network errors
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return locale === 'zh-CN'
      ? '❌ 网络连接失败。请检查您的网络连接后重试。'
      : '❌ Network connection failed. Please check your internet connection and try again.';
  }

  // Context length exceeded
  if (msg.includes('context') && (msg.includes('exceed') || msg.includes('too long') || msg.includes('maximum') || msg.includes('token'))) {
    return locale === 'zh-CN'
      ? '❌ 输入内容超过了模型的最大上下文长度。请减少输入内容或使用支持更长上下文的模型。'
      : '❌ Input exceeds the model maximum context length. Please reduce input or use a model with longer context support.';
  }

  // Model not found
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid'))) {
    return locale === 'zh-CN'
      ? '❌ 模型不存在或无法访问。请在设置中检查模型配置。'
      : '❌ Model not found or inaccessible. Please check model settings.';
  }

  // Fallback: return original message
  return rawMessage;
}

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

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCallDisplay[];
  attachedFiles?: { path: string; name: string; content: string }[];
  isStreaming?: boolean;
  requestId?: string;
}

interface ToolCallDisplay {
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
    type: 'queued' | 'started' | 'stdout' | 'stderr' | 'exit' | 'error' | 'retry' | 'cancelled';
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

const CHAT_HISTORY_KEY = 'loom:ai-chat-history';

function normalizeChunk(chunk: unknown): AgentChunk {
  if (typeof chunk === 'string') return { type: 'text', content: chunk };
  if (chunk && typeof chunk === 'object') return chunk as AgentChunk;
  return { type: 'text', content: String(chunk ?? '') };
}

function compactContext(openFiles: Props['openFiles'], workspaceRules?: string): string {
  const fileContext = (openFiles || [])
    .slice(0, 6)
    .map(file => `File: ${file.path}\n${file.content.slice(0, 12000)}`)
    .join('\n\n---\n\n');
  return [
    workspaceRules ? `Workspace rules:\n${workspaceRules}` : '',
    fileContext ? `Open files:\n${fileContext}` : '',
  ].filter(Boolean).join('\n\n');
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function createReviewId(filePath: string): string {
  return filePath.replace(/[\\/:\s]+/g, '-').toLowerCase();
}

function cleanAssistantDisplayText(content: string): string {
  return content
    .replace(/(?:^|\n)\s*(?:Using|Calling) tool:\s*[A-Za-z0-9_-]+\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

function makeSessionTitle(messages: Message[]): string {
  const firstUser = messages.find(message => message.role === 'user')?.content || 'New chat';
  return firstUser.replace(/\s+/g, ' ').trim().slice(0, 48) || 'New chat';
}

function makeSessionPreview(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant')?.content || '';
  return cleanAssistantDisplayText(lastAssistant).replace(/\s+/g, ' ').trim().slice(0, 96);
}

function loadChatSessions(): ChatSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function saveChatSessions(sessions: ChatSession[]) {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sessions.slice(0, 40)));
}

function renderTaskEvent(event: AgentChunk['taskEvent']): string {
  if (!event) return '';
  const command = [event.command, ...(event.args || [])].join(' ').trim();
  if (event.type === 'stdout' || event.type === 'stderr') return event.data || '';
  if (event.type === 'exit') return `Command finished (${event.exitCode ?? 'unknown'}): ${command}`;
  if (event.type === 'error') return `Command failed: ${event.error || command}`;
  if (event.type === 'cancelled') return `Command cancelled: ${command}`;
  if (event.type === 'retry') return `Command retry queued: ${command}`;
  return `Command ${event.type}: ${command}`;
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

export default function AIAgent({
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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
  const [reviewQueue, setReviewQueue] = useState<AgentReviewItem[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [agentTask, setAgentTask] = useState(createAgentTaskState());
  const [assistantTerminalVisible, setAssistantTerminalVisible] = useState(false);
  const [usageText, setUsageText] = useState('');

  // 多模型对比 / 投票
  const [compareMode, setCompareMode] = useState(false);
  const [compareModelA, setCompareModelA] = useState('');
  const [compareModelB, setCompareModelB] = useState('');
  const [compareResult, setCompareResult] = useState<{ a: { text: string; usage: any }; b: { text: string; usage: any } } | null>(null);
  const [compareError, setCompareError] = useState('');
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareVotes, setCompareVotes] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const labelOf = (value: string) => modelOptions.find((o: ModelOption) => o.value === value)?.label || value;
  const abortRef = useRef<null | (() => void)>(null);
  const compareAbortRef = useRef<{ a?: () => void; b?: () => void }>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentSessionIdRef = useRef<string>(crypto.randomUUID());
  const pendingPlanStreamIdRef = useRef<string | null>(null);
  // 当前 agent 流 id（onFilePreview 回调透传），用于拒绝尚未落盘的修改
  const currentStreamIdRef = useRef<string | null>(null);
  // 当前运行中的消息 requestId：停止生成时也要把 isStreaming 复位，否则
  // 消息永久悬挂在流式样式且历史会话永不落盘。
  const currentRequestIdRef = useRef<string | null>(null);
  // 最新 send 引用：状态条「继续」按钮在 setInput 之后调用，需要拿到新闭包。
  const sendRef = useRef<() => void>(() => {});
  // 破坏性操作（delete/rename）等待用户审批
  const [pendingDestructive, setPendingDestructive] = useState<{
    request: { type: 'delete' | 'rename'; filePath: string; newPath?: string };
    sid: string;
  } | null>(null);
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

  useEffect(() => {
    if (!showTaskCenter && !loading) return undefined;
    const timer = window.setInterval(refreshAgentTasks, 1500);
    return () => window.clearInterval(timer);
  }, [showTaskCenter, loading, refreshAgentTasks]);

  useEffect(() => {
    return () => abortRef.current?.();
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

  const hasConfiguredModel = Boolean(modelOptions.length > 0 || selectedCliAgent);
  const canSend = input.trim().length > 0 && !loading && hasConfiguredModel;
  const reviewItem = selectedReview(reviewQueue, selectedReviewId);

  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message, type } }));
  }, []);

  const appendAssistantChunk = useCallback((requestId: string, chunk: string) => {
    const visibleChunk = cleanAssistantDisplayText(chunk);
    if (!visibleChunk) return;
    setMessages(prev => prev.map(message => (
      message.requestId === requestId
        ? { ...message, content: message.content + visibleChunk, isStreaming: true }
        : message
    )));
  }, []);

  const updateLastToolCall = useCallback((requestId: string, patch: Partial<ToolCallDisplay>) => {
    setMessages(prev => prev.map(message => {
      if (message.requestId !== requestId) return message;
      const toolCalls = [...(message.toolCalls || [])];
      if (toolCalls.length === 0) return message;
      toolCalls[toolCalls.length - 1] = { ...toolCalls[toolCalls.length - 1], ...patch };
      return { ...message, toolCalls };
    }));
  }, []);

  const addToolCall = useCallback((requestId: string, toolCall: ToolCallDisplay) => {
    setMessages(prev => prev.map(message => (
      message.requestId === requestId
        ? { ...message, toolCalls: [...(message.toolCalls || []), toolCall] }
        : message
    )));
  }, []);

  const finishAssistantMessage = useCallback((requestId: string) => {
    setMessages(prev => prev.map(message => (
      message.requestId === requestId ? { ...message, isStreaming: false } : message
    )));
  }, []);

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
    setAgentTask(prev => ({ ...prev, status: 'reviewing' }));
  }, []);

  const acceptChange = useCallback((id: string) => {
    const item = reviewQueue.find(entry => entry.id === id);
    if (item && item.status === 'pending') {
      onApplyEdit?.(item.filePath, item.modified);
      onOpenFile?.(item.filePath, item.modified);
      notify(`已接受 ${basename(item.filePath)}`, 'success');
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
      notify(`已拒绝 ${basename(item.filePath)}，但该修改可能已写入磁盘，请按 Ctrl+Z 手动撤销`, 'info');
    } else {
      notify(`已拒绝 ${basename(item.filePath)}，agent 将跳过该修改`, 'info');
    }
    setReviewQueue(prev => rejectReviewItem(prev, id));
  }, [notify, reviewQueue]);

  const handleAgentChunk = useCallback((requestId: string, rawChunk: unknown) => {
    const chunk = normalizeChunk(rawChunk);
    if (chunk.type === 'text') {
      appendAssistantChunk(requestId, chunk.content || '');
      return;
    }
    if (chunk.type === 'plan') {
      setAgentTask(prev => receivePlan(prev, chunk.content || ''));
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
      updateLastToolCall(requestId, {
        status: 'done',
        result: chunk.content || '',
      });
      return;
    }
    if (chunk.type === 'task_event') {
      const eventText = renderTaskEvent(chunk.taskEvent);
      if (eventText) {
        addToolCall(requestId, {
          name: `PowerShell ${chunk.taskEvent?.type || ''}`.trim(),
          args: {
            command: chunk.taskEvent ? [chunk.taskEvent.command, ...(chunk.taskEvent.args || [])].join(' ') : '',
            attempt: chunk.taskEvent?.attempt,
          },
          status: chunk.taskEvent?.type === 'error' ? 'error' : chunk.taskEvent?.type === 'exit' ? 'done' : 'running',
          result: eventText,
          expanded: false,
        });
      }
      refreshAgentTasks();
      return;
    }
    if (chunk.type === 'error') {
      setAgentTask(prev => failTask(prev, chunk.content || 'Agent failed'));
      appendAssistantChunk(requestId, `\n\n${chunk.content || 'Agent failed'}`);
    }
  }, [addToolCall, appendAssistantChunk, refreshAgentTasks, updateLastToolCall]);

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

  const send = useCallback(async () => {
    if (compareMode) {
      runCompare();
      return;
    }
    const prompt = input.trim();
    if (!prompt || loading) return;

    const requestId = crypto.randomUUID();
    currentRequestIdRef.current = requestId;
    const attachedFiles = [...openFiles];
    const userMessage: Message = { role: 'user', content: prompt, attachedFiles };
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [],
      isStreaming: true,
      requestId,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    setLoading(true);
    setUsageText('');
    setAgentTask(prev => agentMode ? startPlanning(prev) : { ...prev, status: 'running', error: null });

    // 解析输入中的 @relativePath 引用：读取文件内容加入 context。
    // 解析 @codebase path:symbol 引用：读取符号文本加入 context。
    // 这让用户能精确控制 AI 看哪些代码，而不只是依赖「打开文件」。
    const mentionContext = await (async (): Promise<string> => {
      const parts: string[] = [];
      // @relativePath 文件引用（排除 @codebase）
      const fileMentions = prompt.match(/(?:^|\s)@(?!codebase\b)([\w./\\-]+\.\w+)/g) || [];
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
      // @codebase path:symbol 引用
      const codebaseMentions = prompt.match(/@codebase\s+([\w./\\-]+)(?::(\d+))?/g) || [];
      for (const m of codebaseMentions) {
        const match = m.match(/@codebase\s+([\w./\\-]+)(?::(\d+))?/);
        if (!match) continue;
        const rel = match[1];
        const line = match[2] ? parseInt(match[2], 10) : undefined;
        const fullPath = workspacePath ? `${workspacePath}/${rel}`.replace(/\\/g, '/') : rel;
        try {
          const content = await window.loom?.fs?.readFile?.(fullPath);
          if (typeof content === 'string' && !content.startsWith('__ERR__:')) {
            if (line) {
              // 提取符号附近的代码（前后 40 行）
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
      prompt,
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
          appendAssistantChunk(requestId, stderr || `CLI Agent 失败（退出码 ${result?.exitCode}）`);
          setAgentTask(prev => failTask(prev, stderr || `CLI Agent failed: ${result.exitCode}`));
        } else {
          appendAssistantChunk(requestId, stdout || 'CLI Agent 已完成，但没有输出。');
          setAgentTask(prev => ({ ...prev, status: 'completed' }));
        }
        // CRITICAL FIX: the CLI path previously never reset loading — the UI
        // spun forever and no further messages could be sent.
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
            setAgentTask(prev => prev.status === 'running' || prev.status === 'planning'
              ? { ...prev, status: 'completed' }
              : prev);
            if (usage) setUsageText(formatUsage(usage, activeProvider?.activeModel));
            abortRef.current = null;
            pendingPlanStreamIdRef.current = null;
            setPendingDestructive(null);
            currentRequestIdRef.current = null;
            refreshAgentTasks();
          },
          (error: Error) => {
            const errorMsg = getLocalizedErrorMessage(error.message, getLocale() as 'zh-CN' | 'en-US');
            appendAssistantChunk(requestId, `\n\n${errorMsg}`);
            finishAssistantMessage(requestId);
            setLoading(false);
            setAgentTask(prev => failTask(prev, errorMsg));
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
            // 主进程已暂停 agent，等待用户在 UI 上确认/拒绝
            pendingPlanStreamIdRef.current = sid;
          },
          (request: { type: 'delete' | 'rename'; filePath: string; newPath?: string }, sid: string) => {
            // 主进程已暂停 agent 的 delete/rename 工具，等待用户审批
            setPendingDestructive({ request, sid });
          },
          {
            previewFileWrites: true,
            autoApplySafeEdits,
            plannerMode,
            verifyMode,
            // 已激活的 skill 注入 agent system prompt
            activeSkillId: activeSkillId || undefined,
            // planner 模式语义为「先出计划→等待审批→再执行」，故 planOnly 必须为 false，
            // 否则 ai-engine 会在输出 plan 后立即 return，审批链路（planApproval）变为死代码。
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
            setAgentTask(prev => ({ ...prev, status: 'completed' }));
            abortRef.current = null;
          },
          (error: Error) => {
            const errorMsg = getLocalizedErrorMessage(error.message, getLocale() as 'zh-CN' | 'en-US');
            appendAssistantChunk(requestId, `\n\n${errorMsg}`);
            finishAssistantMessage(requestId);
            setLoading(false);
            setAgentTask(prev => failTask(prev, errorMsg));
            abortRef.current = null;
          },
          (usage: { input: number; output: number }) => {
            setUsageText(formatUsage(usage, activeProvider?.activeModel));
          },
        );
      }
    } catch (error: any) {
      appendAssistantChunk(requestId, error?.message || 'Agent request failed');
      finishAssistantMessage(requestId);
      setLoading(false);
      setAgentTask(prev => failTask(prev, error?.message || 'Agent request failed'));
    }
  }, [
    addReview,
    agentMode,
    appendAssistantChunk,
    autoApplySafeEdits,
    compareMode,
    finishAssistantMessage,
    handleAgentChunk,
    input,
    loading,
    messages,
    openFiles,
    plannerMode,
    refreshAgentTasks,
    runCompare,
    selectedCliAgent,
    workspacePath,
    workspaceRules,
  ]);

  // 保持 sendRef 指向最新 send 闭包（「继续」按钮等场景需要新 input 值）。
  useEffect(() => { sendRef.current = send; });

  // 运行结束后一键继续：以当前对话历史再发一轮。
  const continueAgent = useCallback(() => {
    if (loading) return;
    setInput(locale === 'zh-CN' ? '继续' : 'Continue');
    setTimeout(() => sendRef.current(), 0);
  }, [loading, locale]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setLoading(false);
    setAgentTask(prev => cancelTask(prev));
    // 停止时同步复位流式状态，避免消息永久悬挂（isStreaming 不落盘、样式残留）。
    const rid = currentRequestIdRef.current;
    if (rid) finishAssistantMessage(rid);
    currentRequestIdRef.current = null;
  }, [finishAssistantMessage]);

  const startNewChat = useCallback(() => {
    stopGeneration();
    currentSessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setReviewQueue([]);
    setSelectedReviewId(null);
    setAgentTask(createAgentTaskState());
    setUsageText('');
  }, [stopGeneration]);

  const restoreChatSession = useCallback((session: ChatSession) => {
    stopGeneration();
    currentSessionIdRef.current = session.id;
    setMessages(session.messages || []);
    setReviewQueue([]);
    setSelectedReviewId(null);
    setAgentTask(createAgentTaskState());
    setUsageText('');
    setShowHistory(false);
  }, [stopGeneration]);

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
    setAgentTask(prev => approvePlan(prev));
    setPlannerMode(false);
    notify('计划已确认，可以继续执行。', 'success');
  }, [notify]);

  const rejectCurrentPlan = useCallback(() => {
    const sid = pendingPlanStreamIdRef.current;
    if (sid) {
      getLoom()?.ai?.rejectPlan(sid);
      pendingPlanStreamIdRef.current = null;
    }
    setAgentTask(prev => cancelTask(prev));
  }, []);

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

      <AgentPlanApproval task={agentTask} onApprove={approveCurrentPlan} onCancel={rejectCurrentPlan} locale={locale} />

      <AgentRunStatus
        task={agentTask}
        usageText={usageText}
        toolCount={messages.reduce((n, m) => n + (m.toolCalls?.length || 0), 0)}
        locale={locale}
        onContinue={continueAgent}
      />

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
