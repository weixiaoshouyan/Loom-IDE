export interface EditorHealthContainer {
  clientWidth: number;
  clientHeight: number;
  querySelector(selector: string): unknown;
}

export function isEditorDomHealthy(container: EditorHealthContainer | null): boolean {
  if (!container) return false;
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
  return !!container.querySelector('.view-lines');
}
