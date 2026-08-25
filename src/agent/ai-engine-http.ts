/**
 * 带指数退避的 fetch 封装。处理 429 / 5xx / 网络错误。
 * 尊重外部 AbortSignal（用户取消时立即停止重试）。
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { maxRetries?: number; baseDelayMs?: number } = {},
  externalSignal?: AbortSignal
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 800;
  let lastError: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (externalSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const resp = await fetch(url, { ...options, signal: externalSignal });
      // 不可重试：4xx（除 408/425/429）或 2xx/3xx
      if (resp.ok) return resp;
      const status = resp.status;
      const retryable = status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === maxRetries) return resp;
      const retryAfter = Number(resp.headers.get('retry-after')) || 0;
      const delay = retryAfter > 0
        ? retryAfter * 1000
        : baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise(r => setTimeout(r, delay));
    } catch (e: any) {
      lastError = e;
      // 用户主动中止：不重试
      if (e?.name === 'AbortError' || externalSignal?.aborted) throw e;
      if (attempt === maxRetries) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError || new Error('fetchWithRetry: exhausted retries');
}

export async function* readSSEStream(
  reader: any,
  isAnthropic: boolean,
  onUsage?: (input: number, output: number) => void
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  const READ_STALL_TIMEOUT_MS = 60000;
  while (true) {
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    const readPromise = reader.read();
    const stallPromise = new Promise<{ done: boolean; timedOut?: boolean }>((resolve) => {
      readTimer = setTimeout(() => resolve({ done: true, timedOut: true }), READ_STALL_TIMEOUT_MS);
    });
    const chunk = await Promise.race([readPromise, stallPromise]);
    if (chunk.timedOut) {
      try { await reader.cancel(); } catch {}
      break;
    }
    if (readTimer) clearTimeout(readTimer);
    const { done, value } = chunk as { done: boolean; value?: Uint8Array };
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataStr);
        if (isAnthropic) {
          if (parsed.type === 'content_block_delta') {
            const text = parsed.delta?.text;
            if (text) yield text;
          }
        } else {
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        }
        const usage = parsed.usage || parsed.message?.usage;
        if (usage) {
          const input = usage.prompt_tokens || usage.input_tokens || 0;
          const output = usage.completion_tokens || usage.output_tokens || 0;
          if (input || output) {
            onUsage?.(input, output);
          }
        }
      } catch {}
    }
  }
}
