/**
 * Loom Agent Recipes (Task Templates)
 *
 * Pre-defined task templates that users can invoke with a single
 * command. Supports variable interpolation and automatic
 * verification.
 */

export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** The prompt template with {variable} placeholders */
  prompt: string;
  /** Variables that can be interpolated */
  variables: RecipeVariable[];
  /** Whether to auto-verify after execution */
  autoVerify: boolean;
  /** Whether to auto-apply edits */
  autoApply: boolean;
  /** Optional keyboard shortcut */
  shortcut?: string;
  /** Category for organization */
  category: 'fix' | 'create' | 'refactor' | 'test' | 'docs' | 'review' | 'custom';
}

export interface RecipeVariable {
  name: string;
  description: string;
  type: 'text' | 'selection' | 'file' | 'clipboard' | 'ask';
  default?: string;
  required: boolean;
}

export interface RecipeContext {
  selection?: string;
  filePath?: string;
  clipboard?: string;
  workspacePath: string;
}

export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: 'fix-type-error',
    name: 'Fix TypeScript Errors',
    description: 'Find and fix all TypeScript errors in the selected file or project',
    prompt: 'Find and fix all TypeScript errors in {target}. Run tsc --noEmit after fixing to verify all errors are resolved.',
    variables: [
      { name: 'target', description: 'File or directory to fix', type: 'file', required: true },
    ],
    autoVerify: true,
    autoApply: true,
    category: 'fix',
  },
  {
    id: 'add-tests',
    name: 'Add Unit Tests',
    description: 'Generate unit tests for the selected code',
    prompt: 'Write comprehensive unit tests for {selection}. Use the project\'s existing test framework. Cover edge cases, error paths, and happy paths.',
    variables: [
      { name: 'selection', description: 'Code to test', type: 'selection', required: true },
    ],
    autoVerify: true,
    autoApply: false,
    category: 'test',
  },
  {
    id: 'refactor-clean',
    name: 'Refactor for Clean Code',
    description: 'Refactor the selected code following clean code principles',
    prompt: 'Refactor the following code to improve readability, maintainability, and follow clean code principles:\n\n{selection}\n\nFocus on: single responsibility, meaningful names, reducing complexity. Explain each change.',
    variables: [
      { name: 'selection', description: 'Code to refactor', type: 'selection', required: true },
    ],
    autoVerify: false,
    autoApply: false,
    category: 'refactor',
  },
  {
    id: 'explain-code',
    name: 'Explain Code',
    description: 'Get a detailed explanation of the selected code',
    prompt: 'Explain the following code in detail. Cover: what it does, why it does it this way, potential issues, and suggestions for improvement:\n\n{selection}',
    variables: [
      { name: 'selection', description: 'Code to explain', type: 'selection', required: true },
    ],
    autoVerify: false,
    autoApply: false,
    category: 'review',
  },
  {
    id: 'add-documentation',
    name: 'Add Documentation',
    description: 'Generate JSDoc/documentation comments for the selected code',
    prompt: 'Add comprehensive JSDoc documentation to the following code. Include: function description, @param, @returns, @throws where appropriate, and usage examples:\n\n{selection}',
    variables: [
      { name: 'selection', description: 'Code to document', type: 'selection', required: true },
    ],
    autoVerify: false,
    autoApply: true,
    category: 'docs',
  },
  {
    id: 'find-bugs',
    name: 'Find Potential Bugs',
    description: 'Analyze code for potential bugs and security issues',
    prompt: 'Analyze the following code for potential bugs, security issues, and edge cases. Provide specific line references and suggested fixes:\n\n{target}',
    variables: [
      { name: 'target', description: 'Code to analyze', type: 'file', required: true },
    ],
    autoVerify: false,
    autoApply: false,
    category: 'review',
  },
  {
    id: 'optimize-performance',
    name: 'Optimize Performance',
    description: 'Identify and fix performance bottlenecks',
    prompt: 'Analyze the following code for performance issues. Identify bottlenecks, unnecessary computations, and memory leaks. Provide optimized alternatives:\n\n{selection}',
    variables: [
      { name: 'selection', description: 'Code to optimize', type: 'selection', required: true },
    ],
    autoVerify: false,
    autoApply: false,
    category: 'refactor',
  },
  {
    id: 'generate-readme',
    name: 'Generate README',
    description: 'Generate or update project README based on codebase',
    prompt: 'Generate a comprehensive README.md for this project. Include: project description, installation, usage examples, API reference, and contribution guidelines. Base it on the actual codebase.',
    variables: [],
    autoVerify: false,
    autoApply: false,
    category: 'docs',
  },
];

export class RecipeManager {
  private recipes: Map<string, Recipe> = new Map();
  private customRecipes: Recipe[] = [];

  constructor() {
    // Load built-in recipes
    for (const recipe of BUILTIN_RECIPES) {
      this.recipes.set(recipe.id, recipe);
    }
  }

  get(id: string): Recipe | undefined {
    return this.recipes.get(id);
  }

  list(): Recipe[] {
    return [...this.recipes.values()];
  }

  listByCategory(category: Recipe['category']): Recipe[] {
    return this.list().filter(r => r.category === category);
  }

  addCustom(recipe: Recipe): void {
    this.recipes.set(recipe.id, recipe);
    this.customRecipes.push(recipe);
  }

  removeCustom(id: string): boolean {
    if (this.customRecipes.some(r => r.id === id)) {
      this.recipes.delete(id);
      this.customRecipes = this.customRecipes.filter(r => r.id !== id);
      return true;
    }
    return false;
  }

  /**
   * Interpolate variables in a recipe prompt.
   */
  interpolate(recipe: Recipe, context: RecipeContext, extraVars?: Record<string, string>): string {
    let prompt = recipe.prompt;

    const vars: Record<string, string> = {
      selection: context.selection || '',
      target: context.filePath || context.selection || '',
      file: context.filePath || '',
      clipboard: context.clipboard || '',
      workspace: context.workspacePath,
      ...extraVars,
    };

    // Replace {variable} placeholders
    for (const [key, value] of Object.entries(vars)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    return prompt;
  }

  /**
   * Get variables that need user input (no default, not auto-filled).
   */
  getRequiredInputs(recipe: Recipe, context: RecipeContext): RecipeVariable[] {
    return recipe.variables.filter(v => {
      if (!v.required) return false;
      // Check if already filled by context
      if (v.type === 'selection' && context.selection) return false;
      if (v.type === 'file' && context.filePath) return false;
      if (v.type === 'clipboard' && context.clipboard) return false;
      if (v.default) return false;
      return true;
    });
  }
}
