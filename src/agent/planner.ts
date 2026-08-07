/**
 * Planner mode for the Loom Agent.
 *
 * When planner mode is enabled, the Agent first produces a structured plan
 * before executing tool calls. The plan is yielded to the UI so the user can
 * review or abort before the Agent continues.
 */

export interface PlanStep {
  id: number;
  description: string;
  tool?: string;
  dependsOn?: number[];
}

export interface AgentPlan {
  goal: string;
  steps: PlanStep[];
}

const PLANNING_PROMPT_APPENDIX = `

Before using any tools, you MUST produce a structured plan. Output the plan as a single JSON code block with this exact schema:

\`\`\`json
{
  "goal": "one-sentence summary of the task",
  "steps": [
    { "id": 1, "description": "concise action description", "tool": "optional tool name", "dependsOn": [] },
    { "id": 2, "description": "concise action description", "tool": "optional tool name", "dependsOn": [1] }
  ]
}
\`\`\`

After emitting the plan, wait for user confirmation. Once confirmed, proceed to execute the steps using the available tools. Do not repeat the plan unless asked.
`;

export function addPlannerPrompt(systemPrompt: string): string {
  return systemPrompt + PLANNING_PROMPT_APPENDIX;
}

export function parsePlan(content: string): AgentPlan | null {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonText = match ? match[1] : content;
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.steps)) return null;
    return {
      goal: String(parsed.goal || ''),
      steps: parsed.steps.map((s: any, idx: number) => ({
        id: Number(s.id || idx + 1),
        description: String(s.description || ''),
        tool: s.tool ? String(s.tool) : undefined,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(Number) : undefined,
      })),
    };
  } catch {
    return null;
  }
}

export function formatPlanForDisplay(plan: AgentPlan): string {
  let output = `## Plan: ${plan.goal || 'Untitled'}\n\n`;
  plan.steps.forEach((step, i) => {
    output += `${i + 1}. **${step.description}**`;
    if (step.tool) output += ` *(tool: ${step.tool})*`;
    output += '\n';
  });
  return output;
}
