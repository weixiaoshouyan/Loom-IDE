import React, { useEffect, useRef } from 'react';
import { t } from '@/shared/i18n';
import { Terminal as XTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { getLoom } from '../loom-ipc';
import 'xterm/css/xterm.css';

// Terminal theme configurations
const darkTheme = {
  background: '#111214',
  foreground: '#e6e8ee',
  cursor: '#a8adb8',
  selectionBackground: '#264f78',
  black: '#111214',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#cca700',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#e6e8ee',
};

const lightTheme = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#333333',
  selectionBackground: '#c4dcf0',
  black: '#333333',
  red: '#cd3131',
  green: '#168233',
  yellow: '#bf8803',
  blue: '#0451a5',
  magenta: '#a133b3',
  cyan: '#098658',
  white: '#333333',
};

function getTerminalTheme() {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') return lightTheme;
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? lightTheme : darkTheme;
  }
  return darkTheme;
}

interface Props { visible: boolean; termId?: string; workspacePath?: string; }

export default function Terminal({ visible, termId = 'term-1', workspacePath }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // The terminal instance lifecycle is keyed to termId: changing termId
  // disposes the old xterm and creates a new one.
  useEffect(() => {
    if (!ref.current) return;

    const term = new XTerminal({
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      theme: getTerminalTheme(),
      cursorBlink: true, scrollback: 5000, allowProposedApi: true,
    });

    // Listen for theme changes
    const themeObserver = new MutationObserver(() => {
      term.options.theme = getTerminalTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(ref.current);
    setTimeout(() => { try { fitAddon.fit(); } catch { /* fit failed, ignore */ } }, 100);

    getLoom()?.terminal?.create?.(termId, workspacePath);

    const onDataDispose = term.onData((data: string) => {
      getLoom()?.terminal?.write?.(termId, data);
    });

    const removeOnData = getLoom()?.terminal?.onData?.(termId, (data: string) => {
      termRef.current?.write(data);
    });

    const removeOnExit = getLoom()?.terminal?.onExit?.(termId, (code: number | null) => {
      const c = typeof code === 'number' ? code : 0;
      // Map common exit codes to friendly messages
      let label = t('terminal.exitCodeLabel', { code: c });
      if (c === 0) label = t('terminal.exitNormal');
      else if (c === -1073741510 || c === 0xC000013A) label = t('terminal.exitInterrupted');
      else if (c === 1) label = t('terminal.exitGenericError');
      else if (c === 2) label = t('terminal.exitUsageError');
      else if (c === 126) label = t('terminal.exitPermissionDenied');
      else if (c === 127) label = t('terminal.exitCommandNotFound');
      termRef.current?.writeln(`\r\n\x1b[90m${t('terminal.processExitedWithLabel', { label })}\x1b[0m`);
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
        getLoom()?.terminal?.resize?.(termId, termRef.current!.cols, termRef.current!.rows);
      } catch { /* resize failed, ignore */ }
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(ref.current);

      return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      removeOnData?.();
      removeOnExit?.();
      onDataDispose.dispose();
      try { getLoom()?.terminal?.kill?.(termId); } catch { /* terminal already dead */ }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [termId]);

  useEffect(() => {
    if (visible && fitRef.current) {
      setTimeout(() => { try { fitRef.current?.fit(); } catch { /* fit failed, ignore */ } }, 50);
    }
  }, [visible]);

  return <div ref={ref} className="terminal-container" style={{ display: visible ? 'block' : 'none', width: '100%', height: '100%' }} />;
}
