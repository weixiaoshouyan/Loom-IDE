/**
 * DebugControls — 断点调试控制条（继续/暂停/单步 + 调用栈 + 变量）。
 * 接主进程 CDP inspector（Node/TS 文件调试时可用）。
 */
import React, { useEffect, useState } from 'react';
import { getLoom } from '../loom-ipc';
import { t } from '@/shared/i18n';

interface StackFrame {
  functionName: string;
  url: string;
  line: number;
  callFrameId: string;
}

interface DebugVariable {
  name: string;
  value?: string;
}

export default function DebugControls() {
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stack, setStack] = useState<StackFrame[]>([]);
  const [variables, setVariables] = useState<DebugVariable[]>([]);

  useEffect(() => {
    let mounted = true;
    const loom = getLoom();
    loom?.debug?.isConnected?.().then((r) => { if (mounted) setConnected(!!r?.connected); }).catch(() => {});
    const offPaused = loom?.debug?.onPaused?.((p) => {
      if (!mounted) return;
      setPaused(true);
      setStack(p.stack || []);
      setVariables(p.variables || []);
    });
    const offResumed = loom?.debug?.onResumed?.(() => { if (mounted) setPaused(false); });
    const offExit = loom?.debug?.onExit?.(() => {
      if (!mounted) return;
      setPaused(false);
      setStack([]);
      setVariables([]);
      setConnected(false);
    });
    return () => {
      mounted = false;
      offPaused?.();
      offResumed?.();
      offExit?.();
    };
  }, []);

  const run = (fn: () => Promise<unknown> | undefined) => { void fn()?.catch(() => {}); };

  if (!connected) {
    return (
      <div className="debug-controls">
        <div className="debug-controls-hint">
          {t('panel.debugControlsHint')}
        </div>
      </div>
    );
  }

  return (
    <div className="debug-controls">
      <div className="debug-controls-toolbar">
        <button type="button" className="settings-btn-sm primary" disabled={!paused} onClick={() => run(() => getLoom()?.debug?.continue())} title={t('panel.debugContinue')}>
          ▶ {t('panel.debugContinue')}
        </button>
        <button type="button" className="settings-btn-sm" disabled={paused} onClick={() => run(() => getLoom()?.debug?.pause())} title={t('panel.debugPause')}>
          ⏸ {t('panel.debugPause')}
        </button>
        <button type="button" className="settings-btn-sm" disabled={!paused} onClick={() => run(() => getLoom()?.debug?.step('over'))} title={t('panel.debugStepOver')}>
          ⤵ {t('panel.debugStepOver')}
        </button>
        <button type="button" className="settings-btn-sm" disabled={!paused} onClick={() => run(() => getLoom()?.debug?.step('into'))} title={t('panel.debugStepInto')}>
          ⤓ {t('panel.debugStepInto')}
        </button>
        <button type="button" className="settings-btn-sm" disabled={!paused} onClick={() => run(() => getLoom()?.debug?.step('out'))} title={t('panel.debugStepOut')}>
          ⤴ {t('panel.debugStepOut')}
        </button>
        <span className="debug-controls-status">{paused ? t('panel.debugPaused') : t('panel.debugRunning')}</span>
      </div>

      <div className="debug-controls-body">
        <div className="debug-controls-column">
          <div className="debug-controls-title">{t('panel.debugCallStack')}</div>
          {stack.length === 0 ? (
            <div className="debug-controls-empty">{t('panel.debugNoStack')}</div>
          ) : stack.map((f, i) => (
            <div key={i} className="debug-frame" title={`${f.url}:${f.line}`}>
              <span className="debug-frame-name">{f.functionName}</span>
              <span className="debug-frame-loc">{f.url.split(/[\\/]/).pop() || f.url}:{f.line}</span>
            </div>
          ))}
        </div>
        <div className="debug-controls-column">
          <div className="debug-controls-title">{t('panel.debugVariables')}</div>
          {variables.length === 0 ? (
            <div className="debug-controls-empty">{t('panel.debugNoVariables')}</div>
          ) : variables.map((v, i) => (
            <div key={i} className="debug-var">
              <span className="debug-var-name">{v.name}</span>
              <span className="debug-var-value">{v.value ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
