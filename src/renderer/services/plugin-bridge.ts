/**
 * Renderer-side plugin bridge.
 *
 * Listens for webview events from the main process and notifies any
 * registered renderer components (e.g. a webview panel container).
 */

export interface WebviewPanelInfo {
  id: string;
  title: string;
  html?: string;
  url?: string;
}

export interface WebviewEvent {
  type: 'create' | 'dispose' | 'message';
  panelId: string;
  payload?: any;
}

let unsubscribe: (() => void) | null = null;
const listeners = new Set<(event: WebviewEvent) => void>();

export function startPluginBridge(): void {
  if (unsubscribe) return;
  const loom = window.loom;
  if (!loom?.plugins?.onWebviewEvent) return;
  unsubscribe = loom.plugins.onWebviewEvent((event: WebviewEvent) => {
    listeners.forEach(cb => {
      try { cb(event); } catch { /* ignore */ }
    });
  });
}

export function stopPluginBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}

export function onWebviewEvent(callback: (event: WebviewEvent) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function getWebviewPanels(): Promise<WebviewPanelInfo[]> {
  const loom = window.loom;
  if (!loom?.plugins?.getWebviewPanels) return [];
  return (await loom.plugins.getWebviewPanels()) || [];
}

export async function postMessageToWebview(panelId: string, message: any): Promise<boolean> {
  const loom = window.loom;
  if (!loom?.plugins?.postMessageToWebview) return false;
  return loom.plugins.postMessageToWebview(panelId, message);
}
