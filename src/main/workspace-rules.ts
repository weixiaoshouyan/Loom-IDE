/**
 * Workspace rules loader — wires the layered RulesEngine into the agent runtime.
 *
 * Previously `.loomrules` was only read once by the renderer (App.tsx) and
 * `.loom/rules/*.md` layered rules (RulesEngine) were dead code. This module
 * resolves all rule sources in the main process on every agent run:
 *
 *   1. `.loomrules`            — project-level rules (priority 100)
 *   2. `.loom/rules/*.md`      — file-pattern rules with frontmatter globs (50)
 *   3. `.loom/rules` JSON      — legacy team-rules JSON (if it is a file, not a dir)
 *
 * The returned text is injected by ai-stream-handlers as `teamRules`, which
 * ai-engine pushes into the delimited <workspace_context> USER message
 * (untrusted boundary — never the system prompt), preserving the
 * prompt-injection defense.
 */
import fs from 'fs';
import path from 'path';
import { RulesEngine } from '../agent/rules-engine';

const TEAM_RULES_JSON = '.loom' + path.sep + 'rules';

/** Resolve `rel` under `root`; return null when the result would escape `root`. */
function resolveInside(root: string, rel: string): string | null {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, rel);
  return resolved.startsWith(rootAbs + path.sep) ? resolved : null;
}

/** Resolve all workspace rules for the given workspace (stateless, per-call). */
export function loadWorkspaceRulesPrompt(workspacePath: string): string {
  if (!workspacePath) return '';
  const parts: string[] = [];

  // 1) Layered rules: .loomrules + .loom/rules/*.md
  try {
    const engine = new RulesEngine(workspacePath);
    const { text } = engine.resolve();
    if (text) parts.push(text);
  } catch { /* best-effort */ }

  // 2) Legacy team-rules JSON at `.loom/rules` — only when it is actually a
  //    file (the RulesEngine above treats `.loom/rules` as a directory).
  try {
    const rulesPath = resolveInside(workspacePath, TEAM_RULES_JSON);
    if (rulesPath && fs.existsSync(rulesPath) && fs.statSync(rulesPath).isFile()) {
      const raw = fs.readFileSync(rulesPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const sections: string[] = [];
      if (parsed.instructions) sections.push(`Team instructions:\n${parsed.instructions}`);
      if (parsed.include?.length) sections.push(`Always include these paths: ${parsed.include.join(', ')}`);
      if (parsed.exclude?.length) sections.push(`Always exclude these paths: ${parsed.exclude.join(', ')}`);
      if (parsed.conventions && Object.keys(parsed.conventions).length > 0) {
        sections.push('Team conventions:\n' + Object.entries(parsed.conventions).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
      }
      if (parsed.fileRules && Array.isArray(parsed.fileRules)) {
        const fileRules = parsed.fileRules
          .filter((r: any) => r && typeof r.pattern === 'string' && r.include !== false && r.instructions)
          .map((r: any) => `- ${r.pattern}: ${r.instructions}`);
        if (fileRules.length) sections.push('File-specific rules:\n' + fileRules.join('\n'));
      }
      if (sections.length) parts.push(sections.join('\n\n'));
    }
  } catch { /* not JSON or unreadable — skip */ }

  return parts.join('\n\n');
}
