import React, { useEffect, useRef } from 'react';
import { Terminal as XTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props { visible: boolean; termId?: string; }

export default function Terminal({ visible, termId = 'term-1' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const createdRef = useRef(false);
  const currentTermId = useRef(termId);

  useEffect(() => {
    currentTermId.current = termId;
  }, [termId]);

  useEffect(() => {
    if (!ref.current || !visible) return;

    const term = new XTerminal({
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      theme: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', selectionBackground: '#264f78', black: '#1e1e1e', red: '#f44747', green: '#6a9955', yellow: '#cca700', blue: '#569cd6', magenta: '#c586c0', cyan: '#4ec9b0', white: '#d4d4d4' },
      cursorBlink: true, scrollback: 5000, allowProposedApi: true,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(ref.current);
    setTimeout(() => { try { fitAddon.fit(); } catch {} }, 100);

    const id = currentTermId.current;
    (window as any).loom.terminal.create(id);

    const onDataDispose = term.onData((data: string) => {
      (window as any).loom.terminal.write(currentTermId.current, data);
    });

    const removeOnData = (window as any).loom.terminal.onData(id, (data: string) => {
      termRef.current?.write(data);
    });

    const removeOnExit = (window as any).loom.terminal.onExit(id, () => {});

    const handleResize = () => {
      try {
        fitAddon.fit();
        (window as any).loom.terminal.resize(currentTermId.current, termRef.current?.cols, termRef.current?.rows);
      } catch {}
    };
    window.addEventListener('resize', handleResize);

    createdRef.current = true;

    return () => {
      window.removeEventListener('resize', handleResize);
      onDataDispose?.dispose?.();
      removeOnData?.();
      removeOnExit?.();
      // Kill the PTY process associated with this terminal
      try { (window as any).loom.terminal.kill(currentTermId.current); } catch {}
      try { term.dispose(); } catch {}
      termRef.current = null;
      createdRef.current = false;
    };
  }, [visible, termId]);

  useEffect(() => {
    if (visible && fitRef.current) {
      setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 50);
    }
  }, [visible]);

  return <div ref={ref} className="terminal-container" style={{ display: visible ? 'block' : 'none', width: '100%', height: '100%' }} />;
}
