/**
 * Loom Rules Engine
 *
 * Layered system prompt rules that adapt based on:
 * 1. Project-level rules (.loomrules)
 * 2. File-pattern rules (.loom/rules/*.md)
 * 3. Extension-contributed rules
 * 4. Inline rules from team settings
 *
 * This is inspired by Cursor's .cursorrules and Claude Code's CLAUDE.md.
 */

import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';

export interface RuleLayer {
  id: string;
  name: string;
  content: string;
  source: 'project' | 'pattern' | 'extension' | 'team';
  /** Glob patterns this rule applies to (empty = always applies) */
  globs?: string[];
  /** Priority — higher wins when multiple rules match */
  priority: number;
}

export interface ResolvedRules {
  text: string;
  layers: RuleLayer[];
}

export class RulesEngine {
  private workspacePath: string;
  private customLayers: RuleLayer[] = [];

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  addLayer(layer: RuleLayer): void {
    this.customLayers.push(layer);
  }

  removeLayer(id: string): void {
    this.customLayers = this.customLayers.filter(l => l.id !== id);
  }

  /**
   * Resolve all applicable rules for the given file context.
   * Returns the combined rule text and the list of applied layers.
   */
  resolve(currentFile?: string): ResolvedRules {
    const layers: RuleLayer[] = [];

    // Layer 1: Project-level rules
    const projectRules = this.loadProjectRules();
    if (projectRules) layers.push(projectRules);

    // Layer 2: Pattern-based rules
    const patternRules = this.loadPatternRules(currentFile);
    layers.push(...patternRules);

    // Layer 3: Extension-contributed rules
    const extensionRules = this.loadExtensionRules(currentFile);
    layers.push(...extensionRules);

    // Layer 4: Custom/team layers
    const teamRules = this.customLayers.filter(l => {
      if (!l.globs || l.globs.length === 0) return true;
      if (!currentFile) return false;
      return l.globs.some(g => minimatch(currentFile, g));
    });
    layers.push(...teamRules);

    // Sort by priority (highest first)
    layers.sort((a, b) => b.priority - a.priority);

    const text = layers.map(l => l.content).filter(Boolean).join('\n\n');
    return { text, layers };
  }

  /**
   * Generate the system prompt section for rules.
   */
  resolveForPrompt(currentFile?: string): string {
    const { text } = this.resolve(currentFile);
    if (!text) return '';
    return `\n\n## Project Rules\nThe following rules are in effect for this project. Follow them strictly:\n\n${text}`;
  }

  private loadProjectRules(): RuleLayer | null {
    const rulesPath = path.join(this.workspacePath, '.loomrules');
    if (!fs.existsSync(rulesPath)) return null;
    try {
      const content = fs.readFileSync(rulesPath, 'utf-8').trim();
      if (!content) return null;
      return {
        id: 'project-rules',
        name: '.loomrules',
        content,
        source: 'project',
        priority: 100,
      };
    } catch {
      return null;
    }
  }

  private loadPatternRules(currentFile?: string): RuleLayer[] {
    const rulesDir = path.join(this.workspacePath, '.loom', 'rules');
    if (!fs.existsSync(rulesDir)) return [];

    const layers: RuleLayer[] = [];
    try {
      const entries = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
      for (const entry of entries) {
        const content = fs.readFileSync(path.join(rulesDir, entry), 'utf-8').trim();
        if (!content) continue;

        // Parse frontmatter for glob patterns
        const { globs, body } = parseRuleFrontmatter(content, entry);

        // If a current file is specified, only include matching rules
        if (currentFile && globs.length > 0) {
          if (!globs.some(g => minimatch(currentFile, g))) continue;
        }

        layers.push({
          id: `pattern-${entry}`,
          name: entry,
          content: body,
          source: 'pattern',
          globs,
          priority: 50,
        });
      }
    } catch { /* skip */ }
    return layers;
  }

  private loadExtensionRules(_currentFile?: string): RuleLayer[] {
    // Extension-contributed rules would be loaded from the plugin system
    // For now, return empty — plugins register via addLayer()
    return [];
  }
}

/**
 * Parse frontmatter from a rule file.
 * Supports:
 *   ---
 *   globs: *.ts, *.tsx
 *   ---
 *   Rule content here...
 */
function parseRuleFrontmatter(content: string, _fileName: string): { globs: string[]; body: string } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!frontmatterMatch) return { globs: [], body: content };

  const [, frontmatter, body] = frontmatterMatch;
  const globs: string[] = [];

  for (const line of frontmatter!.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('globs:')) {
      const value = trimmed.slice(6).trim();
      globs.push(...value.split(',').map(g => g.trim()).filter(Boolean));
    }
  }

  return { globs, body: body!.trim() };
}
