import type { AIProvider, AgentProfile } from './ai-engine';

export const DEFAULT_PROVIDERS: AIProvider[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'], enabledModels: [], activeModel: 'gpt-4.1-mini', isCustom: false },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'], enabledModels: [], activeModel: 'deepseek-chat', isCustom: false },
  { id: 'xiaomi', name: '\u5c0f\u7c73 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: '', models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-flash', 'mimo-v2-omni'], enabledModels: [], activeModel: 'mimo-v2.5-pro', isCustom: false },
  { id: 'xiaomi-tokenplan', name: '\u5c0f\u7c73 MiMo Token Plan', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: '', models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-flash', 'mimo-v2-omni'], enabledModels: [], activeModel: 'mimo-v2.5-pro', isCustom: false },
  { id: 'dashscope', name: '\u901a\u4e49\u5343\u95ee', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'], enabledModels: [], activeModel: 'qwen-plus', isCustom: false },
  { id: 'doubao', name: '\u8c46\u5305', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', models: ['doubao-pro-256k', 'doubao-pro-128k', 'doubao-lite-128k'], enabledModels: [], activeModel: 'doubao-pro-128k', isCustom: false },
  { id: 'zhipu', name: '\u667a\u8c31 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'], enabledModels: [], activeModel: 'glm-4-plus', isCustom: false },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], enabledModels: [], activeModel: 'moonshot-v1-32k', isCustom: false },
  { id: 'siliconflow', name: '\u7845\u57fa\u6d41\u52a8', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: '', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Meta-Llama-3.1-70B-Instruct'], enabledModels: [], activeModel: 'deepseek-ai/DeepSeek-V3', isCustom: false },
  { id: 'yi', name: '\u96f6\u4e00\u4e07\u7269 Yi', baseUrl: 'https://api.lingyiwanwu.com/v1', apiKey: '', models: ['yi-large', 'yi-medium', 'yi-spark'], enabledModels: [], activeModel: 'yi-large', isCustom: false },
  { id: 'baichuan', name: '\u767e\u5ddd\u667a\u80fd', baseUrl: 'https://api.baichuan-ai.com/v1', apiKey: '', models: ['Baichuan4', 'Baichuan3-Turbo'], enabledModels: [], activeModel: 'Baichuan4', isCustom: false },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', apiKey: '', models: ['abab6.5s-chat', 'abab6.5g-chat'], enabledModels: [], activeModel: 'abab6.5s-chat', isCustom: false },
  { id: 'custom', name: 'Custom Provider', baseUrl: '', apiKey: '', models: ['default'], enabledModels: [], activeModel: 'default', isCustom: true },
];

export const DEFAULT_PROFILES: AgentProfile[] = [
  { id: 'coder', name: 'Code Assistant', systemPrompt: 'You are an expert programming assistant. Help users write, debug, review, and optimize code. Provide clear explanations with code examples. Always respond in the same language as the user.', providerId: '', model: '', temperature: 0.3, maxTokens: 4096, icon: '💻' },
  { id: 'reviewer', name: 'Code Reviewer', systemPrompt: 'You are a senior code reviewer. Analyze code for bugs, security issues, performance problems, and style violations. Provide actionable suggestions with improved code examples.', providerId: '', model: '', temperature: 0.2, maxTokens: 4096, icon: '🔍' },
  { id: 'architect', name: 'Architect', systemPrompt: 'You are a software architect. Help with system design, architecture decisions, design patterns, and technical trade-offs. Think broadly about scalability, maintainability, and team workflow.', providerId: '', model: '', temperature: 0.4, maxTokens: 4096, icon: '🏗️' },
  { id: 'teacher', name: 'Teacher', systemPrompt: 'You are a patient programming teacher. Explain concepts clearly with analogies and examples. Break down complex topics into digestible steps. Encourage learning by doing.', providerId: '', model: '', temperature: 0.5, maxTokens: 4096, icon: '📚' },
  { id: 'general', name: 'General Assistant', systemPrompt: 'You are a helpful AI assistant. Answer questions accurately and concisely. When working with code, follow best practices and explain your reasoning.', providerId: '', model: '', temperature: 0.7, maxTokens: 4096, icon: '🤖' },
];

export function getDefaultProviders(): AIProvider[] { return DEFAULT_PROVIDERS; }
export function getDefaultProfiles(): AgentProfile[] { return DEFAULT_PROFILES; }
