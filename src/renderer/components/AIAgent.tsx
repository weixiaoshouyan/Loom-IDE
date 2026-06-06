import React, { useState, useRef, useEffect } from 'react';

interface Props {
  workspacePath: string;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AIAgent({ workspacePath, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'online' | 'offline'>('offline');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (window as any).loom.agent.status().then((s: any) => {
      setAgentStatus(s.ok ? 'online' : 'offline');
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const result = await (window as any).loom.agent.chat(msg, workspacePath);
      setMessages((prev) => [...prev, { role: 'assistant', content: result }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `错误: ${e.message}` }]);
    }
    setLoading(false);
  };

  return (
    <div className="agent-panel">
      <div className="agent-header">
        <div className="agent-title">
          <span className={`agent-status ${agentStatus}`} />
          <span>Orca 智能体</span>
        </div>
        <button className="agent-close" onClick={onClose}>×</button>
      </div>

      <div className="agent-messages">
        {messages.length === 0 && (
          <div className="agent-empty">
            <p>你好，我是 Orca 智能体。</p>
            <p>可以帮你写代码、分析文件、执行命令。</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`agent-msg ${m.role}`}>
            <div className="agent-msg-role">{m.role === 'user' ? '你' : 'Orca'}</div>
            <div className="agent-msg-content">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="agent-msg assistant">
            <div className="agent-msg-role">Orca</div>
            <div className="agent-msg-content"><span className="typing">思考中...</span></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="agent-input-area">
        <textarea
          className="agent-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="输入消息... (Enter 发送)"
          rows={2}
        />
      </div>
    </div>
  );
}
