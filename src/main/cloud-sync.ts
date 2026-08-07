/**
 * Cloud Sync & Team Collaboration module (skeleton).
 *
 * Provides the foundation for:
 *   - User authentication and settings sync.
 *   - Team rules via `.loom/rules` files.
 *   - Shared workspace indexes and annotations.
 *
 * The actual backend transport is left as a configurable adapter so Loom can
 * plug into Firebase, Supabase, or a self-hosted backend without changing the
 * core interface.
 */

import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';

export interface CloudSyncAdapter {
  id: string;
  signIn(credentials?: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  signOut(): Promise<void>;
  getUser(): Promise<{ id: string; email: string; name?: string } | null>;
  syncSettings(settings: Record<string, any>): Promise<{ ok: boolean; error?: string }>;
  loadSettings(): Promise<Record<string, any> | null>;
}

export interface TeamRulePattern {
  /** Glob pattern matched against file paths relative to the workspace root.
   *  Uses the same syntax as .gitignore (via the `glob` package). */
  pattern: string;
  /** When true, this rule applies to files matching the pattern.
   *  When false, it explicitly excludes them (overrides a broader include). */
  include?: boolean;
  /** Instruction text injected into the system prompt when the agent touches
   *  a file matching this pattern. */
  instructions?: string;
}

export interface TeamRules {
  include?: string[];
  exclude?: string[];
  instructions?: string;
  conventions?: Record<string, string>;
  /** Per-pattern rules — matched against file paths the agent reads/writes. */
  fileRules?: TeamRulePattern[];
}

export class CloudSyncManager {
  private adapter?: CloudSyncAdapter;

  setAdapter(adapter: CloudSyncAdapter) {
    this.adapter = adapter;
  }

  async signIn(credentials?: Record<string, string>) {
    if (!this.adapter) return { ok: false, error: 'No cloud adapter configured' };
    return this.adapter.signIn(credentials);
  }

  async signOut() {
    await this.adapter?.signOut();
  }

  async getUser() {
    return this.adapter?.getUser() || null;
  }

  async syncSettings(settings: Record<string, any>) {
    if (!this.adapter) return { ok: false, error: 'No cloud adapter configured' };
    return this.adapter.syncSettings(settings);
  }

  async loadSettings() {
    if (!this.adapter) return null;
    return this.adapter.loadSettings();
  }

  /**
   * Read team rules from `.loom/rules` in the workspace root.
   */
  loadTeamRules(workspacePath: string): TeamRules {
    const rulesPath = path.join(workspacePath, '.loom', 'rules');
    if (!fs.existsSync(rulesPath)) return {};
    try {
      const raw = fs.readFileSync(rulesPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        include: Array.isArray(parsed.include) ? parsed.include : undefined,
        exclude: Array.isArray(parsed.exclude) ? parsed.exclude : undefined,
        instructions: parsed.instructions ? String(parsed.instructions) : undefined,
        conventions: parsed.conventions || {},
        fileRules: Array.isArray(parsed.fileRules)
          ? parsed.fileRules.filter(
              (r: any) => r && typeof r.pattern === 'string',
            ).map((r: any) => ({
              pattern: r.pattern,
              include: r.include !== false,
              instructions: r.instructions ? String(r.instructions) : undefined,
            }))
          : undefined,
      };
    } catch {
      // Fall back to treating the file as plain text instructions.
      try {
        return { instructions: fs.readFileSync(rulesPath, 'utf-8') };
      } catch {
        return {};
      }
    }
  }

  /**
   * Format team rules for injection into the Agent system prompt.
   */
  formatRulesPrompt(rules: TeamRules): string {
    const parts: string[] = [];
    if (rules.instructions) parts.push(`Team instructions:\n${rules.instructions}`);
    if (rules.include?.length) parts.push(`Always include these paths: ${rules.include.join(', ')}`);
    if (rules.exclude?.length) parts.push(`Always exclude these paths: ${rules.exclude.join(', ')}`);
    if (rules.conventions && Object.keys(rules.conventions).length > 0) {
      parts.push('Team conventions:\n' + Object.entries(rules.conventions).map(([k, v]) => `- ${k}: ${v}`).join('\n'));
    }
    if (rules.fileRules && rules.fileRules.length > 0) {
      parts.push(
        'File-specific rules:\n' +
          rules.fileRules
            .filter(r => r.include !== false && r.instructions)
            .map(r => `- ${r.pattern}: ${r.instructions}`)
            .join('\n'),
      );
    }
    if (parts.length === 0) return '';
    return '\n\n' + parts.join('\n\n');
  }

  /**
   * Get the concatenated instructions from all file rules whose glob pattern
   * matches the given relative file path. Used by agent callbacks to inject
   * context-aware instructions when the model touches a matching file.
   *
   * @param rules   The parsed TeamRules.
   * @param relPath File path relative to the workspace root (forward-slash).
   */
  getRulesForFile(rules: TeamRules, relPath: string): string {
    if (!rules.fileRules || rules.fileRules.length === 0) return '';
    const normRel = relPath.replace(/\\/g, '/');
    const parts: string[] = [];
    for (const rule of rules.fileRules) {
      if (rule.include === false) continue;
      if (!rule.instructions) continue;
      if (this.globMatch(normRel, rule.pattern)) {
        parts.push(`[${rule.pattern}] ${rule.instructions}`);
      }
    }
    return parts.length > 0 ? parts.join('\n') : '';
  }

  /**
   * Match a file path against a glob pattern using minimatch.
   * Uses dot-match and basePath options so patterns like star-star-slash-star.ts
   * and folder-scoped patterns like `src/**` work intuitively.
   */
  private globMatch(filePath: string, pattern: string): boolean {
    try {
      return minimatch(filePath, pattern, { dot: true, nocase: process.platform === 'win32' });
    } catch {
      // Invalid glob — fall back to substring containment.
      return filePath.includes(pattern);
    }
  }
}
