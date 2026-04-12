import { StatusDot } from '@canopy/ui';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('StatusDot', () => {
  it('renders green dot with no animation when idle', () => {
    render(<StatusDot status="idle" />);
    const dot = screen.getByRole('img', { name: 'Agent idle' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('bg-(--agent-idle)');
  });

  it('renders amber dot with pulse-slow animation when working', () => {
    render(<StatusDot status="working" />);
    const dot = screen.getByRole('img', { name: 'Agent working' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('pulse-slow');
    expect(dot.className).toContain('bg-(--agent-running)');
  });

  it('renders red dot with pulse-slow animation when permission', () => {
    render(<StatusDot status="permission" />);
    const dot = screen.getByRole('img', { name: 'Agent permission' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('pulse-slow');
    expect(dot.className).toContain('bg-(--agent-waiting)');
  });

  it('renders green static dot when review', () => {
    render(<StatusDot status="review" />);
    const dot = screen.getByRole('img', { name: 'Agent review' });
    expect(dot).toBeDefined();
    expect(dot.className).toContain('bg-green-500');
  });

  it('uses custom size prop via CSS variable', () => {
    render(<StatusDot status="working" size={12} />);
    const dot = screen.getByRole('img') as HTMLElement;
    expect(dot.style.getPropertyValue('--dot-size')).toBe('12px');
  });

  it('has accessible aria-label', () => {
    render(<StatusDot status="working" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Agent working');
  });

  it('uses default size of 8px', () => {
    render(<StatusDot status="working" />);
    const dot = screen.getByRole('img') as HTMLElement;
    expect(dot.style.getPropertyValue('--dot-size')).toBe('8px');
  });
});
