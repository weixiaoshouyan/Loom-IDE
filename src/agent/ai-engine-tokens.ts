/**
 * 轻量级 token 估算器。
 * 启发式：1 个中文字符 ≈ 1.5 token，1 个英文 token ≈ 4 字符
 * 实际 LLM 精确计数需要专用分词器（gpt-tokenizer / tiktoken），这里仅作 UI 显示用
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let chinese = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) chinese++;
    else other++;
  }
  // 工具调用 / JSON 序列化损耗 ~15%
  return Math.ceil(chinese * 1.5 + other / 4 * 1.15);
}

export function estimateMessagesTokens(messages: Array<{ role: string; content?: string; toolCalls?: any[] }>): number {
  // 每条消息加 4 token 的 role / 框架开销
  let total = 0;
  for (const m of messages) {
    total += 4;
    total += estimateTokens(m.content || '');
    if (Array.isArray(m.toolCalls)) {
      total += estimateTokens(JSON.stringify(m.toolCalls));
    }
  }
  return total;
}
