import { AGENT_TOOLS, type ToolCall } from './tool-types';

/**
 * Format tool definitions for the AI system prompt
 */
export function getToolSystemPrompt(): string {
  let prompt = `\n\nYou have access to the following tools to read, write, edit, and analyze code in the user's project:\n\n`;

  for (const tool of AGENT_TOOLS) {
    prompt += `### ${tool.name}\n${tool.description}\n`;
    if (tool.parameters.required.length > 0) {
      prompt += `Required: ${tool.parameters.required.join(', ')}\n`;
    }
    prompt += `Parameters: ${JSON.stringify(tool.parameters.properties)}\n\n`;
  }

  prompt += `\n## Tool Usage Examples

### Reading a file
\`\`\`tool_call
{"name": "read_file", "arguments": {"filePath": "src/index.ts"}}
\`\`\`

### Editing a file (REPLACE old code with new code)
\`\`\`tool_call
{"name": "edit_file", "arguments": {"filePath": "src/index.ts", "oldString": "const old = 1;", "newString": "const new = 2;"}}
\`\`\`

### Adding new code (use empty oldString to insert at beginning, or find a nearby line to replace)
\`\`\`tool_call
{"name": "edit_file", "arguments": {"filePath": "src/index.ts", "oldString": "// existing line", "newString": "// new line to add\\n// existing line"}}
\`\`\`

### Writing a new file
\`\`\`tool_call
{"name": "write_file", "arguments": {"filePath": "src/newfile.ts", "content": "// file content"}}
\`\`\`

### Searching code
\`\`\`tool_call
{"name": "search_code", "arguments": {"pattern": "function_name", "fileTypes": ".ts,.tsx"}}
\`\`\`

### Running a command
\`\`\`tool_call
{"name": "run_command", "arguments": {"command": "npm", "args": ["test"]}}
\`\`\`

## Important Rules
1. Always read files before editing them to understand the current content
2. Always search before making assumptions about the codebase
3. When editing files, make sure the oldString matches EXACTLY what's in the file (including whitespace and indentation)
4. To ADD new code, you MUST provide both oldString (existing code to anchor) and newString (old code + new code)
5. NEVER leave newString empty when you want to add code - that would DELETE the oldString
6. Use write_file for creating entirely new files, edit_file for modifying existing files
7. You can make multiple tool calls in sequence (they will execute in parallel)
8. After receiving tool results, continue responding to the user
9. Use write_memory/read_memory to maintain working memory across rounds
10. Use analyze_dependencies before making changes to understand impact
11. Use run_test_at to run specific tests after making changes
12. Use undo_last_edit to revert an incorrect change
13. Multiple tool calls in one turn execute in parallel for efficiency`;

  return prompt;
}

/**
 * Parse tool calls from AI response text
 */
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Match ```tool_call ... ``` blocks
  const regex = /```tool_call\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!.trim());
      calls.push({
        id: 'call_' + Math.random().toString(36).substring(2, 10),
        type: 'function',
        function: {
          name: parsed.name,
          arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments),
        },
      });
    } catch (e) {
      // Try parsing as array
      try {
        const arr = JSON.parse(match[1]!.trim());
        if (Array.isArray(arr)) {
          for (const item of arr) {
            calls.push({
              id: 'call_' + Math.random().toString(36).substring(2, 10),
              type: 'function',
              function: {
                name: item.name,
                arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments),
              },
            });
          }
        }
      } catch {}
    }
  }

  return calls;
}

/**
 * Strip tool call blocks from AI response text for display
 */
export function stripToolCalls(text: string): string {
  return text.replace(/```tool_call\s*\n[\s\S]*?```/g, '').trim();
}
