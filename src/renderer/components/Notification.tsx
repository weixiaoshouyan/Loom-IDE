import React, { useEffect, useCallback } from 'react';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
}

interface Props {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
}

const iconMap: Record<NotificationType, React.ReactNode> = {
  info: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zM7.25 5h1.5v1.5h-1.5V5zm0 2.5h1.5v4h-1.5v-4z" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.78 5.22l-4.5 5.5a.75.75 0 01-1.12.02l-2-2a.75.75 0 111.06-1.06l1.42 1.42 3.96-4.86a.75.75 0 111.18.98z" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
    </svg>
  ),
};

const colorMap: Record<NotificationType, string> = {
  info: 'var(--accent)',
  success: 'var(--green)',
  warning: 'var(--yellow)',
  error: 'var(--red)',
};

export default function NotificationContainer({ notifications, onDismiss }: Props) {
  return (
    <div className="notification-container">
      {notifications.map((n) => (
        <NotificationToast key={n.id} item={n} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function NotificationToast({ item, onDismiss }: { item: NotificationItem; onDismiss: (id: string) => void }) {
  const dismiss = useCallback(() => onDismiss(item.id), [item.id, onDismiss]);

  useEffect(() => {
    const dur = item.duration ?? (item.type === 'error' ? 8000 : 4000);
    const timer = setTimeout(dismiss, dur);
    return () => clearTimeout(timer);
  }, [item.duration, item.type, dismiss]);

  return (
    <div className={`notification ${item.type}`} style={{ '--notif-accent': colorMap[item.type] } as React.CSSProperties}>
      <span className="notification-icon" style={{ color: colorMap[item.type] }}>
        {iconMap[item.type]}
      </span>
      <span className="notification-message">{item.message}</span>
      <button className="notification-close" onClick={dismiss} title="关闭">
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}
