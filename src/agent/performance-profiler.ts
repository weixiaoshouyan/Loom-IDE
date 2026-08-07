/**
 * Loom Agent Performance Profiler
 *
 * Tracks and analyzes Agent runtime metrics for optimization.
 * Records per-run and aggregated statistics.
 */

export interface AgentRunMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  totalDurationMs?: number;
  totalRounds: number;
  tokenUsage: { input: number; output: number; total: number };
  costEstimate: number; // in USD
  toolCalls: Array<{ name: string; durationMs: number; success: boolean }>;
  apiCalls: { count: number; totalLatencyMs: number; avgLatencyMs: number };
  filesModified: string[];
  verificationResult?: { passed: boolean; durationMs: number };
  errors: string[];
  outcome: 'success' | 'failure' | 'timeout' | 'cancelled';
}

export interface AggregatedStats {
  totalRuns: number;
  avgDurationMs: number;
  avgRounds: number;
  avgTokensPerRun: number;
  avgCostPerRun: number;
  successRate: number;
  toolUsageBreakdown: Array<{ name: string; count: number; avgDurationMs: number; successRate: number }>;
  recentTrend: Array<{ date: string; runs: number; avgDurationMs: number; successRate: number }>;
}

export class PerformanceProfiler {
  private runs: AgentRunMetrics[] = [];
  private currentRun?: AgentRunMetrics;
  private maxHistory = 100;

  /**
   * Start tracking a new Agent run.
   */
  startRun(sessionId: string): void {
    this.currentRun = {
      sessionId,
      startTime: Date.now(),
      totalRounds: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
      costEstimate: 0,
      toolCalls: [],
      apiCalls: { count: 0, totalLatencyMs: 0, avgLatencyMs: 0 },
      filesModified: [],
      errors: [],
      outcome: 'success',
    };
  }

  recordApiCall(latencyMs: number, inputTokens: number, outputTokens: number): void {
    if (!this.currentRun) return;
    this.currentRun.apiCalls.count++;
    this.currentRun.apiCalls.totalLatencyMs += latencyMs;
    this.currentRun.apiCalls.avgLatencyMs = this.currentRun.apiCalls.totalLatencyMs / this.currentRun.apiCalls.count;
    this.currentRun.tokenUsage.input += inputTokens;
    this.currentRun.tokenUsage.output += outputTokens;
    this.currentRun.tokenUsage.total += inputTokens + outputTokens;
    // Rough cost estimate: $0.01/1K input tokens, $0.03/1K output tokens
    this.currentRun.costEstimate += (inputTokens / 1000 * 0.01) + (outputTokens / 1000 * 0.03);
  }

  recordToolCall(name: string, durationMs: number, success: boolean): void {
    if (!this.currentRun) return;
    this.currentRun.toolCalls.push({ name, durationMs, success });
  }

  recordFileModified(filePath: string): void {
    if (!this.currentRun) return;
    if (!this.currentRun.filesModified.includes(filePath)) {
      this.currentRun.filesModified.push(filePath);
    }
  }

  recordError(error: string): void {
    if (!this.currentRun) return;
    this.currentRun.errors.push(error);
  }

  recordVerification(passed: boolean, durationMs: number): void {
    if (!this.currentRun) return;
    this.currentRun.verificationResult = { passed, durationMs };
  }

  incrementRound(): void {
    if (!this.currentRun) return;
    this.currentRun.totalRounds++;
  }

  /**
   * End the current run and save metrics.
   */
  endRun(outcome: AgentRunMetrics['outcome']): AgentRunMetrics | undefined {
    if (!this.currentRun) return undefined;
    this.currentRun.endTime = Date.now();
    this.currentRun.totalDurationMs = this.currentRun.endTime - this.currentRun.startTime;
    this.currentRun.outcome = outcome;
    this.runs.push(this.currentRun);
    // Trim history
    if (this.runs.length > this.maxHistory) {
      this.runs = this.runs.slice(-this.maxHistory);
    }
    const result = this.currentRun;
    this.currentRun = undefined;
    return result;
  }

  /**
   * Get aggregated statistics across all recorded runs.
   */
  getAggregatedStats(): AggregatedStats {
    if (this.runs.length === 0) {
      return {
        totalRuns: 0,
        avgDurationMs: 0,
        avgRounds: 0,
        avgTokensPerRun: 0,
        avgCostPerRun: 0,
        successRate: 0,
        toolUsageBreakdown: [],
        recentTrend: [],
      };
    }

    const totalRuns = this.runs.length;
    const avgDurationMs = this.runs.reduce((s, r) => s + (r.totalDurationMs || 0), 0) / totalRuns;
    const avgRounds = this.runs.reduce((s, r) => s + r.totalRounds, 0) / totalRuns;
    const avgTokensPerRun = this.runs.reduce((s, r) => s + r.tokenUsage.total, 0) / totalRuns;
    const avgCostPerRun = this.runs.reduce((s, r) => s + r.costEstimate, 0) / totalRuns;
    const successCount = this.runs.filter(r => r.outcome === 'success').length;
    const successRate = successCount / totalRuns;

    // Tool usage breakdown
    const toolMap = new Map<string, { count: number; totalDuration: number; successes: number }>();
    for (const run of this.runs) {
      for (const tc of run.toolCalls) {
        const existing = toolMap.get(tc.name) || { count: 0, totalDuration: 0, successes: 0 };
        existing.count++;
        existing.totalDuration += tc.durationMs;
        if (tc.success) existing.successes++;
        toolMap.set(tc.name, existing);
      }
    }
    const toolUsageBreakdown = [...toolMap.entries()]
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        avgDurationMs: stats.totalDuration / stats.count,
        successRate: stats.successes / stats.count,
      }))
      .sort((a, b) => b.count - a.count);

    // Recent trend (last 7 days)
    const now = Date.now();
    const trend: AggregatedStats['recentTrend'] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - (i + 1) * 86400000;
      const dayEnd = now - i * 86400000;
      const dayRuns = this.runs.filter(r => r.startTime >= dayStart && r.startTime < dayEnd);
      const daySuccess = dayRuns.filter(r => r.outcome === 'success').length;
      trend.push({
        date: new Date(dayStart).toISOString().slice(0, 10),
        runs: dayRuns.length,
        avgDurationMs: dayRuns.length > 0 ? dayRuns.reduce((s, r) => s + (r.totalDurationMs || 0), 0) / dayRuns.length : 0,
        successRate: dayRuns.length > 0 ? daySuccess / dayRuns.length : 0,
      });
    }

    return {
      totalRuns,
      avgDurationMs,
      avgRounds,
      avgTokensPerRun,
      avgCostPerRun,
      successRate,
      toolUsageBreakdown,
      recentTrend: trend,
    };
  }

  /**
   * Get the most recent runs.
   */
  getRecentRuns(count = 10): AgentRunMetrics[] {
    return this.runs.slice(-count).reverse();
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.runs = [];
  }
}
