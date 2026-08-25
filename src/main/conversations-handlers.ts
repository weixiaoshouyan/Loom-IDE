/**
 * Conversation history — per-project message persistence + search.
 *
 * Conversations are stored as JSON files keyed by a URL-safe base64 hash of the
 * project path. Supports save/load/list/delete/search/export.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDataDir, ensureDataDir } from './config';

const conversationsDir = path.join(getDataDir(), 'conversations');

function ensureConversationsDir() {
  if (!fs.existsSync(conversationsDir)) fs.mkdirSync(conversationsDir, { recursive: true });
}

// URL-safe base64 — guarantees save/load/list/delete are fully reversible.
function hashProjectPath(projectPath: string): string {
  return Buffer.from(projectPath, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function unhashProjectPath(hash: string): string {
  const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

export function registerConversationHandlers() {
  ipcMain.handle('conversations:save', (_e: any, projectPath: string, messages: any[]) => {
    try {
      ensureConversationsDir();
      const hash = hashProjectPath(projectPath);
      const filePath = path.join(conversationsDir, `${hash}.json`);
      const data = {
        projectPath,
        updatedAt: new Date().toISOString(),
        messages: messages.slice(-500), // keep last 500 messages
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch { return false; }
  });

  ipcMain.handle('conversations:load', (_e: any, projectPath: string) => {
    try {
      ensureConversationsDir();
      const hash = hashProjectPath(projectPath);
      const filePath = path.join(conversationsDir, `${hash}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data.messages || [];
      }
      return [];
    } catch { return []; }
  });

  ipcMain.handle('conversations:list', () => {
    try {
      ensureConversationsDir();
      const files = fs.readdirSync(conversationsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const fp = path.join(conversationsDir, f);
          const stat = fs.statSync(fp);
          const hash = f.replace(/\.json$/, '');
          let projectPath = '';
          try { projectPath = unhashProjectPath(hash); } catch {}
          let preview = '';
          let messageCount = 0;
          try {
            const raw = fs.readFileSync(fp, 'utf-8');
            const data = JSON.parse(raw);
            const msgs = Array.isArray(data.messages) ? data.messages : [];
            messageCount = msgs.length;
            const firstUser = msgs.find((m: any) => m && m.role === 'user' && typeof m.content === 'string');
            if (firstUser) {
              preview = firstUser.content.replace(/\s+/g, ' ').trim().substring(0, 80);
            }
          } catch {}
          return {
            name: f,
            projectPath,
            mtime: stat.mtimeMs,
            size: stat.size,
            preview,
            messageCount,
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
      return files;
    } catch { return []; }
  });

  ipcMain.handle('conversations:delete', (_e: any, projectPath: string) => {
    try {
      ensureConversationsDir();
      const hash = hashProjectPath(projectPath);
      const filePath = path.join(conversationsDir, `${hash}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch { return false; }
  });

  // Cross-conversation search.
  ipcMain.handle('conversations:search', (_e: any, query: string, limit: number = 20) => {
    try {
      if (!query || !query.trim()) return [];
      ensureConversationsDir();
      const q = query.toLowerCase().trim();
      const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
      const results: Array<{
        projectPath: string;
        snippet: string;
        messageRole: string;
        messageIndex: number;
        timestamp?: string;
        matchScore: number;
      }> = [];
      for (const f of files) {
        // f comes from readdirSync (plain names), but resolve + boundary-check
        // anyway so a crafted name can never escape conversationsDir.
        const fp = path.resolve(conversationsDir, f);
        if (fp !== conversationsDir && !fp.startsWith(conversationsDir + path.sep)) continue;
        try {
          const stat = fs.statSync(fp);
          const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
          const messages: any[] = data.messages || [];
          const projectPath = data.projectPath || (() => { try { return unhashProjectPath(f.replace('.json', '')); } catch { return f; } })();
          for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (!m || typeof m.content !== 'string') continue;
            const content = m.content;
            const lower = content.toLowerCase();
            const idx = lower.indexOf(q);
            if (idx < 0) continue;
            let score = 1;
            if (projectPath.toLowerCase().includes(q)) score += 5;
            if (m.role === 'user') score += 2;
            if (idx === 0 || /^\s/.test(content.substring(Math.max(0, idx - 1), idx))) score += 1;
            const start = Math.max(0, idx - 60);
            const end = Math.min(content.length, idx + q.length + 60);
            const snippet = (start > 0 ? '…' : '') + content.substring(start, end).replace(/\n+/g, ' ') + (end < content.length ? '…' : '');
            results.push({
              projectPath,
              snippet,
              messageRole: m.role || 'unknown',
              messageIndex: i,
              timestamp: m.timestamp || (data.updatedAt as string) || new Date(stat.mtimeMs).toISOString(),
              matchScore: score,
            });
          }
        } catch {}
      }
      results.sort((a, b) => b.matchScore - a.matchScore || (b.timestamp || '').localeCompare(a.timestamp || ''));
      return results.slice(0, Math.max(1, Math.min(limit, 100)));
    } catch { return []; }
  });

  ipcMain.handle('conversations:clear', () => {
    try {
      ensureConversationsDir();
      const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
      for (const f of files) fs.unlinkSync(path.join(conversationsDir, f));
      return true;
    } catch { return false; }
  });

  // Export conversation as Markdown or JSON.
  ipcMain.handle('conversations:export', async (_e: any, projectPath: string, format: 'markdown' | 'json' = 'markdown') => {
    try {
      ensureConversationsDir();
      const hash = hashProjectPath(projectPath);
      const filePath = path.join(conversationsDir, `${hash}.json`);
      if (!fs.existsSync(filePath)) return { ok: false, error: '对话不存在' };
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const messages: any[] = data.messages || [];
      const projectName = path.basename(projectPath);
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      let content: string;
      let extension: string;
      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        extension = 'json';
      } else {
        content = `# 对话: ${projectName}\n\n` +
          `**项目**: \`${projectPath}\`  \n` +
          `**导出时间**: ${new Date().toLocaleString()}  \n` +
          `**消息数**: ${messages.length}\n\n---\n\n`;
        for (const m of messages) {
          const role = m.role === 'user' ? '**👤 用户**' : '**🤖 助手**';
          const ts = m.timestamp ? `\`${new Date(m.timestamp).toLocaleString()}\`  \n` : '';
          let body = m.content || '';
          if (Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
            body += '\n\n<details><summary>工具调用</summary>\n\n';
            for (const tc of m.toolCalls) {
              body += `- **${tc.name}**\n  \`\`\`json\n  ${JSON.stringify(tc.args, null, 2).replace(/\n/g, '\n  ')}\n  \`\`\`\n`;
            }
            body += '\n</details>\n';
          }
          content += `${role}  \n${ts}${body}\n\n---\n\n`;
        }
        extension = 'md';
      }
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]!;
      const saveResult = await dialog.showSaveDialog(win, {
        title: '导出对话',
        defaultPath: `loom-conversation-${projectName}-${timestamp}.${extension}`,
        filters: format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(saveResult.filePath, content, 'utf-8');
      return { ok: true, path: saveResult.filePath };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}
