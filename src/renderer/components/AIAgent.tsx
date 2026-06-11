import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface Props { 
  workspacePath: string; 
  onClose: () => void;
  openFiles?: { path: string; name: string; content: string }[];
  onOpenFile?: (path: string, content: string) => void;
  onApplyEdit?: (filePath: string, content: string) => void;
}

interface Message { 
  role: 'user' | 'assistant' | 'system' | 'tool'; 
  content: string; 
  toolCalls?: ToolCallDisplay[];
  toolResults?: ToolResultDisplay[];
  isStreaming?: boolean;
}

interface ToolCallDisplay { name: string; args: any; status: 'pending' | 'running' | 'done' | 'error'; result?: string; }
interface ToolResultDisplay { toolName: string; content: string; }
interface AgentChunk { type: 'text' | 'tool_call' | 'tool_result' | 'error'; content: string; toolName?: string; toolArgs?: any; }

interface AIProvider {
  id: string; name: string; baseUrl: string; apiKey: string;
  models: string[]; activeModel: string; isCustom: boolean;
}
interface AgentProfile {
  id: string; name: string; systemPrompt: string; providerId: string;
  model: string; temperature: number; maxTokens: number; icon: string;
}
interface AIConfig {
  providers: AIProvider[]; activeProviderId: string;
  profiles: AgentProfile[]; activeProfileId: string; streamEnabled: boolean;
  mode?: 'orca' | 'builtin'; orcaBaseUrl?: string;
}
interface Skill {
  id: string; name: string; description: string;
  category: string; prompt: string; icon: string; builtin: boolean;
}

// ====== Tokenizer for streaming text ======
function useStreamTokenizer(onToken: (token: string) => void) {
  const bufferRef = useRef('');
  
  const feed = useCallback((text: string) => {
    bufferRef.current += text;
    // Yield complete words/sentences for smoother streaming
    const parts = bufferRef.current.split(/(?<=[.!?\n])\s+/);
    bufferRef.current = parts.pop() || '';
    
    for (const part of parts) {
      if (part) onToken(part + ' ');
    }
  }, [onToken]);

  const flush = useCallback(() => {
    if (bufferRef.current) {
      onToken(bufferRef.current);
      bufferRef.current = '';
    }
  }, [onToken]);

  return { feed, flush };
}

