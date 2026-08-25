import React, { useEffect, useSyncExternalStore } from 'react';
import { t } from '@/shared/i18n';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmItem extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const queue: ConfirmItem[] = [];
let listeners: Array<() => void> = [];

function notify() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function getSnapshot(): ConfirmItem | null {
  return queue[0] ?? null;
}

export const confirmDialog = {
  ask(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      queue.push({ ...opts, resolve });
      notify();
    });
  },
};

function resolveCurrent(ok: boolean) {
  const item = queue.shift();
  if (item) item.resolve(ok);
  notify();
}

export default function ConfirmModal() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resolveCurrent(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        resolveCurrent(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current]);

  if (!current) return null;

  const confirmLabel = current.confirmText || t('confirm.ok');
  const cancelLabel = current.cancelText || t('confirm.cancel');

  return (
    <div
      className="confirm-modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={current.title ? 'confirm-modal-title' : undefined}
      aria-describedby="confirm-modal-message"
      onMouseDown={e => {
        // 点击遮罩层（非弹窗本体）视为取消
        if (e.target === e.currentTarget) resolveCurrent(false);
      }}
    >
      <div className="confirm-modal" onMouseDown={e => e.stopPropagation()}>
        {current.title && (
          <div className="confirm-modal-title" id="confirm-modal-title">
            {current.title}
          </div>
        )}
        <div className="confirm-modal-message" id="confirm-modal-message">
          {current.message}
        </div>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn cancel"
            onClick={() => resolveCurrent(false)}
            autoFocus={false}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn confirm ${current.danger ? 'danger' : ''}`}
            onClick={() => resolveCurrent(true)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
