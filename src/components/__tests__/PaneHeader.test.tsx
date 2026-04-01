import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaneHeader } from '../PaneHeader';

describe('PaneHeader', () => {
  it('renders last 2 path segments', () => {
    render(<PaneHeader cwd="/Users/pierre/project/src" isFocused={false} />);
    expect(screen.getByText('project/src')).toBeInTheDocument();
  });

  it('renders ~ when cwd is empty string', () => {
    render(<PaneHeader cwd="" isFocused={false} />);
    expect(screen.getByText('~')).toBeInTheDocument();
  });

  it('applies focused text color when isFocused=true', () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={true} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.color).toBe('var(--text-primary)');
  });

  it('applies muted text color when isFocused=false', () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={false} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.color).toBe('var(--text-muted)');
  });

  it('handles single-segment path', () => {
    render(<PaneHeader cwd="/home" isFocused={false} />);
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('handles deeply nested path showing only last 2 segments', () => {
    render(<PaneHeader cwd="/a/b/c/d/e/f" isFocused={false} />);
    expect(screen.getByText('e/f')).toBeInTheDocument();
  });
});
