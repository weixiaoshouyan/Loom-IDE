/**
 * Loom Skill System
 * Skills are predefined prompt templates that can be invoked to augment AI capabilities.
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'code' | 'analysis' | 'productivity' | 'creative' | 'system';
  prompt: string;
  icon: string;
  builtin: boolean;
}

const BUILTIN_SKILLS: Skill[] = [
  // === Code ===
  {
    id: 'explain-code',
    name: 'Explain Code',
    description: 'Explain what the selected code does in detail',
    category: 'code',
    prompt: 'Please explain the following code in detail. Break down each section, explain the logic, and highlight any patterns or techniques used.\n\n```\n{code}\n```',
    icon: '📖',
    builtin: true,
  },
  {
    id: 'improve-code',
    name: 'Improve Code',
    description: 'Suggest improvements for the selected code',
    category: 'code',
    prompt: 'Review the following code and suggest specific improvements for readability, performance, and best practices. Provide the improved code with explanations.\n\n```\n{code}\n```',
    icon: '🔧',
    builtin: true,
  },
  {
    id: 'add-comments',
    name: 'Add Comments',
    description: 'Add comprehensive comments to the selected code',
    category: 'code',
    prompt: 'Add comprehensive and meaningful comments to the following code. Include JSDoc/docstring comments for functions, inline comments for complex logic, and a header comment describing the file purpose.\n\n```\n{code}\n```',
    icon: '💬',
    builtin: true,
  },
  {
    id: 'write-tests',
    name: 'Write Tests',
    description: 'Generate unit tests for the selected code',
    category: 'code',
    prompt: 'Write comprehensive unit tests for the following code. Cover edge cases, happy paths, and error handling. Use a testing framework appropriate for the language.\n\n```\n{code}\n```',
    icon: '🧪',
    builtin: true,
  },
  {
    id: 'refactor-code',
    name: 'Refactor Code',
    description: 'Refactor code following clean code principles',
    category: 'code',
    prompt: 'Refactor the following code following SOLID principles, clean code practices, and modern patterns. Explain your changes and trade-offs.\n\n```\n{code}\n```',
    icon: '♻️',
    builtin: true,
  },
  {
    id: 'find-bugs',
    name: 'Find Bugs',
    description: 'Analyze code for bugs and potential issues',
    category: 'code',
    prompt: 'Carefully analyze the following code for bugs, logic errors, edge cases, security vulnerabilities, and potential runtime errors. For each issue found, explain the problem and suggest a fix.\n\n```\n{code}\n```',
    icon: '🐛',
    builtin: true,
  },
  {
    id: 'generate-docs',
    name: 'Generate Docs',
    description: 'Generate documentation for the selected code',
    category: 'code',
    prompt: 'Generate comprehensive documentation for the following code. Include a high-level overview, usage examples, API reference, and any important notes.\n\n```\n{code}\n```',
    icon: '📄',
    builtin: true,
  },
  {
    id: 'convert-language',
    name: 'Convert Language',
    description: 'Convert code from one language to another',
    category: 'code',
    prompt: 'Convert the following code to {target}. Maintain the same logic, style, and behavior. Add comments explaining any language-specific differences.\n\n```\n{code}\n```',
    icon: '🔄',
    builtin: true,
  },

  // === Analysis ===
  {
    id: 'analyze-complexity',
    name: 'Analyze Complexity',
    description: 'Analyze time and space complexity',
    category: 'analysis',
    prompt: 'Analyze the time and space complexity of the following code. Explain the Big-O notation for each function, identify bottlenecks, and suggest optimizations.\n\n```\n{code}\n```',
    icon: '📊',
    builtin: true,
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Perform a security audit on the code',
    category: 'analysis',
    prompt: 'Perform a thorough security audit of the following code. Check for OWASP Top 10 vulnerabilities, injection risks, authentication issues, data exposure, and insecure configurations.\n\n```\n{code}\n```',
    icon: '🔒',
    builtin: true,
  },
  {
    id: 'summarize-text',
    name: 'Summarize Text',
    description: 'Create a concise summary of the text',
    category: 'analysis',
    prompt: 'Create a concise summary of the following text. Highlight the key points, main arguments, and conclusions.\n\n```\n{text}\n```',
    icon: '📝',
    builtin: true,
  },

  // === Productivity ===
  {
    id: 'git-commit',
    name: 'Git Commit Message',
    description: 'Generate a conventional commit message for the changes',
    category: 'productivity',
    prompt: 'Generate a conventional commit message based on the following diff/changes. Use the format: type(scope): description. Types: feat, fix, docs, style, refactor, perf, test, chore.\n\n```\n{diff}\n```',
    icon: '📦',
    builtin: true,
  },
  {
    id: 'api-client',
    name: 'Generate API Client',
    description: 'Generate an API client from a specification',
    category: 'productivity',
    prompt: 'Generate an API client based on the following API specification. Include proper error handling, type definitions, and async support. Use {language} programming language.\n\n```\n{spec}\n```',
    icon: '📡',
    builtin: true,
  },
  {
    id: 'data-structure',
    name: 'Design Data Structure',
    description: 'Design a data structure for the given requirements',
    category: 'productivity',
    prompt: 'Design an optimal data structure for the following requirements. Consider memory usage, access patterns, and performance characteristics. Provide the implementation with explanations.\n\nRequirements:\n{requirements}',
    icon: '🗂️',
    builtin: true,
  },

  // === Creative ===
  {
    id: 'diagram-mermaid',
    name: 'Generate Mermaid Diagram',
    description: 'Create a Mermaid.js diagram description',
    category: 'creative',
    prompt: 'Create a Mermaid.js diagram based on the following description. Use the most appropriate diagram type (flowchart, sequence, class, etc.) and ensure the syntax is valid.\n\n{description}',
    icon: '📐',
    builtin: true,
  },
  {
    id: 'regex-generator',
    name: 'Regex Generator',
    description: 'Generate a regex pattern from a description',
    category: 'creative',
    prompt: 'Generate a regular expression that matches the following description. Explain each part of the pattern and provide test cases.\n\nPattern should match: {description}',
    icon: '🎯',
    builtin: true,
  },

  // === System ===
  {
    id: 'custom-prompt',
    name: 'Custom Prompt',
    description: 'Write a custom prompt to guide the AI',
    category: 'system',
    prompt: '{custom}',
    icon: '✏️',
    builtin: true,
  },
];

export class SkillManager {
  private skills: Skill[] = [];
  private onUpdate?: (skills: Skill[]) => void;

  constructor() {
    this.skills = [...BUILTIN_SKILLS];
  }

  onUpdateConfig(cb: (skills: Skill[]) => void) { this.onUpdate = cb; }

  getAll(): Skill[] { return [...this.skills]; }

  getByCategory(category: Skill['category']): Skill[] {
    return this.skills.filter(s => s.category === category);
  }

  getById(id: string): Skill | undefined {
    return this.skills.find(s => s.id === id);
  }

  addSkill(skill: Omit<Skill, 'builtin'> & { builtin?: boolean }) {
    if (this.skills.find(s => s.id === skill.id)) return false;
    this.skills.push({ ...skill, builtin: skill.builtin ?? false });
    this.onUpdate?.(this.skills);
    return true;
  }

  updateSkill(id: string, patch: Partial<Skill>) {
    this.skills = this.skills.map(s => s.id === id ? { ...s, ...patch } : s);
    this.onUpdate?.(this.skills);
  }

  removeSkill(id: string) {
    const skill = this.skills.find(s => s.id === id);
    if (!skill || skill.builtin) return false;
    this.skills = this.skills.filter(s => s.id !== id);
    this.onUpdate?.(this.skills);
    return true;
  }

  /**
   * Get the resolved prompt for a skill, with variables replaced.
   * Variables: {code}, {text}, {diff}, {requirements}, {description}, {target}, {language}, {spec}, {custom}
   */
  resolvePrompt(skillId: string, variables: Record<string, string>): string | null {
    const skill = this.getById(skillId);
    if (!skill) return null;
    let prompt = skill.prompt;
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(`{${key}}`, value || `{${key}}`);
    }
    // Handle {code} specially - it's the most common
    if (variables['code'] || variables['selectedText']) {
      prompt = prompt.replace('{code}', variables['code'] || variables['selectedText']);
    }
    return prompt;
  }

  /**
   * Get skill-enhanced system prompt for the active skill context
   */
  getSkillSystemPrompt(activeSkillId?: string): string {
    if (!activeSkillId) return '';
    const skill = this.getById(activeSkillId);
    if (!skill) return '';
    return `\n\n[Active Skill: ${skill.name}]\n${skill.prompt}`;
  }
}

export function getBuiltinSkills(): Skill[] { return [...BUILTIN_SKILLS]; }
