/**
 * Loom AI Engine - Independent AI agent system
 * Supports any OpenAI-compatible API provider directly (no proxy dependency)
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  activeModel: string;
  headers?: Record<string, string>;
  isCustom: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  icon: string;
}

export type AIEngineMode = 'orca' | 'builtin';

export interface AIConfig {
  providers: AIProvider[];
  activeProviderId: string;
  profiles: AgentProfile[];
  activeProfileId: string;
  streamEnabled: boolean;
  mode: AIEngineMode;
  orcaBaseUrl: string;
}

const DEFAULT_PROVIDERS: AIProvider[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'], activeModel: 'gpt-4o', isCustom: false },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'], activeModel: 'deepseek-chat', isCustom: false },
  { id: 'anthropic', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', apiKey: '', models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'], activeModel: 'claude-sonnet-4-20250514', isCustom: false, headers: { 'anthropic-version': '2023-06-01' } },
  { id: 'dashscope', name: 'Tongyi Qianwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'], activeModel: 'qwen-plus', isCustom: false },
  { id: 'zhipu', name: 'Zhipu GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', models: ['glm-4', 'glm-4-flash', 'glm-4-plus'], activeModel: 'glm-4-flash', isCustom: false },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], activeModel: 'moonshot-v1-8k', isCustom: false },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: '', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Meta-Llama-3.1-70B-Instruct'], activeModel: 'deepseek-ai/DeepSeek-V3', isCustom: false },
  { id: 'doubao', name: 'Doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', models: ['doubao-pro-256k', 'doubao-pro-128k', 'doubao-lite-128k'], activeModel: 'doubao-pro-128k', isCustom: false },
  { id: 'yi', name: 'Yi / Lingyiwanwu', baseUrl: 'https://api.lingyiwanwu.com/v1', apiKey: '', models: ['yi-large', 'yi-medium', 'yi-spark'], activeModel: 'yi-large', isCustom: false },
  { id: 'custom', name: 'Custom Provider', baseUrl: '', apiKey: '', models: [], activeModel: '', isCustom: true },
];

const DEFAULT_PROFILES: AgentProfile[] = [
  { id: 'coder', name: 'Code Assistant', systemPrompt: 'You are an expert programming assistant. Help users write, debug, review, and optimize code. Provide clear explanations with code examples. Always respond in the same language as the user.', providerId: '', model: '', temperature: 0.3, maxTokens: 4096, icon: '💻' },
  { id: 'reviewer', name: 'Code Reviewer', systemPrompt: 'You are a senior code reviewer. Analyze code for bugs, security issues, performance problems, and style violations. Provide actionable suggestions with improved code examples.', providerId: '', model: '', temperature: 0.2, maxTokens: 4096, icon: '🔍' },
  { id: 'architect', name: 'Architect', systemPrompt: 'You are a software architect. Help with system design, architecture decisions, design patterns, and technical trade-offs. Think broadly about scalability, maintainability, and team workflow.', providerId: '', model: '', temperature: 0.4, maxTokens: 4096, icon: '🏗️' },
  { id: 'teacher', name: 'Teacher', systemPrompt: 'You are a patient programming teacher. Explain concepts clearly with analogies and examples. Break down complex topics into digestible steps. Encourage learning by doing.', providerId: '', model: '', temperature: 0.5, maxTokens: 4096, icon: '📚' },
  { id: 'general', name: 'General Assistant', systemPrompt: 'You are a helpful AI assistant. Answer questions accurately and concisely. When working with code, follow best practices and explain your reasoning.', providerId: '', model: '', temperature: 0.7, maxTokens: 4096, icon: '🤖' },
];

import { getToolSystemPrompt, executeToolCall, parseToolCalls, stripToolCalls, ToolExecutionContext, AGENT_TOOLS } from './agent-tools';

// Convert tools to OpenAI function format
const AGENT_TOOLS_OPENAI = AGENT_TOOLS.map(t => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

export class AIEngine {
  private config: AIConfig;
  private onUpdate?: (config: AIConfig) => void;

  constructor(savedConfig?: Partial<AIConfig>) {
    this.config = {
      providers: savedConfig?.providers || DEFAULT_PROVIDERS,
      activeProviderId: savedConfig?.activeProviderId || 'deepseek',
      profiles: savedConfig?.profiles || DEFAULT_PROFILES,
      activeProfileId: savedConfig?.activeProfileId || 'coder',
      streamEnabled: savedConfig?.streamEnabled ?? true,
      mode: savedConfig?.mode || 'orca',
      orcaBaseUrl: savedConfig?.orcaBaseUrl || 'http://127.0.0.1:18080',
    };
  }

  onUpdateConfig(cb: (config: AIConfig) => void) { this.onUpdate = cb; }

  getConfig(): AIConfig { return { ...this.config }; }

  updateConfig(patch: Partial<AIConfig>) {
    this.config = { ...this.config, ...patch };
    this.onUpdate?.(this.config);
  }

  getActiveProvider(): AIProvider | undefined {
    return this.config.providers.find(p => p.id === this.config.activeProviderId);
  }

  getActiveProfile(): AgentProfile | undefined {
    return this.config.profiles.find(p => p.id === this.config.activeProfileId);
  }

  updateProvider(id: string, patch: Partial<AIProvider>) {
    this.config.providers = this.config.providers.map(p => p.id === id ? { ...p, ...patch } : p);
    this.onUpdate?.(this.config);
  }

  addProvider(provider: AIProvider) {
    this.config.providers = [...this.config.providers, provider];
    this.onUpdate?.(this.config);
  }

  removeProvider(id: string) {
    this.config.providers = this.config.providers.filter(p => p.id !== id);
    this.onUpdate?.(this.config);
  }

  updateProfile(id: string, patch: Partial<AgentProfile>) {
    this.config.profiles = this.config.profiles.map(p => p.id === id ? { ...p, ...patch } : p);
    this.onUpdate?.(this.config);
  }

  addProfile(profile: AgentProfile) {
    this.config.profiles = [...this.config.profiles, profile];
    this.onUpdate?.(this.config);
  }

  removeProfile(id: string) {
    this.config.profiles = this.config.profiles.filter(p => p.id !== id);
    this.onUpdate?.(this.config);
  }

  async testConnection(providerId: string): Promise<{ ok: boolean; msg: string }> {
    const provider = this.config.providers.find(p => p.id === providerId);
    if (!provider) return { ok: false, msg: 'Provider not found' };
    if (!provider.apiKey) return { ok: false, msg: 'API key not set' };
    try {
      const resp = await fetch(`${provider.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${provider.apiKey}`, ...(provider.headers || {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { ok: false, msg: `HTTP ${resp.status}: ${resp.statusText}` };
      return { ok: true, msg: `Connected to ${provider.name}` };
    } catch (e: any) {
      return { ok: false, msg: e.message || 'Connection failed' };
    }
  }

  async checkOrcaStatus(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const resp = await fetch(`${this.config.orcaBaseUrl}/api/status`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const data = await resp.json() as any;
      return { ok: true, version: data.version };
    } catch (e: any) {
      return { ok: false, error: e.message || 'Connection failed' };
    }
  }

  async getOrcaProviders(): Promise<any[]> {
    try {
      const resp = await fetch(`${this.config.orcaBaseUrl}/api/providers`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return [];
      return await resp.json() as any[];
    } catch { return []; }
  }

  // ====== Agent Mode with Tool Calling ======

  /**
   * Agent chat with tool-calling loop.
   * The AI can call tools (read_file, write_file, edit_file, search_code, etc.)
   * to autonomously solve coding tasks.
   */
  async *agentChatStream(
    messages: ChatMessage[],
    toolContext: ToolExecutionContext,
    maxToolRounds: number = 10
  ): AsyncGenerator<{ type: 'text' | 'tool_call' | 'tool_result' | 'error'; content: string; toolName?: string; toolArgs?: any }> {
    const provider = this.getActiveProvider();
    const profile = this.getActiveProfile();

    if (!provider || !provider.apiKey) {
      yield { type: 'error', content: 'Error: No API key configured. Go to Settings > AI Providers to set up.' };
      return;
    }

    const systemPrompt = (profile?.systemPrompt || 'You are a helpful coding assistant.') +
      getToolSystemPrompt() +
      `\n\nCurrent workspace: ${toolContext.workspacePath || 'No workspace open'}`;

    const conversation: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    for (let round = 0; round < maxToolRounds; round++) {
      const isAnthropic = provider.id === 'anthropic';
      // Build conversation for API - Anthropic needs special handling
      let apiMessages: any[];
      
      if (isAnthropic) {
        const nonSystem = conversation.filter(m => m.role !== 'system');
        apiMessages = [];
        for (const m of nonSystem) {
          if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
            const textContent = m.content || '';
            apiMessages.push({
              role: 'assistant',
              content: [
                ...(textContent ? [{ type: 'text', text: textContent }] : []),
                ...m.tool_calls.map(tc => ({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: JSON.parse(tc.function.arguments),
                })),
              ],
            });
          } else if (m.role === 'tool') {
            apiMessages.push({
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: m.tool_call_id,
                content: m.content,
              }],
            });
          } else {
            apiMessages.push({ role: m.role, content: m.content });
          }
        }
      } else {
        apiMessages = conversation.filter(m => m.role !== 'system');
      }

      const body: any = {
        model: provider.activeModel || provider.models[0],
        messages: isAnthropic ? apiMessages : conversation,
        max_tokens: profile?.maxTokens || 4096,
        temperature: profile?.temperature || 0.7,
        stream: false,
        tools: AGENT_TOOLS_OPENAI,
        tool_choice: 'auto',
      };

      // Add system prompt for Anthropic separately
      if (isAnthropic) {
        const sysContent = conversation.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        body.system = sysContent;
        // For Anthropic, remove tool_choice
        delete body.tool_choice;
      }

      const url = isAnthropic ? `${provider.baseUrl}/messages` : `${provider.baseUrl}/chat/completions`;

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
            ...(provider.headers || {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          yield { type: 'error', content: `HTTP ${resp.status}: ${errText.substring(0, 300)}` };
          return;
        }

        const data = await resp.json() as any;
        
        let assistantContent = '';
        let toolCalls: any[] = [];

        if (isAnthropic) {
          // Anthropic format
          const contentBlocks = data.content || [];
          for (const block of contentBlocks) {
            if (block.type === 'text') assistantContent += block.text;
            if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: JSON.stringify(block.input) },
              });
            }
          }
        } else {
          const choice = data.choices?.[0]?.message;
          assistantContent = choice?.content || '';
          toolCalls = choice?.tool_calls || [];
        }

        // Parse tool calls from text if API doesn't support native tool calling
        if (toolCalls.length === 0 && assistantContent) {
          const parsedCalls = parseToolCalls(assistantContent);
          if (parsedCalls.length > 0) {
            toolCalls = parsedCalls;
          }
        }

        if (assistantContent) {
          const cleanContent = stripToolCalls(assistantContent);
          if (cleanContent) {
            yield { type: 'text', content: cleanContent };
          }
        }

        if (toolCalls.length === 0) {
          // No tool calls, conversation complete
          return;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          const toolName = tc.function?.name || tc.name;
          const toolArgs = tc.function?.arguments 
            ? (typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments))
            : '{}';

          let parsedToolArgs: any;
          try {
            parsedToolArgs = JSON.parse(typeof toolArgs === 'string' ? toolArgs : toolArgs);
          } catch {
            parsedToolArgs = {};
          }
          yield { type: 'tool_call', content: `Calling: ${toolName}`, toolName, toolArgs: parsedToolArgs };

          const result = await executeToolCall(
            { id: tc.id, type: 'function', function: { name: toolName, arguments: toolArgs } },
            toolContext
          );

          yield { type: 'tool_result', content: result, toolName };

          // Add to conversation
          conversation.push({
            role: 'assistant',
            content: assistantContent || `Using tool: ${toolName}`,
            tool_calls: [tc],
          });
          conversation.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id,
            name: toolName,
          });
        }
      } catch (e: any) {
        yield { type: 'error', content: `Error: ${e.message}` };
        return;
      }
    }

    // Max rounds reached - get final summary
    yield { type: 'text', content: '\n\n(Max tool rounds reached. The agent has completed as many operations as allowed.)' };
  }

  async chat(messages: ChatMessage[], workspaceContext?: string): Promise<string> {
    const provider = this.getActiveProvider();
    const profile = this.getActiveProfile();
    if (this.config.mode === 'orca') return this.chatOrca(messages, workspaceContext, false);
    if (!provider || !provider.apiKey) return 'Error: No API key configured. Go to Settings > AI Providers to set up.';

    const allMessages: ChatMessage[] = [];
    const systemPrompt = (profile?.systemPrompt || 'You are a helpful assistant.') +
      (workspaceContext ? `\n\nCurrent workspace context:\n${workspaceContext}` : '');
    allMessages.push({ role: 'system', content: systemPrompt });
    allMessages.push(...messages);

    try {
      const isAnthropic = provider.id === 'anthropic';
      const url = isAnthropic ? `${provider.baseUrl}/messages` : `${provider.baseUrl}/chat/completions`;

      let body: any;
      if (isAnthropic) {
        const systemMsg = allMessages.find(m => m.role === 'system');
        const nonSystem = allMessages.filter(m => m.role !== 'system');
        body = {
          model: provider.activeModel || provider.models[0],
          max_tokens: profile?.maxTokens || 4096,
          system: systemMsg?.content || '',
          messages: nonSystem.map(m => ({ role: m.role, content: m.content })),
        };
      } else {
        body = {
          model: provider.activeModel || provider.models[0],
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: profile?.maxTokens || 4096,
          temperature: profile?.temperature || 0.7,
          stream: false,
        };
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
          ...(provider.headers || {}),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return `Error: HTTP ${resp.status} - ${errText.substring(0, 200)}`;
      }
      const data = await resp.json() as any;
      if (isAnthropic) return data.content?.[0]?.text || '';
      return data.choices?.[0]?.message?.content || '';
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  async chatOrca(messages: ChatMessage[], workspaceContext?: string, _stream = false): Promise<string> {
    const profile = this.getActiveProfile();
    const systemPrompt = (profile?.systemPrompt || 'You are a helpful assistant.') +
      (workspaceContext ? `\n\nCurrent workspace context:\n${workspaceContext}` : '');
    const allMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];
    try {
      const resp = await fetch(`${this.config.orcaBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '', messages: allMessages.map(m => ({ role: m.role, content: m.content })), stream: false, useAgent: true, workspacePath: workspaceContext || '' }),
      });
      if (!resp.ok) { const errText = await resp.text().catch(() => ''); return `Error: HTTP ${resp.status} - ${errText.substring(0, 200)}`; }
      const data = await resp.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } catch (e: any) { return `Error: ${e.message}`; }
  }

  async *chatStream(messages: ChatMessage[], workspaceContext?: string): AsyncGenerator<string> {
    if (this.config.mode === 'orca') {
      yield* this.chatStreamOrca(messages, workspaceContext);
      return;
    }
    const provider = this.getActiveProvider();
    const profile = this.getActiveProfile();
    if (!provider || !provider.apiKey) {
      yield 'Error: No API key configured. Go to Settings > AI Providers to set up.';
      return;
    }

    const allMessages: ChatMessage[] = [];
    const systemPrompt = (profile?.systemPrompt || 'You are a helpful assistant.') +
      (workspaceContext ? `\n\nCurrent workspace context:\n${workspaceContext}` : '');
    allMessages.push({ role: 'system', content: systemPrompt });
    allMessages.push(...messages);

    const isAnthropic = provider.id === 'anthropic';
    const url = isAnthropic ? `${provider.baseUrl}/messages` : `${provider.baseUrl}/chat/completions`;

    let body: any;
    if (isAnthropic) {
      const systemMsg = allMessages.find(m => m.role === 'system');
      const nonSystem = allMessages.filter(m => m.role !== 'system');
      body = {
        model: provider.activeModel || provider.models[0],
        max_tokens: profile?.maxTokens || 4096,
        system: systemMsg?.content || '',
        messages: nonSystem.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      };
    } else {
      body = {
        model: provider.activeModel || provider.models[0],
        messages: allMessages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: profile?.maxTokens || 4096,
        temperature: profile?.temperature || 0.7,
        stream: true,
      };
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
          ...(provider.headers || {}),
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        yield `Error: HTTP ${resp.status} - ${errText.substring(0, 200)}`;
        return;
      }

      const reader = (resp.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') return;

          try {
            const parsed = JSON.parse(dataStr);
            if (isAnthropic) {
              if (parsed.type === 'content_block_delta') {
                const text = parsed.delta?.text;
                if (text) yield text;
              }
            } else {
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            }
          } catch {}
        }
      }
    } catch (e: any) {
      yield `Error: ${e.message}`;
    }
  }

  async *chatStreamOrca(messages: ChatMessage[], workspaceContext?: string): AsyncGenerator<string> {
    const profile = this.getActiveProfile();
    const systemPrompt = (profile?.systemPrompt || 'You are a helpful assistant.') +
      (workspaceContext ? `\n\nCurrent workspace context:\n${workspaceContext}` : '');
    const allMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...messages];
    try {
      const resp = await fetch(`${this.config.orcaBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '', messages: allMessages.map(m => ({ role: m.role, content: m.content })), stream: true, useAgent: true, workspacePath: workspaceContext || '' }),
      });
      if (!resp.ok) { const errText = await resp.text().catch(() => ''); yield `Error: HTTP ${resp.status} - ${errText.substring(0, 200)}`; return; }
      const reader = (resp.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') return;
          try { const parsed = JSON.parse(dataStr); const delta = parsed.choices?.[0]?.delta?.content; if (delta) yield delta; } catch {}
        }
      }
    } catch (e: any) { yield `Error: ${e.message}`; }
  }
}

export function getDefaultProviders(): AIProvider[] { return DEFAULT_PROVIDERS; }
export function getDefaultProfiles(): AgentProfile[] { return DEFAULT_PROFILES; }
