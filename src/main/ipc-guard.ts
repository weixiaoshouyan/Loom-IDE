/**
 * IPC sender validation — defense-in-depth for security-sensitive handlers.
 *
 * Electron's `ipcRenderer` is reachable from the main window's main frame, its
 * iframes/subframes, AND `<webview>` guest pages (plugin webviews). A guest or
 * injected subframe script that somehow obtains a `window.loom` reference must
 * not be able to mutate security policy (command allow/block lists, agent
 * settings). This guard rejects anything that is not the main window's main
 * frame:
 *
 *   - `sender.getType() === 'window'` — webview guests report 'webview';
 *   - `senderFrame.parent === null`  — only the top-level frame has no parent.
 */
export function isTrustedSender(event: { sender: any; senderFrame?: any }): boolean {
  try {
    const wc = event?.sender;
    if (!wc || typeof wc.getType !== 'function') return false;
    if (wc.getType() !== 'window') return false;
    const frame = event?.senderFrame;
    if (!frame) return false;
    return frame.parent === null;
  } catch {
    return false;
  }
}
