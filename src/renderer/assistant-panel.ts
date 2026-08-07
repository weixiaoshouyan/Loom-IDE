export const ASSISTANT_PANEL_MIN_WIDTH = 340;
export const ASSISTANT_PANEL_MAX_WIDTH = 1040;

export function clampAssistantPanelWidth(width: number): number {
  return Math.max(ASSISTANT_PANEL_MIN_WIDTH, Math.min(ASSISTANT_PANEL_MAX_WIDTH, Math.round(width)));
}

export function buildCodexTerminalInput(): string {
  return 'codex\r';
}
