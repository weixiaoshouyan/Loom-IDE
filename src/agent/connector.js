"use strict";
/**
 * Orca Agent Connector
 * Connects to the Orca Universal Proxy API for AI capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrcaAgent = void 0;
class OrcaAgent {
    baseUrl;
    constructor(baseUrl = 'http://127.0.0.1:18080') {
        this.baseUrl = baseUrl;
    }
    async getStatus() {
        try {
            const resp = await fetch(`${this.baseUrl}/api/status`);
            if (!resp.ok)
                return { ok: false, error: `HTTP ${resp.status}` };
            const data = await resp.json();
            return { ok: true, version: data.version };
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    }
    async listSkills() {
        try {
            const resp = await fetch(`${this.baseUrl}/api/skills`);
            if (!resp.ok)
                return [];
            return await resp.json();
        }
        catch {
            return [];
        }
    }
    async getSkill(skillId) {
        try {
            const resp = await fetch(`${this.baseUrl}/api/skills/${skillId}`);
            if (!resp.ok)
                return null;
            return await resp.json();
        }
        catch {
            return null;
        }
    }
    async chat(message, workspacePath) {
        try {
            const body = {
                model: '',
                messages: [{ role: 'user', content: message }],
                stream: false,
                useAgent: true,
                workspacePath: workspacePath || '',
            };
            const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!resp.ok)
                return `Error: HTTP ${resp.status}`;
            const data = await resp.json();
            return data.choices?.[0]?.message?.content || '';
        }
        catch (e) {
            return `Error: ${e.message}`;
        }
    }
    async *chatStream(message, workspacePath) {
        const body = {
            model: '',
            messages: [{ role: 'user', content: message }],
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
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: '))
                    continue;
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]')
                    return;
                try {
                    const parsed = JSON.parse(dataStr);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta)
                        yield delta;
                }
                catch { }
            }
        }
    }
}
exports.OrcaAgent = OrcaAgent;
//# sourceMappingURL=connector.js.map