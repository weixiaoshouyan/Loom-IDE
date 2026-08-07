const DEFAULT_COMMANDS = ['npm run test:run', 'npm run lint'];
const PREFERRED_SCRIPTS = ['test:run', 'test', 'lint', 'typecheck', 'build'];
const MAX_OUTPUT_LENGTH = 4000;

export function getVerificationCommandOptions(packageJsonContent?: string | null): string[] {
  if (!packageJsonContent) return DEFAULT_COMMANDS;

  try {
    const parsed = JSON.parse(packageJsonContent);
    const scripts = parsed?.scripts && typeof parsed.scripts === 'object'
      ? parsed.scripts as Record<string, unknown>
      : {};
    const commands = PREFERRED_SCRIPTS
      .filter(script => typeof scripts[script] === 'string')
      .map(script => `npm run ${script}`);

    return commands.length > 0 ? commands : DEFAULT_COMMANDS;
  } catch {
    return DEFAULT_COMMANDS;
  }
}

export function normalizeVerificationOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  return output.slice(0, MAX_OUTPUT_LENGTH) + '…';
}
