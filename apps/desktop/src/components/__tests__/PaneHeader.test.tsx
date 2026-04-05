import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { PaneHeader } from '../PaneHeader';

describe('PaneHeader', () => {
  afterEach(cleanup);

  it('renders nothing when no agent is active', () => {
    const { container } = render(<PaneHeader cwd="/Users/pierre/project/src" isFocused={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when agentStatus is idle', () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={false} agentStatus="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when agent is running', () => {
    const { container } = render(
      <PaneHeader cwd="/a/b" isFocused={false} agentStatus="running" agentName="Claude" />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('shows agent name when provided', () => {
    const { getByText } = render(
      <PaneHeader cwd="/a/b" isFocused={false} agentStatus="running" agentName="Claude" />,
    );
    expect(getByText('Claude')).toBeInTheDocument();
  });

  it('applies focused text color when isFocused=true', () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={true} agentStatus="running" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-text-primary');
  });

  it('applies muted text color when isFocused=false', () => {
    const { container } = render(<PaneHeader cwd="/a/b" isFocused={false} agentStatus="running" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('text-text-muted');
  });
});
