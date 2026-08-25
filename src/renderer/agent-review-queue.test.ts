import { describe, expect, it } from 'vitest';
import {
  acceptReviewItem,
  addOrUpdateReviewItem,
  getReviewSummary,
  rejectReviewItem,
  type AgentReviewItem,
} from './agent-review-queue';

const item = (filePath: string, modified = 'next'): AgentReviewItem => ({
  id: filePath,
  filePath,
  original: 'old',
  modified,
  existed: true,
  status: 'pending',
});

describe('agent-review-queue', () => {
  it('adds new file previews and replaces pending previews for the same file', () => {
    const first = addOrUpdateReviewItem([], item('D:/demo/a.ts', 'v1'));
    const second = addOrUpdateReviewItem(first, item('D:/demo/a.ts', 'v2'));

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ filePath: 'D:/demo/a.ts', modified: 'v2', status: 'pending' });
  });

  it('keeps accepted history when a later preview for the same file arrives', () => {
    const accepted = acceptReviewItem([item('D:/demo/a.ts', 'v1')], 'D:/demo/a.ts');
    const next = addOrUpdateReviewItem(accepted, item('D:/demo/a.ts', 'v2'));

    expect(next).toHaveLength(2);
    expect(next.map(entry => entry.status)).toEqual(['accepted', 'pending']);
  });

  it('marks pending items accepted or rejected by id', () => {
    const queue = [item('D:/demo/a.ts'), item('D:/demo/b.ts')];

    expect(acceptReviewItem(queue, 'D:/demo/a.ts')[0]!.status).toBe('accepted');
    expect(rejectReviewItem(queue, 'D:/demo/b.ts')[1]!.status).toBe('rejected');
  });

  it('summarizes pending, accepted, and rejected counts', () => {
    const queue = rejectReviewItem(
      acceptReviewItem([item('D:/demo/a.ts'), item('D:/demo/b.ts'), item('D:/demo/c.ts')], 'D:/demo/a.ts'),
      'D:/demo/b.ts',
    );

    expect(getReviewSummary(queue)).toEqual({ pending: 1, accepted: 1, rejected: 1, total: 3 });
  });
});
