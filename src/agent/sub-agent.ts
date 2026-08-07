/**
 * Sub-Agent system for parallel exploration.
 *
 * Spawns independent Agent workers that focus on a slice of a larger task,
 * then returns a concise summary to the orchestrating Agent.
 */

import { AIEngine, type ChatMessage } from './ai-engine';
import { executeToolCall, type ToolExecutionContext, type ToolCall } from './agent-tools';
import { parseToolCalls, stripToolCalls } from './agent-tools';

export interface SubAgentTask {
  id: string;
  description: string;
  focus?: string;
  maxRounds?: number;
}

export interface SubAgentResult {
  id: string;
  description: string;
  summary: string;
  findings: string[];
  filesTouched: string[];
  error?: string;
}

export interface SubAgentOptions {
  engine: AIEngine;
  task: SubAgentTask;
  context: ToolExecutionContext;
  abortSignal?: AbortSignal;
}

const SUB_AGENT_SYSTEM_PROMPT = `You are a focused sub-agent working on one slice of a larger coding task.
Your job is to explore, read, and analyze code. You may use read_file, search_code, list_files, get_diagnostics, and read_lints.
Avoid making destructive changes unless explicitly asked. When you are done, output a concise summary of your findings and any recommendations.
`;

export async function runSubAgent(options: SubAgentOptions): Promise<SubAgentResult> {
  const { engine, task, context, abortSignal } = options;
  const maxRounds = task.maxRounds || 5;
  const messages: ChatMessage[] = [
    { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: `Task: ${task.description}\n${task.focus ? `Focus: ${task.focus}\n` : ''}Provide a concise summary when done.` },
  ];

  const filesTouched = new Set<string>();
  const findings: string[] = [];
  let summary = '';

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (abortSignal?.aborted) {
        return { id: task.id, description: task.description, summary: 'Aborted', findings: [], filesTouched: [], error: 'Aborted by user' };
      }

      const provider = engine.getActiveProvider();
      const profile = engine.getActiveProfile();
      const config = engine.getConfig();
      const isAnthropic = provider?.id === 'anthropic';

      const body: any = {
        model: config.mode === 'orca' ? '' : (provider?.activeModel || provider?.models?.[0] || ''),
        messages: isAnthropic
          ? messages.filter(m => m.role !== 'system')
          : messages,
        max_tokens: profile?.maxTokens || 4096,
        temperature: profile?.temperature || 0.3,
        stream: false,
      };
      if (isAnthropic) {
        body.system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      }

      const url = config.mode === 'orca'
        ? `${config.orcaBaseUrl}/v1/chat/completions`
        : (isAnthropic ? `${provider!.baseUrl}/messages` : `${provider?.baseUrl || ''}/chat/completions`);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.mode !== 'orca' && provider ? { 'Authorization': `Bearer ${provider.apiKey}` } : {}),
          ...(provider?.headers || {}),
        },
        body: JSON.stringify(body),
        signal: abortSignal
          ? (typeof AbortSignal.any === 'function'
              ? AbortSignal.any([abortSignal, AbortSignal.timeout(120000)])
              : abortSignal)
          : AbortSignal.timeout(120000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.substring(0, 200)}`);
      }

      const data = await resp.json() as any;
      let assistantContent = '';
      let toolCalls: ToolCall[] = [];

      if (isAnthropic) {
        for (const block of (data.content || [])) {
          if (block.type === 'text') assistantContent += block.text;
          if (block.type === 'tool_use') {
            toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } });
          }
        }
      } else {
        const choice = data.choices?.[0]?.message;
        assistantContent = choice?.content || '';
        toolCalls = (choice?.tool_calls || []).map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }

      if (toolCalls.length === 0 && assistantContent) {
        const parsed = parseToolCalls(assistantContent);
        if (parsed.length > 0) toolCalls = parsed;
      }

      const cleanContent = stripToolCalls(assistantContent);
      if (cleanContent) {
        messages.push({ role: 'assistant', content: cleanContent });
        if (round === maxRounds - 1 || toolCalls.length === 0) {
          summary = cleanContent;
        }
      }

      if (toolCalls.length === 0) {
        break;
      }

      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        // Sub-agents are restricted to read-only / safe tools by default.
        if (!['read_file', 'search_code', 'list_files', 'get_diagnostics', 'read_lints'].includes(toolName)) {
          messages.push({ role: 'tool', content: `Tool ${toolName} is not available to sub-agents.`, tool_call_id: tc.id, name: toolName });
          continue;
        }
        const result = await executeToolCall(tc, context);
        messages.push({ role: 'tool', content: result, tool_call_id: tc.id, name: toolName });
        if (toolName === 'read_file' && tc.function.arguments) {
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.filePath) filesTouched.add(args.filePath);
          } catch { /* ignore */ }
        }
      }
    }

    // Extract short findings from the conversation
    for (const m of messages) {
      if (m.role === 'tool' && m.content && m.content.length < 500) {
        findings.push(m.content.split('\n')[0].slice(0, 200));
      }
    }

    return {
      id: task.id,
      description: task.description,
      summary: summary || 'No summary provided by sub-agent.',
      findings: Array.from(new Set(findings)).slice(0, 10),
      filesTouched: Array.from(filesTouched).slice(0, 20),
    };
  } catch (e: any) {
    return {
      id: task.id,
      description: task.description,
      summary: `Error: ${e.message}`,
      findings: [],
      filesTouched: Array.from(filesTouched),
      error: e.message,
    };
  }
}

/**
 * Split a high-level task into sub-tasks based on the user's request.
 * This is a lightweight heuristic; future versions can ask the model to split.
 */
export function splitTask(request: string, workspacePath: string): SubAgentTask[] {
  const tasks: SubAgentTask[] = [];
  if (request.toLowerCase().includes('refactor') || request.toLowerCase().includes('across')) {
    tasks.push({ id: 'explore', description: `Explore the workspace structure and identify files relevant to: ${request}` });
    tasks.push({ id: 'analyze', description: `Analyze the code patterns and dependencies involved in: ${request}` });
    tasks.push({ id: 'recommend', description: `Recommend concrete changes for: ${request}` });
  } else {
    tasks.push({ id: 'explore', description: `Explore code relevant to: ${request}` });
    tasks.push({ id: 'summarize', description: `Summarize findings for: ${request}` });
  }
  return tasks;
}
