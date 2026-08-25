/**
 * useNotifications — 全局通知状态 hook（App.tsx 拆出的领域模块）。
 *
 * 集中管理通知队列（NotificationContainer 消费），并订阅类型化事件总线上的
 * `loom:notify`（任何组件/模块发通知都走这里，单一事实源）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationItem, NotificationType } from '../components/Notification';
import { onLoomEvent } from '../loom-events';

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const notifIdRef = useRef(0);

  const addNotification = useCallback((message: string, type: NotificationType = 'info', duration?: number) => {
    const id = 'n' + (++notifIdRef.current);
    setNotifications(prev => [...prev, { id, type, message, duration }]);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // 事件总线：任何模块 emitLoomEvent('loom:notify', ...) → 进入通知队列
  useEffect(() => {
    return onLoomEvent('loom:notify', ({ message, type, duration }) => {
      if (message) addNotification(message, type || 'info', duration);
    });
  }, [addNotification]);

  return { notifications, addNotification, dismissNotification };
}
