/**
 * Orca Agent Connector
 * Connects to the Orca Universal Proxy API for AI capabilities
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
}

export class OrcaAgent {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:18080') {
    this.baseUrl = baseUrl;
  }

  async getStatus(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/status`);
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const data = await resp.json() as any;
      return { ok: true, version: data.version };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  async listSkills(): Promise<Skill[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/skills`);
      if (!resp.ok) return [];
      return await resp.json() as Skill[];
    } catch {
      return [];
    }
  }

  async getSkill(skillId: string): Promise<{ name: string; description: string; instructions: string } | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/skills/${skillId}`);
      if (!resp.ok) return null;
      return await resp.json() as any;
    } catch {
      return null;
    }
  }

  async chat(messages: ChatMessage[], workspacePath?: string): Promise<string> {
    try {
      const body: any = {
        model: '',
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        useAgent: true,
        workspacePath: workspacePath || '',
      };
      const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) return `Error: HTTP ${resp.status}`;
      const data = await resp.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  async *chatStream(messages: ChatMessage[], workspacePath?: string): AsyncGenerator<string> {
    const body: any = {
      model: '',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      useAgent: true,
      workspacePath: workspacePath || '',
    };
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      yield `Error: HTTP ${resp.status}`;
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
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {}
      }
    }
  }
}
