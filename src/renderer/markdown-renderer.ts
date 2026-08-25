// Pure markdown subset renderer used by the assistant panel.
// Only runtime dependency is the i18n table (node-safe, DOM-guarded) so tests
// can import it without mounting React/xterm.
import { t } from '@/shared/i18n';
export function formatMarkdown(text: string): string {
  if (!text) return '';
  // Extract code blocks FIRST from the RAW text — before escaping — so their
  // content is escaped exactly once. Escaping the already-escaped text again
  // inside code blocks turned `<div>` into `&amp;lt;div&amp;gt;` (double-escape bug).
  const codeBlocks: string[] = [];
  let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    const langLabel = lang || 'text';
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const codeContent = escapedCode.trim();
    const encodedCode = encodeURIComponent(code.trim());
    let filePath = '';
    const filePatterns = [
      /\/\/\s*File:\s*(.+)/,
      /\/\*\s*File:\s*(.+?)\s*\*\//,
      /#\s*File:\s*(.+)/,
    ];
    for (const pat of filePatterns) {
      const m = code.match(pat);
      if (m) { filePath = m[1].trim(); break; }
    }
    const safeFilePath = safeAttr(filePath);
    const fileName = filePath.split(/[\\/]/).pop();
    const block = `<details class="code-block-wrapper" data-code="${encodedCode}" data-lang="${safeAttr(langLabel)}"${filePath ? ` data-file="${safeFilePath}"` : ''} open>
      <summary class="code-block-header">
        <span class="code-collapse-indicator">▶</span>
        <span class="code-lang">${safeAttr(langLabel)}</span>
        ${filePath ? `<span class="code-file-tag" title="${safeFilePath}">${safeAttr(fileName || filePath)}</span>` : ''}
        <button class="code-copy-btn" data-action="copy" title="${t('markdownCode.copy')}">${t('markdownCode.copyBtn')}</button>
        <button class="code-apply-btn" data-action="apply" title="${filePath ? t('markdownCode.applyTo', { file: safeFilePath }) : t('markdownCode.applyToActive')}">${t('markdownCode.apply')}</button>
      </summary>
      <pre class="code-block"><code>${codeContent}</code></pre>
    </details>`;
    codeBlocks.push(block);
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
  });

  // Escape the remaining (non-code) text exactly once.
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Restore the rendered code blocks.
  // NUL 占位符不能写进正则字面量（no-control-regex），动态构造。
  const CODEBLOCK_RE = new RegExp(`\\x00CODEBLOCK(\\d+)\\x00`, 'g');
  html = html.replace(CODEBLOCK_RE, (_: string, i: string) => codeBlocks[Number(i)]);

  html = html.replace(/`([^\n`]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    if (!isSafeHref(m)) return m;
    return `<a href="${safeAttr(m)}" target="_blank" rel="noopener noreferrer">${safeAttr(m)}</a>`;
  });
  html = html.replace(/(href|src)=(["']?)(javascript|data|vbscript):[^"'\s>]*/gi, '$1=$2about:blank#blocked');

  html = html.split('\n\n').map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<details class="code-block-wrapper"')) return trimmed;
    return '<p>' + trimmed.replace(/\n/g, '<br/>') + '</p>';
  }).join('');

  return html;
}

function isSafeHref(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return false;
  return /^(https?:\/\/|mailto:|\/|#)/i.test(trimmed);
}

function safeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
