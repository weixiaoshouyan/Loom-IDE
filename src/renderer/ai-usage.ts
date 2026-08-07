// Token 用量 / 成本估算工具——从 AIAgent.tsx 抽出，供多个组件复用。
// 费率为粗略估算（人民币/千 tokens），仅用于 UI 展示；真实计费以 provider 账单为准。

const DEFAULT_INPUT_PER_1K = 0.01;
const DEFAULT_OUTPUT_PER_1K = 0.03;

/** 依据模型名返回估算费率（input/output，单位：¥/千 tokens） */
export function estimateRates(model?: string): { input: number; output: number } {
  const m = (model || '').toLowerCase();
  if (!m) return { input: DEFAULT_INPUT_PER_1K, output: DEFAULT_OUTPUT_PER_1K };
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4\b|o1-preview|o1-mini|\bo1\b/.test(m)) return { input: 0.15, output: 0.6 };
  if (/claude-3.*opus|claude-3\.5-sonnet|claude-3.*sonnet/.test(m)) return { input: 0.21, output: 0.75 };
  if (/claude-3.*haiku/.test(m)) return { input: 0.0025, output: 0.0125 };
  if (/deepseek/.test(m)) return { input: 0.001, output: 0.002 };
  if (/qwen|glm|chatglm/.test(m)) return { input: 0.004, output: 0.012 };
  if (/gpt-3\.5|gpt-35/.test(m)) return { input: 0.0035, output: 0.007 };
  return { input: DEFAULT_INPUT_PER_1K, output: DEFAULT_OUTPUT_PER_1K };
}

export interface TokenUsage {
  input?: number;
  output?: number;
}

/** 将 token 用量格式化为「≈ Xk tokens · ¥Y 估算」 */
export function formatUsage(u?: TokenUsage | null, model?: string): string {
  if (!u || (!u.input && !u.output)) return '';
  const inT = u.input || 0;
  const outT = u.output || 0;
  const totalK = (inT + outT) / 1000;
  const rates = estimateRates(model);
  const cost = (inT / 1000) * rates.input + (outT / 1000) * rates.output;
  return `≈ ${totalK.toFixed(1)}k tokens · ¥${cost.toFixed(2)} 估算`;
}
