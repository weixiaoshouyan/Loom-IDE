// @vitest-environment jsdom
/**
 * 类型化事件总线测试：验证 emit/on 往返、取消订阅、载荷传递。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { emitLoomEvent, onLoomEvent } from './loom-events';

describe('loom-events typed bus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers payload to a matching listener', () => {
    const handler = vi.fn();
    onLoomEvent('loom:notify', handler);
    emitLoomEvent('loom:notify', { message: 'hello', type: 'info' });
    expect(handler).toHaveBeenCalledWith({ message: 'hello', type: 'info' });
  });

  it('supports payload-free events (undefined)', () => {
    const handler = vi.fn();
    onLoomEvent('loom:refresh-tree', handler);
    emitLoomEvent('loom:refresh-tree', undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not deliver to listeners of other events', () => {
    const handler = vi.fn();
    onLoomEvent('loom:save-file', handler);
    emitLoomEvent('loom:format-and-save', { all: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivery', () => {
    const handler = vi.fn();
    const off = onLoomEvent('loom:go-to-line', handler);
    emitLoomEvent('loom:go-to-line', { line: 3 });
    off();
    emitLoomEvent('loom:go-to-line', { line: 9 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ line: 3 });
  });

  it('supports multiple listeners on the same event', () => {
    const a = vi.fn();
    const b = vi.fn();
    onLoomEvent('loom:cmd', a);
    onLoomEvent('loom:cmd', b);
    emitLoomEvent('loom:cmd', 'openFile');
    expect(a).toHaveBeenCalledWith('openFile');
    expect(b).toHaveBeenCalledWith('openFile');
  });
});
