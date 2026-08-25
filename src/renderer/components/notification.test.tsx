// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import NotificationContainer, { type NotificationItem } from './Notification';
import { setLocale } from '@/shared/i18n';

setLocale('zh-CN');

describe('NotificationContainer', () => {
  it('renders message text with the given type class', () => {
    const items: NotificationItem[] = [
      { id: 'n1', type: 'success', message: 'Saved', duration: 10_000 },
    ];
    render(<NotificationContainer notifications={items} onDismiss={() => {}} />);
    const msg = screen.getByText('Saved');
    expect(msg).toBeTruthy();
    expect(msg.closest('.notification')?.className).toContain('success');
  });

  it('auto-dismisses after the duration via onDismiss', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const items: NotificationItem[] = [{ id: 'n2', type: 'info', message: 'Hi', duration: 1000 }];
    render(<NotificationContainer notifications={items} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(onDismiss).toHaveBeenCalledWith('n2');
    vi.useRealTimers();
  });

  it('errors stay visible longer than info when no explicit duration', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const items: NotificationItem[] = [
      { id: 'err', type: 'error', message: 'Boom' },
      { id: 'inf', type: 'info', message: 'Note' },
    ];
    render(<NotificationContainer notifications={items} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(4500); });
    expect(onDismiss).toHaveBeenCalledWith('inf');
    expect(onDismiss).not.toHaveBeenCalledWith('err');
    vi.useRealTimers();
  });

  it('exposes an accessible close button for each toast', () => {
    const items: NotificationItem[] = [{ id: 'n3', type: 'warning', message: 'Watch out', duration: 60_000 }];
    render(<NotificationContainer notifications={items} onDismiss={() => {}} />);
    expect(screen.getByTitle('关闭通知')).toBeTruthy();
  });
});
