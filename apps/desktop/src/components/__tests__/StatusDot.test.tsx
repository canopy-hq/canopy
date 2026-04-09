import { StatusDot } from '@superagent/ui';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('StatusDot', () => {
  it('renders green dot with no animation when idle', () => {
    render(<StatusDot status="idle" />);
    const dot = screen.getByRole('img', { name: 'Agent idle' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('bg-(--agent-idle)');
  });

  it('renders orange dot with pulse-slow animation when running', () => {
    render(<StatusDot status="running" />);
    const dot = screen.getByRole('img', { name: 'Agent running' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('pulse-slow');
    expect(dot.className).toContain('bg-(--agent-running)');
  });

  it('renders red dot with breathe animation when waiting', () => {
    render(<StatusDot status="waiting" />);
    const dot = screen.getByRole('img', { name: 'Agent waiting' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('breathe');
    expect(dot.className).toContain('bg-(--agent-waiting)');
  });

  it('uses custom size prop via CSS variable', () => {
    render(<StatusDot status="running" size={12} />);
    const dot = screen.getByRole('img') as HTMLElement;
    expect(dot.style.getPropertyValue('--dot-size')).toBe('12px');
  });

  it('has accessible aria-label', () => {
    render(<StatusDot status="running" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Agent running');
  });

  it('uses default size of 8px', () => {
    render(<StatusDot status="running" />);
    const dot = screen.getByRole('img') as HTMLElement;
    expect(dot.style.getPropertyValue('--dot-size')).toBe('8px');
  });
});
