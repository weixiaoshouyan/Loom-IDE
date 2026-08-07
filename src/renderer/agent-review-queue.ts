export type AgentReviewStatus = 'pending' | 'accepted' | 'rejected';

export interface AgentReviewItem {
  id: string;
  filePath: string;
  original: string;
  modified: string;
  existed: boolean;
  status: AgentReviewStatus;
}

export interface AgentReviewSummary {
  pending: number;
  accepted: number;
  rejected: number;
  total: number;
}

export function addOrUpdateReviewItem(queue: AgentReviewItem[], item: AgentReviewItem): AgentReviewItem[] {
  const existingPending = queue.findIndex(entry => entry.id === item.id && entry.status === 'pending');
  if (existingPending === -1) {
    return [...queue, { ...item, status: 'pending' }];
  }

  const next = [...queue];
  next[existingPending] = { ...next[existingPending], ...item, status: 'pending' };
  return next;
}

export function acceptReviewItem(queue: AgentReviewItem[], id: string): AgentReviewItem[] {
  return queue.map(item => item.id === id && item.status === 'pending'
    ? { ...item, status: 'accepted' }
    : item);
}

export function rejectReviewItem(queue: AgentReviewItem[], id: string): AgentReviewItem[] {
  return queue.map(item => item.id === id && item.status === 'pending'
    ? { ...item, status: 'rejected' }
    : item);
}

export function getReviewSummary(queue: AgentReviewItem[]): AgentReviewSummary {
  return queue.reduce<AgentReviewSummary>((summary, item) => {
    summary.total += 1;
    summary[item.status] += 1;
    return summary;
  }, { pending: 0, accepted: 0, rejected: 0, total: 0 });
}
