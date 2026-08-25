/**
 * AI 面板纯函数工具模块（从 AIAgent.tsx 拆出）。
 *
 * 全部为无副作用纯函数：错误文案本地化、会话标题/摘要生成、Agent chunk 归一化、
 * 会话持久化（localStorage）、提及解析等。拆分后每个函数可独立单测，
 * 出问题可直接定位到具体函数。
 */
import { getLocale } from '@/shared/i18n';
import { readJSON, writeJSON } from './storage';

// ---- 消息类型（与 AIAgent.tsx 保持一致的最小视图）----

export interface ChatDisplayMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: { name: string; args: unknown; status: 'pending' | 'running' | 'done' | 'error'; result?: string; expanded?: boolean }[];
  isStreaming?: boolean;
  requestId?: string;
}

export interface AgentChunkDisplay {
  type: 'text' | 'plan' | 'tool_call' | 'tool_result' | 'task_event' | 'error';
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  taskEvent?: {
    type: string;
    command: string;
    args: string[];
    attempt: number;
    data?: string;
    exitCode?: number | null;
    error?: string;
  };
}

export interface AgentTaskEvent {
  type: string;
  command: string;
  args: string[];
  attempt: number;
  data?: string;
  exitCode?: number | null;
  error?: string;
}

// ---- 错误文案本地化 ----

/** 把原始 API 错误转换为本地化、用户友好的文案。 */
export function getLocalizedErrorMessage(rawMessage: string, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  const msg = rawMessage.toLowerCase();

  if (msg.includes('image') && (msg.includes('not support') || msg.includes('unsupported') || msg.includes('cannot read'))) {
    return locale === 'zh-CN'
      ? '❌ 当前模型不支持图片输入。请使用支持视觉的模型（如 GPT-4o、Claude 3.5 Sonnet 等），或移除图片后重试。'
      : '❌ The current model does not support image input. Please use a vision-capable model (e.g., GPT-4o, Claude 3.5 Sonnet) or remove the image and try again.';
  }
  if (msg.includes('api key') && (msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('401'))) {
    return locale === 'zh-CN'
      ? '❌ API Key 无效或已过期。请在设置中检查并更新您的 API Key。'
      : '❌ API Key is invalid or expired. Please check and update your API Key in Settings.';
  }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return locale === 'zh-CN'
      ? '❌ 请求过于频繁，已触发速率限制。请稍后再试。'
      : '❌ Too many requests. Rate limit exceeded. Please try again later.';
  }
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return locale === 'zh-CN'
      ? '❌ 网络连接失败。请检查您的网络连接后重试。'
      : '❌ Network connection failed. Please check your internet connection and try again.';
  }
  if (msg.includes('context') && (msg.includes('exceed') || msg.includes('too long') || msg.includes('maximum') || msg.includes('token'))) {
    return locale === 'zh-CN'
      ? '❌ 输入内容超过了模型的最大上下文长度。请减少输入内容或使用支持更长上下文的模型。'
      : '❌ Input exceeds the model maximum context length. Please reduce input or use a model with longer context support.';
  }
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid'))) {
    return locale === 'zh-CN'
      ? '❌ 模型不存在或无法访问。请在设置中检查模型配置。'
      : '❌ Model not found or inaccessible. Please check model settings.';
  }
  return rawMessage;
}

// ---- Agent chunk 归一化 ----

export function normalizeChunk(chunk: unknown): AgentChunkDisplay {
  if (typeof chunk === 'string') return { type: 'text', content: chunk };
  if (chunk && typeof chunk === 'object') return chunk as AgentChunkDisplay;
  return { type: 'text', content: String(chunk ?? '') };
}

// ---- 任务事件渲染 ----

export function renderTaskEvent(event?: AgentTaskEvent): string {
  if (!event) return '';
  const command = [event.command, ...(event.args || [])].join(' ').trim();
  if (event.type === 'stdout' || event.type === 'stderr') return event.data || '';
  if (event.type === 'exit') return `Command finished (${event.exitCode ?? 'unknown'}): ${command}`;
  if (event.type === 'error') return `Command failed: ${event.error || command}`;
  if (event.type === 'cancelled') return `Command cancelled: ${command}`;
  if (event.type === 'retry') return `Command retry queued: ${command}`;
  return `Command ${event.type}: ${command}`;
}

// ---- 会话标题 / 摘要 ----

export function makeSessionTitle(messages: ChatDisplayMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')?.content || 'New chat';
  return firstUser.replace(/\s+/g, ' ').trim().slice(0, 48) || 'New chat';
}

export function makeSessionPreview(messages: ChatDisplayMessage[]): string {
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')?.content || '';
  return cleanAssistantDisplayText(lastAssistant).replace(/\s+/g, ' ').trim().slice(0, 96);
}

export function cleanAssistantDisplayText(content: string): string {
  return content
    .replace(/(?:^|\n)\s*(?:Using|Calling) tool:\s*[A-Za-z0-9_-]+\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

// ---- 会话持久化（localStorage，上限 40 条）----

export const CHAT_HISTORY_KEY = 'loom:ai-chat-history';
export const CHAT_HISTORY_MAX = 40;

export function loadChatSessions<T>(): T[] {
  const parsed = readJSON<unknown>(CHAT_HISTORY_KEY, []);
  return Array.isArray(parsed) ? (parsed as T[]).slice(0, CHAT_HISTORY_MAX) : [];
}

export function saveChatSessions<T>(sessions: T[]) {
  writeJSON(CHAT_HISTORY_KEY, sessions.slice(0, CHAT_HISTORY_MAX));
}

// ---- 工具函数 ----

export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export function createReviewId(filePath: string): string {
  return filePath.replace(/[\\/:\s]+/g, '-').toLowerCase();
}

/** 打开文件上下文压缩：最多 6 个文件、每文件前 12000 字符。 */
export function compactContext(
  openFiles: { path: string; name: string; content: string }[],
  workspaceRules?: string,
): string {
  const fileContext = (openFiles || [])
    .slice(0, 6)
    .map(file => `File: ${file.path}\n${file.content.slice(0, 12000)}`)
    .join('\n\n---\n\n');
  return [
    workspaceRules ? `Workspace rules:\n${workspaceRules}` : '',
    fileContext ? `Open files:\n${fileContext}` : '',
  ].filter(Boolean).join('\n\n');
}

/** 当前界面语言（供非组件代码使用）。 */
export function currentLocale(): 'zh-CN' | 'en-US' {
  return getLocale() as 'zh-CN' | 'en-US';
}
