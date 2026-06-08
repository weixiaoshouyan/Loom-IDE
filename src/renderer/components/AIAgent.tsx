import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Props { workspacePath: string; onClose: () => void; }
interface Message { role: 'user' | 'assistant' | 'system'; content: string; }

function formatMarkdown(text: string): string {
  if (!text) return '';
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```([\s\S]*?)```/g, (_: string, block: string) => {
    const lines = block.split('\n');
    let lang = '', code = block;
    if (lines[0] && lines[0].length < 20 && !lines[0].includes(' ')) { lang = lines[0].trim(); code = lines.slice(1).join('\n'); }
    return '<pre class="code-block">' + (lang ? '<div class="code-lang">' + lang + '</div>' : '') + '<code>' + code.trim() + '</code></pre>';
  });
  html = html.replace(/`([^\n`]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:var(--text-link)" target="_blank">$1</a>');
  html = html.split('\n\n').map(p => p.trim().startsWith('<pre') ? p.trim() : '<p>' + p.trim().replace(/\n/g, '<br/>') + '</p>').join('');
  return html;
}

export default function AIAgent({ workspacePath, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const check = () => {
      (window as any).loom.agent.status().then((s: any) => setStatus(s.ok ? 'online' : 'offline')).catch(() => setStatus('offline'));
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { return () => { if (abortRef.current) abortRef.current(); }; }, []);

  const clearChat = () => {
    if (abortRef.current) { abortRef.current(); abortRef.current = null; }
    setMessages([]);
    setLoading(false);
  };

  const send = useCallback(() => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: msg };
    const next = [...messages, userMsg];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setLoading(true);
    let content = '';
    const idx = next.length;
    const abort = (window as any).loom.agent.chatStream(next, workspacePath,
      (chunk: string) => {
        content += chunk;
        setMessages(prev => {
          const c = [...prev];
          if (c[idx]) c[idx] = { ...c[idx], content };
          return c;
        });
      },
      () => { setLoading(false); abortRef.current = null; },
      (err: any) => {
        setMessages(prev => {
          const c = [...prev];
          if (c[idx]) c[idx] = { ...c[idx], content: content + '\n\n[Error: ' + err.message + ']' };
          return c;
        });
        setLoading(false);
        abortRef.current = null;
      }
    );
    abortRef.current = abort;
  }, [input, loading, messages, workspacePath]);

  const insertCodeContext = () => {
    if (!workspacePath) return;
    setInput(prev => prev + (prev ? '\n' : '') + `[Workspace: ${workspacePath.split(/[\\/]/).pop()}] `);
    textareaRef.current?.focus();
  };

  const quickActions = [
    { label: 'Review Code', prompt: 'Review the current code and find bugs or improvements.' },
    { label: 'Explain', prompt: 'Explain how this code works in detail.' },
    { label: 'Refactor', prompt: 'Suggest refactoring improvements for better code quality.' },
    { label: 'Add Tests', prompt: 'Write unit tests for this code.' },
    { label: 'Fix Bug', prompt: 'Help me find and fix the bug in this code.' },
  ];

  return (
    <div className="ai-agent-panel">
      <div className="ai-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'online' ? 'var(--green)' : 'var(--red)' }} />
          <span style={{ fontWeight: 600 }}>Orca AI Agent</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{status === 'online' ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={clearChat} style={{ color: 'var(--text-secondary)', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 3 }}
            title="Clear Chat">
            Clear
          </button>
          <button onClick={onClose} style={{ color: 'var(--text-secondary)', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer' }}>
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4"/></svg>
          </button>
        </div>
      </div>

      <div className="ai-messages">
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 16px' }}>
            <div style={{ fontSize: 36, marginBottom: 8, color: 'var(--accent)' }}>{'\u2B21'}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Orca Assistant</div>
            <div style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
              I can review code, find bugs, explain logic, refactor features, and help with any coding task.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {quickActions.map(qa => (
                <button key={qa.label} className="ai-quick-btn" onClick={() => { setInput(qa.prompt); textareaRef.current?.focus(); }}>
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            <div className="ai-msg-role">{m.role === 'user' ? 'You' : 'Orca'}</div>
            <div className="ai-msg-content"
              dangerouslySetInnerHTML={{ __html: formatMarkdown(m.content) || (m.content === '' && loading && i === messages.length - 1 ? '<em>Thinking...</em>' : '') }}
            />
            {m.role === 'assistant' && m.content && (
              <button className="ai-copy-btn" onClick={() => navigator.clipboard?.writeText(m.content)} title="Copy">
                <svg viewBox="0 0 16 16" width="12" height="12"><rect x="5" y="5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/><path d="M3 11V3a2 2 0 012-2h8" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
              </button>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="ai-input-area">
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
            <button onClick={() => { abortRef.current?.(); abortRef.current = null; setLoading(false); }}
              className="ai-stop-btn">
              <span style={{ color: 'var(--red)', fontSize: 10 }}>{'\u25A0'}</span> Stop
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <button onClick={insertCodeContext} className="ai-context-btn" title="Insert workspace context">
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.146a.5.5 0 01.354.146L7.207 3.293a.5.5 0 00.354.146H13.5A1.5 1.5 0 0115 4.5v8a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          {messages.length > 0 && (
            <button onClick={clearChat} className="ai-context-btn" title="Clear chat">
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M5 1h6v1H5V1zM3 3h10v1H3V3zM4 4h8v9H4V4zM6 6h1v5H6V6zm3 0h1v5H9V6z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
            </button>
          )}
        </div>
        <textarea ref={textareaRef} value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={status === 'online' ? 'Ask Orca anything... (Enter to send)' : 'Orca is offline. Start Orca Proxy first.'}
          rows={3} disabled={loading || status === 'offline'}
          className="ai-textarea"
        />
      </div>
    </div>
  );
}