// ====== Markdown Renderer ======
function formatMarkdown(text: string): string {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks with language
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    const langLabel = lang || '';
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const codeContent = escapedCode.trim();
    const encodedCode = encodeURIComponent(code.trim());
    return `<div class="code-block-wrapper" data-code="${encodedCode}" data-lang="${langLabel}">
      <div class="code-block-header">
        <span class="code-lang">${langLabel}</span>
        <button class="code-apply-btn" data-action="apply" title="Apply this code" onclick="
          const wrapper = this.closest('.code-block-wrapper');
          const code = decodeURIComponent(wrapper.dataset.code);
          const lang = wrapper.dataset.lang;
          window.dispatchEvent(new CustomEvent('loom:apply-code', { detail: { code, lang } }));
        ">Apply</button>
        <button class="code-copy-btn" data-action="copy" title="Copy code" onclick="
          const w = this.closest('.code-block-wrapper');
          navigator.clipboard.writeText(decodeURIComponent(w.dataset.code));
        ">Copy</button>
      </div>
      <pre class="code-block"><code>${codeContent}</code></pre>
    </div>`;
  });

  // Inline code
  html = html.replace(/`([^\n`]+)`/g, '<code class="inline-code">$1</code>');
  
  // Bold and italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // Links
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  
  // Paragraphs
  html = html.split('\n\n').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<div class="code-block-wrapper"')) return trimmed;
    return '<p>' + trimmed.replace(/\n/g, '<br/>') + '</p>';
  }).join('');

  return html;
}

// ====== LCS-based Diff Algorithm ======
type DiffLine = { type: 'same' | 'added' | 'removed'; numA: number | null; numB: number | null; content: string };

function computeDiff(origLines: string[], modLines: string[]): DiffLine[] {
  const m = origLines.length;
  const n = modLines.length;
  
  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      stack.push({ type: 'same', numA: i, numB: j, content: origLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', numA: null, numB: j, content: modLines[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', numA: i, numB: null, content: origLines[i - 1] });
      i--;
    }
  }
  
  // Reverse stack to get correct order
  while (stack.length > 0) result.push(stack.pop()!);
  
  // Merge adjacent same-type runs for cleaner display
  const merged: DiffLine[] = [];
  for (const line of result) {
    const last = merged[merged.length - 1];
    if (last && last.type === line.type) {
      merged.push({ ...line, numA: null, numB: null });
    } else {
      merged.push(line);
    }
  }
  
  return merged;
}

// ====== Code Diff Renderer ======
function DiffPreview({ filePath, original, modified, onAccept, onReject }: {
  filePath: string; original: string; modified: string; onAccept: () => void; onReject: () => void;
}) {
  const diffLines = useMemo(() => {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    if (original === modified) {
      return origLines.map((line, i) => ({ type: 'same' as const, numA: i + 1, numB: i + 1, content: line }));
    }
    // Use context-optimized diff for large files to avoid O(m*n) memory
    if (origLines.length > 2000 || modLines.length > 2000) {
      return largeFileDiff(origLines, modLines);
    }
    return computeDiff(origLines, modLines);
  }, [original, modified]);

  // Context-aware diff for large files
  function largeFileDiff(origLines: string[], modLines: string[]): DiffLine[] {
    const result: DiffLine[] = [];
    const chunkSize = 500;
    const maxI = Math.max(origLines.length, modLines.length);
    let oi = 0, mi = 0;
    
    while (oi < origLines.length && mi < modLines.length) {
      const oChunk = origLines.slice(oi, oi + chunkSize);
      const mChunk = modLines.slice(mi, mi + chunkSize);
      
      if (oChunk.join('\n') === mChunk.join('\n')) {
        for (const line of oChunk) result.push({ type: 'same', numA: ++oi, numB: ++mi, content: line });
      } else {
        const chunkDiff = computeDiff(oChunk, mChunk);
        for (const d of chunkDiff) {
          if (d.type === 'same') { oi++; mi++; result.push({ ...d, numA: oi, numB: mi }); }
          else if (d.type === 'removed') { oi++; result.push({ ...d, numA: oi, numB: null }); }
          else { mi++; result.push({ ...d, numA: null, numB: mi }); }
        }
      }
    }
    while (oi < origLines.length) { oi++; result.push({ type: 'removed', numA: oi, numB: null, content: origLines[oi - 1] }); }
    while (mi < modLines.length) { mi++; result.push({ type: 'added', numA: null, numB: mi, content: modLines[mi - 1] }); }
    return result;
  }

  if (!original && !modified) return null;

  const added = diffLines.filter(l => l.type === 'added').length;
  const removed = diffLines.filter(l => l.type === 'removed').length;

  return (
    <div className="diff-preview">
      <div className="diff-header">
        <span className="diff-file-icon">📄</span>
        <span className="diff-filename">{filePath.split(/[\\/]/).pop()}</span>
        <span className="diff-stats">+{added} -{removed}</span>
        <div className="diff-actions">
          <button className="diff-accept-btn" onClick={onAccept} title="Accept changes">✓ Accept</button>
          <button className="diff-reject-btn" onClick={onReject} title="Reject changes">✗ Reject</button>
        </div>
      </div>
      <div className="diff-content">
        {diffLines.map((line, idx) => (
          <div key={idx} className={`diff-line diff-line-${line.type}`}>
            <span className="diff-line-num">{line.numB || ''}</span>
            <span className="diff-line-sign">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
            <span className="diff-line-text">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ====== Conversation Storage ======
const STORAGE_KEY = 'loom-ai-chat-v2';
// Fallback: localStorage for backward compatibility
function loadLocalHistory(): Message[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveLocalHistory(msgs: Message[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-300))); } catch {}
}
// File-based conversation storage (project-scoped)
async function loadConversation(projectPath: string): Promise<Message[]> {
  try { return await (window as any).loom.conversations.load(projectPath) || []; } catch { return []; }
}
async function saveConversation(projectPath: string, msgs: Message[]) {
  try { await (window as any).loom.conversations.save(projectPath, msgs); } catch {}
}

export default function AIAgent({ workspacePath, onClose, openFiles, onOpenFile, onApplyEdit }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => loadLocalHistory());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState(true); // Default to agent mode
  const [diffPreview, setDiffPreview] = useState<{ filePath: string; original: string; modified: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Refs to avoid stale closures in send callback
  const messagesRef = useRef(messages);
  const openFilesRef = useRef(openFiles);
  const workspaceRef = useRef(workspacePath);
  const configRef = useRef(config);
  const activeSkillRef = useRef<Skill | null>(null);
  const agentModeRef = useRef(agentMode);
  const onOpenFileRef = useRef(onOpenFile);
  const onApplyEditRef = useRef(onApplyEdit);
  
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { openFilesRef.current = openFiles; }, [openFiles]);
  useEffect(() => { workspaceRef.current = workspacePath; }, [workspacePath]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { activeSkillRef.current = activeSkill; }, [activeSkill]);
  useEffect(() => { agentModeRef.current = agentMode; }, [agentMode]);
  useEffect(() => { onOpenFileRef.current = onOpenFile; }, [onOpenFile]);
  useEffect(() => { onApplyEditRef.current = onApplyEdit; }, [onApplyEdit]);

  useEffect(() => {
    saveLocalHistory(messages);
    if (workspacePath) saveConversation(workspacePath, messages);
  }, [messages, workspacePath]);

  // Load project-specific conversation on workspace change
  useEffect(() => {
    if (!workspacePath) return;
    loadConversation(workspacePath).then(msgs => {
      if (msgs && msgs.length > 0) setMessages(msgs);
    });
  }, [workspacePath]);
  useEffect(() => { 
    endRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [messages]);
  useEffect(() => { return () => { if (abortRef.current) abortRef.current(); }; }, []);

  useEffect(() => {
    (window as any).loom.ai.getConfig().then((c: AIConfig) => setConfig(c)).catch(() => {});
    (window as any).loom.skills.getAll().then((s: Skill[]) => setSkills(s)).catch(() => {});
  }, []);

  // Listen for apply-code events from markdown buttons
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { code, lang } = e.detail;
      if (!code) return;
      
      // Try to find the target file from context
      const fileMatch = code.match(/\/\/\s*File:\s*(.+)/) || code.match(/\/\*\s*File:\s*(.+?)\s*\*\//);
      const targetPath = fileMatch ? fileMatch[1].trim() : null;
      
      if (targetPath && onApplyEdit) {
        onApplyEdit(targetPath, code);
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `Applied code to ${targetPath.split(/[\\/]/).pop()}`, type: 'success' } }));
      } else if (onApplyEdit && openFiles && openFiles.length > 0) {
        // Apply to the currently active file
        const activeFile = openFiles[0];
        onApplyEdit(activeFile.path, code);
        window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `Applied code to ${activeFile.name}`, type: 'success' } }));
      }
    };
    window.addEventListener('loom:apply-code' as any, handler);
    return () => window.removeEventListener('loom:apply-code' as any, handler);
  }, [onApplyEdit, openFiles]);

  const activeProvider = config?.providers.find(p => p.id === config.activeProviderId);
  const activeProfile = config?.profiles.find(p => p.id === config?.activeProfileId);
  const isOrca = config?.mode === 'orca';
  const hasKey = isOrca ? true : (activeProvider && activeProvider.apiKey);

  const clearChat = () => {
    if (abortRef.current) { abortRef.current(); abortRef.current = null; }
    setMessages([]);
    setLoading(false);
    setDiffPreview(null);
  };

  const activeSkill = activeSkillId ? skills.find(s => s.id === activeSkillId) : null;

  const getContextPrompt = useCallback((): string => {
    const files = openFilesRef.current;
    if (!files || files.length === 0) return '';
    const contextParts: string[] = [];
    
    // Add open files info
    contextParts.push('\n## Open Files');
    for (const f of files.slice(0, 5)) {
      const truncated = f.content.length > 3000 ? f.content.substring(0, 3000) + '\n... (truncated)' : f.content;
      contextParts.push(`\n### ${f.path}\n\`\`\`\n${truncated}\n\`\`\``);
    }
    
    return contextParts.join('\n');
  }, []);

  const send = useCallback(() => {
    const msg = input.trim();
    const cfg = configRef.current;
    if (!msg || loading || !cfg) return;
    setInput('');
    
    const skill = activeSkillRef.current;
    const mode = agentModeRef.current;
    const files = openFilesRef.current;
    const ws = workspaceRef.current;
    const onOpen = onOpenFileRef.current;
    const onEdit = onApplyEditRef.current;
    
    let fullMsg = msg;
    if (skill) {
      fullMsg = `[Skill: ${skill.name}]\nInstructions: ${skill.prompt}\n\nUser request:\n${msg}`;
    }
    
    const context = getContextPrompt();
    if (context && mode) {
      fullMsg = fullMsg + '\n\n' + context;
    }
    
    const prevMessages = messagesRef.current;
    const userMsg: Message = { role: 'user', content: msg };
    const assistantMsg: Message = { role: 'assistant', content: '', isStreaming: true, toolCalls: [], toolResults: [] };
    const next = [...prevMessages, userMsg, assistantMsg];
    setMessages(next);
    setLoading(true);
    
    const assistantIdx = next.length - 1;
    let fullContent = '';
    let toolCalls: ToolCallDisplay[] = [];
    let toolResults: ToolResultDisplay[] = [];
    
    const updateAssistant = () => {
      setMessages(prev => {
        const c = [...prev];
        if (c[assistantIdx]) {
          c[assistantIdx] = { 
            ...c[assistantIdx], 
            content: fullContent, 
            toolCalls: [...toolCalls], 
            toolResults: [...toolResults],
            isStreaming: loading,
          };
        }
        return c;
      });
    };
    
    if (mode) {
      // Agent mode - use tool calling
      const abort = (window as any).loom.ai.agentChatStream(
        prevMessages.map(m => ({ role: m.role, content: m.content })),
        ws,
        files?.map(f => ({ path: f.path, content: f.content })) || [],
        (chunk: AgentChunk) => {
          if (chunk.type === 'text') {
            fullContent += chunk.content;
          } else if (chunk.type === 'tool_call') {
            toolCalls.push({ name: chunk.toolName || 'unknown', args: chunk.toolArgs || {}, status: 'running' });
            updateAssistant();
          } else if (chunk.type === 'tool_result') {
            const lastTool = toolCalls[toolCalls.length - 1];
            if (lastTool) {
              lastTool.status = 'done';
              lastTool.result = chunk.content;
            }
            toolResults.push({ toolName: chunk.toolName || '', content: chunk.content });
            updateAssistant();
          } else if (chunk.type === 'error') {
            fullContent += `\n\n❌ ${chunk.content}`;
          }
          updateAssistant();
        },
        () => {
          setLoading(false);
          abortRef.current = null;
          setMessages(prev => {
            const c = [...prev];
            if (c[assistantIdx]) c[assistantIdx] = { ...c[assistantIdx], isStreaming: false };
            return c;
          });
        },
        (err: any) => {
          fullContent += `\n\n❌ Error: ${err.message}`;
          setLoading(false);
          abortRef.current = null;
          updateAssistant();
        },
        (filePath: string, content: string) => {
          window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `Agent created: ${filePath.split(/[\\/]/).pop()}`, type: 'success' } }));
          onOpen?.(filePath, content);
        },
        (filePath: string, content: string) => {
          window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: `Agent modified: ${filePath.split(/[\\/]/).pop()}`, type: 'info' } }));
          onEdit?.(filePath, content);
        }
      );
      abortRef.current = abort;
    } else {
      // Normal chat mode
      const abort = (window as any).loom.ai.chatStream(
        next.filter(m => m.role !== 'assistant' || m.content).map(m => ({ role: m.role, content: m.content })),
        ws,
        (chunk: string) => {
          fullContent += chunk;
          updateAssistant();
        },
        () => { setLoading(false); abortRef.current = null; },
        (err: any) => {
          fullContent += `\n\n❌ Error: ${err.message}`;
          setLoading(false);
          abortRef.current = null;
          updateAssistant();
        }
      );
      abortRef.current = abort;
    }
  }, [input, loading]);

  const switchProfile = async (profileId: string) => {
    if (!config) return;
    const updated = await (window as any).loom.ai.updateConfig({ activeProfileId: profileId });
    setConfig(updated);
    setShowProfiles(false);
  };

  const quickActions = [
    { label: '🔍 Review Code', prompt: 'Review the current code and find bugs or improvements.' },
    { label: '📖 Explain', prompt: 'Explain how this code works in detail.' },
    { label: '♻️ Refactor', prompt: 'Suggest refactoring improvements for better code quality.' },
    { label: '🧪 Add Tests', prompt: 'Write unit tests for this code.' },
    { label: '🐛 Fix Bug', prompt: 'Help me find and fix the bug in this code.' },
    { label: '⚡ Optimize', prompt: 'Optimize this code for better performance.' },
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { onClose(); }
  };

  if (!config) {
    return (
      <div className="ai-agent-panel">
        <div className="ai-header">
          <span style={{ fontWeight: 600 }}>AI Assistant</span>
          <button onClick={onClose} className="ai-context-btn">
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4"/></svg>
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="ai-agent-panel">
      {/* Header */}
      <div className="ai-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 18 }}>{activeProfile?.icon || '🤖'}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProfile?.name || 'AI Assistant'}
            </div>
            <div style={{ fontSize: 10, color: hasKey ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: hasKey ? 'var(--green)' : 'var(--red)', display: 'inline-block' }} />
              {isOrca ? 'Orca' : (hasKey ? `${activeProvider?.name} / ${activeProvider?.activeModel}` : 'No API Key')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {/* Agent/Chat Mode Toggle */}
          <button 
            onClick={() => setAgentMode(!agentMode)} 
            className={`ai-mode-btn ${agentMode ? 'active' : ''}`}
            title={agentMode ? 'Agent Mode: AI can read/write files' : 'Chat Mode: AI can only answer questions'}
          >
            {agentMode ? '🤖 Agent' : '💬 Chat'}
          </button>
          <button onClick={() => { setShowSkills(!showSkills); setShowProfiles(false); }} className="ai-context-btn" title="Select Skill">
            <svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 4l6-3 6 3v1H2V4zM3 6v6h2V6H3zM7 6v6h2V6H7zM11 6v6h2V6h-2z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button onClick={() => { setShowProfiles(!showProfiles); setShowSkills(false); }} className="ai-context-btn" title="Switch Agent Profile">
            <svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 1a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 13c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button onClick={clearChat} className="ai-context-btn" title="Clear Chat">
            <svg viewBox="0 0 16 16" width="13" height="13"><path d="M5 1h6v1H5V1zM3 3h10v1H3V3zM4 4h8v9H4V4z" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button onClick={onClose} className="ai-context-btn" title="Close">
            <svg viewBox="0 0 16 16" width="13" height="13"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4"/></svg>
          </button>
        </div>
      </div>

      {/* Profile Selector Dropdown */}
      {showProfiles && (
        <div className="ai-profiles-dropdown">
          {config.profiles.map(p => (
            <div key={p.id}
              className={`ai-profile-item ${p.id === config.activeProfileId ? 'active' : ''}`}
              onClick={() => switchProfile(p.id)}>
              <span style={{ fontSize: 14 }}>{p.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.systemPrompt.substring(0, 60)}...
                </div>
              </div>
              {p.id === config.activeProfileId && <span style={{ color: 'var(--accent)', fontSize: 14 }}>✓</span>}
            </div>
          ))}
        </div>
      )}

      {/* Skill Selector Dropdown */}
      {showSkills && (
        <div className="ai-profiles-dropdown">
          <div className="ai-profile-item" style={{ cursor: 'default', opacity: 0.7 }}
            onClick={() => { setActiveSkillId(null); setShowSkills(false); }}>
            <span style={{ fontSize: 14 }}>🔲</span>
            <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600 }}>No Skill</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Normal mode</div></div>
          </div>
          {skills.map(s => (
            <div key={s.id}
              className={`ai-profile-item ${s.id === activeSkillId ? 'active' : ''}`}
              onClick={() => { setActiveSkillId(s.id); setShowSkills(false); }}>
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.description}
                </div>
              </div>
              {s.id === activeSkillId && <span style={{ color: 'var(--accent)', fontSize: 14 }}>✓</span>}
            </div>
          ))}
        </div>
      )}

      {/* Active Skill Indicator */}
      {activeSkill && (
        <div className="ai-skill-indicator">
          <span>{activeSkill.icon}</span>
          <span style={{ fontWeight: 600 }}>{activeSkill.name}</span>
          <button onClick={() => setActiveSkillId(null)} className="ai-skill-remove">&times;</button>
        </div>
      )}

      {/* Agent Mode Indicator */}
      {agentMode && (
        <div className="ai-agent-indicator">
          <span>🤖</span>
          <span>Agent mode active — AI can read, write, and edit files</span>
        </div>
      )}

      {/* Messages */}
      <div className="ai-messages" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="ai-welcome">
            <div className="ai-welcome-icon">{activeProfile?.icon || '🤖'}</div>
            <div className="ai-welcome-name">{activeProfile?.name || 'AI Assistant'}</div>
            <div className="ai-welcome-model">
              {activeProvider?.name || 'No provider'} · {activeProvider?.activeModel || 'No model'}
            </div>
            <div className="ai-welcome-text">
              {hasKey
                ? (agentMode 
                  ? 'I can read, write, and edit your code. Try asking me to implement a feature or fix a bug!'
                  : 'Ask me anything about your code, or use a quick action below.')
                : 'Configure an API key in Settings > AI Providers to get started.'}
            </div>
            {hasKey && (
              <div className="ai-quick-actions">
                {quickActions.map(qa => (
                  <button key={qa.label} className="ai-quick-btn" onClick={() => { setInput(qa.prompt); textareaRef.current?.focus(); }}>
                    {qa.label}
                  </button>
                ))}
              </div>
            )}
            {!hasKey && (
              <button className="ai-quick-btn ai-settings-btn"
                onClick={() => window.dispatchEvent(new CustomEvent('loom:cmd', { detail: 'openSettings' }))}>
                Open Settings
              </button>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            <div className="ai-msg-header">
              <span className="ai-msg-role">
                {m.role === 'user' ? '👤 You' : 
                 m.role === 'tool' ? '🔧 Tool' : 
                 `${activeProfile?.icon || '🤖'} ${activeProfile?.name || 'AI'}`}
              </span>
              {m.isStreaming && <span className="ai-typing-indicator"><span>●</span><span>●</span><span>●</span></span>}
            </div>

            {/* Tool Calls Display */}
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="ai-tool-calls">
                {m.toolCalls.map((tc, ti) => (
                  <div key={ti} className={`ai-tool-call ai-tool-${tc.status}`}>
                    <div className="ai-tool-call-header">
                      <span className="ai-tool-status-icon">
                        {tc.status === 'running' ? '⏳' : tc.status === 'done' ? '✅' : tc.status === 'error' ? '❌' : '⏸️'}
                      </span>
                      <span className="ai-tool-name">{tc.name}</span>
                    </div>
                    {tc.result && (
                      <div className="ai-tool-result">
                        {tc.result.length > 500 ? tc.result.substring(0, 500) + '...' : tc.result}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Message Content */}
            {m.content && (
              <div className={`ai-msg-content ${m.role === 'assistant' ? 'ai-msg-assistant-content' : ''}`}
                dangerouslySetInnerHTML={{ 
                  __html: m.role === 'assistant' 
                    ? formatMarkdown(m.content) 
                    : m.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
                }}
              />
            )}

            {/* Empty streaming state */}
            {m.isStreaming && !m.content && (!m.toolCalls || m.toolCalls.length === 0) && (
              <div className="ai-msg-content ai-msg-assistant-content">
                <em className="ai-thinking">Thinking...</em>
              </div>
            )}

            {/* Copy button for assistant messages */}
            {m.role === 'assistant' && m.content && !m.isStreaming && (
              <button 
                className="ai-copy-btn" 
                onClick={() => {
                  navigator.clipboard?.writeText(m.content);
                  window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: 'Copied to clipboard', type: 'info' } }));
                }} 
                title="Copy message"
              >
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <rect x="5" y="5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/>
                  <path d="M3 11V3a2 2 0 012-2h8" fill="none" stroke="currentColor" strokeWidth="1"/>
                </svg>
              </button>
            )}
          </div>
        ))}

        {/* Diff Preview */}
        {diffPreview && (
          <DiffPreview
            filePath={diffPreview.filePath}
            original={diffPreview.original}
            modified={diffPreview.modified}
            onAccept={() => {
              if (onApplyEdit) {
                onApplyEdit(diffPreview.filePath, diffPreview.modified);
                window.dispatchEvent(new CustomEvent('loom:notify', { detail: { message: 'Changes applied!', type: 'success' } }));
              }
              setDiffPreview(null);
            }}
            onReject={() => setDiffPreview(null)}
          />
        )}

        <div ref={endRef} />
      </div>

      {/* Input Area */}
      <div className="ai-input-area">
        {loading && (
          <div className="ai-stop-row">
            <button onClick={() => { abortRef.current?.(); abortRef.current = null; setLoading(false); }}
              className="ai-stop-btn">
              ■ Stop Generation
            </button>
          </div>
        )}
        <div className="ai-input-row">
          <textarea 
            ref={textareaRef} 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasKey 
              ? (agentMode ? `Ask Agent to implement... (Enter to send)` : `Ask ${activeProfile?.name || 'AI'}... (Enter to send)`) 
              : 'Configure API key in Settings first'}
            rows={2}
            disabled={loading || !hasKey}
            className="ai-textarea"
          />
          <button 
            onClick={send} 
            disabled={loading || !input.trim() || !hasKey}
            className="ai-send-btn"
            title="Send message"
          >
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path d="M1 1l14 7-14 7 3.5-7L1 1z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        {agentMode && (
          <div className="ai-agent-hint">
            {openFiles && openFiles.length > 0 
              ? `📎 Context: ${openFiles.length} open file(s) included` 
              : '💡 Open files will be included as context'}
          </div>
        )}
      </div>
    </div>
  );
}
