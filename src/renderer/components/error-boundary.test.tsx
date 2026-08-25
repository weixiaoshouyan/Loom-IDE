// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';
import { setLocale } from '@/shared/i18n';
import type { ReactElement } from 'react';

setLocale('zh-CN');

function Bomb({ message }: { message: string }): ReactElement {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary name="Widget">
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('shows the localized crash fallback including the boundary name', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary name="Widget">
        <Bomb message="kaboom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Widget 组件崩溃')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
    spy.mockRestore();
  });

  it('retry resets the boundary and mounts children again', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function MaybeBomb(): ReactElement {
      if (shouldThrow) throw new Error('transient');
      return <div>recovered</div>;
    }
    render(
      <ErrorBoundary name="W">
        <MaybeBomb />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('recovered')).toBeNull();

    // While the child still throws, retry must surface the fallback again…
    fireEvent.click(screen.getByText('重试'));
    expect(screen.queryByText('recovered')).toBeNull();

    // …and once the child recovers, retry mounts it fresh.
    shouldThrow = false;
    fireEvent.click(screen.getByText('重试'));
    expect(screen.getByText('recovered')).toBeTruthy();
    spy.mockRestore();
  });
});
