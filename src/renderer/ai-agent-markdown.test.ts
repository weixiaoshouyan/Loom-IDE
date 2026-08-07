import { describe, expect, it } from 'vitest';
import { formatMarkdown } from './markdown-renderer';

describe('AIAgent markdown rendering', () => {
  it('renders fenced code blocks as collapsible sections with copy and apply actions', () => {
    const html = formatMarkdown('Run this:\n\n```powershell\nnpm run test:run\n```');

    expect(html).toContain('<details class="code-block-wrapper"');
    expect(html).toContain('<summary class="code-block-header">');
    expect(html).toContain('data-action="copy"');
    expect(html).toContain('data-action="apply"');
    expect(html).toContain('npm run test:run');
  });
});
