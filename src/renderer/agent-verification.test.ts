import { describe, expect, it } from 'vitest';
import { getVerificationCommandOptions, normalizeVerificationOutput } from './agent-verification';

describe('agent-verification', () => {
  it('prefers package scripts used for verification', () => {
    const options = getVerificationCommandOptions(JSON.stringify({
      scripts: {
        build: 'vite build',
        lint: 'eslint .',
        'test:run': 'vitest run',
      },
    }));

    expect(options).toEqual(['npm run test:run', 'npm run lint', 'npm run build']);
  });

  it('falls back to useful defaults when package.json is missing or invalid', () => {
    expect(getVerificationCommandOptions()).toEqual(['npm run test:run', 'npm run lint']);
    expect(getVerificationCommandOptions('{bad json')).toEqual(['npm run test:run', 'npm run lint']);
  });

  it('keeps verification output readable in the task panel', () => {
    expect(normalizeVerificationOutput('a'.repeat(5005))).toHaveLength(4001);
  });
});
